/**
 * Canvas video studio — animate path with filters, export WebM via MediaRecorder.
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
    path: null,
    glow: false,
    stamp: 'rgba(232,184,109,0.95)',
  },
  neon: {
    label: 'Neon trail',
    bg: ['#05070a', '#0d1520'],
    path: '#5ef0c8',
    glow: true,
    stamp: '#5ef0c8',
  },
  vintage: {
    label: 'Vintage',
    bg: ['#1a1510', '#2a2218'],
    path: '#c4a574',
    glow: false,
    stamp: '#e8d5b0',
    sepia: true,
  },
  mono: {
    label: 'Mono',
    bg: ['#0e0e0e', '#1a1a1a'],
    path: '#d0d0d0',
    glow: false,
    stamp: '#f0f0f0',
  },
  sunset: {
    label: 'Sunset',
    bg: ['#1a0f14', '#2a1820'],
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
  const pad = 0.08;
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

function toXY(p, bounds, w, h, margin = 64) {
  const x =
    margin +
    ((p.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * (w - margin * 2);
  const y =
    margin +
    (1 - (p.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * (h - margin * 2);
  return { x, y };
}

function drawGrid(ctx, w, h, filter) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, filter.bg[0]);
  g.addColorStop(1, filter.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const x = (w / 12) * i;
    const y = (h / 12) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(61,155,122,0.08)';
  for (let r = 80; r < Math.max(w, h); r += 120) {
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.55, r, 0, Math.PI * 2);
    ctx.stroke();
  }
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
    drawGrid(ctx, w, h, filter);

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
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = filter.path || '#e8b86d';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();

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

  function preview(data, opts = {}) {
    cancel();
    cancelled = false;
    const frames = buildFrames(data);
    if (frames.length < 2) throw new Error('Butuh minimal 2 titik untuk video.');
    canvas.width = opts.width || 1280;
    canvas.height = opts.height || 720;
    let i = 0;
    const speed = opts.speed || 2;
    const tick = () => {
      const idx = Math.min(i, frames.length - 1);
      renderFrame(frames, idx, opts);
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

    canvas.width = opts.width || 1280;
    canvas.height = opts.height || 720;
    const fps = opts.fps || 30;
    const speed = opts.speed || 2;
    const bits = opts.videoBitsPerSecond || 4_000_000;
    const stream = canvas.captureStream(fps);
    chunks = [];

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';

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
        const blob = new Blob(chunks, { type: mime });
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
      renderFrame(frames, Math.min(i, frames.length - 1), opts);
      if (onProgress) onProgress(i / frames.length);
      await new Promise((r) => setTimeout(r, 1000 / fps));
    }
    renderFrame(frames, frames.length - 1, opts);
    await new Promise((r) => setTimeout(r, 400));

    if (cancelled) throw new ExportCancelled();

    recorder.stop();
    const blob = await done;
    if (onProgress) onProgress(1);
    return blob;
  }

  return { preview, exportVideo, cancel, renderFrame, listFilters };
}

export { FILTERS };
