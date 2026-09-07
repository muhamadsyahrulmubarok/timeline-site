/**
 * Client-side WebM → MP4 via ffmpeg.wasm (single-thread).
 * Progress listeners shared across preload + export; direct same-origin URLs (HTTP cache).
 */

import { FFmpeg } from '../vendor/ffmpeg/ffmpeg-esm/index.js';
import { fetchFile } from '../vendor/ffmpeg/util-esm/index.js';

export class ExportCancelled extends Error {
  constructor(message = 'Dibatalkan') {
    super(message);
    this.name = 'ExportCancelled';
  }
}

const CORE_BASE = '/vendor/ffmpeg/core-esm';
const CORE_JS = `${CORE_BASE}/ffmpeg-core.js`;
const CORE_WASM = `${CORE_BASE}/ffmpeg-core.wasm`;
/** Uncompressed wasm size (gzip ~10MB on wire). */
const WASM_BYTES = 32_129_114;

let ffmpeg = null;
let loadPromise = null;
let loadAbort = null;
const progressListeners = new Set();
let converting = false;

function assertNotCancelled(flag) {
  if (flag?.cancelled) throw new ExportCancelled();
}

function notify(info) {
  for (const fn of progressListeners) {
    try {
      fn(info);
    } catch (_) {}
  }
}

function subscribeProgress(fn) {
  if (typeof fn !== 'function') return () => {};
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

export function isFfmpegReady() {
  return !!(ffmpeg && ffmpeg.loaded);
}

/** Warm HTTP cache without instantiating wasm yet (cheap). */
export function prefetchEncoderAssets() {
  const urls = [CORE_JS, CORE_WASM];
  for (const url of urls) {
    if (document.querySelector(`link[data-ffmpeg-preload="${url}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'fetch';
    link.href = url;
    link.crossOrigin = 'anonymous';
    link.dataset.ffmpegPreload = url;
    document.head.appendChild(link);
  }
  // Also kick fetch into HTTP cache (ignore body)
  urls.forEach((url) => {
    fetch(url, { credentials: 'same-origin', cache: 'force-cache' }).catch(() => {});
  });
}

/**
 * Track download of wasm via fetch for UX; result discarded (HTTP cache warms).
 * Real load uses same URL so browser reuses cache.
 */
async function warmWasmWithProgress(flag, signal) {
  notify({ phase: 'download', ratio: 0.02, cached: false, label: 'Mengunduh encoder…' });

  // Cache API fast path
  try {
    const cache = await caches.open('timeline-ffmpeg-v2');
    const hit = await cache.match(CORE_WASM);
    if (hit) {
      notify({ phase: 'download', ratio: 0.85, cached: true, label: 'Encoder di cache…' });
      return true;
    }
  } catch (_) {}

  const res = await fetch(CORE_WASM, { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Gagal unduh encoder (${res.status})`);

  const encodedLen = Number(res.headers.get('Content-Length')) || 0;
  // Prefer compressed length for progress when gzip (matches network feel on mobile)
  const total = encodedLen || WASM_BYTES;
  let received = 0;
  let cached = false;

  if (!res.body?.getReader) {
    await res.arrayBuffer();
    notify({ phase: 'download', ratio: 0.85, cached: false, label: 'Unduhan encoder selesai' });
    return false;
  }

  const reader = res.body.getReader();
  // If browser auto-decompressed, Content-Length is compressed but chunks are full size.
  // Cap ratio using max(received/total, received/WASM_BYTES) carefully:
  const useUncompressed = !res.headers.get('Content-Encoding') && !encodedLen;
  const denom = useUncompressed ? WASM_BYTES : total;

  while (true) {
    assertNotCancelled(flag);
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    const ratio = Math.min(0.85, received / Math.max(denom, 1));
    notify({
      phase: 'download',
      ratio,
      cached: false,
      label: `Mengunduh encoder… ${Math.round(ratio * 100)}%`,
    });
  }

  try {
    const cache = await caches.open('timeline-ffmpeg-v2');
    // Re-fetch from HTTP cache into Cache API for next time (opaque-ish)
    const cachedRes = await fetch(CORE_WASM, { credentials: 'same-origin', cache: 'force-cache' });
    if (cachedRes.ok) await cache.put(CORE_WASM, cachedRes.clone());
    cached = true;
  } catch (_) {}

  notify({ phase: 'download', ratio: 0.88, cached, label: 'Unduhan encoder selesai' });
  return cached;
}

/**
 * @param {(info: object) => void} [onProgress]
 * @param {{ cancelled?: boolean }} [flag]
 */
export async function ensureFfmpeg(onProgress, flag) {
  assertNotCancelled(flag);
  const unsub = subscribeProgress(onProgress);

  try {
    if (ffmpeg?.loaded) {
      notify({ phase: 'ready', ratio: 1, cached: true, label: 'Encoder siap' });
      return ffmpeg;
    }

    if (!loadPromise) {
      loadAbort = new AbortController();
      const signal = loadAbort.signal;

      loadPromise = (async () => {
        assertNotCancelled(flag);
        let fromCache = false;
        try {
          fromCache = await warmWasmWithProgress(flag, signal);
        } catch (err) {
          if (flag?.cancelled || err?.name === 'AbortError') throw new ExportCancelled();
          // Still try direct load — HTTP cache / previous visit may help
          notify({
            phase: 'download',
            ratio: 0.5,
            cached: false,
            label: 'Mencoba muat encoder…',
          });
        }

        assertNotCancelled(flag);
        notify({
          phase: 'init',
          ratio: 0.9,
          cached: fromCache,
          label: 'Menyiapkan encoder di perangkat…',
        });

        const instance = new FFmpeg();
        const started = Date.now();
        const beat = setInterval(() => {
          if (flag?.cancelled) return;
          const sec = Math.round((Date.now() - started) / 1000);
          const pulse = 0.9 + Math.min(0.08, sec / 120);
          notify({
            phase: 'init',
            ratio: pulse,
            cached: fromCache,
            label: `Menyiapkan encoder di perangkat… ${sec}d`,
          });
        }, 500);

        try {
          // Same-origin URLs — browser HTTP cache; no 31MB blob copy
          await instance.load({
            coreURL: CORE_JS,
            wasmURL: CORE_WASM,
          });
        } finally {
          clearInterval(beat);
        }

        assertNotCancelled(flag);
        ffmpeg = instance;
        notify({
          phase: 'ready',
          ratio: 1,
          cached: fromCache,
          label: fromCache ? 'Encoder siap (cache)' : 'Encoder siap',
        });
        return instance;
      })().catch((err) => {
        loadPromise = null;
        loadAbort = null;
        if (flag?.cancelled || err?.name === 'AbortError' || err?.name === 'ExportCancelled') {
          throw new ExportCancelled();
        }
        throw err;
      });
    } else {
      notify({
        phase: 'init',
        ratio: 0.9,
        cached: true,
        label: 'Menyiapkan encoder di perangkat…',
      });
    }

    // Watch export cancel → abort in-flight warm fetch
    const watch = setInterval(() => {
      if (flag?.cancelled && loadAbort) {
        try {
          loadAbort.abort();
        } catch (_) {}
      }
    }, 200);

    try {
      return await loadPromise;
    } finally {
      clearInterval(watch);
    }
  } finally {
    unsub();
  }
}

export function preloadFfmpeg(onProgress) {
  prefetchEncoderAssets();
  const flag = { cancelled: false };
  return ensureFfmpeg(onProgress, flag).catch((err) => {
    if (err?.name === 'ExportCancelled') return null;
    console.warn('ffmpeg preload', err);
    return null;
  });
}

/**
 * Cancel in-flight convert / load. Prefer soft abort during download;
 * terminate only if converting or hard reset needed.
 */
export function cancelConvert(hard = true) {
  try {
    loadAbort?.abort();
  } catch (_) {}
  loadAbort = null;

  if (hard || converting) {
    if (ffmpeg) {
      try {
        ffmpeg.terminate();
      } catch (_) {}
    }
    ffmpeg = null;
    loadPromise = null;
  }
  converting = false;
}

/**
 * @param {Blob} webmBlob
 * @param {{ bitrate?: number, fps?: number, onProgress?: (ratio: number) => void, onStatus?: (msg: string) => void, onLoadProgress?: Function, flag?: { cancelled?: boolean } }} opts
 */
export async function convertWebmToMp4(webmBlob, opts = {}) {
  const flag = opts.flag || {};
  assertNotCancelled(flag);

  const instance = await ensureFfmpeg(opts.onLoadProgress || ((info) => opts.onStatus?.(info.label)), flag);
  assertNotCancelled(flag);

  const onProgress = ({ progress }) => {
    if (flag.cancelled) return;
    opts.onProgress?.(Math.min(1, Math.max(0, progress || 0)));
  };
  instance.on('progress', onProgress);

  const inName = 'input.webm';
  const outName = 'output.mp4';
  const bitrate = opts.bitrate || 8_000_000;
  const fps = opts.fps || 30;
  converting = true;

  try {
    opts.onStatus?.('Mengonversi ke MP4…');
    await instance.writeFile(inName, await fetchFile(webmBlob));
    assertNotCancelled(flag);

    const bitrateStr = `${Math.round(bitrate / 1000)}k`;
    const code = await instance.exec([
      '-i',
      inName,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-b:v',
      bitrateStr,
      '-maxrate',
      bitrateStr,
      '-bufsize',
      `${Math.round((bitrate * 2) / 1000)}k`,
      '-r',
      String(fps),
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      outName,
    ]);
    assertNotCancelled(flag);

    if (code !== 0) throw new Error(`ffmpeg gagal (kode ${code})`);

    const data = await instance.readFile(outName);
    opts.onProgress?.(1);
    return new Blob([data.buffer], { type: 'video/mp4' });
  } catch (err) {
    if (flag.cancelled || err?.name === 'ExportCancelled') throw new ExportCancelled();
    throw err;
  } finally {
    converting = false;
    try {
      instance.off('progress', onProgress);
    } catch (_) {}
    try {
      await instance.deleteFile(inName);
    } catch (_) {}
    try {
      await instance.deleteFile(outName);
    } catch (_) {}
  }
}
