/* Facet filters + free-text search + year picking from the chart.
   Every filterable list is a [data-filterable] container whose children carry
   data-s (lowercase haystack), and optionally data-f (facet) and data-y (year). */

(function () {
  document.querySelectorAll('[data-filterable]').forEach(function (list) {
    var scope = list.closest('.wrap') || document;
    var box = scope.querySelector('[data-search]');
    var facets = Array.prototype.slice.call(scope.querySelectorAll('[data-facet]'));
    var points = Array.prototype.slice.call(scope.querySelectorAll('[data-year]'));
    var yearClear = scope.querySelector('[data-yearclear]');
    var yearLabel = scope.querySelector('[data-yearlabel]');
    var count = scope.querySelector('[data-count]');
    var empty = scope.querySelector('[data-empty]');
    var items = Array.prototype.slice.call(list.querySelectorAll('[data-s]'));
    var spark = scope.querySelector('[data-spark]');
    var active = '';      // facet
    var year = '';        // year picked on the chart

    function apply() {
      var q = (box && box.value || '').trim().toLowerCase();
      var terms = q ? q.split(/\s+/) : [];
      var shown = 0;

      // The chart reflects the facet and the search, but not the year pick —
      // otherwise choosing a year would collapse the line to a single point.
      var counts = {}, narrowed = false;

      items.forEach(function (el) {
        var hay = el.getAttribute('data-s');
        var okFacet = !active || el.getAttribute('data-f') === active;
        var okText = terms.every(function (t) { return hay.indexOf(t) !== -1; });
        var okYear = !year || el.getAttribute('data-y') === year;
        if (okFacet && okText) {
          var y = el.getAttribute('data-y');
          if (y) counts[y] = (counts[y] || 0) + 1;
        }
        var on = okFacet && okYear && okText;
        el.hidden = !on;
        if (on) shown++;
      });
      narrowed = !!(active || terms.length);
      if (spark && spark.updateCounts) spark.updateCounts(narrowed ? counts : null);

      // hide a group heading when everything under it is filtered out
      list.querySelectorAll('[data-group]').forEach(function (g) {
        var sibs = [], n = g.nextElementSibling;
        while (n && !n.hasAttribute('data-group')) {
          if (n.hasAttribute('data-s')) sibs.push(n);
          n = n.nextElementSibling;
        }
        g.hidden = sibs.length > 0 && sibs.every(function (s) { return s.hidden; });
      });

      if (count) count.textContent = shown;
      if (empty) empty.hidden = shown !== 0;
      facets.forEach(function (f) {
        f.setAttribute('aria-pressed', f.getAttribute('data-facet') === active);
      });
      points.forEach(function (p) {
        p.setAttribute('aria-pressed', p.getAttribute('data-year') === year);
      });
      if (yearClear) yearClear.hidden = !year;
      if (yearLabel) yearLabel.textContent = year;
    }

    facets.forEach(function (f) {
      f.addEventListener('click', function () {
        var key = f.getAttribute('data-facet');
        active = (active === key) ? '' : key;
        apply();
      });
    });

    points.forEach(function (p) {
      p.addEventListener('click', function () {
        var y = p.getAttribute('data-year');
        year = (year === y) ? '' : y;
        apply();
      });
    });

    if (yearClear) {
      yearClear.addEventListener('click', function () { year = ''; apply(); });
    }

    if (box) {
      box.addEventListener('input', apply);
      box.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { box.value = ''; active = ''; year = ''; apply(); box.blur(); }
      });
    }

    var clear = scope.querySelector('[data-clear]');
    if (clear) {
      clear.addEventListener('click', function () {
        if (box) box.value = '';
        active = '';
        year = '';
        apply();
        if (box) box.focus();
      });
    }

    apply();
  });
})();
