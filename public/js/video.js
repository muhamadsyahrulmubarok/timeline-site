/**
 * Canvas video studio — static map tiles background, city labels, WebM/MP4 export.
 */

import { activityColor } from './map.js';
import { haversine } from './parse.js';

export class ExportCancelled extends Error {
  constructor(message = 'Dibatalkan') {
    super(message);
    this.name = 'ExportCancelled';
  }
}

export const RES_PRESETS = {
  1280: { width: 1280, height: 720, label: '720p', baseBitrate: 4_000_000 },
  1920: { width: 1920, height: 1080, label: '1080p', baseBitrate: 8_000_000 },
  2560: { width: 2560, height: 1440, label: '1440p', baseBitrate: 14_000_000 },
};

export const BITRATE_MULTIPLIERS = {
  low: 0.6,
  normal: 1,
  high: 1.5,
};

export const ICON_OPTIONS = [
  { id: 'auto', label: 'Otomatis (dari aktivitas)' },
  { id: 'motor', label: 'Motor' },
  { id: 'car', label: 'Mobil' },
  { id: 'bike', label: 'Sepeda' },
  { id: 'walk', label: 'Jalan kaki' },
  { id: 'dot', label: 'Titik' },
];

const TILE_SIZE = 256;
const TILE_SUBS = ['a', 'b', 'c', 'd'];
const PATH_COLOR = '#1d6b4f';
const ACCENT = '#c9872a';
const MAX_TILES = 48;

/** @deprecated themes removed — kept for older app.js imports */
export function listFilters() {
  return [];
}

function boundsFromPoints(points) {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  if (!Number.isFinite(minLat)) {
    minLat = -7;
    maxLat = -6;
    minLng = 106;
    maxLng = 107;
  }
  const pad = 0.12;
  const dLat = Math.max(maxLat - minLat, 0.008) * (1 + pad);
  const dLng = Math.max(maxLng - minLng, 0.008) * (1 + pad);
  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  return {
    minLat: cLat - dLat / 2,
    maxLat: cLat + dLat / 2,
    minLng: cLng - dLng / 2,
    maxLng: cLng + dLng / 2,
  };
}

function latLngToWorld(lat, lng, zoom) {
  const sin = Math.sin((lat * Math.PI) / 180);
  const z = 2 ** zoom;
  const x = ((lng + 180) / 360) * z;
  const y =
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * z;
  return { x, y };
}

function chooseZoom(bounds, w, h) {
  for (let z = 15; z >= 4; z--) {
    const tl = latLngToWorld(bounds.maxLat, bounds.minLng, z);
    const br = latLngToWorld(bounds.minLat, bounds.maxLng, z);
    const tilesX = Math.ceil(Math.abs(br.x - tl.x)) + 1;
    const tilesY = Math.ceil(Math.abs(br.y - tl.y)) + 1;
    if (tilesX * tilesY <= MAX_TILES && tilesX * TILE_SIZE >= w * 0.55) {
      return z;
    }
  }
  return 4;
}

function createMercator(bounds, w, h) {
  const zoom = chooseZoom(bounds, w, h);
  const tl = latLngToWorld(bounds.maxLat, bounds.minLng, zoom);
  const br = latLngToWorld(bounds.minLat, bounds.maxLng, zoom);
  const worldW = Math.max(br.x - tl.x, 1e-9);
  const worldH = Math.max(br.y - tl.y, 1e-9);
  return {
    zoom,
    tl,
    br,
    worldW,
    worldH,
    w,
    h,
    toXY(p) {
      const pt = latLngToWorld(p.lat, p.lng, zoom);
      return {
        x: ((pt.x - tl.x) / worldW) * w,
        y: ((pt.y - tl.y) / worldH) * h,
      };
    },
  };
}

function loadTileImage(z, x, y) {
  const n = 2 ** z;
  const xx = ((x % n) + n) % n;
  const s = TILE_SUBS[(xx + y) % 4];
  const url = `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${xx}/${y}.png`;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function buildStaticMap(bounds, w, h, onProgress) {
  const merc = createMercator(bounds, w, h);
  const { zoom, tl, br, worldW, worldH } = merc;
  const x0 = Math.floor(tl.x);
  const y0 = Math.floor(tl.y);
  const x1 = Math.floor(br.x);
  const y1 = Math.floor(br.y);

  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      jobs.push({ tx, ty });
    }
  }

  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  octx.fillStyle = '#dfe7ee';
  octx.fillRect(0, 0, w, h);

  let done = 0;
  const concurrency = 6;
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const imgs = await Promise.all(batch.map((j) => loadTileImage(zoom, j.tx, j.ty)));
    batch.forEach((j, idx) => {
      const img = imgs[idx];
      done += 1;
      onProgress?.(done / jobs.length);
      if (!img) return;
      const dx = ((j.tx - tl.x) / worldW) * w;
      const dy = ((j.ty - tl.y) / worldH) * h;
      const dw = (1 / worldW) * w;
      const dh = (1 / worldH) * h;
      octx.drawImage(img, dx, dy, dw + 0.5, dh + 0.5);
    });
  }

  // light vignette so trail pops
  const g = octx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  octx.fillStyle = g;
  octx.fillRect(0, 0, w, h);

  octx.fillStyle = 'rgba(0,0,0,0.45)';
  octx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
  octx.fillText('© OpenStreetMap © CARTO', 16, h - 14);

  return { canvas: off, merc };
}

function formatStamp(t) {
  return new Date(t).toLocaleString('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateLabel(name, max = 24) {
  const s = String(name || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Prefer readable city / area name from visit. */
export function cityLabelForVisit(v) {
  const name = String(v?.name || '').trim();
  const address = String(v?.address || '').trim();
  if (address) {
    const parts = address
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !/^\d{4,}$/.test(p) && !/^indonesia$/i.test(p));
    // Prefer a mid/late segment that looks like a city/area (not street number)
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.length >= 3 && !/^(jl|jln|jalan|rt|rw)\b/i.test(p)) {
        // If name is generic, use address city; else name if shorter/clearer
        if (!name || /kunjungan|place|unknown/i.test(name)) return p;
        if (parts.length >= 2 && i >= parts.length - 2) {
          // keep place name if distinctive, else city
          if (name.length <= 18) return name;
          return p;
        }
      }
    }
  }
  return name || 'Lokasi';
}

export function pickVisitLabels(visits, max = 12) {
  if (!visits?.length) return [];
  const seen = new Set();
  const uniq = [];
  for (const v of visits) {
    const label = cityLabelForVisit(v);
    const key = label.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push({ ...v, label });
  }
  if (uniq.length <= max) return uniq;

  const picked = [uniq[0]];
  const rest = uniq.slice(1);
  while (picked.length < max && rest.length) {
    let bestI = 0;
    let bestD = -1;
    for (let i = 0; i < rest.length; i++) {
      const v = rest[i];
      let minD = Infinity;
      for (const p of picked) minD = Math.min(minD, haversine(v, p));
      if (minD > bestD) {
        bestD = minD;
        bestI = i;
      }
    }
    picked.push(rest.splice(bestI, 1)[0]);
  }
  return picked;
}

function resolveIcon(iconOpt, activity) {
  if (iconOpt && iconOpt !== 'auto') return iconOpt;
  const a = String(activity || '').toLowerCase();
  if (/sepeda|bicycle|bike/.test(a)) return 'bike';
  if (/jalan|walk|lari|run|foot/.test(a)) return 'walk';
  if (/motor|motorcycle/.test(a)) return 'motor';
  if (/mobil|car|bus|kendaraan|vehicle|in_vehicle/.test(a)) return 'car';
  if (/kereta|train|mrt|subway|terbang|fly/.test(a)) return 'car';
  if (/diam|still|idle/.test(a)) return 'dot';
  return 'motor';
}

function drawIcon(ctx, type, x, y, angle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.25;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;

  if (type === 'dot') {
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (type === 'walk') {
    ctx.beginPath();
    ctx.arc(0, -10, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 6);
    ctx.moveTo(0, -1);
    ctx.lineTo(-7, 4);
    ctx.moveTo(0, -1);
    ctx.lineTo(7, 4);
    ctx.moveTo(0, 6);
    ctx.lineTo(-6, 16);
    ctx.moveTo(0, 6);
    ctx.lineTo(6, 16);
    ctx.stroke();
  } else if (type === 'bike') {
    ctx.beginPath();
    ctx.arc(-10, 6, 6, 0, Math.PI * 2);
    ctx.arc(10, 6, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-10, 6);
    ctx.lineTo(0, -2);
    ctx.lineTo(10, 6);
    ctx.moveTo(0, -2);
    ctx.lineTo(0, -10);
    ctx.lineTo(6, -10);
    ctx.stroke();
  } else if (type === 'car') {
    ctx.beginPath();
    ctx.moveTo(-16, 4);
    ctx.lineTo(-12, -6);
    ctx.lineTo(8, -6);
    ctx.lineTo(16, 2);
    ctx.lineTo(16, 8);
    ctx.lineTo(-16, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(-6, -5, 10, 5);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(-9, 9, 3.5, 0, Math.PI * 2);
    ctx.arc(10, 9, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(-11, 8, 5.5, 0, Math.PI * 2);
    ctx.arc(12, 8, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-11, 8);
    ctx.lineTo(2, 2);
    ctx.lineTo(12, 8);
    ctx.moveTo(2, 2);
    ctx.lineTo(2, -6);
    ctx.lineTo(10, -8);
    ctx.moveTo(2, 2);
    ctx.lineTo(-4, -4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(1, -10, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawCityLabels(ctx, merc, labels) {
  ctx.font = '600 14px "IBM Plex Sans", system-ui, sans-serif';
  for (const v of labels) {
    const { x, y } = merc.toXY(v);
    const label = truncateLabel(v.label || cityLabelForVisit(v));

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    const tw = ctx.measureText(label).width;
    const bx = x + 10;
    const by = y - 16;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    roundRect(ctx, bx - 6, by - 14, tw + 12, 24, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#1a2420';
    ctx.fillText(label, bx, by + 3);
  }
}

function buildFrames(data) {
  if (!data) return [];
  const fromSeg = [];
  for (const seg of data.segments || []) {
    for (const p of seg.path) {
      fromSeg.push({
        ...p,
        activity: seg.activity,
        color: activityColor(seg.activity),
      });
    }
  }
  const src = fromSeg.length > 1 ? fromSeg : data.points;
  if (src.length < 2) return src.slice();

  const frames = [];
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i];
    const b = src[i + 1];
    frames.push(a);
    const dist = haversine(a, b);
    const steps = Math.min(8, Math.max(0, Math.floor(dist / 80)));
    for (let s = 1; s <= steps; s++) {
      const f = s / (steps + 1);
      frames.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lng: a.lng + (b.lng - a.lng) * f,
        t: a.t + (b.t - a.t) * f,
        activity: a.activity,
        color: a.color || activityColor(a.activity),
      });
    }
  }
  frames.push(src[src.length - 1]);
  return frames;
}

function headingAngle(frames, index, merc) {
  const cur = merc.toXY(frames[index]);
  const prev = merc.toXY(frames[Math.max(0, index - 1)]);
  if (prev.x !== cur.x || prev.y !== cur.y) {
    return Math.atan2(cur.y - prev.y, cur.x - prev.x);
  }
  const next = merc.toXY(frames[Math.min(frames.length - 1, index + 1)]);
  return Math.atan2(next.y - cur.y, next.x - cur.x);
}

export function createVideoStudio(canvas) {
  const ctx = canvas.getContext('2d');
  let animId = null;
  let recorder = null;
  let chunks = [];
  let cancelled = false;
  let mapCacheKey = '';
  let mapCache = null;

  function renderFrame(frames, index, opts) {
    const w = canvas.width;
    const h = canvas.height;
    const merc = opts.merc;
    const labels = opts.labels || [];

    if (opts.mapBg) {
      ctx.drawImage(opts.mapBg, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#dfe7ee';
      ctx.fillRect(0, 0, w, h);
    }

    if (!merc) return;

    // faint full route
    if (frames.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(29,107,79,0.35)';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      frames.forEach((p, i) => {
        const { x, y } = merc.toXY(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    }

    drawCityLabels(ctx, merc, labels);

    const trail = Math.max(8, opts.trail || 40);
    const start = Math.max(0, index - trail);
    const slice = frames.slice(start, index + 1);

    if (slice.length > 1) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 4;
      for (let i = 1; i < slice.length; i++) {
        const a = slice[i - 1];
        const b = slice[i];
        const pa = merc.toXY(a);
        const pb = merc.toXY(b);
        ctx.strokeStyle = a.color || PATH_COLOR;
        ctx.globalAlpha = 0.4 + (i / slice.length) * 0.6;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    const cur = frames[index];
    if (cur) {
      const { x, y } = merc.toXY(cur);
      const icon = resolveIcon(opts.icon, cur.activity);
      const angle = headingAngle(frames, index, merc);
      drawIcon(ctx, icon, x, y, angle, cur.color || ACCENT);

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      roundRect(ctx, 28, 24, 400, 78, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.stroke();
      ctx.fillStyle = PATH_COLOR;
      ctx.font = '600 20px "Sora", system-ui, sans-serif';
      ctx.fillText('Timeline', 44, 52);
      ctx.font = '400 14px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillStyle = '#334';
      ctx.fillText(formatStamp(cur.t), 44, 76);
      if (cur.activity) {
        ctx.fillStyle = '#667';
        ctx.font = '400 12px "IBM Plex Sans", system-ui, sans-serif';
        ctx.fillText(cur.activity, 44, 94);
      }

      const prog = index / Math.max(1, frames.length - 1);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(28, h - 28, w - 56, 6);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(28, h - 28, (w - 56) * prog, 6);
    }
  }

  async function prepareScene(data, opts = {}, onMapProgress) {
    const frames = buildFrames(data);
    if (frames.length < 2) throw new Error('Butuh minimal 2 titik untuk video.');
    const w = opts.width || 1280;
    const h = opts.height || 720;
    canvas.width = w;
    canvas.height = h;

    const bounds = boundsFromPoints(frames);
    const labels = pickVisitLabels(data?.visits || [], 14);
    const key = [
      w,
      h,
      bounds.minLat.toFixed(4),
      bounds.maxLat.toFixed(4),
      bounds.minLng.toFixed(4),
      bounds.maxLng.toFixed(4),
    ].join('|');

    let mapBg;
    let merc;
    if (mapCache && mapCacheKey === key) {
      mapBg = mapCache.canvas;
      merc = mapCache.merc;
      onMapProgress?.(1);
    } else {
      const built = await buildStaticMap(bounds, w, h, onMapProgress);
      mapBg = built.canvas;
      merc = built.merc;
      mapCache = built;
      mapCacheKey = key;
    }

    return {
      frames,
      fullOpts: {
        ...opts,
        labels,
        mapBg,
        merc,
        width: w,
        height: h,
      },
    };
  }

  async function preview(data, opts = {}) {
    cancel();
    cancelled = false;
    const { frames, fullOpts } = await prepareScene(data, opts);
    if (cancelled) return { frames: frames.length };

    let i = 0;
    const speed = Number(fullOpts.speed) || 1;
    const tick = () => {
      if (cancelled) return;
      const idx = Math.min(Math.floor(i), frames.length - 1);
      renderFrame(frames, idx, fullOpts);
      i += speed;
      if (i >= frames.length) i = 0;
      animId = requestAnimationFrame(tick);
    };
    tick();
    return { frames: frames.length };
  }

  function cancel() {
    cancelled = true;
    if (animId) cancelAnimationFrame(animId);
    animId = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (_) {}
    }
    recorder = null;
    chunks = [];
  }

  async function exportVideo(data, opts = {}, onProgress) {
    cancel();
    cancelled = false;
    const { frames, fullOpts } = await prepareScene(data, opts, (p) => {
      onProgress?.(p * 0.08);
    });
    if (cancelled) throw new ExportCancelled();

    const fps = fullOpts.fps || 30;
    const speed = Number(fullOpts.speed) || 1;
    const bits = fullOpts.videoBitsPerSecond || 4_000_000;
    const stream = canvas.captureStream(fps);
    chunks = [];

    const mime = pickRecorderMime(fullOpts.preferMp4 !== false);
    const isMp4 = mime.includes('mp4');

    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bits });
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };

    const done = new Promise((resolve, reject) => {
      recorder.onstop = () => {
        if (cancelled) {
          reject(new ExportCancelled());
          return;
        }
        resolve(new Blob(chunks, { type: mime.split(';')[0] }));
      };
      recorder.onerror = () => reject(new Error('Gagal merekam video'));
    });

    recorder.start(100);

    for (let i = 0; i < frames.length; i += speed) {
      if (cancelled) {
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch (_) {}
        throw new ExportCancelled();
      }
      renderFrame(frames, Math.min(Math.floor(i), frames.length - 1), fullOpts);
      if (onProgress) onProgress(0.08 + (i / frames.length) * 0.92);
      await new Promise((r) => setTimeout(r, 1000 / fps));
    }
    renderFrame(frames, frames.length - 1, fullOpts);
    await new Promise((r) => setTimeout(r, 400));

    if (cancelled) throw new ExportCancelled();

    recorder.stop();
    const blob = await done;
    if (onProgress) onProgress(1);
    blob._timelineIsMp4 = isMp4;
    return blob;
  }

  return { preview, exportVideo, cancel, renderFrame, listFilters, supportsNativeMp4 };
}

function pickRecorderMime(preferMp4) {
  const mp4 = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1.4D401E',
    'video/mp4',
  ];
  const webm = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const order = preferMp4 ? [...mp4, ...webm] : [...webm, ...mp4];
  for (const m of order) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

export function supportsNativeMp4() {
  return pickRecorderMime(true).includes('mp4');
}
