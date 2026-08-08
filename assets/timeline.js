/* Timeline: track toggles + hover/focus tooltips.
   The chart is readable as static HTML; this adds interaction and broadcasts
   the active-track set so other views (the CV map) can follow. */

(function () {
  var toggles = Array.prototype.slice.call(document.querySelectorAll('[data-trk]'));

  function activeTracks() {
    return toggles.filter(function (t) {
      return t.getAttribute('aria-pressed') === 'true';
    }).map(function (t) { return t.getAttribute('data-trk'); });
  }

  function broadcast() {
    document.dispatchEvent(new CustomEvent('tracks:change', {
      detail: {active: activeTracks()}
    }));
  }

  document.querySelectorAll('[data-timeline]').forEach(function (chart) {
    var box = chart.querySelector('[data-tipbox]');

    /* ---- tooltips ---- */
    function show(el) {
      var d;
      try { d = JSON.parse(el.getAttribute('data-tip')); } catch (err) { return; }
      if (d.items) {
        // a merged dot: several things happened in that year
        var noun = d.kind === 'project' ? 'project' : 'course / lecture';
        box.innerHTML =
          '<span class="tip-kind">' + d.year + ' &middot; ' + d.count + ' ' +
            noun + (d.count > 1 ? 's' : '') + (d.org ? ' &middot; ' + d.org : '') + '</span>' +
          d.items.map(function (i) {
            return '<span class="tip-item">' +
              (i.url ? '<a href="' + i.url + '" target="_blank" rel="noopener">' +
                        i.title + '</a>' : i.title) +
              '<em>' + (i.org ? i.org + ' &middot; ' : '') + i.where + '</em></span>';
          }).join('');
      } else {
        var when = '';
        if (d.from) when = '<span class="tip-when">' + d.from +
          (d.to ? ' &ndash; ' + d.to : '') + (d.dur ? ' &middot; ' + d.dur : '') + '</span>';
        box.innerHTML =
          '<span class="tip-kind">' + (d.kind === 'role' ? 'Position'
            : d.kind === 'project' ? 'Project' : 'Course / lecture') + '</span>' +
          '<span class="tip-title">' + d.role + '</span>' +
          '<span class="tip-org">' + d.org + '</span>' +
          '<span class="tip-where">' + d.where + '</span>' + when +
          (d.note ? '<span class="tip-note">' + d.note + '</span>' : '');
      }
      box.hidden = false;

      var cr = chart.getBoundingClientRect(), er = el.getBoundingClientRect();
      var w = box.offsetWidth;
      var x = er.left - cr.left + er.width / 2 - w / 2;
      box.style.left = Math.max(4, Math.min(x, cr.width - w - 4)) + 'px';
      box.style.top = (er.top - cr.top + er.height + 8) + 'px';
    }
    var timer;
    function hide() { box.hidden = true; }
    box.addEventListener('mouseenter', function () { clearTimeout(timer); });
    box.addEventListener('mouseleave', hide);

    chart.querySelectorAll('[data-tip]').forEach(function (el) {
      el.addEventListener('mouseenter', function () { clearTimeout(timer); show(el); });
      el.addEventListener('focus', function () { show(el); });
      el.addEventListener('mouseleave', function () { timer = setTimeout(hide, 220); });
      el.addEventListener('blur', hide);
    });


    document.addEventListener('tracks:change', function (ev) {
      var on = ev.detail.active;

      // Bars and dots each carry their own track. Turning Projects on on its
      // own therefore strips the bars off the chart and leaves the project
      // points standing on their rows — which is the point of that toggle.
      chart.querySelectorAll('[data-track]').forEach(function (el) {
        el.hidden = on.indexOf(el.getAttribute('data-track')) === -1;
      });

      // A row with nothing left visible would otherwise sit there as an empty
      // ruled line, so fold away whatever has no content left.
      chart.querySelectorAll('.g-lane').forEach(function (lane) {
        lane.hidden = !lane.querySelector('.g-seg:not([hidden]), .g-dot:not([hidden])');
      });
      chart.querySelectorAll('[data-band]').forEach(function (band) {
        band.hidden = !band.querySelector('.g-lane:not([hidden])');
      });
      hide();
    });
  });

  /* ---- track selection -------------------------------------------------
     Same feel as the facet buttons on the listing pages. Untouched, every
     track is on. The first click is read as "show me only this one" rather
     than "hide this one" — otherwise picking a track means four clicks.
     After that the buttons behave additively, and emptying the selection
     falls back to showing everything. */
  var pristine = true;   // nothing chosen yet — all tracks on
  var chosen = {};       // explicit selection, once the user has picked

  function paint() {
    toggles.forEach(function (t) {
      var k = t.getAttribute('data-trk');
      t.setAttribute('aria-pressed', String(pristine || !!chosen[k]));
    });
  }

  toggles.forEach(function (t) {
    t.addEventListener('click', function () {
      var k = t.getAttribute('data-trk');
      if (pristine) {
        pristine = false;
        chosen = {};
        chosen[k] = true;
      } else if (chosen[k]) {
        delete chosen[k];
        if (!Object.keys(chosen).length) pristine = true;   // back to everything
      } else {
        chosen[k] = true;
      }
      paint();
      broadcast();
    });
  });

  if (toggles.length) { paint(); broadcast(); }
})();
