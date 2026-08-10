/* CV Map — world map linked to the timeline.

   Points are rebuilt whenever the track toggles change, so the map and the
   timeline always show the same slice. The basemap is progressive enhancement:
   points, graticule and interaction work with no network at all. */

(function () {
  var root = document.getElementById('cvmap');
  if (!root) return;

  var BASE = JSON.parse(document.getElementById('cvdata').textContent);
  var DATA = BASE;
  var svg = root.querySelector('svg');
  var gLand = svg.querySelector('.m-land');
  var gPts = svg.querySelector('.m-points');
  var tip = root.querySelector('[data-maptip]');
  var counter = document.querySelector('[data-mapcount]');
  var NS = 'http://www.w3.org/2000/svg';
  var W = 1000, H = 500, LAT0 = 83, LAT1 = -56;
  var active = null;   // null = everything
  var span = null;     // null = every year, else {from, to} from the rail
  var view = {x: 0, y: 0, k: 1};   // pan/zoom state, k = 1 is the whole world

  function proj(lon, lat) {
    return [(lon + 180) / 360 * W, (LAT0 - lat) / (LAT0 - LAT1) * H];
  }

  /* ---------------- zoom & pan ---------------- */
  function scalePoints() {
    var s = 1 / view.k;
    gPts.querySelectorAll('.m-city').forEach(function (g) {
      g.setAttribute('transform',
        'translate(' + g.dataset.x + ',' + g.dataset.y + ') scale(' + s + ')');
    });
  }

  function applyView() {
    var w = W / view.k, h = H / view.k;
    view.x = Math.max(0, Math.min(view.x, W - w));
    view.y = Math.max(0, Math.min(view.y, H - h));
    svg.setAttribute('viewBox', view.x + ' ' + view.y + ' ' + w + ' ' + h);
    // keep strokes and labels a constant size on screen
    svg.style.setProperty('--k', view.k);
    root.classList.toggle('is-zoomed', view.k > 1.01);
    scalePoints();
  }

  function zoomTo(k, cx, cy) {
    k = Math.max(1, Math.min(k, 12));
    if (cx === undefined) { cx = view.x + W / view.k / 2; cy = view.y + H / view.k / 2; }
    var kx = (cx - view.x) / (W / view.k), ky = (cy - view.y) / (H / view.k);
    view.k = k;
    view.x = cx - kx * (W / k);
    view.y = cy - ky * (H / k);
    applyView();
  }

  function svgPoint(ev) {
    var r = svg.getBoundingClientRect();
    return [view.x + (ev.clientX - r.left) / r.width * (W / view.k),
            view.y + (ev.clientY - r.top) / r.height * (H / view.k)];
  }

  svg.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var p = svgPoint(ev);
    zoomTo(view.k * (ev.deltaY < 0 ? 1.18 : 1 / 1.18), p[0], p[1]);
  }, {passive: false});

  var drag = null;
  svg.addEventListener('pointerdown', function (ev) {
    if (ev.target.closest('.m-city')) return;      // let city hover work
    drag = {p: svgPoint(ev), x: view.x, y: view.y};
    svg.setPointerCapture(ev.pointerId);
    root.classList.add('is-dragging');
  });
  svg.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var r = svg.getBoundingClientRect();
    view.x = drag.x - (ev.clientX - r.left) / r.width * (W / view.k) + (drag.p[0] - drag.x);
    view.y = drag.y - (ev.clientY - r.top) / r.height * (H / view.k) + (drag.p[1] - drag.y);
    applyView();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    svg.addEventListener(t, function () { drag = null; root.classList.remove('is-dragging'); });
  });
  svg.addEventListener('dblclick', function (ev) {
    var p = svgPoint(ev);
    zoomTo(view.k * 1.8, p[0], p[1]);
  });

  root.querySelectorAll('[data-zoom]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var z = btn.getAttribute('data-zoom');
      if (z === 'reset') { view = {x: 0, y: 0, k: 1}; applyView(); }
      else zoomTo(view.k * (z === 'in' ? 1.6 : 1 / 1.6));
    });
  });

  applyView();

  /* ---------------- basemap (optional) ---------------- */
  function decode(topo, obj) {
    // minimal TopoJSON arc decoder — avoids pulling in topojson-client
    var arcs = topo.arcs, tr = topo.transform, out = [];
    function arc(i) {
      var rev = i < 0, a = arcs[rev ? ~i : i], x = 0, y = 0, pts = [];
      for (var k = 0; k < a.length; k++) {
        x += a[k][0]; y += a[k][1];
        pts.push(tr ? [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]]
                    : [a[k][0], a[k][1]]);
      }
      return rev ? pts.reverse() : pts;
    }
    function ring(idx) {
      var pts = [];
      idx.forEach(function (i, n) { var p = arc(i); pts = pts.concat(n ? p.slice(1) : p); });
      return pts;
    }
    obj.geometries.forEach(function (g) {
      var nm = (g.properties && g.properties.name) || '';
      if (nm === 'Antarctica') return;
      var polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
      polys.forEach(function (poly) { poly.forEach(function (r) { out.push(ring(r)); }); });
    });
    return out;
  }

  function unwrap(ring) {
    // A ring that crosses the antimeridian jumps from +179 to -179. Projected
    // linearly that draws a band right across the map, so make longitudes run
    // continuously first, then draw the ring shifted by -360 / 0 / +360 and let
    // the viewBox clip whichever copies fall outside.
    var out = [ring[0]], prev = ring[0][0];
    for (var i = 1; i < ring.length; i++) {
      var lon = ring[i][0];
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
      out.push([lon, ring[i][1]]);
      prev = lon;
    }
    return out;
  }

  function ringPath(ring, shift) {
    var s = '';
    for (var i = 0; i < ring.length; i++) {
      var p = proj(ring[i][0] + shift, ring[i][1]);
      s += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }
    return s + 'Z';
  }

  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    .then(function (r) { return r.json(); })
    .then(function (t) {
      var d = '';
      decode(t, t.objects.countries).forEach(function (raw) {
        var ring = unwrap(raw);
        var lons = ring.map(function (p) { return p[0]; });
        var lo = Math.min.apply(null, lons), hi = Math.max.apply(null, lons);
        [-360, 0, 360].forEach(function (shift) {
          if (hi + shift < -180 || lo + shift > 180) return;   // fully off-map
          d += ringPath(ring, shift);
        });
      });
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'm-country');
      gLand.appendChild(path);
      root.classList.add('has-basemap');
    })
    .catch(function () { /* graticule-only fallback is already on screen */ });

  /* ---------------- points ---------------- */
  function render() {
    var rows = DATA.filter(function (d) {
      if (active && active.indexOf(d.track) === -1) return false;
      // a spell of work counts as inside the window if it overlaps it at all
      if (span && (Math.ceil(d.end) < span.from || Math.floor(d.start) > span.to)) return false;
      return true;
    });

    var byCity = {};
    rows.forEach(function (d) {
      (byCity[d.city] = byCity[d.city] ||
        {city: d.city, country: d.country, lat: d.lat, lon: d.lon, items: []}).items.push(d);
    });
    var cities = Object.keys(byCity).map(function (k) { return byCity[k]; });
    var max = Math.max.apply(null, cities.map(function (c) { return c.items.length; }).concat([1]));

    while (gPts.firstChild) gPts.removeChild(gPts.firstChild);
    cities.forEach(function (c) {
      var p = proj(c.lon, c.lat);
      var r = 3 + Math.sqrt(c.items.length / max) * 11;
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'm-city');
      g.setAttribute('tabindex', '0');
      g.dataset.city = c.city;
      g.dataset.x = p[0];
      g.dataset.y = p[1];

      var circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', 0); circle.setAttribute('cy', 0);
      circle.setAttribute('r', r);
      g.appendChild(circle);

      var label = document.createElementNS(NS, 'text');
      label.setAttribute('x', r + 4);
      label.setAttribute('y', 3.5);
      label.textContent = c.city;
      g.appendChild(label);

      g.addEventListener('mouseenter', function () { focusCity(c); });
      g.addEventListener('focus', function () { focusCity(c); });
      g.addEventListener('mouseleave', blurCity);
      g.addEventListener('blur', blurCity);
      gPts.appendChild(g);
    });
    scalePoints();

    if (counter) counter.textContent = rows.length + ' entries · ' + cities.length + ' cities';
    blurCity();
  }

  function focusCity(c) {
    root.classList.add('is-focused');
    svg.querySelectorAll('.m-city').forEach(function (g) {
      g.classList.toggle('is-on', g.dataset.city === c.city);
    });
    var byTrack = {};
    c.items.forEach(function (i) { (byTrack[i.track] = byTrack[i.track] || []).push(i); });
    var html = '<span class="tip-title">' + c.city + '</span>' +
               '<span class="tip-where">' + (c.country || '') + '</span>';
    Object.keys(byTrack).forEach(function (t) {
      html += '<span class="tip-kind">' + t + ' &middot; ' + byTrack[t].length + '</span>';
      byTrack[t].slice(0, 5).forEach(function (i) {
        html += '<span class="tip-line">' + i.from_ + ' — ' + i.title + '</span>';
      });
      if (byTrack[t].length > 5)
        html += '<span class="tip-line">+ ' + (byTrack[t].length - 5) + ' more</span>';
    });
    tip.innerHTML = html;
    tip.hidden = false;

    document.querySelectorAll('[data-timeline] .g-lane').forEach(function (l) {
      var pl = l.querySelector('.g-place');
      l.classList.toggle('is-dim', !(pl && pl.textContent.indexOf(c.city) === 0));
    });
  }

  function blurCity() {
    root.classList.remove('is-focused');
    svg.querySelectorAll('.m-city').forEach(function (g) { g.classList.remove('is-on'); });
    document.querySelectorAll('[data-timeline] .g-lane').forEach(function (l) {
      l.classList.remove('is-dim');
    });
    if (tip) tip.hidden = true;
  }

  /* hovering a timeline row highlights its city */
  document.querySelectorAll('[data-timeline] .g-lane').forEach(function (lane) {
    lane.addEventListener('mouseenter', function () {
      var pl = lane.querySelector('.g-place');
      if (!pl) return;
      var city = pl.textContent.split(',')[0].trim();
      svg.querySelectorAll('.m-city').forEach(function (g) {
        g.classList.toggle('is-on', g.dataset.city === city);
      });
      root.classList.add('is-focused');
    });
    lane.addEventListener('mouseleave', function () {
      svg.querySelectorAll('.m-city').forEach(function (g) { g.classList.remove('is-on'); });
      root.classList.remove('is-focused');
    });
  });

  document.addEventListener('tracks:change', function (ev) {
    active = ev.detail.active;
    render();
  });

  document.addEventListener('years:change', function (ev) {
    span = ev.detail;
    render();
  });

  // the import panel swaps the whole dataset out and back again
  document.addEventListener('mapdata:change', function (ev) {
    DATA = ev.detail || BASE;
    render();
  });


  render();
})();
