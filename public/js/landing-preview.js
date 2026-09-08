/**
 * Hero product preview — static fallback, then Leaflet upgrade with sample route.
 */

import { getPreviewRoute } from './sample.js?v=18';

const MINT = '#64D8AB';
const GOLD = '#E8BC76';

function startMarkerIcon() {
  return L.divIcon({
    className: 'hero-marker',
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${MINT};border:2px solid #0B1210;box-shadow:0 0 0 1px ${MINT}"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function endMarkerIcon() {
  return L.divIcon({
    className: 'hero-marker',
    html: `<span style="display:block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:14px solid ${GOLD};filter:drop-shadow(0 1px 1px rgba(0,0,0,.4))"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 14],
  });
}

export function initLandingPreview(root = document) {
  const mapEl = root.querySelector('#hero-preview-map');
  const fallback = root.querySelector('#hero-preview-fallback');
  if (!mapEl || typeof L === 'undefined') return null;

  const route = getPreviewRoute();
  if (!route?.length) return null;

  const boot = () => {
    try {
      mapEl.hidden = false;
      const map = L.map(mapEl, {
        zoomControl: false,
        attributionControl: true,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        tap: false,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      const latlngs = route.map((p) => [p.lat, p.lng]);
      const line = L.polyline(latlngs, {
        color: MINT,
        weight: 3.5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      const start = route[0];
      const end = route[route.length - 1];
      L.marker([start.lat, start.lng], { icon: startMarkerIcon(), interactive: false })
        .addTo(map)
        .bindTooltip('Awal', { permanent: false, direction: 'top' });
      L.marker([end.lat, end.lng], { icon: endMarkerIcon(), interactive: false })
        .addTo(map)
        .bindTooltip('Tujuan', { permanent: false, direction: 'top' });

      map.fitBounds(line.getBounds(), { padding: [28, 28], maxZoom: 12 });

      if (fallback) fallback.hidden = true;

      requestAnimationFrame(() => map.invalidateSize());
      return map;
    } catch (err) {
      console.warn('Hero preview map gagal, pakai fallback statis', err);
      mapEl.hidden = true;
      if (fallback) fallback.hidden = false;
      return null;
    }
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => boot(), { timeout: 1800 });
  } else {
    setTimeout(boot, 400);
  }

  return { upgrade: boot };
}
