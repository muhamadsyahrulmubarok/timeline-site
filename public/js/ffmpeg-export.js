/**
 * Client-side WebM → MP4 via ffmpeg.wasm (single-thread core).
 * Loads encoder with download progress + Cache API (repeat visits skip network).
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
const CACHE_NAME = 'timeline-ffmpeg-v1';
const ASSETS = [
  { url: `${CORE_BASE}/ffmpeg-core.js`, mime: 'text/javascript', bytes: 112_000 },
  { url: `${CORE_BASE}/ffmpeg-core.wasm`, mime: 'application/wasm', bytes: 32_129_114 },
];

let ffmpeg = null;
let loadPromise = null;
const objectUrls = [];

function assertNotCancelled(flag) {
  if (flag?.cancelled) throw new ExportCancelled();
}

async function openCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch (_) {
    return null;
  }
}

/**
 * Fetch one asset with byte progress; prefer Cache API.
 * @returns {Promise<Blob>}
 */
async function fetchAssetBlob(asset, onByteProgress, flag, signal) {
  assertNotCancelled(flag);
  const cache = await openCache();

  if (cache) {
    const hit = await cache.match(asset.url);
    if (hit) {
      onByteProgress?.(asset.bytes, asset.bytes, true);
      return hit.blob();
    }
  }

  const res = await fetch(asset.url, { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Gagal unduh encoder (${res.status})`);

  const totalHeader = Number(res.headers.get('Content-Length')) || 0;
  // After gzip, Content-Length is compressed size; reader yields uncompressed.
  // Prefer known uncompressed size for stable UX.
  const total = asset.bytes || totalHeader || 0;

  if (!res.body || !res.body.getReader) {
    const blob = await res.blob();
    if (cache) {
      try {
        await cache.put(asset.url, new Response(blob, { headers: { 'Content-Type': asset.mime } }));
      } catch (_) {}
    }
    onByteProgress?.(blob.size, blob.size, false);
    return blob;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    assertNotCancelled(flag);
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onByteProgress?.(received, total || received, false);
  }

  const blob = new Blob(chunks, { type: asset.mime });
  if (cache) {
    try {
      await cache.put(asset.url, new Response(blob, { headers: { 'Content-Type': asset.mime } }));
    } catch (_) {}
  }
  onByteProgress?.(blob.size, blob.size, false);
  return blob;
}

function blobToObjectURL(blob, mime) {
  const url = URL.createObjectURL(new Blob([blob], { type: mime }));
  objectUrls.push(url);
  return url;
}

/**
 * @param {(info: { phase: string, ratio: number, cached?: boolean, label?: string }) => void} [onProgress]
 * @param {{ cancelled?: boolean }} [flag]
 * @param {AbortSignal} [signal]
 */
async function loadCoreUrls(onProgress, flag, signal) {
  const sizes = ASSETS.map((a) => a.bytes);
  const totalBytes = sizes.reduce((a, b) => a + b, 0);
  const received = [0, 0];
  let fromCache = true;

  const report = () => {
    const got = received[0] + received[1];
    onProgress?.({
      phase: 'download',
      ratio: Math.min(0.92, got / totalBytes),
      cached: fromCache,
      label: fromCache ? 'Memuat encoder dari cache…' : 'Mengunduh encoder…',
    });
  };

  // Parallel download (js is tiny; wasm dominates)
  const blobs = await Promise.all(
    ASSETS.map((asset, i) =>
      fetchAssetBlob(
        asset,
        (got, _total, cached) => {
          received[i] = Math.min(got, asset.bytes);
          if (!cached) fromCache = false;
          report();
        },
        flag,
        signal
      )
    )
  );

  assertNotCancelled(flag);
  onProgress?.({
    phase: 'init',
    ratio: 0.94,
    cached: fromCache,
    label: 'Menyiapkan encoder…',
  });

  return {
    coreURL: blobToObjectURL(blobs[0], ASSETS[0].mime),
    wasmURL: blobToObjectURL(blobs[1], ASSETS[1].mime),
    fromCache,
  };
}

/**
 * @param {(info: { phase: string, ratio: number, cached?: boolean, label?: string }) => void} [onProgress]
 * @param {{ cancelled?: boolean }} [flag]
 */
export async function ensureFfmpeg(onProgress, flag) {
  assertNotCancelled(flag);
  if (ffmpeg?.loaded) {
    onProgress?.({ phase: 'ready', ratio: 1, cached: true, label: 'Encoder siap' });
    return ffmpeg;
  }

  if (!loadPromise) {
    const ac = new AbortController();
    const watchCancel = setInterval(() => {
      if (flag?.cancelled) ac.abort();
    }, 200);

    loadPromise = (async () => {
      onProgress?.({ phase: 'download', ratio: 0, label: 'Mengunduh encoder…' });
      const { coreURL, wasmURL, fromCache } = await loadCoreUrls(onProgress, flag, ac.signal);
      assertNotCancelled(flag);

      const instance = new FFmpeg();
      await instance.load({ coreURL, wasmURL });
      assertNotCancelled(flag);

      ffmpeg = instance;
      onProgress?.({
        phase: 'ready',
        ratio: 1,
        cached: fromCache,
        label: fromCache ? 'Encoder siap (cache)' : 'Encoder siap',
      });
      return instance;
    })()
      .catch((err) => {
        loadPromise = null;
        if (flag?.cancelled || err?.name === 'AbortError') throw new ExportCancelled();
        throw err;
      })
      .finally(() => clearInterval(watchCancel));
  }

  return loadPromise;
}

/** Warm cache + optionally init wasm while user tweaks studio settings. */
export function preloadFfmpeg(onProgress) {
  const flag = { cancelled: false };
  return ensureFfmpeg(onProgress, flag).catch((err) => {
    if (err?.name === 'ExportCancelled') return null;
    console.warn('ffmpeg preload', err);
    return null;
  });
}

export function cancelConvert() {
  if (ffmpeg) {
    try {
      ffmpeg.terminate();
    } catch (_) {}
  }
  ffmpeg = null;
  loadPromise = null;
  // Keep Cache API + HTTP cache; only drop in-memory instance.
  while (objectUrls.length) {
    try {
      URL.revokeObjectURL(objectUrls.pop());
    } catch (_) {}
  }
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
    const ratio = Math.min(1, Math.max(0, progress || 0));
    opts.onProgress?.(ratio);
  };
  instance.on('progress', onProgress);

  const inName = 'input.webm';
  const outName = 'output.mp4';
  const bitrate = opts.bitrate || 8_000_000;
  const fps = opts.fps || 30;

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

    if (code !== 0) {
      throw new Error(`ffmpeg gagal (kode ${code})`);
    }

    const data = await instance.readFile(outName);
    opts.onProgress?.(1);
    return new Blob([data.buffer], { type: 'video/mp4' });
  } catch (err) {
    if (flag.cancelled || err?.name === 'ExportCancelled') {
      throw new ExportCancelled();
    }
    throw err;
  } finally {
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
