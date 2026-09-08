/**
 * Leaflet map layer for timeline points, paths, visits, heatmap.
 */

const ACTIVITY_COLORS = {
  'Jalan kaki': '#64d8ab',
  Lari: '#f07178',
  Sepeda: '#7aa2f7',
  Kendaraan: '#e8bc76',
  Mobil: '#e8bc76',
  Motor: '#ff9e64',
  Bus: '#bb9af7',
  Kereta: '#7dcfff',
  'MRT/Subway': '#7dcfff',
  Terbang: '#c0caf5',
  Diam: '#565f89',
  Perjalanan: '#64d8ab',
};

export function activityColor(name) {
  return ACTIVITY_COLORS[name] || '#64d8ab';
}

export function createTimelineMap(container) {
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true,
  }).setView([-2.5, 118], 5);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Free raster basemaps (no API key)
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  });

  const cartoVoyager = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }
  );

  const cartoDark = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }
  );

  const esriStreet = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19,
    }
  );

  const tiles = osm;
  osm.addTo(map);

  L.control
    .layers(
      {
        OpenStreetMap: osm,
        'Carto Voyager': cartoVoyager,
        'Carto Dark': cartoDark,
        'Esri Streets': esriStreet,
      },
      {},
      { position: 'bottomright', collapsed: true }
    )
    .addTo(map);

  const pathLayer = L.layerGroup().addTo(map);
  const visitLayer = L.layerGroup().addTo(map);
  const playLayer = L.layerGroup().addTo(map);
  let heatLayer = null;
  let heatEnabled = false;

  function clear() {
    pathLayer.clearLayers();
    visitLayer.clearLayers();
    playLayer.clearLayers();
    if (heatLayer) {
      map.removeLayer(heatLayer);
      heatLayer = null;
    }
  }

  function draw(data, opts = {}) {
    clear();
    const { points, visits, segments } = data;
    const bounds = [];

    if (segments?.length) {
      for (const seg of segments) {
        const path = thinForDraw(seg.path, 3000);
        const latlngs = path.map((p) => [p.lat, p.lng]);
        if (latlngs.length < 2) continue;
        L.polyline(latlngs, {
          color: activityColor(seg.activity),
          weight: 3.5,
          opacity: 0.85,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(pathLayer);
        // bounds: sample endpoints only for speed
        bounds.push(latlngs[0], latlngs[latlngs.length - 1]);
      }
    } else if (points?.length > 1) {
      const path = thinForDraw(points, 20_000);
      // Chunk polylines — browser struggle with 1 huge path
      const chunk = 4000;
      for (let i = 0; i < path.length - 1; i += chunk) {
        const slice = path.slice(i, Math.min(path.length, i + chunk + 1));
        const latlngs = slice.map((p) => [p.lat, p.lng]);
        L.polyline(latlngs, {
          color: '#64d8ab',
          weight: 3,
          opacity: 0.8,
          lineJoin: 'round',
        }).addTo(pathLayer);
      }
      bounds.push([path[0].lat, path[0].lng], [path[path.length - 1].lat, path[path.length - 1].lng]);
      // a few mid samples for better fitBounds
      for (let i = 0; i < path.length; i += Math.ceil(path.length / 8)) {
        bounds.push([path[i].lat, path[i].lng]);
      }
    } else if (points?.length === 1) {
      bounds.push([points[0].lat, points[0].lng]);
    }

    for (const v of visits || []) {
      bounds.push([v.lat, v.lng]);
      const marker = L.circleMarker([v.lat, v.lng], {
        radius: 7,
        color: '#0c1210',
        weight: 2,
        fillColor: '#e8bc76',
        fillOpacity: 0.95,
      });
      const when = new Date(v.t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
      marker.bindPopup(
        `<strong>${escapeHtml(v.name)}</strong><br><span style="opacity:.75">${escapeHtml(v.address || '')}</span><br>${when}`
      );
      marker.addTo(visitLayer);
    }

    if (opts.heatmap && points?.length) {
      const heatSrc = thinForDraw(points, 12_000);
      const heatPts = heatSrc.map((p) => [p.lat, p.lng, 0.4]);
      heatLayer = L.heatLayer(heatPts, {
        radius: 22,
        blur: 18,
        maxZoom: 16,
        gradient: {
          0.2: '#1a3a32',
          0.45: '#64d8ab',
          0.7: '#e8bc76',
          1: '#f07178',
        },
      }).addTo(map);
      heatEnabled = true;
    } else {
      heatEnabled = false;
    }

    if (bounds.length && !opts.keepView) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    }

    return bounds;
  }

  let playMarker = null;
  let trailLine = null;

  function setPlayhead(point, trail = []) {
    playLayer.clearLayers();
    if (!point) return;
    if (trail.length > 1) {
      trailLine = L.polyline(
        trail.map((p) => [p.lat, p.lng]),
        { color: '#e8bc76', weight: 4, opacity: 0.95 }
      ).addTo(playLayer);
    }
    playMarker = L.circleMarker([point.lat, point.lng], {
      radius: 9,
      color: '#fff',
      weight: 2,
      fillColor: '#e8bc76',
      fillOpacity: 1,
    }).addTo(playLayer);
    map.panTo([point.lat, point.lng], { animate: true, duration: 0.25 });
  }

  function destroy() {
    clear();
    map.remove();
  }

  return {
    map,
    tiles,
    draw,
    clear,
    setPlayhead,
    destroy,
    get heatEnabled() {
      return heatEnabled;
    },
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function thinForDraw(points, max) {
  if (!points?.length || points.length <= max) return points || [];
  const step = Math.ceil(points.length / max);
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
