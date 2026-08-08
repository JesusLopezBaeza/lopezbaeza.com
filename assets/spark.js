/* Per-year line chart: tooltips, plus a redraw hook so the active filters
   reshape the line. Clicking a year is handled by filter.js. */

(function () {
  document.querySelectorAll('[data-spark]').forEach(function (fig) {
    var box = fig.querySelector('[data-tipbox]');
    var timer;
    // charts sitting in a narrow column ask for the tip to drop below the
    // whole figure rather than float over the prose next to it
    var below = !!fig.closest('[data-tip-below]');

    function hide() { box.hidden = true; }

    function show(col) {
      var d;
      try { d = JSON.parse(col.getAttribute('data-tip')); } catch (err) { return; }

      if (d.series) {
        box.innerHTML = '<span class="tip-kind">' + d.year + '</span>' +
          d.series.map(function (s) {
            return '<span class="tip-item"><span class="tip-sname">' + s.name +
              ' <b>' + s.count + '</b></span>' +
              (s.items.length ? '<em>' + s.items.join(' · ') + '</em>' : '') + '</span>';
          }).join('');
      } else if (!d.count) {
        box.innerHTML = '<span class="tip-kind">' + d.year + '</span>' +
                        '<span class="tip-line">Nothing here.</span>';
      } else {
        box.innerHTML =
          '<span class="tip-kind">' + d.year + ' &middot; ' + d.count + ' ' +
            d.noun + (d.count > 1 ? 's' : '') + '</span>' +
          d.items.map(function (i) {
            return '<span class="tip-item">' +
              (i.url ? '<a href="' + i.url + '" target="_blank" rel="noopener">' +
                        i.title + '</a>' : i.title) +
              (i.meta ? '<em>' + i.meta + '</em>' : '') + '</span>';
          }).join('') +
          (d.more ? '<span class="tip-line">+ ' + d.more + ' more</span>' : '') +
          (d.clickable ? '<span class="tip-line tip-hint">Click to show only ' +
            d.year + '</span>' : '');
      }
      box.hidden = false;

      var fr = fig.getBoundingClientRect(), cr = col.getBoundingClientRect();
      var w = box.offsetWidth, h = box.offsetHeight;
      var x = cr.left - fr.left + cr.width / 2 - w / 2;
      box.style.left = Math.max(0, Math.min(x, fr.width - w)) + 'px';

      if (below) {
        // clear of the figure entirely, so it never lands on the text beside it
        box.style.top = (fr.height + 8) + 'px';
        return;
      }
      // open above the point, unless that would run off the top of the window
      var above = cr.top - fr.top - h - 8;
      box.style.top = (cr.top - h - 8 < 8 ? cr.top - fr.top + cr.height + 8 : above) + 'px';
    }

    fig.querySelectorAll('[data-tip]').forEach(function (col) {
      col.addEventListener('mouseenter', function () { clearTimeout(timer); show(col); });
      col.addEventListener('focus', function () { show(col); });
      col.addEventListener('mouseleave', function () { timer = setTimeout(hide, 200); });
      col.addEventListener('blur', hide);
    });
    box.addEventListener('mouseenter', function () { clearTimeout(timer); });
    box.addEventListener('mouseleave', hide);

    /* ---- legend doubles as a series filter (multi-series charts) --------- */
    var keys = Array.prototype.slice.call(fig.querySelectorAll('.sp-key[data-series]'));
    if (keys.length) {
      // Same rule as the facet buttons and the timeline tracks: untouched,
      // every series shows; the first click means "only this one"; after that
      // the keys behave additively, and emptying the set restores everything.
      var pristine = true, chosen = {};

      var paint = function () {
        keys.forEach(function (k) {
          var i = k.getAttribute('data-series');
          var on = pristine || !!chosen[i];
          k.setAttribute('aria-pressed', String(on));
          var series = fig.querySelector('.sp-series[data-series="' + i + '"]');
          if (series) series.hidden = !on;
        });
        hide();
      };

      keys.forEach(function (key) {
        key.addEventListener('click', function () {
          var i = key.getAttribute('data-series');
          if (pristine) { pristine = false; chosen = {}; chosen[i] = true; }
          else if (chosen[i]) {
            delete chosen[i];
            if (!Object.keys(chosen).length) pristine = true;
          } else chosen[i] = true;
          paint();
        });
      });
      paint();
    }

    /* ---- redraw from a filtered subset ---------------------------------- */
    var pts = Array.prototype.slice.call(fig.querySelectorAll('.sp-pt'));
    if (!pts.length) return;            // the multi-series chart has no points to redraw
    var path = fig.querySelector('.sp-path');
    var area = fig.querySelector('.sp-area');
    var meta = fig.querySelector('.sp-meta');
    var years = pts.map(function (p) { return p.getAttribute('data-year'); });
    var n = years.length;

    function xAt(i) { return n === 1 ? 0 : i / (n - 1) * 100; }

    // remember the unfiltered shape so Clear restores it exactly
    var base = {
      path: path.getAttribute('points'),
      area: area.getAttribute('points'),
      meta: meta ? meta.innerHTML : '',
      y: pts.map(function (p) { return p.style.getPropertyValue('--y'); }),
      n: pts.map(function (p) { return p.querySelector('.sp-n').textContent; })
    };

    function draw(vals, peak) {
      var poly = vals.map(function (v, i) {
        return xAt(i).toFixed(2) + ',' + (100 - v / peak * 100).toFixed(2);
      }).join(' ');
      path.setAttribute('points', poly);
      area.setAttribute('points',
        xAt(0).toFixed(2) + ',100 ' + poly + ' ' + xAt(n - 1).toFixed(2) + ',100');
      pts.forEach(function (p, i) {
        p.style.setProperty('--y', (vals[i] / peak * 100).toFixed(3) + '%');
        p.querySelector('.sp-n').textContent = vals[i] || '';
        p.classList.toggle('is-zero', vals[i] === 0);
      });
    }

    fig.updateCounts = function (counts) {
      var reset = meta ? meta.querySelector('[data-yearclear]') : null;

      if (!counts) {                                   // nothing filtered — restore
        path.setAttribute('points', base.path);
        area.setAttribute('points', base.area);
        pts.forEach(function (p, i) {
          p.style.setProperty('--y', base.y[i]);
          p.querySelector('.sp-n').textContent = base.n[i];
          p.classList.toggle('is-zero', !base.n[i].trim());
        });
        if (meta) {
          meta.innerHTML = base.meta;
          if (reset) { meta.appendChild(reset); }
        }
        return;
      }

      var vals = years.map(function (y) { return counts[y] || 0; });
      var peak = Math.max.apply(null, vals.concat([1]));
      draw(vals, peak);

      var total = vals.reduce(function (a, b) { return a + b; }, 0);
      if (meta) {
        meta.innerHTML = total
          ? total + ' shown &middot; peak ' + peak + ' in ' + years[vals.indexOf(peak)]
          : 'nothing matches';
        if (reset) meta.appendChild(reset);
      }
      hide();
    };
  });
})();
