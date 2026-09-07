/**
 * Client-side WebM → MP4 via ffmpeg.wasm (single-thread core).
 */

import { FFmpeg } from '../vendor/ffmpeg/ffmpeg-esm/index.js';
import { fetchFile, toBlobURL } from '../vendor/ffmpeg/util-esm/index.js';

export class ExportCancelled extends Error {
  constructor(message = 'Dibatalkan') {
    super(message);
    this.name = 'ExportCancelled';
  }
}

const CORE_BASE = '/vendor/ffmpeg/core-esm';

let ffmpeg = null;
let loadPromise = null;

function assertNotCancelled(flag) {
  if (flag?.cancelled) throw new ExportCancelled();
}

/**
 * @param {(msg: string) => void} [onStatus]
 * @param {{ cancelled?: boolean }} [flag]
 */
export async function ensureFfmpeg(onStatus, flag) {
  assertNotCancelled(flag);
  if (ffmpeg?.loaded) return ffmpeg;

  if (!loadPromise) {
    loadPromise = (async () => {
      onStatus?.('Mengunduh encoder…');
      const instance = new FFmpeg();
      const coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript');
      assertNotCancelled(flag);
      const wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm');
      assertNotCancelled(flag);
      await instance.load({ coreURL, wasmURL });
      assertNotCancelled(flag);
      ffmpeg = instance;
      return instance;
    })().catch((err) => {
      loadPromise = null;
      ffmpeg = null;
      throw err;
    });
  }

  return loadPromise;
}

export function cancelConvert() {
  if (ffmpeg) {
    try {
      ffmpeg.terminate();
    } catch (_) {}
  }
  ffmpeg = null;
  loadPromise = null;
}

/**
 * @param {Blob} webmBlob
 * @param {{ bitrate?: number, fps?: number, onProgress?: (ratio: number) => void, onStatus?: (msg: string) => void, flag?: { cancelled?: boolean } }} opts
 */
export async function convertWebmToMp4(webmBlob, opts = {}) {
  const flag = opts.flag || {};
  assertNotCancelled(flag);

  const instance = await ensureFfmpeg(opts.onStatus, flag);
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
