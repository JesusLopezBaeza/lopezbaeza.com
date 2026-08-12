/* Dashboard widgets under the map.

   Everything is recomputed from the raw records whenever the track toggles or
   the year selection change, so the numbers describe exactly the slice on
   screen rather than the whole CV. */

(function () {
  var root = document.getElementById('kpis');
  if (!root) return;

  var BASE = JSON.parse(document.getElementById('kpidata').textContent);
  var GEOBASE = JSON.parse(document.getElementById('cvdata').textContent);
  var DATA = BASE, GEO = GEOBASE;
  var tracks = null;               // null = every track
  var span = null;                 // null = every year

  var PUB = 'publications', EV = 'courses', PROJ = 'projects', PRACTICE = 'practice';

  function on(t) { return !tracks || tracks.indexOf(t) !== -1; }
  function inSpan(y) { return !span || (y >= span.from && y <= span.to); }

  function rows(key, track) {
    if (!on(track)) return [];
    return (DATA[key] || []).filter(function (r) { return inSpan(r.y); });
  }

  function geo() {
    return GEO.filter(function (d) {
      if (tracks && tracks.indexOf(d.track) === -1) return false;
      if (span && (Math.ceil(d.end) < span.from || Math.floor(d.start) > span.to)) return false;
      return true;
    });
  }

  function count(list, key) {
    var s = {};
    list.forEach(function (r) { if (r[key]) s[r[key]] = 1; });
    return Object.keys(s).length;
  }

  function byYear(list) {
    var m = {};
    list.forEach(function (r) { m[r.y] = (m[r.y] || 0) + 1; });
    return m;
  }

  function byType(list) {
    var m = {};
    list.forEach(function (r) { m[r.t] = (m[r.t] || 0) + 1; });
    return m;
  }

  /* The denominator is the span the records occupy, not the whole axis:
     dividing by every year since 2010 would understate the rate, because the
     first record is years after the axis begins. */
  function activeYears(list) {
    if (span) return Math.max(1, span.to - span.from + 1);
    if (!list || !list.length) return 1;
    var ys = list.map(function (r) { return r.y; });
    return Math.max(1, Math.max(Math.max.apply(null, ys), new Date().getFullYear()) -
                       Math.min.apply(null, ys) + 1);
  }

  /* Shannon entropy over a category mix, normalised to 0–1 so mixes with
     different numbers of categories stay comparable. */
  function entropy(counts) {
    var keys = Object.keys(counts);
    if (keys.length < 2) return {h: 0, top: keys[0] || '—', share: keys.length ? 1 : 0};
    var total = keys.reduce(function (a, k) { return a + counts[k]; }, 0);
    if (!total) return {h: 0, top: '—', share: 0};
    var h = 0;
    keys.forEach(function (k) {
      var p = counts[k] / total;
      if (p > 0) h -= p * Math.log(p);
    });
    var top = keys.reduce(function (a, b) { return counts[a] >= counts[b] ? a : b; });
    return {h: h / Math.log(keys.length), top: top, share: counts[top] / total};
  }

  /* ---------------- rendering ---------------- */

  function stat(name, value, note, dir) {
    var el = root.querySelector('[data-s="' + name + '"]');
    if (!el) return;
    el.querySelector('b').textContent = value;
    var n = el.querySelector('i');
    if (n) n.innerHTML = note || '';
    el.classList.toggle('is-empty', value === '—' || value === 0 || value === '0');
    if (dir !== undefined) el.setAttribute('data-dir', dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat');
  }

  function bar(name, value, pct, note) {
    var el = root.querySelector('[data-bar="' + name + '"]');
    if (!el) return;
    el.querySelector('b').textContent = value;
    el.querySelector('i').style.width = (pct * 100).toFixed(1) + '%';
    el.querySelector('em').innerHTML = note;
  }

  function radar(svg, counts) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var NS = 'http://www.w3.org/2000/svg';
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var cx = 100, cy = 84, R = 44;   // smaller: two of these share one row now

    if (!keys.length) {
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', cx); t.setAttribute('y', cy);
      t.setAttribute('class', 'rd-empty'); t.setAttribute('text-anchor', 'middle');
      t.textContent = 'nothing selected';
      svg.appendChild(t);
      return;
    }
    var max = Math.max.apply(null, keys.map(function (k) { return counts[k]; }));
    var n = keys.length;
    function pt(i, r) {
      var a = -Math.PI / 2 + i / n * Math.PI * 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    }
    function poly(cls, pts) {
      var p = document.createElementNS(NS, 'polygon');
      p.setAttribute('class', cls);
      p.setAttribute('points', pts.map(function (q) {
        return q[0].toFixed(1) + ',' + q[1].toFixed(1);
      }).join(' '));
      svg.appendChild(p);
    }
    [0.5, 1].forEach(function (f) {
      poly('rd-ring', keys.map(function (_, i) { return pt(i, R * f); }));
    });
    keys.forEach(function (_, i) {
      var l = document.createElementNS(NS, 'line');
      l.setAttribute('class', 'rd-spoke');
      l.setAttribute('x1', cx); l.setAttribute('y1', cy);
      var p = pt(i, R);
      l.setAttribute('x2', p[0].toFixed(1)); l.setAttribute('y2', p[1].toFixed(1));
      svg.appendChild(l);
    });
    poly('rd-area', keys.map(function (k, i) { return pt(i, R * (counts[k] / max)); }));
    keys.forEach(function (k, i) {
      var p = pt(i, R + 10);
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', p[0].toFixed(1));
      t.setAttribute('y', p[1].toFixed(1));
      t.setAttribute('class', 'rd-lab');
      t.setAttribute('text-anchor', p[0] > cx + 5 ? 'start' : p[0] < cx - 5 ? 'end' : 'middle');
      t.textContent = (k.length > 12 ? k.slice(0, 11) + '…' : k) + ' ' + counts[k];
      svg.appendChild(t);
    });
  }

  var svgPub = root.querySelector('[data-radar="publications"]');
  var svgEv = root.querySelector('[data-radar="events"]');
  var birthEl = root.querySelector('[data-birth]');

  /* Retirement is read off a birth year the reader can edit, so the bar means
     something for whoever is looking at it rather than only for me. */
  function birthYear() {
    var v = birthEl ? parseInt(birthEl.value, 10) : NaN;
    if (!isNaN(v) && v > 1900 && v < 2100) return v;
    return DATA.birthYear || (DATA.retireYear - (DATA.retirementAge || 67));
  }

  /* Rate, last full year against the one before, peak and active years for one
     kind of record. Used for publications and, separately, for projects. */
  function series(list, prefix, noun) {
    var thisYear = new Date().getFullYear();
    var yrs = byYear(list);
    stat(prefix + 'rate', list.length ? (list.length / activeYears(list)).toFixed(1) : '—',
      'per year');

    var last = span ? span.to : thisYear - 1;   // the current year is still running
    var a = yrs[last] || 0, b = yrs[last - 1] || 0, d = a - b;
    stat(prefix + 'last', list.length ? a : '—',
      (d > 0 ? '&#9650; ' : d < 0 ? '&#9660; ' : '&#9644; ') + 'vs ' + (last - 1) +
      ' (' + b + ')', d);

    // the busiest year is a single figure across every kind of entry, so it is
    // computed once in render() rather than per series
    if (!prefix) stat('active', Object.keys(yrs).length, 'years with ' + noun);
  }

  function render() {
    var pubs = rows('publications', PUB);
    var evs = rows('events', EV);
    var projs = rows('projects', PROJ);
    var g = geo();
    var thisYear = new Date().getFullYear();

    /* --- counts --- */
    stat('pubs', pubs.length);
    stat('projects', projs.length);
    stat('events', evs.length);
    stat('cities', count(g, 'city'));
    stat('countries', count(g, 'country'));
    stat('orgs', count(g, 'org'));

    /* --- how many places have employed him --- */
    stat('employers', count(g.filter(function (d) { return d.track === 'practice'; }), 'org'));

    /* --- rate and last-year, once for publications and once for projects --- */
    series(pubs, '', 'publications');
    series(projs, 'p', 'projects');

    /* --- busiest year, counting publications, projects and events together --- */
    var all = {};
    [pubs, evs, projs].forEach(function (l) {
      l.forEach(function (r) { all[r.y] = (all[r.y] || 0) + 1; });
    });
    var allYears = Object.keys(all);
    if (allYears.length) {
      var peak = allYears.reduce(function (x, y) { return all[x] >= all[y] ? x : y; });
      stat('peak', peak, all[peak] + ' entries');
    } else {
      stat('peak', '—', '');
    }

    /* --- reach: the share of the selection outside the commonest country,
           which is derived rather than hard-coded so an imported CV gets its
           own home country --- */
    var byCountry = {};
    g.forEach(function (d) { if (d.country) byCountry[d.country] = (byCountry[d.country] || 0) + 1; });
    var cs = Object.keys(byCountry);
    if (cs.length) {
      var home = cs.reduce(function (a, b) { return byCountry[a] >= byCountry[b] ? a : b; });
      var total = cs.reduce(function (a, k) { return a + byCountry[k]; }, 0);
      var away = total - byCountry[home];
      stat('abroad', Math.round(away / total * 100) + '%',
        away + ' of ' + total + ' outside ' + home);
    } else {
      stat('abroad', '—', '');
    }

    /* --- career progress --- */
    var start = DATA.practiceStart, end = birthYear() + (DATA.retirementAge || 67);
    var now = thisYear + (new Date().getMonth() / 12);
    var done = Math.max(0, now - start), total = end - start;
    var note = start + ' &rarr; ' + end + ' &middot; ' +
      Math.round(done / total * 100) + '% elapsed, ' +
      Math.max(0, Math.round(total - done)) + ' to go';
    // an imported file rarely says when its owner retires, so be honest about
    // where the far end of this bar came from
    note += ' &middot; retiring at ' + (DATA.retirementAge || 67);
    if (DATA.startAssumed) {
      note += '. No employment rows in this file, so the start is the earliest ' +
        'entry of any kind.';
    }
    bar('career', done.toFixed(0) + ' yrs', Math.max(0, Math.min(1, done / total)), note);

    /* --- breadth --- */
    var mix = {};
    [[pubs, 'publication'], [evs, 'event'], [projs, 'project']].forEach(function (p) {
      p[0].forEach(function (r) {
        var k = p[1] + ': ' + r.t;
        mix[k] = (mix[k] || 0) + 1;
      });
    });
    var ent = entropy(mix);
    bar('breadth', ent.h ? ent.h.toFixed(2) : '—', ent.h,
      ent.h ? '0 = one category only, 1 = an even spread. Across ' +
              Object.keys(mix).length + ' categories.'
            : 'Nothing selected.');

    radar(svgPub, byType(pubs));
    radar(svgEv, byType(evs));
  }

  if (birthEl) {
    ['input', 'change'].forEach(function (t) { birthEl.addEventListener(t, render); });
  }

  /* The "i" bubbles are placed by wi.js, which every page loads — the rule it
     has to satisfy (never be clipped by a scrolling ancestor) turned up on the
     Flight Log, and one implementation is better than two. */

  document.addEventListener('tracks:change', function (ev) { tracks = ev.detail.active; render(); });
  document.addEventListener('years:change', function (ev) { span = ev.detail; render(); });
  document.addEventListener('data:change', function (ev) {
    DATA = ev.detail || BASE;
    // a file carrying a retirement row can preset the box
    if (birthEl && DATA.birthYear) birthEl.value = DATA.birthYear;
    render();
  });
  document.addEventListener('mapdata:change', function (ev) { GEO = ev.detail || GEOBASE; render(); });

  render();
})();
