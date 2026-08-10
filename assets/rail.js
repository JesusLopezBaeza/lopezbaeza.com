/* Year selection, drawn on the timeline itself.

   Earlier versions used a separate rail, which meant two time axes on one
   screen showing the same years. The drag now happens on the chart: a press
   that does not start on a bar or a dot begins a selection, so hovering an
   entry still works and there is only one timeline to read. */

(function () {
  var chart = document.querySelector('.cvsplit-time [data-timeline]');
  if (!chart) return;

  var lab = document.querySelector('[data-yearlab]');
  var clear = document.querySelector('[data-railclear]');
  var LO = 2010, HI = 2027;
  var m = /(\d+)\s*,\s*(\d+)/.exec(chart.getAttribute('data-range') || '');
  if (m) { LO = +m[1]; HI = +m[2]; }

  var band = document.createElement('div');
  band.className = 'g-span';
  chart.appendChild(band);

  var from = null, to = null, dragging = false, moved = false;

  function lane() { return chart.querySelector('.g-track'); }

  function yearAt(ev) {
    var l = lane();
    if (!l) return LO;
    var b = l.getBoundingClientRect();
    var f = Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width));
    return LO + f * (HI - LO);
  }

  function bounds() {
    return [Math.floor(Math.min(from, to)), Math.ceil(Math.max(from, to))];
  }

  function paint() {
    var has = from !== null;
    chart.classList.toggle('has-span', has);
    if (clear) clear.hidden = !has;
    if (lab) lab.textContent = has ? bounds().join(' – ') : 'All years';
    if (!has) return;

    var l = lane();
    if (!l) return;
    var cb = chart.getBoundingClientRect(), lb = l.getBoundingClientRect();
    var b = bounds();
    var x0 = (b[0] - LO) / (HI - LO), x1 = (b[1] - LO) / (HI - LO);
    band.style.left = (lb.left - cb.left + lb.width * x0) + 'px';
    band.style.width = (lb.width * (x1 - x0)) + 'px';
  }

  function broadcast() {
    var b = from === null ? null : bounds();
    document.dispatchEvent(new CustomEvent('years:change', {
      detail: b === null ? null : {from: b[0], to: b[1]}
    }));
  }

  chart.addEventListener('pointerdown', function (ev) {
    // leave the entries themselves alone — they have their own hover and links
    if (ev.target.closest('.g-dot, .g-seg, a, button')) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    dragging = true;
    moved = false;
    from = to = yearAt(ev);
    chart.classList.add('is-brushing');
    chart.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  chart.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    to = yearAt(ev);
    if (Math.abs(to - from) > 0.2) moved = true;
    paint();
  });

  function end() {
    if (!dragging) return;
    dragging = false;
    chart.classList.remove('is-brushing');
    // a click with no drag clears, so there is an obvious way back
    if (!moved) { from = to = null; }
    paint();
    broadcast();
  }
  ['pointerup', 'pointercancel'].forEach(function (t) {
    chart.addEventListener(t, end);
  });

  if (clear) {
    clear.addEventListener('click', function () {
      from = to = null;
      paint();
      broadcast();
    });
  }

  window.addEventListener('resize', paint);
  document.addEventListener('tracks:change', function () { setTimeout(paint, 0); });
  paint();
})();
