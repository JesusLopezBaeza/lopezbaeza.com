/* Flight Log — the numeric widgets.

   Every figure describes the current crossfilter selection, not the whole
   diary, so clicking an airline in the bar chart re-reads all of them. The two
   exceptions say so on their face: "first flight" and the year-on-year arrow
   need the record before the selection to mean anything.

   Kept apart from flights.js because that file is about reading files and
   drawing maps, and this one is only arithmetic. */

(function () {
  var root = document.getElementById('fl-kpis');
  if (!root) return;

  var EARTH = 40075;          // equatorial circumference, km
  var MOON = 384400;          // mean Earth–Moon distance, km
  var LONG_HAUL = 4000;       // km — the usual dividing line for long-haul

  function stat(name, value, note, dir) {
    var el = root.querySelector('[data-s="' + name + '"]');
    if (!el) return;
    el.querySelector('b').textContent = value;
    var i = el.querySelector('i');
    if (i) i.innerHTML = note || '';
    el.classList.toggle('is-empty', value === '—' || value === 0 || value === '0');
    if (dir !== undefined) {
      el.setAttribute('data-dir', dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat');
    }
  }

  /* The proportion bars sit in their own three-column block, outside the
     column of figures beside the map — so they cannot be looked up inside
     #fl-kpis, which is what silently left every one of them showing a dash. */
  var bars = document.getElementById('fl-bars');

  function bar(name, value, pct, note) {
    var el = bars && bars.querySelector('[data-bar="' + name + '"]');
    if (!el) return;
    el.querySelector('b').textContent = value;
    el.querySelector('.statbar-t i').style.width =
      (Math.max(0, Math.min(1, pct)) * 100).toFixed(1) + '%';
    el.querySelector('em').innerHTML = note;
  }

  function short(s, n) {
    s = String(s == null ? '—' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];

  window.FL_KPI = function (d, all, u) {
    var n = d.length;
    var km = u.sum(d, function (x) { return x.distance_km; });
    var hrs = u.sum(d, function (x) { return x.duration_h; });
    var years = u.uniq(d.map(function (x) { return x.year; })).sort();
    var thisYear = new Date().getFullYear();

    /* --- volume ------------------------------------------------------- */
    stat('legs', u.fmt(n), n === 1 ? 'flight leg' : 'flight legs');

    /* The denominator is the span the flights occupy, not the calendar. A
       diary that starts in 2001 and a filter showing only 2024 should not be
       divided by the same number of years. */
    var span = years.length ? (Math.max.apply(null, years) - Math.min.apply(null, years) + 1) : 0;
    stat('rate', span ? u.fmt(n / span, 1) : '—', span ? 'per year over ' + span + ' years' : '');

    /* Last full year against the one before. The current year is still running,
       so comparing it would always look like a collapse. */
    var byYear = {};
    d.forEach(function (x) { byYear[x.year] = (byYear[x.year] || 0) + 1; });
    var last = thisYear - 1;
    var a = byYear[last] || 0, b = byYear[last - 1] || 0, delta = a - b;
    stat('last', n ? u.fmt(a) : '—',
      (delta > 0 ? '&#9650; ' : delta < 0 ? '&#9660; ' : '&#9644; ') +
      'vs ' + (last - 1) + ' (' + b + ')', delta);

    var months = {};
    d.forEach(function (x) { months[x.date.slice(0, 7)] = 1; });
    stat('permonth', n ? u.fmt(n / Math.max(1, Object.keys(months).length), 1) : '—',
      'per active month');

    /* --- distance and reach ------------------------------------------- */
    stat('km', km ? u.fmt(km) : '—', 'kilometres, great-circle');
    stat('laps', km ? u.fmt(km / EARTH, 2) : '—', 'times around the Earth');

    /* Below one whole trip the ratio reads as nothing at all — 0.13 tells you
       less than 13%. So under 1 it is shown as a percentage of the way there. */
    var moon = km / MOON;
    stat('moon', !km ? '—' : moon >= 1 ? u.fmt(moon, 2) : (moon * 100).toFixed(1) + '%',
      moon >= 1 ? 'one-way trips' : 'of one trip there');
    stat('hours', hrs ? u.fmt(hrs, 0) + ' h' : '—',
      d.some(function (x) { return x.duration_est; }) ? 'air time, part estimated' : 'air time');
    stat('avgleg', n && km ? u.fmt(km / n) : '—', 'km, average leg');

    var placed = d.filter(function (x) { return x.placed; });
    var longest = null, shortest = null;
    placed.forEach(function (x) {
      if (x.distance_km === null) return;
      if (!longest || x.distance_km > longest.distance_km) longest = x;
      if (!shortest || x.distance_km < shortest.distance_km) shortest = x;
    });
    stat('longest', longest ? u.fmt(longest.distance_km) : '—',
      longest ? short(longest.route, 22) : 'longest leg');
    stat('shortest', shortest ? u.fmt(shortest.distance_km) : '—',
      shortest ? short(shortest.route, 22) : 'shortest leg');

    var airports = {};
    d.forEach(function (x) {
      if (x.dep_iata) airports[x.dep_iata] = 1;
      if (x.arr_iata) airports[x.arr_iata] = 1;
    });
    stat('airports', u.fmt(Object.keys(airports).length), 'airports touched');

    var countries = {};
    d.forEach(function (x) {
      if (x.dep_country) countries[x.dep_country] = 1;
      if (x.arr_country) countries[x.arr_country] = 1;
    });
    stat('countries', u.fmt(Object.keys(countries).length), 'countries');

    /* --- rhythm and recency ------------------------------------------- */
    var busiestY = null;
    Object.keys(byYear).forEach(function (y) {
      if (!busiestY || byYear[y] > byYear[busiestY]) busiestY = y;
    });
    stat('busyyear', busiestY || '—', busiestY ? byYear[busiestY] + ' flights' : '');

    var byMonth = {};
    d.forEach(function (x) { byMonth[x.month] = (byMonth[x.month] || 0) + 1; });
    var busiestM = null;
    Object.keys(byMonth).forEach(function (m) {
      if (!busiestM || byMonth[m] > byMonth[busiestM]) busiestM = m;
    });
    stat('busymonth', busiestM ? MONTHS[busiestM - 1].slice(0, 3) : '—',
      busiestM ? byMonth[busiestM] + ' flights, all years' : '');

    /* Sorted dates, so the widest hole between two consecutive flights. */
    var dates = d.map(function (x) { return x.date; }).sort();
    var gap = 0, gapAt = '';
    for (var i = 1; i < dates.length; i++) {
      var days = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000;
      if (days > gap) { gap = days; gapAt = dates[i - 1]; }
    }
    stat('gap', dates.length > 1 ? u.fmt(gap) : '—',
      gap ? 'days, from ' + gapAt : 'longest gap');

    /* A diary can hold flights that have not happened yet — tickets booked, a
       trip next month. Counting days "since" one of those gives a negative
       number, which reads as a bug rather than as a booking, so a future date
       is counted forwards and labelled as such. */
    var last = dates.length ? dates[dates.length - 1] : null;
    var since = last ? Math.round((Date.now() - Date.parse(last)) / 86400000) : null;
    stat('since', since === null ? '—' : u.fmt(Math.abs(since)),
      !last ? 'since last flight'
            : since >= 0 ? 'days since ' + last
                         : 'days until ' + last);

    /* A leg counts as returned if the same unordered pair appears an even
       number of times — a rough but honest reading of "did you come back". */
    var pairs = u.tally(d, function (x) { return x.route_pair; });
    var returned = 0;
    Object.keys(pairs).forEach(function (p) { returned += pairs[p] - (pairs[p] % 2); });
    bar('returns', n ? Math.round(returned / n * 100) + '%' : '—',
      n ? returned / n : 0,
      n ? u.fmt(returned) + ' of ' + u.fmt(n) + ' legs are part of a matched pair' : '');

    /* --- diversity and specialisation --------------------------------- */
    function spread(key, fn, noun) {
      var t = u.tally(d, fn);
      var r = u.entropy(t);
      bar(key, r.k ? (r.h * 100).toFixed(0) + '%' : '—', r.h,
        r.k ? short(r.top, 26) + ' leads with ' + Math.round(r.share * 100) +
              '% of ' + r.k + ' ' + noun
            : 'nothing selected');
    }
    spread('spread-airline', function (x) { return x.airline; }, 'airlines');
    spread('spread-route', function (x) { return x.route_pair; }, 'routes');
    spread('spread-aircraft', function (x) { return x.aircraft; }, 'types');
    spread('spread-country', function (x) {
      return x.arr_country || x.dep_country;
    }, 'countries');

    /* --- cabin and aircraft -------------------------------------------- */
    var ac = u.tally(d, function (x) { return x.aircraft; });
    var topAc = Object.keys(ac).sort(function (x, y) { return ac[y] - ac[x]; })[0];
    stat('aircraft', topAc ? short(topAc, 16) : '—',
      topAc ? ac[topAc] + ' flights · ' + Math.round(ac[topAc] / n * 100) + '%' : 'most flown');

    var regs = u.uniq(d.map(function (x) { return x.registration; }));
    stat('tails', regs.length ? u.fmt(regs.length) : '—', 'individual aircraft');

    var airlines = u.uniq(d.map(function (x) { return x.airline; }));
    stat('airlines', u.fmt(airlines.length), 'airlines');

    stat('avgdur', hrs && n ? u.fmt(hrs / n, 1) + ' h' : '—', 'average leg');

    var lh = placed.filter(function (x) { return (x.distance_km || 0) >= LONG_HAUL; }).length;
    bar('longhaul', n ? Math.round(lh / n * 100) + '%' : '—', n ? lh / n : 0,
      n ? u.fmt(lh) + ' legs of 4,000 km or more' : '');

    var cabins = u.tally(d, function (x) { return x.flight_class; });
    var topCab = Object.keys(cabins).sort(function (x, y) { return cabins[y] - cabins[x]; })[0];
    bar('cabin', topCab ? short(topCab, 14) : '—', topCab ? cabins[topCab] / n : 0,
      topCab ? Math.round(cabins[topCab] / n * 100) + '% of the selection' : '');

    /* Matched on the word rather than a code, so a diary that spells its own
       purposes still lands somewhere sensible. */
    var work = d.filter(function (x) { return /business|work|crew|duty/i.test(x.reason); }).length;
    bar('business', n ? Math.round(work / n * 100) + '%' : '—', n ? work / n : 0,
      n ? u.fmt(work) + ' of ' + u.fmt(n) + ' legs recorded as work' : '');

    var dom = d.filter(function (x) {
      return x.dep_country && x.arr_country && x.dep_country === x.arr_country;
    }).length;
    bar('domestic', n ? Math.round(dom / n * 100) + '%' : '—', n ? dom / n : 0,
      n ? u.fmt(dom) + ' legs begin and end in the same country' : '');

    /* --- the two that describe the record, not the selection ----------- */
    stat('first', all.length ? all[0].date : '—', 'first flight on record');
    stat('recent', all.length ? all[all.length - 1].date : '—', 'latest flight on record');
  };
})();
