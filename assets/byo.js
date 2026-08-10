/* "Visualize yours" — drop a filled-in template and the dashboard redraws from
   it instead of mine.

   The spreadsheet parser is only fetched when someone actually drops an .xlsx;
   a .csv is handled here in a few lines, and a visitor who never uses the panel
   downloads nothing extra. */

(function () {
  var panel = document.querySelector('[data-byo]');
  if (!panel) return;

  var input = panel.querySelector('input[type=file]');
  var drop = panel.querySelector('[data-drop]');
  var status = panel.querySelector('[data-byostatus]');
  var clearBtn = panel.querySelector('[data-byoclear]');
  var chart = document.querySelector('.cvsplit-time');
  var original = chart ? chart.innerHTML : '';

  var COLS = ['type', 'title', 'organisation', 'city', 'country', 'lat', 'lon',
              'start', 'end', 'category'];

  function say(msg, bad) {
    status.textContent = msg;
    status.classList.toggle('is-bad', !!bad);
  }

  /* ---------------- parsing ---------------- */

  function splitCsvLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';' || c === '\t') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function fromRows(rows) {
    if (!rows.length) throw new Error('the file has no rows');
    var head = rows[0].map(function (h) {
      return String(h || '').trim().toLowerCase().split(' ')[0];
    });
    var idx = {};
    COLS.forEach(function (c) { idx[c] = head.indexOf(c); });
    if (idx.type === -1 || idx.title === -1) {
      throw new Error('missing the Type or Title column — use the template');
    }
    var out = [];
    rows.slice(1).forEach(function (r) {
      if (!r || !String(r[idx.title] || '').trim()) return;
      var rec = {};
      COLS.forEach(function (c) {
        rec[c] = idx[c] === -1 ? '' : String(r[idx[c]] === undefined ? '' : r[idx[c]]).trim();
      });
      rec.type = rec.type.toLowerCase();
      out.push(rec);
    });
    if (!out.length) throw new Error('no data rows found under the header');
    return out;
  }

  function parseCsv(text) {
    var lines = text.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    return fromRows(lines.map(splitCsvLine));
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = function () { rej(new Error('could not load the spreadsheet reader')); };
      document.head.appendChild(s);
    });
  }

  function parseXlsx(buf) {
    var go = window.XLSX ? Promise.resolve()
      : loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    return go.then(function () {
      var wb = window.XLSX.read(new Uint8Array(buf), {type: 'array'});
      var ws = wb.Sheets[wb.SheetNames[0]];
      return fromRows(window.XLSX.utils.sheet_to_json(ws, {header: 1, blankrows: false}));
    });
  }

  /* ---------------- shaping ---------------- */

  function ym(v) {
    var m = String(v || '').match(/(\d{4})(?:-(\d{1,2}))?/);
    if (!m) return null;
    return +m[1] + ((+m[2] || 1) - 1) / 12;
  }

  var BANDS = {practice: 1, research: 1, education: 1};

  // How long a career runs when the file doesn't say. Only used to draw the
  // progress bar, and the caption admits to it.
  var ASSUMED_CAREER = 40;

  function shape(rows) {
    var map = [], pubs = [], evs = [], projs = [], starts = [], years = [];
    var retire = null;

    rows.forEach(function (r) {
      // an optional single row that fixes the end of the progress bar
      if (r.type === 'retirement') {
        var ry = ym(r.start);
        if (ry) retire = Math.round(ry);
        return;
      }
      var a = ym(r.start), b = ym(r.end);
      var y = a ? Math.floor(a) : null;
      if (y) years.push(y);

      if (r.type === 'publication') { if (y) pubs.push({y: y, t: r.category || 'Other'}); return; }
      if (r.type === 'event') { if (y) evs.push({y: y, t: r.category || 'Other'}); }
      if (r.type === 'project') { if (y) projs.push({y: y, t: r.organisation || 'Other'}); }
      if (r.type === 'practice' && a) starts.push(Math.floor(a));

      var lat = parseFloat(r.lat), lon = parseFloat(r.lon);
      if (!isNaN(lat) && !isNaN(lon) && a) {
        map.push({
          track: r.type === 'event' ? 'courses' : r.type === 'project' ? 'projects' : r.type,
          kind: r.type === 'project' ? 'project' : 'role',
          title: r.title, org: r.organisation, city: r.city, country: r.country,
          lat: lat, lon: lon, start: a, end: b || a,
          from_: String(r.start || ''), to: String(r.end || ''), dur: '', url: ''
        });
      }
    });

    var lo = years.length ? Math.min.apply(null, years) : new Date().getFullYear() - 10;
    var hi = years.length ? Math.max.apply(null, years) : new Date().getFullYear();
    var began = starts.length ? Math.min.apply(null, starts) : lo;
    return {
      map: map,
      kpi: {
        publications: pubs, events: evs, projects: projs,
        practiceStart: began,
        retireYear: retire || (began + ASSUMED_CAREER),
        retireAssumed: !retire,
        birthYear: retire ? retire - 67 : null,
        retirementAge: 67,
        startAssumed: !starts.length,
        range: [lo, hi + 1]
      },
      bands: rows.filter(function (r) { return BANDS[r.type] && ym(r.start); }),
      range: [lo, hi + 1]
    };
  }

  /* ---------------- the visitor's timeline ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }

  function drawTimeline(shaped) {
    if (!chart) return;
    var lo = shaped.range[0], hi = shaped.range[1], span = hi - lo || 1;
    function pct(t) { return (t - lo) / span * 100; }

    var ticks = '';
    for (var y = lo; y <= hi; y += Math.max(1, Math.round(span / 6))) {
      ticks += '<span style="left:' + pct(y).toFixed(3) + '%">' + y + '</span>';
    }

    var html = '<div class="gantt" data-timeline style="--yearpct:' +
      (100 / span).toFixed(4) + '%">' +
      '<div class="g-head"><span class="g-corner"></span><span class="g-axis">' +
      ticks + '</span></div>';

    ['practice', 'research', 'education'].forEach(function (band) {
      var rows = shaped.bands.filter(function (r) { return r.type === band; });
      if (!rows.length) return;
      html += '<div class="g-band" data-band="' + band + '">' +
        '<div class="g-bandname">' + band + '</div>';

      var byOrg = {}, order = [];
      rows.forEach(function (r) {
        var k = r.organisation || r.title;
        if (!byOrg[k]) { byOrg[k] = []; order.push(k); }
        byOrg[k].push(r);
      });

      order.forEach(function (org) {
        var segs = byOrg[org].map(function (r) {
          var a = ym(r.start), b = ym(r.end) || a + 1 / 12;
          var tip = JSON.stringify({
            role: r.title, org: org, where: [r.city, r.country].filter(Boolean).join(', '),
            from: r.start, to: r.end || 'Present', dur: '', note: r.category, kind: 'role'
          });
          return '<span class="g-seg" data-track="' + band + '" style="left:' +
            pct(a).toFixed(3) + '%;width:' +
            Math.max(pct(b) - pct(a), 0.7).toFixed(3) + '%" tabindex="0" data-tip=\'' +
            esc(tip) + '\'></span>';
        }).join('');
        html += '<div class="g-lane"><div class="g-org">' +
          '<span class="g-orgname">' + esc(org) + '</span>' +
          '<span class="g-place">' +
          esc([byOrg[org][0].city, byOrg[org][0].country].filter(Boolean).join(', ')) +
          '</span></div><div class="g-track">' + segs + '</div></div>';
      });
      html += '</div>';
    });

    html += '<div class="g-foot"><span class="g-corner"></span><span class="g-axis">' +
      ticks + '</span></div><div class="g-tip" data-tipbox hidden></div></div>';
    chart.innerHTML = html;
  }

  /* ---------------- applying ---------------- */

  function apply(rows) {
    var shaped = shape(rows);
    drawTimeline(shaped);
    document.dispatchEvent(new CustomEvent('data:change', {detail: shaped.kpi}));
    document.dispatchEvent(new CustomEvent('mapdata:change', {detail: shaped.map}));
    panel.classList.add('is-mine');
    clearBtn.hidden = false;
    say(rows.length + ' rows loaded — showing your career. ' +
        shaped.map.length + ' of them have coordinates and appear on the map.');
  }

  function restore() {
    if (chart) chart.innerHTML = original;
    document.dispatchEvent(new CustomEvent('data:change', {detail: null}));
    document.dispatchEvent(new CustomEvent('mapdata:change', {detail: null}));
    panel.classList.remove('is-mine');
    clearBtn.hidden = true;
    say('');
  }

  function handle(file) {
    if (!file) return;
    say('Reading ' + file.name + '…');
    var reader = new FileReader();
    var xlsx = /\.xlsx?$/i.test(file.name);
    reader.onload = function () {
      Promise.resolve()
        .then(function () {
          return xlsx ? parseXlsx(reader.result) : parseCsv(reader.result);
        })
        .then(apply)
        .catch(function (err) { say(err.message || 'could not read that file', true); });
    };
    reader.onerror = function () { say('could not read that file', true); };
    if (xlsx) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  }

  input.addEventListener('change', function () { handle(input.files[0]); });
  clearBtn.addEventListener('click', restore);

  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (ev) {
      ev.preventDefault();
      drop.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (ev) {
      ev.preventDefault();
      drop.classList.remove('is-over');
    });
  });
  drop.addEventListener('drop', function (ev) {
    handle(ev.dataTransfer.files[0]);
  });
})();
