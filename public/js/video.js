/**
 * Canvas video studio — stylized map, activity icons, WebM export.
 */

import { activityColor } from './map.js';
import { haversine } from './parse.js';

export class ExportCancelled extends Error {
  constructor(message = 'Dibatalkan') {
    super(message);
    this.name = 'ExportCancelled';
  }
}

const FILTERS = {
  clean: {
    label: 'Clean',
    bg: ['#0a100e', '#14241e'],
    land: '#16352c',
    road: 'rgba(232,220,200,0.12)',
    path: null,
    glow: false,
    stamp: 'rgba(232,184,109,0.95)',
  },
  neon: {
    label: 'Neon trail',
    bg: ['#05070a', '#0d1520'],
    land: '#0a1a28',
    road: 'rgba(94,240,200,0.1)',
    path: '#5ef0c8',
    glow: true,
    stamp: '#5ef0c8',
  },
  vintage: {
    label: 'Vintage',
    bg: ['#1a1510', '#2a2218'],
    land: '#3a2e22',
    road: 'rgba(232,213,176,0.14)',
    path: '#c4a574',
    glow: false,
    stamp: '#e8d5b0',
    sepia: true,
  },
  mono: {
    label: 'Mono',
    bg: ['#0e0e0e', '#1a1a1a'],
    land: '#222',
    road: 'rgba(255,255,255,0.1)',
    path: '#d0d0d0',
    glow: false,
    stamp: '#f0f0f0',
  },
  sunset: {
    label: 'Sunset',
    bg: ['#1a0f14', '#2a1820'],
    land: '#3a1c28',
    road: 'rgba(255,201,168,0.12)',
    path: '#ff8b6a',
    glow: true,
    stamp: '#ffc9a8',
  },
};

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

export function listFilters() {
  return Object.entries(FILTERS).map(([id, f]) => ({ id, label: f.label }));
}

function project(points) {
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
  const pad = 0.1;
  const dLat = Math.max(maxLat - minLat, 0.01) * (1 + pad);
  const dLng = Math.max(maxLng - minLng, 0.01) * (1 + pad);
  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  return {
    minLat: cLat - dLat / 2,
    maxLat: cLat + dLat / 2,
    minLng: cLng - dLng / 2,
    maxLng: cLng + dLng / 2,
  };
}

function toXY(p, bounds, w, h, margin = 56) {
  const x =
    margin +
    ((p.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * (w - margin * 2);
  const y =
    margin +
    (1 - (p.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * (h - margin * 2);
  return { x, y };
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

function truncateLabel(name, max = 22) {
  const s = String(name || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Pick spatially spread unique visit labels (max N). */
export function pickVisitLabels(visits, max = 12) {
  if (!visits?.length) return [];
  const seen = new Set();
  const uniq = [];
  for (const v of visits) {
    const key = (v.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(v);
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
      for (const p of picked) {
        minD = Math.min(minD, haversine(v, p));
      }
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
  if (/mobil|car|bus|kendaraan|vehicle|in_vehicle|mobil/.test(a)) return 'car';
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
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

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
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-6, -5, 10, 5);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(-9, 9, 3.5, 0, Math.PI * 2);
    ctx.arc(10, 9, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // motor
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

function drawStylizedMap(ctx, w, h, filter, bounds, frames, labels) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, filter.bg[0]);
  g.addColorStop(1, filter.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // land plate
  ctx.fillStyle = filter.land || '#16352c';
  ctx.globalAlpha = 0.55;
  roundRect(ctx, 28, 24, w - 56, h - 48, 18);
  ctx.fill();
  ctx.globalAlpha = 1;

  // soft city blobs around visits
  for (const v of labels) {
    const { x, y } = toXY(v, bounds, w, h);
    const rg = ctx.createRadialGradient(x, y, 8, x, y, 90);
    rg.addColorStop(0, 'rgba(94,196,160,0.18)');
    rg.addColorStop(1, 'rgba(94,196,160,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, 90, 0, Math.PI * 2);
    ctx.fill();
  }

  // road grid
  ctx.strokeStyle = filter.road || 'rgba(232,220,200,0.12)';
  ctx.lineWidth = 1.25;
  const cols = 10;
  const rows = 7;
  for (let i = 0; i <= cols; i++) {
    const x = 40 + ((w - 80) * i) / cols;
    ctx.beginPath();
    ctx.moveTo(x, 36);
    ctx.lineTo(x + (i % 2 ? 12 : -8), h - 36);
    ctx.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    const y = 40 + ((h - 80) * j) / rows;
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(w - 36, y + (j % 2 ? 10 : -6));
    ctx.stroke();
  }

  // faint full route as "known road"
  if (frames.length > 1) {
    ctx.save();
    ctx.strokeStyle = filter.road || 'rgba(232,220,200,0.2)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    frames.forEach((p, i) => {
      const { x, y } = toXY(p, bounds, w, h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  // compass rose
  ctx.save();
  ctx.translate(w - 70, 70);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(4, 2);
  ctx.lineTo(0, -4);
  ctx.lineTo(-4, 2);
  ctx.closePath();
  ctx.fill();
  ctx.font = '600 11px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText('U', -4, -22);
  ctx.restore();

  // visit pins + city labels
  ctx.font = '600 13px "IBM Plex Sans", system-ui, sans-serif';
  for (const v of labels) {
    const { x, y } = toXY(v, bounds, w, h);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = filter.stamp;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const label = truncateLabel(v.name);
    const tw = ctx.measureText(label).width;
    const bx = x + 10;
    const by = y - 18;
    ctx.fillStyle = 'rgba(8,12,10,0.72)';
    roundRect(ctx, bx - 6, by - 14, tw + 12, 22, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(label, bx, by + 2);
  }
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

function headingAngle(frames, index, bounds, w, h) {
  const cur = toXY(frames[index], bounds, w, h);
  const prev = toXY(frames[Math.max(0, index - 1)], bounds, w, h);
  if (prev.x !== cur.x || prev.y !== cur.y) {
    return Math.atan2(cur.y - prev.y, cur.x - prev.x);
  }
  const next = toXY(frames[Math.min(frames.length - 1, index + 1)], bounds, w, h);
  return Math.atan2(next.y - cur.y, next.x - cur.x);
}

export function createVideoStudio(canvas) {
  const ctx = canvas.getContext('2d');
  let animId = null;
  let recorder = null;
  let chunks = [];
  let cancelled = false;

  function renderFrame(frames, index, opts) {
    const filter = FILTERS[opts.filter] || FILTERS.clean;
    const w = canvas.width;
    const h = canvas.height;
    const bounds = project(frames);
    const labels = opts.labels || [];
    drawStylizedMap(ctx, w, h, filter, bounds, frames, labels);

    const trail = Math.max(8, opts.trail || 40);
    const start = Math.max(0, index - trail);
    const slice = frames.slice(start, index + 1);

    if (slice.length > 1) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (filter.glow) {
        ctx.save();
        ctx.shadowColor = filter.path || '#3d9b7a';
        ctx.shadowBlur = 18;
        ctx.strokeStyle = filter.path || '#3d9b7a';
        ctx.lineWidth = 6;
        ctx.beginPath();
        slice.forEach((p, i) => {
          const { x, y } = toXY(p, bounds, w, h);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();
      }

      ctx.lineWidth = 3.5;
      for (let i = 1; i < slice.length; i++) {
        const a = slice[i - 1];
        const b = slice[i];
        const pa = toXY(a, bounds, w, h);
        const pb = toXY(b, bounds, w, h);
        ctx.strokeStyle = filter.path || a.color || '#3d9b7a';
        ctx.globalAlpha = 0.35 + (i / slice.length) * 0.65;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    const cur = frames[index];
    if (cur) {
      const { x, y } = toXY(cur, bounds, w, h);
      const icon = resolveIcon(opts.icon, cur.activity);
      const angle = headingAngle(frames, index, bounds, w, h);
      const color = filter.path || cur.color || '#e8b86d';
      drawIcon(ctx, icon, x, y, angle, color);

      ctx.fillStyle = 'rgba(12,18,16,0.55)';
      ctx.fillRect(32, 28, 420, 86);
      ctx.fillStyle = filter.stamp;
      ctx.font = '600 22px "Sora", system-ui, sans-serif';
      ctx.fillText('Timeline', 48, 58);
      ctx.font = '400 16px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(formatStamp(cur.t), 48, 86);
      if (cur.activity) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '400 14px "IBM Plex Sans", system-ui, sans-serif';
        ctx.fillText(cur.activity, 48, 108);
      }

      const prog = index / Math.max(1, frames.length - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(32, h - 40, w - 64, 6);
      ctx.fillStyle = filter.stamp;
      ctx.fillRect(32, h - 40, (w - 64) * prog, 6);
    }

    if (filter.sepia) {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i],
          g = d[i + 1],
          b = d[i + 2];
        d[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
        d[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
        d[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
      }
      ctx.putImageData(img, 0, 0);
    }
  }

  function withLabels(data, opts) {
    return {
      ...opts,
      labels: pickVisitLabels(data?.visits || [], 12),
    };
  }

  function preview(data, opts = {}) {
    cancel();
    cancelled = false;
    const frames = buildFrames(data);
    if (frames.length < 2) throw new Error('Butuh minimal 2 titik untuk video.');
    const fullOpts = withLabels(data, opts);
    canvas.width = fullOpts.width || 1280;
    canvas.height = fullOpts.height || 720;
    let i = 0;
    const speed = Number(fullOpts.speed) || 1;
    const tick = () => {
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
    const frames = buildFrames(data);
    if (frames.length < 2) throw new Error('Butuh minimal 2 titik untuk video.');
    const fullOpts = withLabels(data, opts);

    canvas.width = fullOpts.width || 1280;
    canvas.height = fullOpts.height || 720;
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
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        resolve(blob);
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
      if (onProgress) onProgress(i / frames.length);
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

export { FILTERS };
