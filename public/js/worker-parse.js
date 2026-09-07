/**
 * Web Worker: parse large Google Timeline JSON off the main thread.
 */
import { parseTimelineJson } from './parse.js';

self.onmessage = (event) => {
  const { id, buffer, name } = event.data || {};
  try {
    self.postMessage({ id, stage: 'decode', progress: 0.05 });
    const text = new TextDecoder('utf-8').decode(buffer);
    self.postMessage({ id, stage: 'json', progress: 0.25 });
    const json = JSON.parse(text);
    self.postMessage({ id, stage: 'timeline', progress: 0.55 });
    const data = parseTimelineJson(json, name || 'upload');
    self.postMessage({ id, stage: 'done', progress: 1, ok: true, data });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      progress: 1,
      error: err?.message || String(err),
    });
  }
};
