/**
 * WebM → MP4 via Muaz Khan ffmpeg_asm.js (asm.js worker).
 * Based on: https://github.com/muaz-khan/Ffmpeg.js/blob/master/webm-to-mp4.html
 */

export class ExportCancelled extends Error {
  constructor(message = 'Dibatalkan') {
    super(message);
    this.name = 'ExportCancelled';
  }
}

const ASM_URL = '/vendor/ffmpeg-asm/ffmpeg_asm.js';
const WORKER_URL = '/js/ffmpeg-asm-worker.js';

let worker = null;
let readyPromise = null;
let ready = false;
let converting = false;
const progressListeners = new Set();

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
  return ready && !!worker;
}

/** Warm HTTP cache for ~4.5MB gzipped asm.js */
export function prefetchEncoderAssets() {
  if (document.querySelector(`link[data-ffmpeg-preload="${ASM_URL}"]`)) {
    fetch(ASM_URL, { credentials: 'same-origin', cache: 'force-cache' }).catch(() => {});
    return;
  }
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'script';
  link.href = ASM_URL;
  link.dataset.ffmpegPreload = ASM_URL;
  document.head.appendChild(link);
  fetch(ASM_URL, { credentials: 'same-origin', cache: 'force-cache' }).catch(() => {});
}

function createWorker() {
  return new Worker(WORKER_URL);
}

/**
 * Load ffmpeg_asm.js inside worker (fires once → type: ready).
 * @param {(info: object) => void} [onProgress]
 * @param {{ cancelled?: boolean }} [flag]
 */
export async function ensureFfmpeg(onProgress, flag) {
  assertNotCancelled(flag);
  const unsub = subscribeProgress(onProgress);

  try {
    if (isFfmpegReady()) {
      notify({ phase: 'ready', ratio: 1, cached: true, label: 'Encoder siap' });
      return worker;
    }

    if (!readyPromise) {
      prefetchEncoderAssets();
      notify({
        phase: 'download',
        ratio: 0.05,
        cached: false,
        label: 'Mengunduh encoder (ffmpeg_asm.js)…',
      });

      const started = Date.now();
      readyPromise = new Promise((resolve, reject) => {
        try {
          worker = createWorker();
        } catch (err) {
          readyPromise = null;
          reject(err);
          return;
        }

        const beat = setInterval(() => {
          if (flag?.cancelled) return;
          const sec = Math.round((Date.now() - started) / 1000);
          notify({
            phase: 'download',
            ratio: Math.min(0.9, 0.1 + sec / 40),
            cached: false,
            label: `Menyiapkan encoder… ${sec}d`,
          });
        }, 400);

        const onMsg = (event) => {
          const message = event.data;
          if (message.type === 'ready') {
            clearInterval(beat);
            worker.removeEventListener('message', onMsg);
            ready = true;
            notify({ phase: 'ready', ratio: 1, cached: true, label: 'Encoder siap' });
            resolve(worker);
          } else if (message.type === 'stdout') {
            // optional log during load
          }
        };

        worker.addEventListener('message', onMsg);
        worker.addEventListener(
          'error',
          (err) => {
            clearInterval(beat);
            readyPromise = null;
            ready = false;
            try {
              worker.terminate();
            } catch (_) {}
            worker = null;
            reject(err?.message ? new Error(err.message) : new Error('Gagal muat encoder'));
          },
          { once: true }
        );
      }).catch((err) => {
        readyPromise = null;
        throw err;
      });
    } else {
      notify({
        phase: 'init',
        ratio: 0.85,
        cached: true,
        label: 'Menyiapkan encoder…',
      });
    }

    const watch = setInterval(() => {
      if (flag?.cancelled) {
        try {
          worker?.terminate();
        } catch (_) {}
        worker = null;
        ready = false;
        readyPromise = null;
      }
    }, 200);

    try {
      assertNotCancelled(flag);
      await readyPromise;
      assertNotCancelled(flag);
      return worker;
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
    console.warn('ffmpeg_asm preload', err);
    return null;
  });
}

export function cancelConvert() {
  converting = false;
  if (worker) {
    try {
      worker.terminate();
    } catch (_) {}
  }
  worker = null;
  ready = false;
  readyPromise = null;
}

function parseStdoutProgress(line, onProgress) {
  if (!onProgress || !line) return;
  // e.g. frame=  120 fps=... time=00:00:04.00
  const timeMatch = String(line).match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (timeMatch) {
    const sec =
      Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
    // unknown duration — pulse upward gently
    onProgress(Math.min(0.95, 0.15 + sec / 60));
    return;
  }
  const frameMatch = String(line).match(/frame=\s*(\d+)/);
  if (frameMatch) {
    const frame = Number(frameMatch[1]);
    onProgress(Math.min(0.95, 0.1 + frame / 800));
  }
}

/**
 * Convert WebM blob → MP4 using ffmpeg_asm.js
 * Command pattern from Muaz demo, bitrate adjustable.
 *
 * @param {Blob} webmBlob
 * @param {{ bitrate?: number, fps?: number, onProgress?: (ratio: number) => void, onStatus?: (msg: string) => void, onLoadProgress?: Function, flag?: { cancelled?: boolean } }} opts
 */
export async function convertWebmToMp4(webmBlob, opts = {}) {
  const flag = opts.flag || {};
  assertNotCancelled(flag);

  const w = await ensureFfmpeg(opts.onLoadProgress || ((info) => opts.onStatus?.(info.label)), flag);
  assertNotCancelled(flag);

  converting = true;
  opts.onStatus?.('Mengonversi ke MP4…');
  opts.onLoadProgress?.({
    phase: 'ready',
    ratio: 1,
    cached: true,
    label: 'Encoder siap — konversi…',
  });

  const buffer = await webmBlob.arrayBuffer();
  assertNotCancelled(flag);

  const bitrateKb = Math.max(500, Math.round((opts.bitrate || 6_400_000) / 1000));
  // Same codec path as Muaz webm-to-mp4.html (mpeg4), bitrate from studio preset
  const args = `-i video.webm -c:v mpeg4 -b:v ${bitrateKb}k -an -strict experimental output.mp4`.split(
    ' '
  );

  return new Promise((resolve, reject) => {
    if (!w) {
      converting = false;
      reject(new Error('Encoder tidak siap'));
      return;
    }

    const onMsg = (event) => {
      const message = event.data;
      if (flag.cancelled) {
        w.removeEventListener('message', onMsg);
        converting = false;
        reject(new ExportCancelled());
        return;
      }

      if (message.type === 'stdout') {
        parseStdoutProgress(message.data, opts.onProgress);
        const text = String(message.data || '');
        if (/frame=|time=|video:|Output|Opening/i.test(text)) {
          opts.onStatus?.(text.length > 80 ? `${text.slice(0, 77)}…` : text);
        }
      } else if (message.type === 'start') {
        opts.onStatus?.('ffmpeg: konversi dimulai…');
        opts.onProgress?.(0.05);
      } else if (message.type === 'done') {
        w.removeEventListener('message', onMsg);
        converting = false;
        try {
          const result = message.data?.[0];
          if (!result?.data) {
            reject(new Error('Konversi gagal — tidak ada output MP4'));
            return;
          }
          const bytes = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
          opts.onProgress?.(1);
          resolve(new Blob([bytes], { type: 'video/mp4' }));
        } catch (err) {
          reject(err);
        }
      }
    };

    w.addEventListener('message', onMsg);

    try {
      w.postMessage({
        type: 'command',
        arguments: args,
        TOTAL_MEMORY: 268435456,
        files: [
          {
            data: new Uint8Array(buffer),
            name: 'video.webm',
          },
        ],
      });
    } catch (err) {
      w.removeEventListener('message', onMsg);
      converting = false;
      reject(err);
    }
  });
}
