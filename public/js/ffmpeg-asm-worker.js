/**
 * Web Worker for Muaz Khan ffmpeg_asm.js (classic asm.js, not wasm).
 * Pattern from: https://github.com/muaz-khan/Ffmpeg.js/blob/master/webm-to-mp4.html
 */

/* eslint-disable no-undef */
importScripts('/vendor/ffmpeg-asm/ffmpeg_asm.js');

const now = Date.now;

function print(text) {
  postMessage({ type: 'stdout', data: String(text) });
}

onmessage = function (event) {
  const message = event.data;
  if (message.type !== 'command') return;

  const Module = {
    print,
    printErr: print,
    files: message.files || [],
    arguments: message.arguments || [],
    TOTAL_MEMORY: message.TOTAL_MEMORY || false,
  };

  postMessage({ type: 'start', data: Module.arguments.join(' ') });
  postMessage({
    type: 'stdout',
    data:
      'Received command: ' +
      Module.arguments.join(' ') +
      (Module.TOTAL_MEMORY ? '. Processing with ' + Module.TOTAL_MEMORY + ' bits.' : ''),
  });

  const time = now();
  const result = ffmpeg_run(Module);
  const totalTime = now() - time;

  postMessage({
    type: 'stdout',
    data: 'Finished processing (took ' + totalTime + 'ms)',
  });
  postMessage({ type: 'done', data: result, time: totalTime });
};

postMessage({ type: 'ready' });
