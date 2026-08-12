/* Flight Log — read a diary, draw it, and let every panel filter every other.

   Nothing is uploaded. The file is parsed in the browser, the airport table is
   fetched once from this site, and closing the tab is all it takes to be rid of
   the data. The page ships empty: no dashboard exists until a file is dropped.

   Three parsers, because people arrive with three things: a flightdiary.net CSV
   export (codes and bracketed labels), the .xlsx template, or a CSV saved from
   that template. They converge on one row shape and the rest of the file does
   not know which it was. */

(function () {
  var root = document.getElementById('fl');
  if (!root) return;

  var drop = document.getElementById('fl-drop');
  var app = document.getElementById('fl-app');
  var err = document.getElementById('fl-err');
  var meta = document.getElementById('fl-meta');

  var FLIGHTS = [];      // every parsed leg
  var AIRPORTS = null;   // IATA -> [lat, lon, city, country]
  var UNPLACED = 0;      // legs that could not be put on the map

  /* The site is paper, ink and one signal colour, so a categorical scale has to
     be built rather than borrowed. These are pigments rather than hues: earths,
     a deep green, a slate — they sit next to the terracotta without any of them
     shouting. Purpose, the default, uses only the first two. */
  var COLORS = ['#D9330A', '#16150F', '#7A5C2E', '#2F5D50', '#8A8577',
                '#A8551F', '#6B7B8C', '#3E4A2E', '#9C6B3F', '#4A473D'];
  var OFF = 'rgba(22,21,15,.13)';   // a category the reader has switched off

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Monday first: a working week reads better than a calendar one on a diary
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ---------------------------------------------------------------- utils */

  function e(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
    });
  }
  function fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-GB', {maximumFractionDigits: d || 0});
  }
  function groupBy(arr, fn) {
    var m = new Map();
    arr.forEach(function (d) {
      var k = fn(d);
      if (k === null || k === undefined || k === '') return;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(d);
    });
    return m;
  }
  function sum(arr, fn) {
    return arr.reduce(function (a, d) { return a + (Number(fn(d)) || 0); }, 0);
  }
  function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))); }

  /* Great-circle distance. The diary records where and when, never how far, so
     every distance on this page is derived from the two coordinates. */
  function haversine(a, b, c, d) {
    var R = 6371, p = Math.PI / 180;
    var dLat = (c - a) * p, dLon = (d - b) * p;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* Points along the great circle, so a route from Madrid to Tokyo bends over
     the pole the way it is actually flown instead of cutting straight across
     the projection. Computed here rather than stored — 100 points per leg was
     most of the weight of the file this replaces. */
  function arc(lat1, lon1, lat2, lon2, n) {
    var p = Math.PI / 180, out = {lat: [], lon: []};
    var φ1 = lat1 * p, λ1 = lon1 * p, φ2 = lat2 * p, λ2 = lon2 * p;
    var d = 2 * Math.asin(Math.sqrt(
      Math.pow(Math.sin((φ2 - φ1) / 2), 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.pow(Math.sin((λ2 - λ1) / 2), 2)));
    if (!d) return {lat: [lat1], lon: [lon1]};
    for (var i = 0; i <= n; i++) {
      var f = i / n;
      var A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      var x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
      var y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
      var z = A * Math.sin(φ1) + B * Math.sin(φ2);
      out.lat.push(Math.atan2(z, Math.sqrt(x * x + y * y)) / p);
      out.lon.push(Math.atan2(y, x) / p);
    }
    return out;
  }

  /* An arrowhead at a point on a path, opening backwards from the direction of
     travel: barb, tip, barb, then a break. Longitude is divided by cos(lat) so
     the head does not squash towards the poles, where a degree of longitude is
     a fraction of a degree of latitude on the ground. */
  function chevron(lat1, lon1, lat2, lon2, km, zoom) {
    if (lat1 === undefined || lat2 === undefined) return null;
    var p = Math.PI / 180;
    var mlat = (lat1 + lat2) / 2, mlon = (lon1 + lon2) / 2;
    var cos = Math.max(0.2, Math.cos(mlat * p));
    var brg = Math.atan2((lon2 - lon1) * cos, lat2 - lat1);   // radians, from north
    /* The head is drawn in degrees of latitude, which are fixed on the ground —
       so zooming in magnifies it along with the coastline and it ends up bigger
       than the country it is over. Dividing by the projection scale holds it at
       roughly the same size on screen at any zoom. */
    var size = Math.max(0.7, Math.min(2.4, (km || 500) / 1600)) / Math.max(0.35, zoom || 1);
    // measured off the backward direction, so 30° gives a 60° head. Measuring
    // it off the heading instead put both barbs in front of the tip and the
    // arrows pointed the way the flight had come.
    var spread = 30 * p;
    function barb(sign) {
      var a = brg + Math.PI + sign * spread;
      return [mlat + Math.cos(a) * size, mlon + Math.sin(a) * size / cos];
    }
    var l = barb(-1), r = barb(1);
    return {lat: [l[0], mlat, r[0], null], lon: [l[1], mlon, r[1], null]};
  }

  /* Normalised Shannon entropy: 0 when every flight is the same airline, 1 when
     they are spread evenly across all of them. Dividing by log(k) is what makes
     an airline mix comparable with an aircraft mix — without it, whichever
     dimension has more categories always looks more varied. */
  function entropy(counts) {
    var keys = Object.keys(counts);
    if (keys.length < 2) return {h: 0, top: keys[0] || '—', share: keys.length ? 1 : 0, k: keys.length};
    var total = keys.reduce(function (a, k) { return a + counts[k]; }, 0);
    if (!total) return {h: 0, top: '—', share: 0, k: 0};
    var h = 0;
    keys.forEach(function (k) {
      var p = counts[k] / total;
      if (p > 0) h -= p * Math.log(p);
    });
    var top = keys.reduce(function (a, b) { return counts[a] >= counts[b] ? a : b; });
    return {h: h / Math.log(keys.length), top: top, share: counts[top] / total, k: keys.length};
  }
  function tally(rows, fn) {
    var c = {};
    rows.forEach(function (r) { var k = fn(r); if (k) c[k] = (c[k] || 0) + 1; });
    return c;
  }

  /* ---------------------------------------------------------------- parsing */

  // "Hamburg / Fuhlsbuttel (HAM/EDDH)" -> {code:"HAM", city:"Hamburg"}
  function airportField(v) {
    v = String(v || '').trim();
    if (!v) return null;
    var m = v.match(/\(([A-Za-z]{3})\s*\/\s*([A-Za-z0-9]{4})\)\s*$/);
    if (m) return {code: m[1].toUpperCase(), city: v.split('/')[0].trim()};
    m = v.match(/\(([A-Za-z]{3})\)\s*$/);
    if (m) return {code: m[1].toUpperCase(), city: v.slice(0, m.index).trim()};
    if (/^[A-Za-z]{3}$/.test(v)) return {code: v.toUpperCase(), city: ''};
    return {code: '', city: v};
  }

  // "Brussels Airlines (SN/BEL)" -> "Brussels Airlines"; " ()" -> ""
  function stripCode(v) {
    v = String(v || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    return v;
  }

  function hhmmToHours(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v * 24;          // an Excel time serial
    var m = String(v).trim().match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return (+m[1]) + (+m[2]) / 60 + (m[3] ? (+m[3]) / 3600 : 0);
  }

  /* The export writes these as digits. Only three meanings are actually
     confirmed against a real diary — 1 and 2 for reason, 1 for class — so the
     rest are shown as the code rather than guessed at, and any file that spells
     the word out keeps its own word. */
  var REASON = {'1': 'Leisure', '2': 'Business'};
  var CLASS = {'1': 'Economy'};
  function decode(v, table, noun) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    if (/^\d+$/.test(v)) return table[v] || (noun + ' ' + v);
    return v;
  }

  function toDate(v) {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    v = String(v || '').trim();
    var m = v.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = v.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);      // dd/mm/yyyy
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return '';
  }

  function pick(row, names) {
    for (var i = 0; i < names.length; i++) {
      var k = Object.keys(row).find(function (c) {
        return c.toLowerCase().replace(/[\s_]/g, '') === names[i];
      });
      if (k !== undefined && row[k] !== '' && row[k] !== null && row[k] !== undefined) return row[k];
    }
    return '';
  }

  function buildRows(records) {
    var out = [], id = 0;
    UNPLACED = 0;
    records.forEach(function (r) {
      var date = toDate(pick(r, ['date']));
      var from = airportField(pick(r, ['from', 'fromairport', 'origin', 'dep']));
      var to = airportField(pick(r, ['to', 'toairport', 'destination', 'arr']));
      if (!date || !from || !to) return;

      var A = AIRPORTS[from.code] || null, B = AIRPORTS[to.code] || null;
      var flat = parseFloat(pick(r, ['fromlat', 'deplat', 'lat1']));
      var flon = parseFloat(pick(r, ['fromlon', 'deplon', 'lon1', 'fromlng']));
      var tlat = parseFloat(pick(r, ['tolat', 'arrlat', 'lat2']));
      var tlon = parseFloat(pick(r, ['tolon', 'arrlon', 'lon2', 'tolng']));

      // a coordinate written into the sheet outranks the table
      var depLat = isFinite(flat) ? flat : (A ? A[0] : null);
      var depLon = isFinite(flon) ? flon : (A ? A[1] : null);
      var arrLat = isFinite(tlat) ? tlat : (B ? B[0] : null);
      var arrLon = isFinite(tlon) ? tlon : (B ? B[1] : null);
      var placed = depLat !== null && depLon !== null && arrLat !== null && arrLon !== null;
      if (!placed) UNPLACED++;

      var km = placed ? Math.round(haversine(depLat, depLon, arrLat, arrLon) * 10) / 10 : null;
      var hrs = hhmmToHours(pick(r, ['duration']));
      var estimated = false;
      if (hrs === null && km !== null) {
        // 800 km/h cruise plus 30 minutes on the ground at either end; flagged
        // wherever it is used so an estimate is never mistaken for a record
        hrs = Math.round((km / 800 + 0.5) * 100) / 100;
        estimated = true;
      }

      var depCode = from.code, arrCode = to.code;
      var pair = [depCode || from.city, arrCode || to.city].sort().join(' ↔ ');
      out.push({
        id: id++,
        date: date,
        year: +date.slice(0, 4),
        month: +date.slice(5, 7),
        // parsed as UTC midnight, so the weekday cannot slide with the reader's
        // time zone; shifted so Monday is 0
        dow: (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7,
        flight_number: String(pick(r, ['flightnumber', 'flight', 'flightno']) || '').trim(),
        dep_iata: depCode, arr_iata: arrCode,
        dep_city: (A && A[2]) || from.city || depCode,
        arr_city: (B && B[2]) || to.city || arrCode,
        dep_country: A ? A[3] : '', arr_country: B ? B[3] : '',
        dep_lat: depLat, dep_lon: depLon, arr_lat: arrLat, arr_lon: arrLon,
        placed: placed,
        airline: stripCode(pick(r, ['airline'])) || 'Unknown',
        aircraft: stripCode(pick(r, ['aircraft', 'aircrafttype'])) || 'Unknown',
        registration: String(pick(r, ['registration', 'reg']) || '').trim(),
        reason: decode(pick(r, ['flightreason', 'reason', 'purpose']), REASON, 'Reason') || 'Unstated',
        flight_class: decode(pick(r, ['flightclass', 'class', 'cabin']), CLASS, 'Class') || 'Unstated',
        seat_type: String(pick(r, ['seattype']) || '').trim(),
        note: String(pick(r, ['note', 'notes']) || '').trim(),
        duration_h: hrs, duration_est: estimated,
        distance_km: km,
        route: (depCode || from.city) + ' → ' + (arrCode || to.city),
        route_pair: pair
      });
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }

  /* A CSV parser rather than a library: quoted fields, embedded commas and
     doubled quotes are the whole grammar, and a flightdiary export opens with a
     blank line that would otherwise be read as the header row. */
  function parseCSV(text) {
    text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/^\n+/, '');
    // Decided once, from the header line: a sheet saved in a locale that uses
    // the comma as a decimal separator comes out semicolon-delimited. Testing
    // this inside the loop would rescan the file on every separator.
    var head0 = text.slice(0, text.indexOf('\n') + 1 || text.length);
    var sep = (head0.split(';').length > head0.split(',').length) ? ';' : ',';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return String(h).trim(); });
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = r[i] === undefined ? '' : String(r[i]).trim(); });
      return o;
    });
  }

  /* ---------------------------------------------------------------- loading */

  var loaded = {};
  function script(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = function () { no(new Error(src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  function plotly() {
    return window.Plotly ? Promise.resolve()
      : script('https://cdn.plot.ly/plotly-2.35.2.min.js');
  }
  function sheetjs() {
    return window.XLSX ? Promise.resolve()
      : script('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  }
  /* Loaded as a script rather than fetched: fetch() cannot read a sibling file
     when the page itself was opened from the filesystem, and fails there with
     nothing but "Load failed". A script tag works from file:// and from the
     web alike, and this still only runs once a file has been dropped. */
  function airports() {
    if (AIRPORTS) return Promise.resolve();
    return script(root.getAttribute('data-airports')).then(function () {
      AIRPORTS = window.FL_AIRPORTS;
      if (!AIRPORTS) throw new Error('the airport table did not load');
    });
  }

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
  }

  /* Errors are labelled by stage. "Could not read the file" is the wrong thing
     to say when the file was fine and a support script never arrived — which is
     the common case, because two of the three come from a CDN and one cannot be
     fetched at all from a page opened out of a folder. */
  function labelled(promise, message) {
    return promise.catch(function () {
      var ex = new Error(message);
      ex.plain = true;
      throw ex;
    });
  }

  function read(file) {
    err.hidden = true;
    var xl = /\.(xlsx|xlsm|xls)$/i.test(file.name);
    root.classList.add('is-loading');
    Promise.all([
      labelled(airports(),
        'The airport table could not be loaded. If you opened this page from a ' +
        'folder on your computer rather than from a web address, your browser ' +
        'may be blocking it — try it on the published site.'),
      xl ? labelled(sheetjs(),
        'The spreadsheet reader could not be loaded. Check your connection, or ' +
        'save the file as .csv and drop that instead.') : Promise.resolve()
    ])
      .then(function () {
        return new Promise(function (ok, no) {
          var fr = new FileReader();
          fr.onerror = function () { no(new Error('could not read the file')); };
          fr.onload = function () { ok(fr.result); };
          if (xl) fr.readAsArrayBuffer(file); else fr.readAsText(file);
        });
      })
      .then(function (buf) {
        var records;
        if (xl) {
          var wb = XLSX.read(new Uint8Array(buf), {type: 'array', cellDates: true});
          var name = wb.SheetNames.find(function (n) { return /flight/i.test(n); }) || wb.SheetNames[0];
          records = XLSX.utils.sheet_to_json(wb.Sheets[name], {defval: '', raw: false});
        } else {
          records = parseCSV(buf);
        }
        FLIGHTS = buildRows(records);
        if (!FLIGHTS.length) {
          throw new Error('No flights found. The file needs Date, From and To columns.');
        }
        start(file.name);
      })
      .catch(function (ex) {
        var msg = ex && ex.message ? ex.message : String(ex);
        fail(ex && ex.plain ? msg : 'Could not read the file: ' + msg);
      })
      .then(function () { root.classList.remove('is-loading'); });
  }

  /* ---------------------------------------------------------------- filters */

  /* Untouched, every category in a dimension is showing. The first click is
     read as "only this one" rather than "not this one" — otherwise picking a
     single airline out of forty means thirty-nine clicks. After that the
     buttons behave additively, and emptying a dimension returns it to showing
     everything. The same rule the timelines elsewhere on the site use.

     So each dimension is a kept-set plus a flag saying whether it has been
     touched at all, rather than a plain list of exclusions. */
  var sel = {};
  function reset(k) { sel[k] = {all: true, on: new Set()}; }

  // widget id -> the dimension it filters, and how to read it off a leg
  var DIM = {
    year: {key: 'year', of: function (d) { return String(d.year); }, label: 'Year'},
    month: {key: 'month', of: function (d) { return MONTHS[d.month - 1]; }, label: 'Month'},
    dow: {key: 'dow', of: function (d) { return DAYS[d.dow]; }, label: 'Day'},
    airline: {key: 'airline', of: function (d) { return d.airline; }, label: 'Airline'},
    reason: {key: 'reason', of: function (d) { return d.reason; }, label: 'Purpose'},
    class: {key: 'flight_class', of: function (d) { return d.flight_class; }, label: 'Class'},
    aircraft: {key: 'aircraft', of: function (d) { return d.aircraft; }, label: 'Aircraft'},
    route: {key: 'route_pair', of: function (d) { return d.route_pair; }, label: 'Route'},
    airport: {key: 'airport', of: null, label: 'Airport'}   // two values per leg
  };
  var WIDGETS = Object.keys(DIM);
  WIDGETS.forEach(function (w) { reset(DIM[w].key); });

  /* One test per dimension, so a chart can ask for "everything except my own
     filter". That is what makes the panels read each other: keeping only 2019
     leaves the airline ranking showing 2019's airlines, while the year chart
     itself still shows every year — otherwise the years you had not chosen
     would vanish and you could never choose them. */
  function ok(w, d) {
    var s = sel[DIM[w].key];
    if (s.all) return true;
    if (w === 'airport') return s.on.has(d.dep_iata) || s.on.has(d.arr_iata);
    return s.on.has(DIM[w].of(d));
  }
  function passes(d, skipKey) {
    for (var i = 0; i < WIDGETS.length; i++) {
      var w = WIDGETS[i];
      if (DIM[w].key !== skipKey && !ok(w, d)) return false;
    }
    return true;
  }
  function selected() {
    return FLIGHTS.filter(function (d) { return passes(d); });
  }
  function isOn(widget, value) {
    var s = sel[DIM[widget].key];
    return s.all || s.on.has(String(value));
  }

  function toggle(widget, value) {
    var s = sel[DIM[widget].key];
    value = String(value);
    if (s.all) {                       // first click: only this one
      s.all = false;
      s.on = new Set([value]);
    } else if (s.on.has(value)) {
      s.on.delete(value);
      if (!s.on.size) reset(DIM[widget].key);      // emptied: back to everything
    } else {
      s.on.add(value);
      // choosing all of them is the same as choosing none
      if (s.on.size === allKeys(widget).length) reset(DIM[widget].key);
    }
    draw();
  }
  function clearWidget(widget) { reset(DIM[widget].key); draw(); }

  /* Clicks that come from the map — a line, an airport, a legend entry — clear
     the whole dimension when they land on something already chosen, rather than
     just removing that one value. On the map you can only see what is currently
     kept, so clicking a visible thing a second time can only mean "undo this",
     and leaving it half-filtered would strand the reader with a selection they
     can no longer see the rest of. The charts keep the additive rule, because
     there you can still see everything you did not choose. */
  function mapPick(widget, value) {
    var s = sel[DIM[widget].key];
    if (!s.all && s.on.has(String(value))) return clearWidget(widget);
    toggle(widget, value);
  }
  function clearAll() {
    WIDGETS.forEach(function (w) { reset(DIM[w].key); });
    draw();
  }
  function anyFilter() {
    return WIDGETS.some(function (w) { return !sel[DIM[w].key].all; });
  }

  function chips() {
    var out = [];
    WIDGETS.forEach(function (w) {
      var s = sel[DIM[w].key];
      if (s.all) return;
      s.on.forEach(function (v) {
        out.push('<button class="fl-chip" data-w="' + w + '" data-val="' + e(v) + '">' +
                 e(DIM[w].label) + ': ' + e(v) + ' <i>×</i></button>');
      });
    });
    /* Rendered with the chips rather than parked on the map, so it sits at the
       end of whatever is currently filtered and moves with them as they wrap. */
    document.getElementById('fl-chips').innerHTML = out.length
      ? '<span class="fl-chip-none">Showing only</span>' + out.join('') +
        '<button type="button" class="fl-btn is-small fl-clearall" data-clearall>' +
        'Clear all filters</button>'
      : '<span class="fl-chip-none">Everything is showing</span>';
  }

  document.getElementById('fl-chips').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-clearall')) return clearAll();
    toggle(b.getAttribute('data-w'), b.getAttribute('data-val'));
  });

  /* ---------------------------------------------------------------- widgets */

  /* Fixed once per dimension, by how much you have flown of each, so neither
     the colours nor the order of the legend shuffle as filters come and go. */
  var orderCache = {};
  function legendOrder(widget) {
    if (orderCache[widget]) return orderCache[widget];
    var total = {};
    FLIGHTS.forEach(function (x) {
      var k = DIM[widget].of(x);
      if (k) total[k] = (total[k] || 0) + 1;
    });
    orderCache[widget] = Object.keys(total).sort(function (a, b) {
      return total[b] - total[a] || a.localeCompare(b);
    });
    return orderCache[widget];
  }

  function colorFor(keys) {
    var m = {};
    keys.forEach(function (v, i) { m[String(v)] = COLORS[i % COLORS.length]; });
    return m;
  }

  /* Chosen means coloured, not chosen means greyed. Nothing is ever hidden from its own
     widget — a category you have switched off still shows its bar, so you can
     see what you are leaving out and click it back. */
  function barColors(widget, keys) {
    return keys.map(function (k) { return isOn(widget, k) ? COLORS[0] : OFF; });
  }
  function sliceColors(widget, keys) {
    return keys.map(function (k, i) {
      return isOn(widget, k) ? COLORS[i % COLORS.length] : OFF;
    });
  }

  var AXIS = {
    color: '#4A473D',
    family: '"JetBrains Mono",ui-monospace,monospace',
    size: 9
  };
  function layout(extra) {
    var l = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: {family: AXIS.family, color: AXIS.color, size: AXIS.size},
      margin: {l: 34, r: 6, t: 4, b: 34},
      xaxis: {gridcolor: 'rgba(22,21,15,.10)', zeroline: false,
              tickfont: {color: AXIS.color, size: AXIS.size}},
      yaxis: {gridcolor: 'rgba(22,21,15,.10)', zeroline: false,
              tickfont: {color: AXIS.color, size: AXIS.size}},
      hoverlabel: {bgcolor: '#16150F', bordercolor: '#16150F',
                   font: {family: AXIS.family, color: '#EFEBE2', size: 10}}
    };
    Object.keys(extra || {}).forEach(function (k) { l[k] = extra[k]; });
    return l;
  }

  /* Counts come from the whole diary, not the filtered selection: a widget that
     removed the categories it had filtered out would leave nothing to click to bring
     them back, and the bars would jump about as unrelated filters changed. */
  /* Read once off the whole diary. A chart's categories must not depend on the
     filters, or a choice that empties a category would take its bar away and
     leave no way to undo the choice. */
  var keyCache = {};
  function allKeys(widget) {
    if (keyCache[widget]) return keyCache[widget];
    var d = DIM[widget], set = {};
    FLIGHTS.forEach(function (x) {
      if (widget === 'airport') {
        if (x.dep_iata) set[x.dep_iata] = 1;
        if (x.arr_iata) set[x.arr_iata] = 1;
      } else {
        var k = d.of(x);
        if (k) set[k] = 1;
      }
    });
    keyCache[widget] = Object.keys(set);
    return keyCache[widget];
  }

  function counts(widget) {
    var d = DIM[widget];
    var rows = FLIGHTS.filter(function (x) { return passes(x, d.key); });
    var m = {};
    if (widget === 'airport') {
      rows.forEach(function (x) {
        if (x.dep_iata) m[x.dep_iata] = (m[x.dep_iata] || 0) + 1;
        if (x.arr_iata) m[x.arr_iata] = (m[x.arr_iata] || 0) + 1;
      });
    } else {
      rows.forEach(function (x) {
        var k = d.of(x);
        if (k) m[k] = (m[k] || 0) + 1;
      });
    }
    // categories emptied by the other panels stay on the chart, at zero, so
    // they can still be clicked
    allKeys(widget).forEach(function (v) { if (!(v in m)) m[v] = 0; });
    return m;
  }

  var sortDir = {};       // widget -> 1 descending (default), -1 ascending

  function ranked(widget) {
    var m = counts(widget);
    var dir = sortDir[widget] || 1;
    return Object.keys(m)
      .map(function (k) { return {k: k, v: m[k]}; })
      .sort(function (a, b) { return dir * (b.v - a.v) || a.k.localeCompare(b.k); });
  }

  /* A horizontal ranking with every category present and the plot grown to fit,
     inside a box that scrolls. Plotly needs an explicit height for that — left
     responsive it would squeeze forty airlines into thirteen rems. */
  function rank(widget) {
    var agg = ranked(widget);
    var id = 'fl-w-' + widget;
    var host = document.getElementById(id);
    var rows = agg.slice().reverse();          // Plotly draws the first at the bottom
    var keys = rows.map(function (x) { return x.k; });
    var h = Math.max(150, keys.length * 19 + 26);
    host.style.height = h + 'px';
    var lo = layout({margin: {l: 118, r: 8, t: 4, b: 22}, height: h});
    lo.yaxis.type = 'category';
    lo.yaxis.automargin = false;
    Plotly.react(id, [{
      type: 'bar', orientation: 'h',
      y: keys, x: rows.map(function (x) { return x.v; }), customdata: keys,
      marker: {color: barColors(widget, keys)},
      hovertemplate: '%{y}<br>%{x} flights<extra>click to isolate</extra>'
    }], lo, {responsive: true, displayModeBar: false});
    wire(id, widget, 'customdata');
  }

  /* A vertical bar chart over a fixed sequence — the twelve months, the seven
     days. The order is the calendar's, never the counts', and a month with no
     flights still gets its slot so the shape of the year stays readable. */
  function bar(widget, order) {
    var m = counts(widget);
    var keys = order || Object.keys(m).sort(function (a, b) {
      return a.localeCompare(b, undefined, {numeric: true});
    });
    var lo = layout({margin: {l: 32, r: 6, t: 4, b: 38}});
    lo.xaxis.tickangle = order ? 0 : -45;
    lo.xaxis.type = 'category';
    Plotly.react('fl-w-' + widget, [{
      type: 'bar', x: keys, customdata: keys,
      y: keys.map(function (k) { return m[k] || 0; }),
      marker: {color: barColors(widget, keys)},
      hovertemplate: '%{x}<br>%{y} flights<extra>click to isolate</extra>'
    }], lo, {responsive: true, displayModeBar: false});
    wire('fl-w-' + widget, widget, 'customdata');
  }

  /* Years read as a series rather than a ranking, so they get a line. Every year
     between the first and the last is present even if it holds nothing — a gap
     is part of the story, and a categorical axis that skipped 2020 would hide
     the one year that most obviously changed. */
  function line(widget) {
    var m = counts(widget);
    var years = Object.keys(m).map(Number);
    var lo, keys, vals;
    if (!years.length) { keys = []; vals = []; }
    else {
      var a = Math.min.apply(null, years), b = Math.max.apply(null, years);
      keys = []; vals = [];
      for (var y = a; y <= b; y++) { keys.push(String(y)); vals.push(m[y] || 0); }
    }
    lo = layout({margin: {l: 32, r: 8, t: 6, b: 34}});
    lo.xaxis.type = 'category';
    lo.xaxis.tickangle = -45;
    Plotly.react('fl-w-' + widget, [{
      type: 'scatter', mode: 'lines+markers', x: keys, y: vals, customdata: keys,
      line: {color: COLORS[0], width: 1.4, shape: 'linear'},
      marker: {
        size: 6,
        color: keys.map(function (k) { return isOn(widget, k) ? COLORS[0] : OFF; }),
        line: {color: COLORS[0], width: 1}
      },
      hovertemplate: '%{x}<br>%{y} flights<extra>click to isolate</extra>'
    }], lo, {responsive: true, displayModeBar: false});
    wire('fl-w-' + widget, widget, 'customdata');
  }

  function donut(widget) {
    var agg = ranked(widget);
    var keys = agg.map(function (x) { return x.k; });
    Plotly.react('fl-w-' + widget, [{
      type: 'pie', labels: keys, values: agg.map(function (x) { return x.v; }),
      hole: 0.62, sort: false,
      marker: {colors: sliceColors(widget, keys), line: {color: '#EFEBE2', width: 1}},
      textinfo: 'label+percent',
      textfont: {family: AXIS.family, size: 9, color: '#EFEBE2'},
      insidetextorientation: 'horizontal',
      hovertemplate: '%{label}<br>%{value} flights<extra>click to isolate</extra>'
    }], layout({margin: {l: 4, r: 4, t: 4, b: 4}, showlegend: false}),
      {responsive: true, displayModeBar: false});
    wire('fl-w-' + widget, widget, 'label');
  }

  function wire(id, widget, field) {
    var gd = document.getElementById(id);
    if (gd.dataset.wired) return;
    gd.dataset.wired = '1';
    gd.on('plotly_click', function (ev) {
      toggle(widget, field === 'label' ? ev.points[0].label : ev.points[0].customdata);
    });
  }

  /* ---------------------------------------------------------------- the map */

  var geoState = null;   // keeps the reader's rotation and zoom across redraws
  var drawnZoom = 1;     // the zoom the arrowheads were last sized for
  var zoomTimer = null;

  function map(rows) {
    var colorBy = document.getElementById('fl-colorby').value;
    var projection = document.getElementById('fl-projection').value;
    var showAirports = document.getElementById('fl-airports').checked;
    var zoom = (geoState && geoState.scale) || 1;
    drawnZoom = zoom;
    var placed = rows.filter(function (d) { return d.placed; });
    var cw = colorBy;                      // the colour-by dimension is a widget too
    var cats = legendOrder(cw);
    var cmap = colorFor(cats);
    var byCat = groupBy(placed, function (d) { return String(d[colorBy]); });
    var traces = [];

    /* Traces are drawn for the chosen categories only. What the reader can
       still click is not tied to them any more — see legend() below. */
    cats.forEach(function (cat) {
      if (!isOn(cw, cat)) return;      // switched off: nothing on the map
      var items = byCat.get(cat) || [];
      var lon = [], lat = [], hover = [], pair = [];
      var alon = [], alat = [];
      items.forEach(function (d) {
        var a = arc(d.dep_lat, d.dep_lon, d.arr_lat, d.arr_lon, 48);
        var h = d.date + '<br><b>' + d.route + '</b><br>' + d.airline +
                '<br>' + d.reason + ' · ' + fmt(d.distance_km) + ' km' +
                '<br><i>click to keep only this route</i>';
        for (var i = 0; i < a.lat.length; i++) {
          lat.push(a.lat[i]); lon.push(a.lon[i]); hover.push(h);
          // every point of the arc carries the route, so a click anywhere
          // along the line knows which one it landed on
          pair.push(d.route_pair);
        }
        lat.push(null); lon.push(null); hover.push(null); pair.push(null);

        // a chevron at the midpoint, aimed along the path there
        var mid = Math.floor(a.lat.length / 2);
        var v = chevron(a.lat[mid - 1], a.lon[mid - 1], a.lat[mid + 1], a.lon[mid + 1],
                        d.distance_km, zoom);
        if (v) { alat.push.apply(alat, v.lat); alon.push.apply(alon, v.lon); }
      });
      traces.push({
        type: 'scattergeo', mode: 'lines', lon: lon, lat: lat,
        hovertext: hover, hoverinfo: 'text', name: cat,
        customdata: pair, meta: 'route',
        line: {color: cmap[cat], width: 1.1}, opacity: 0.72
      });
      /* Direction is drawn rather than marked: an arrowhead built from two short
         great-circle-ish strokes always points the right way, whereas a triangle
         marker would need a rotation attribute that not every projection honours. */
      traces.push({
        type: 'scattergeo', mode: 'lines', lon: alon, lat: alat,
        hoverinfo: 'skip', showlegend: false,
        line: {color: cmap[cat], width: 1.1}, opacity: 0.95
      });
    });

    var aps = {};
    placed.forEach(function (d) {
      [[d.dep_iata, d.dep_city, d.dep_lat, d.dep_lon],
       [d.arr_iata, d.arr_city, d.arr_lat, d.arr_lon]].forEach(function (a) {
        if (!a[0]) return;
        if (!aps[a[0]]) aps[a[0]] = {code: a[0], city: a[1], lat: a[2], lon: a[3], n: 0};
        aps[a[0]].n++;
      });
    });
    var rowsAp = Object.keys(aps).map(function (k) { return aps[k]; });

    traces.push({
      type: 'scattergeo', mode: 'markers',
      lon: rowsAp.map(function (x) { return x.lon; }),
      lat: rowsAp.map(function (x) { return x.lat; }),
      hovertext: rowsAp.map(function (x) {
        return '<b>' + x.code + '</b> · ' + x.city + '<br>' + x.n +
               ' touches<br><i>click to keep only this airport</i>';
      }),
      hoverinfo: 'text', name: 'Airports', showlegend: false,
      customdata: rowsAp.map(function (x) { return x.code; }), meta: 'airport',
      marker: {size: 3, color: 'rgba(22,21,15,.72)'}
    });

    if (showAirports) {
      traces.push({
        type: 'scattergeo', mode: 'markers+text',
        lon: rowsAp.map(function (x) { return x.lon; }),
        lat: rowsAp.map(function (x) { return x.lat; }),
        text: rowsAp.map(function (x) { return x.code; }),
        hovertext: rowsAp.map(function (x) {
          return '<b>' + x.code + '</b> · ' + x.city + '<br>' + x.n + ' touches';
        }),
        hoverinfo: 'text', name: 'Airport labels', showlegend: false,
        customdata: rowsAp.map(function (x) { return x.code; }), meta: 'airport',
        marker: {
          size: rowsAp.map(function (x) { return 8 + Math.sqrt(x.n) * 3.4; }),
          color: 'rgba(217,51,10,.14)',
          line: {color: 'rgba(217,51,10,.62)', width: 1}
        },
        textfont: {family: AXIS.family, color: '#16150F', size: 9},
        textposition: 'top center'
      });
    }

    var proj = geoState && geoState.type === projection
      ? geoState : {type: projection, rotation: {lon: 12, lat: 12}};

    Plotly.react('fl-map', traces, {
      uirevision: 'keep',
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: {family: AXIS.family, color: AXIS.color, size: 9},
      margin: {l: 0, r: 0, t: 0, b: 0},
      showlegend: false,
      hoverlabel: {bgcolor: '#16150F', bordercolor: '#16150F',
                   font: {family: AXIS.family, color: '#EFEBE2', size: 10}},
      geo: {
        projection: proj,
        showland: true, landcolor: '#E2DCCE',
        showocean: true, oceancolor: '#EFEBE2',
        showlakes: true, lakecolor: '#EFEBE2',
        showcountries: true, countrycolor: 'rgba(22,21,15,.22)',
        showcoastlines: true, coastlinecolor: 'rgba(22,21,15,.34)',
        bgcolor: 'rgba(0,0,0,0)',
        lataxis: {showgrid: true, gridcolor: 'rgba(22,21,15,.07)'},
        lonaxis: {showgrid: true, gridcolor: 'rgba(22,21,15,.07)'}
      }
    }, {responsive: true, displayModeBar: false}).then(function (gd) {
      if (gd.layout && gd.layout.geo && gd.layout.geo.projection) {
        geoState = JSON.parse(JSON.stringify(gd.layout.geo.projection));
      }
      /* Clicking the map filters it: a line keeps its route, an airport keeps
         everything touching that airport and nothing else. Attached once — the
         element survives Plotly.react, so re-adding it on every redraw would
         stack up handlers and fire the toggle several times per click. */
      if (!gd.dataset.clickWired) {
        gd.dataset.clickWired = '1';
        gd.on('plotly_click', function (ev) {
          var pt = ev && ev.points && ev.points[0];
          if (!pt || !pt.data || !pt.data.meta) return;
          var v = pt.customdata;
          if (v === null || v === undefined) return;
          mapPick(pt.data.meta === 'airport' ? 'airport' : 'route', v);
        });
      }

      gd.removeAllListeners('plotly_relayout');
      gd.on('plotly_relayout', function () {
        var p = gd.layout && gd.layout.geo && gd.layout.geo.projection;
        if (!p) return;
        geoState = JSON.parse(JSON.stringify(p));
        /* Panning and rotating need no redraw — Plotly reprojects what is
           already there. A change of zoom does, because the arrowheads are
           sized for one particular scale. Debounced, so a pinch or a scroll
           redraws once at the end rather than on every frame. */
        var z = geoState.scale || 1;
        if (Math.abs(Math.log(z / drawnZoom)) < 0.08) return;
        clearTimeout(zoomTimer);
        zoomTimer = setTimeout(function () { map(selected()); }, 180);
      });
    });
  }

  /* ---------------------------------------------------------------- legend

     Plotly's legend lists traces, and a trace only exists while its category is
     on the map — so filtering emptied the legend of everything the reader might
     want to add next. This one is built from the diary instead: every category
     is always listed, whether or not it is currently drawn, which is what makes
     "Iberia, then also Air France" possible. Clicking works exactly like the
     map: the first pick isolates, further picks add, and clicking one that is
     already chosen clears the dimension. */

  function legend() {
    var cw = document.getElementById('fl-colorby').value;
    var cats = legendOrder(cw);
    var cmap = colorFor(cats);
    var m = counts(cw);
    document.getElementById('fl-legend').innerHTML = cats.map(function (c) {
      var on = isOn(cw, c);
      return '<button type="button" class="fl-leg' + (on ? '' : ' is-off') +
        '" data-leg="' + e(c) + '" aria-pressed="' + on + '">' +
        '<u style="border-top-color:' + (on ? cmap[c] : 'rgba(22,21,15,.28)') + '"></u>' +
        e(c) + ' <b>' + fmt(m[c] || 0) + '</b></button>';
    }).join('');
  }

  document.getElementById('fl-legend').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-leg]');
    if (b) mapPick(document.getElementById('fl-colorby').value, b.getAttribute('data-leg'));
  });

  /* ---------------------------------------------------------------- table */

  /* Ten rows by default. The table is the least scannable thing on the page and
     the longest, so it opens as a glance at the most recent flights and expands
     only if asked. */
  var TABLE_PEEK = 10;
  var tableOpen = false;

  /* (key, label, how to read the cell, how to compare) — the accessor is used
     for both, so what you sort on is exactly what you can see. Numbers are
     compared as numbers, everything else with localeCompare so accents and case
     land where a reader expects rather than where their code points fall. */
  var COLS = [
    {k: 'date', l: 'Date', get: function (d) { return d.date; }},
    {k: 'flight', l: 'Flight', get: function (d) { return d.flight_number; }},
    {k: 'route', l: 'Route', get: function (d) { return d.route; }},
    {k: 'airline', l: 'Airline', get: function (d) { return d.airline; }},
    {k: 'aircraft', l: 'Aircraft', get: function (d) { return d.aircraft; }},
    {k: 'reason', l: 'Purpose', get: function (d) { return d.reason; }},
    {k: 'class', l: 'Class', get: function (d) { return d.flight_class; }},
    {k: 'km', l: 'km', num: true, get: function (d) { return d.distance_km; }}
  ];
  var tableSort = {k: 'date', dir: -1};    // newest first, as it opens

  function compare(col, dir) {
    return function (a, b) {
      var x = col.get(a), y = col.get(b);
      if (col.num) {
        // rows with no distance sink to the bottom either way round
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return dir * (x - y);
      }
      return dir * String(x || '').localeCompare(String(y || ''), undefined,
                                                 {numeric: true, sensitivity: 'base'});
    };
  }

  function table(rows) {
    var col = COLS.filter(function (c) { return c.k === tableSort.k; })[0] || COLS[0];
    var sorted = rows.slice().sort(compare(col, tableSort.dir));
    var list = tableOpen ? sorted : sorted.slice(0, TABLE_PEEK);
    var more = sorted.length - list.length;

    var head = COLS.map(function (c) {
      var on = c.k === tableSort.k;
      // ↕ on the untouched columns, so it is visible that they can be sorted
      var mark = on ? (tableSort.dir > 0 ? '&uarr;' : '&darr;') : '&#8597;';
      return '<th' + (c.num ? ' class="n"' : '') + (on ? ' aria-sort="' +
        (tableSort.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' +
        '<button type="button" class="fl-th' + (on ? ' is-on' : '') +
        '" data-col="' + c.k + '">' + e(c.l) + '<i>' + mark + '</i></button></th>';
    }).join('');

    document.getElementById('fl-table').innerHTML =
      '<table class="fl-tbl"><thead><tr>' + head + '</tr></thead><tbody>' +
      list.map(function (d) {
        return '<tr><td>' + e(d.date) + '</td><td>' + e(d.flight_number) +
          '</td><td>' + e(d.route) + '</td><td>' + e(d.airline) +
          '</td><td>' + e(d.aircraft) + '</td><td>' + e(d.reason) +
          '</td><td>' + e(d.flight_class) + '</td><td class="n">' +
          (d.distance_km === null ? '—' : fmt(d.distance_km)) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      (sorted.length > TABLE_PEEK
        ? '<p class="fl-more"><button class="fl-btn is-small" type="button" data-table>' +
          (tableOpen ? 'Show the last ' + TABLE_PEEK
                     : 'Show all ' + fmt(sorted.length)) + '</button>' +
          (more ? '<span>' + fmt(more) + ' more</span>' : '') + '</p>'
        : '');
  }

  document.getElementById('fl-table').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-col]');
    if (!b) return;
    var k = b.getAttribute('data-col');
    /* Clicking the column already sorted reverses it; a new column starts
       descending for dates and distances — most recent, longest — and ascending
       for words, which is what an alphabetical list means. */
    if (tableSort.k === k) tableSort.dir *= -1;
    else tableSort = {k: k, dir: (k === 'date' || k === 'km') ? -1 : 1};
    table(selected());
  });

  /* ---------------------------------------------------------------- render */

  /* ---------------------------------------------------------------- ladder */

  /* Three distances that have nothing to do with each other in scale: the
     Earth is 12,742 km across, the Moon is thirty times that away, and Mars —
     even at its mean distance — is another six hundred times further again.
     A linear bar would put the first two on top of the axis label, so the scale
     is logarithmic and says so. */
  var MARKS = [
    {km: 12742, label: 'Earth ⌀', note:
      "The Earth's mean diameter — straight through the middle, 12,742 km."},
    {km: 40075, label: 'one lap', note:
      'Once around the Equator — 40,075 km. The long way round at the widest point.'},
    {km: 384400, label: 'the Moon', note:
      'Earth to the Moon — 384,400 km on average. The orbit is an ellipse, so the ' +
      'real figure moves between about 356,500 and 406,700 km.'},
    {km: 225000000, label: 'Mars', note:
      'Earth to Mars — about 225 million km on average. The two planets orbit at ' +
      'different speeds, so the gap ranges from 54.6 to roughly 401 million km.'}
  ];
  var LAD_MIN = 1000, LAD_MAX = 225000000;
  var MILE = 0.621371;

  function ladPos(km) {
    var lo = Math.log(LAD_MIN), hi = Math.log(LAD_MAX);
    return Math.max(0, Math.min(1, (Math.log(Math.max(km, LAD_MIN)) - lo) / (hi - lo)));
  }

  var ladBuilt = false;
  function ladder(km) {
    var ax = document.getElementById('fl-lad-ax');
    if (!ladBuilt) {
      ax.innerHTML = MARKS.map(function (m) {
        return '<span class="fl-lad-m" style="left:' + (ladPos(m.km) * 100).toFixed(2) + '%"' +
               ' tabindex="0" role="note"><u></u>' + e(m.label) +
               '<span class="fl-lad-mp"><b>' + e(m.label === 'one lap' ? 'Around the Earth'
                 : m.label === 'Earth ⌀' ? 'Earth diameter' : m.label) + '</b>' +
               e(m.note) + '</span></span>';
      }).join('');
      ladBuilt = true;
    }
    document.getElementById('fl-lad-fill').style.width = (ladPos(km) * 100).toFixed(2) + '%';

    document.getElementById('fl-lad-km').textContent =
      km ? fmt(km) + ' km · ' + fmt(km * MILE) + ' miles' : '—';

    var moon = km / 384400;
    document.getElementById('fl-lad-v').textContent =
      moon >= 1 ? fmt(moon, 2) + ' trips to the Moon'
                : (moon * 100).toFixed(1) + '% of the way to the Moon';
    document.getElementById('fl-lad-pop').innerHTML =
      fmt(km) + ' km<br>' + fmt(km / 40075, 2) + ' laps of the Earth<br>' +
      (moon >= 1 ? fmt(moon, 2) + ' one-way trips to the Moon'
                 : (moon * 100).toFixed(1) + '% of one trip to the Moon') +
      '<br>' + (km / 225000000 * 100).toFixed(3) + '% of the way to Mars';
  }

  /* ---------------------------------------------------------------- render */

  function draw() {
    var d = selected();
    chips();
    window.FL_KPI(d, FLIGHTS, {entropy: entropy, tally: tally, sum: sum,
                               fmt: fmt, uniq: uniq, groupBy: groupBy});
    ladder(sum(d, function (x) { return x.distance_km; }));
    map(d);
    legend();
    line('year');
    rank('route');
    bar('month', MONTHS);
    bar('dow', DAYS);
    donut('reason');
    donut('class');
    rank('airline');
    rank('airport');
    rank('aircraft');
    table(d);

    // a widget only offers Clear once it is filtering something
    WIDGETS.forEach(function (w) {
      var b = document.querySelector('[data-clear="' + w + '"]');
      if (b) b.hidden = sel[DIM[w].key].all;
    });
  }

  function start(filename) {
    drop.hidden = true;
    app.hidden = false;
    var span = FLIGHTS[0].date.slice(0, 4) + '–' + FLIGHTS[FLIGHTS.length - 1].date.slice(0, 4);
    meta.textContent = filename + ' · ' + fmt(FLIGHTS.length) + ' legs · ' + span +
      (UNPLACED ? ' · ' + UNPLACED + ' not mappable' : '');
    plotly().then(function () {
      draw();
      ['fl-projection', 'fl-colorby', 'fl-airports'].forEach(function (id) {
        document.getElementById(id).addEventListener('change', function () {
          if (id === 'fl-projection') geoState = null;
          draw();
        });
      });
      // one listener for every widget's Clear and every ranking's sort arrow
      document.getElementById('fl-app').addEventListener('click', function (ev) {
        var c = ev.target.closest('[data-clear]');
        if (c) return clearWidget(c.getAttribute('data-clear'));
        if (ev.target.closest('[data-table]')) {
          tableOpen = !tableOpen;
          return table(selected());
        }
        if (ev.target.closest('[data-col]')) return;   // the table sorts itself
        var s = ev.target.closest('[data-sort]');
        if (s) {
          var w = s.getAttribute('data-sort');
          sortDir[w] = (sortDir[w] || 1) * -1;
          s.innerHTML = sortDir[w] > 0 ? '&darr;' : '&uarr;';
          s.setAttribute('aria-label', sortDir[w] > 0 ? 'Most flights first'
                                                      : 'Fewest flights first');
          draw();
        }
      });
    }).catch(function () {
      fail('The charting library could not be loaded. Check your connection and reload.');
    });
  }

  /* ---------------------------------------------------------------- input */

  var input = document.getElementById('fl-file');
  document.getElementById('fl-pick').addEventListener('click', function () { input.click(); });
  input.addEventListener('change', function () {
    if (input.files && input.files[0]) read(input.files[0]);
  });
  ['dragenter', 'dragover'].forEach(function (t) {
    root.addEventListener(t, function (ev) {
      ev.preventDefault(); root.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    root.addEventListener(t, function (ev) {
      ev.preventDefault();
      if (t === 'dragleave' && root.contains(ev.relatedTarget)) return;
      root.classList.remove('is-over');
    });
  });
  root.addEventListener('drop', function (ev) {
    var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) read(f);
  });

  /* A door for the build's verification harness, which parses a real export
     through this very code rather than a Python re-implementation of it. The
     page never sets this flag, so in a browser the block does nothing. */
  if (window.__FL_TEST__) {
    window.__FL_TEST__({
      parseCSV: parseCSV, buildRows: buildRows, haversine: haversine,
      entropy: entropy, tally: tally, arc: arc, ladPos: ladPos,
      chevron: chevron, passes: passes,
      useAirports: function (a) { AIRPORTS = a; },
      useFlights: function (f) { FLIGHTS = f; },
      unplaced: function () { return UNPLACED; },
      selected: selected, counts: counts, allKeys: allKeys, isOn: isOn,
      cols: COLS, compare: compare,
      legendOrder: legendOrder,
      mapPick: function (w, v) {       // as if the reader had clicked the map
        var s = sel[DIM[w].key];
        if (!s.all && s.on.has(String(v))) { reset(DIM[w].key); return; }
        var st = sel[DIM[w].key];
        v = String(v);
        if (st.all) { st.all = false; st.on = new Set([v]); }
        else if (st.on.has(v)) { st.on.delete(v); if (!st.on.size) reset(DIM[w].key); }
        else { st.on.add(v); if (st.on.size === allKeys(w).length) reset(DIM[w].key); }
      },
      state: function (w) { var s = sel[DIM[w].key];
        return {all: s.all, on: Array.from(s.on)}; },
      pick: function (w, v) {          // as if the reader had clicked it
        var s = sel[DIM[w].key];
        v = String(v);
        if (s.all) { s.all = false; s.on = new Set([v]); }
        else if (s.on.has(v)) { s.on.delete(v); if (!s.on.size) reset(DIM[w].key); }
        else { s.on.add(v); if (s.on.size === allKeys(w).length) reset(DIM[w].key); }
      },
      clearAll: function () { WIDGETS.forEach(function (w) { reset(DIM[w].key); }); }
    });
  }
})();
