import { createTimelineMap } from './map.js?v=16';
import {
  createVideoStudio,
  RES_PRESETS,
  BITRATE_MULTIPLIERS,
  ExportCancelled,
  supportsNativeMp4,
} from './video.js?v=16';
import { getSampleTimeline } from './sample.js?v=16';
import { parseTimelineJson, filterTimeline } from './parse.js?v=16';
import {
  convertWebmToMp4,
  cancelConvert,
  preloadFfmpeg,
  prefetchEncoderAssets,
  isFfmpegReady,
} from './ffmpeg-export.js?v=16';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  raw: null,
  view: null,
  map: null,
  studio: null,
  playing: false,
  playIdx: 0,
  playTimer: null,
  heatmap: false,
  exporting: false,
  exportFlag: { cancelled: false },
  lastWebm: null,
};

function fmtDist(m) {
  if (!Number.isFinite(m)) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function fmtDate(t) {
  if (!t) return '—';
  return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(t) {
  if (!t) return '—';
  return new Date(t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function toInputDate(t) {
  if (!t) return '';
  const d = new Date(t);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 860px)').matches;
}

function setPanelOpen(open) {
  const panel = $('#side-panel');
  const backdrop = $('#panel-backdrop');
  const toggle = $('#btn-panel-toggle');
  if (!panel) return;
  panel.classList.toggle('panel-open', open);
  if (backdrop) backdrop.hidden = !open || !isMobileLayout();
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Tutup' : 'Filter';
  }
  $('#app')?.classList.toggle('panel-open', open && isMobileLayout());
  requestAnimationFrame(() => state.map?.map.invalidateSize());
}

function togglePanel() {
  const open = !$('#side-panel')?.classList.contains('panel-open');
  setPanelOpen(open);
}

function setMoreMenuOpen(open) {
  const menu = $('#more-menu');
  const btn = $('#btn-more');
  if (!menu || !btn) return;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

function closeMoreMenu() {
  setMoreMenuOpen(false);
}

function showApp() {
  $('#landing').hidden = true;
  $('#app').hidden = false;
  requestAnimationFrame(() => state.map?.map.invalidateSize());
}

function showLanding() {
  stopPlay();
  if (state.exporting) cancelStudioExport();
  state.studio?.cancel();
  $('#landing').hidden = false;
  $('#app').hidden = true;
}

function setStats(data) {
  $('#stat-points').textContent = data.stats.pointCount.toLocaleString('id-ID');
  $('#stat-visits').textContent = data.stats.visitCount.toLocaleString('id-ID');
  $('#stat-distance').textContent = fmtDist(data.stats.distanceM);
  $('#stat-range').textContent =
    data.stats.minT && data.stats.maxT
      ? `${fmtDate(data.stats.minT)} – ${fmtDate(data.stats.maxT)}`
      : '—';
  let meta = `${data.sourceName} · format ${data.format}`;
  if (data.stats.downsampled && data.stats.rawPointCount) {
    meta += ` · ditipiskan dari ${data.stats.rawPointCount.toLocaleString('id-ID')} titik`;
  }
  $('#file-meta').textContent = meta;
}

function showLoader(text, detail = '', progress = 0) {
  const el = $('#loader');
  el.hidden = false;
  $('#loader-text').textContent = text;
  $('#loader-detail').textContent = detail;
  $('#loader-bar').value = progress;
}

function hideLoader() {
  $('#loader').hidden = true;
}

function stageLabel(stage) {
  switch (stage) {
    case 'read':
      return 'Membaca file…';
    case 'decode':
      return 'Decode teks…';
    case 'json':
      return 'Parse JSON (bisa lama untuk file besar)…';
    case 'timeline':
      return 'Ekstrak titik lokasi…';
    case 'draw':
      return 'Menggambar peta…';
    default:
      return 'Memproses…';
  }
}

function parseInWorker(buffer, name, onProgress) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker('/js/worker-parse.js', { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Timeout — file terlalu besar atau HP kehabisan memori. Coba file Semantic bulanan, atau filter tahun lebih kecil.'));
    }, 180_000);

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.stage && onProgress) onProgress(msg.stage, msg.progress ?? 0);
      if (msg.ok === true) {
        clearTimeout(timer);
        worker.terminate();
        resolve(msg.data);
      } else if (msg.ok === false) {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(msg.error || 'Gagal parse'));
      }
    };
    worker.onerror = (err) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(err.message || 'Worker error'));
    };
    worker.postMessage({ id, buffer, name }, [buffer]);
  });
}

async function parseOnMain(buffer, name, onProgress) {
  onProgress?.('decode', 0.1);
  const text = new TextDecoder('utf-8').decode(buffer);
  onProgress?.('json', 0.3);
  await new Promise((r) => setTimeout(r, 40));
  const json = JSON.parse(text);
  onProgress?.('timeline', 0.6);
  await new Promise((r) => setTimeout(r, 40));
  return parseTimelineJson(json, name);
}

async function handleFile(file) {
  if (!file) return;
  const mb = file.size / (1024 * 1024);
  const status = $('#upload-status');
  if (status) {
    status.textContent = `Import ${file.name} (${mb.toFixed(1)} MB)…`;
    status.dataset.state = 'loading';
  }

  showLoader(
    `Membaca ${file.name}`,
    mb >= 10 ? `${mb.toFixed(1)} MB — di HP bisa 30–90 detik, jangan tutup tab` : `${mb.toFixed(1)} MB`,
    0.02
  );

  try {
    const buffer = await file.arrayBuffer();
    showLoader(stageLabel('json'), `${mb.toFixed(1)} MB`, 0.2);

    const onProgress = (stage, progress) => {
      showLoader(stageLabel(stage), `${file.name} · ${mb.toFixed(1)} MB`, progress);
    };

    let data;
    try {
      data = await parseInWorker(buffer, file.name, onProgress);
    } catch (workerErr) {
      console.warn('Worker gagal, fallback main thread', workerErr);
      // buffer may be detached after transfer — re-read
      const buf2 = await file.arrayBuffer();
      data = await parseOnMain(buf2, file.name, onProgress);
    }

    showLoader(stageLabel('draw'), `${data.stats.pointCount.toLocaleString('id-ID')} titik`, 0.92);
    await new Promise((r) => setTimeout(r, 50));
    loadData(data);
    hideLoader();
    if (status) {
      status.textContent = '';
      status.dataset.state = '';
    }
  } catch (err) {
    console.error(err);
    hideLoader();
    const msg = err.message || 'Gagal memuat file';
    if (status) {
      status.textContent = msg;
      status.dataset.state = 'error';
    }
    alert(`Gagal import:\n${msg}`);
  }
}

function populateActivityFilters(data) {
  const box = $('#activity-filters');
  box.innerHTML = '';
  const acts = data.stats.activities.length
    ? data.stats.activities
    : [['Semua titik', data.stats.pointCount]];
  for (const [name, count] of acts) {
    const id = `act-${name.replace(/\W+/g, '-')}`;
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = `<input type="checkbox" name="activity" value="${name}" checked> <span>${name}</span> <em>${count}</em>`;
    box.appendChild(label);
  }
}

function applyFilters() {
  if (!state.raw) return;
  const fromStr = $('#filter-from').value;
  const toStr = $('#filter-to').value;
  const from = fromStr ? Date.parse(`${fromStr}T00:00:00`) : null;
  const to = toStr ? Date.parse(`${toStr}T23:59:59`) : null;
  const activities = $$('#activity-filters input:checked').map((el) => el.value);
  const query = $('#filter-query').value;

  state.view = filterTimeline(state.raw, { from, to, activities, query });
  setStats(state.view);
  state.map.draw(state.view, { heatmap: state.heatmap });
  renderVisitList(state.view);
  stopPlay();
  $('#play-range').max = Math.max(0, state.view.points.length - 1);
  $('#play-range').value = 0;
  if (isMobileLayout()) setPanelOpen(false);
}

function renderVisitList(data) {
  const list = $('#visit-list');
  list.innerHTML = '';
  if (!data.visits.length) {
    list.innerHTML = '<li class="muted">Tidak ada kunjungan di rentang ini.</li>';
    return;
  }
  for (const v of data.visits.slice(0, 80)) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${escape(v.name)}</strong><span>${fmtDateTime(v.t)}</span>`;
    li.tabIndex = 0;
    li.addEventListener('click', () => {
      state.map.map.setView([v.lat, v.lng], 16, { animate: true });
    });
    list.appendChild(li);
  }
}

function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function loadData(data) {
  state.raw = data;
  state.view = data;
  showApp();
  setStats(data);
  populateActivityFilters(data);
  $('#filter-from').value = toInputDate(data.stats.minT);
  $('#filter-to').value = toInputDate(data.stats.maxT);
  $('#filter-query').value = '';
  state.map.draw(data, { heatmap: state.heatmap });
  renderVisitList(data);
  $('#play-range').max = Math.max(0, data.points.length - 1);
  $('#play-range').value = 0;
  $('#play-label').textContent = data.points[0] ? fmtDateTime(data.points[0].t) : '—';
  // Di HP buka sheet filter supaya Dari/Sampai langsung kelihatan
  setPanelOpen(true);
}

function stopPlay() {
  state.playing = false;
  if (state.playTimer) clearInterval(state.playTimer);
  state.playTimer = null;
  $('#btn-play').textContent = 'Putar';
  $('#btn-play').setAttribute('aria-pressed', 'false');
}

function tickPlay() {
  const pts = state.view?.points || [];
  if (!pts.length) return stopPlay();
  state.playIdx = Math.min(state.playIdx, pts.length - 1);
  const trail = pts.slice(Math.max(0, state.playIdx - 30), state.playIdx + 1);
  state.map.setPlayhead(pts[state.playIdx], trail);
  $('#play-range').value = state.playIdx;
  $('#play-label').textContent = fmtDateTime(pts[state.playIdx].t);
  state.playIdx += 1;
  if (state.playIdx >= pts.length) stopPlay();
}

function togglePlay() {
  if (state.playing) return stopPlay();
  const pts = state.view?.points || [];
  if (!pts.length) return;
  if (state.playIdx >= pts.length - 1) state.playIdx = 0;
  state.playing = true;
  $('#btn-play').textContent = 'Pause';
  $('#btn-play').setAttribute('aria-pressed', 'true');
  const speed = Number($('#play-speed').value) || 1;
  state.playTimer = setInterval(tickPlay, Math.max(40, 120 / speed));
  tickPlay();
}

function exportGeoJSON() {
  const data = state.view;
  if (!data) return;
  const features = [
    ...data.points.map((p) => ({
      type: 'Feature',
      properties: { time: new Date(p.t).toISOString(), activity: p.activity || null, kind: p.kind },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
    ...data.segments
      .filter((s) => s.path?.length > 1)
      .map((s) => ({
        type: 'Feature',
        properties: { activity: s.activity, start: s.start, end: s.end },
        geometry: {
          type: 'LineString',
          coordinates: s.path.map((p) => [p.lng, p.lat]),
        },
      })),
  ];
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], {
    type: 'application/geo+json',
  });
  downloadBlob(blob, 'timeline.geojson');
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function ensureStudio() {
  if (state.studio) return state.studio;
  const canvas = $('#studio-canvas');
  if (!canvas) throw new Error('Canvas studio tidak ditemukan.');
  state.studio = createVideoStudio(canvas);
  return state.studio;
}

function runStudioPreview() {
  if (!state.view) {
    throw new Error('Belum ada data timeline. Import JSON dulu.');
  }
  $('#studio-status').textContent = 'Memuat peta latar…';
  return ensureStudio()
    .preview(state.view, getStudioOpts())
    .then(() => {
      if (!$('#studio').hidden) {
        $('#studio-status').textContent = supportsNativeMp4()
          ? 'Preview looping · peta siap · MP4 native'
          : 'Preview looping · peta siap';
      }
    })
    .catch((err) => {
      $('#studio-status').textContent = err.message || 'Gagal preview';
    });
}

function openStudio() {
  $('#studio').hidden = false;
  document.body.classList.add('studio-open');
  runStudioPreview();

  if (supportsNativeMp4()) return;

  prefetchEncoderAssets();
  preloadFfmpeg((info) => {
    if ($('#studio').hidden || state.exporting) return;
    const pct = Math.round((info.ratio || 0) * 100);
    if (info.phase === 'ready') {
      $('#studio-status').textContent = 'Preview looping · encoder siap';
      setStudioProgress('Encoder siap', 0, 1);
      return;
    }
    setStudioProgress(
      info.phase === 'init' ? 'Encoder · siapkan' : info.cached ? 'Encoder · cache' : 'Encoder · unduh',
      (info.ratio || 0) * 0.35,
      info.ratio || 0
    );
    $('#studio-status').textContent = `${info.label || 'Menyiapkan encoder…'} ${pct}%`;
  });
}

function closeStudio() {
  if (state.exporting) cancelStudioExport();
  state.studio?.cancel();
  $('#studio').hidden = true;
  document.body.classList.remove('studio-open');
  $('#studio-status').textContent = '';
  setStudioProgress('Siap', 0, 0);
  setExportUi(false);
  hideWebmFallback();
}

function getStudioOpts() {
  const key = Number($('#studio-res').value) || 1280;
  const preset = RES_PRESETS[key] || RES_PRESETS[1280];
  const mult = BITRATE_MULTIPLIERS[$('#studio-bitrate')?.value] ?? 1;
  const videoBitsPerSecond = Math.round(preset.baseBitrate * mult);
  return {
    speed: Number($('#studio-speed').value) || 1,
    trail: Number($('#studio-trail').value) || 40,
    icon: $('#studio-icon')?.value || 'auto',
    width: preset.width,
    height: preset.height,
    fps: 30,
    videoBitsPerSecond,
  };
}

function setStudioProgress(stage, overall, pct) {
  const bar = $('#studio-progress');
  const stageEl = $('#studio-stage');
  const pctEl = $('#studio-stage-pct');
  if (bar) bar.value = Math.min(1, Math.max(0, overall));
  if (stageEl) stageEl.textContent = stage;
  if (pctEl) pctEl.textContent = `${Math.round((pct ?? overall) * 100)}%`;
}

function setExportUi(active) {
  state.exporting = active;
  const exportBtn = $('#btn-export-video');
  const cancelBtn = $('#btn-cancel-export');
  const previewBtn = $('#btn-preview-video');
  if (exportBtn) exportBtn.disabled = active;
  if (previewBtn) previewBtn.disabled = active;
  if (cancelBtn) cancelBtn.hidden = !active;
}

function hideWebmFallback() {
  const btn = $('#btn-download-webm');
  if (btn) btn.hidden = true;
  state.lastWebm = null;
}

function showWebmFallback(blob) {
  state.lastWebm = blob;
  const btn = $('#btn-download-webm');
  if (btn) btn.hidden = false;
}

function cancelStudioExport() {
  state.exportFlag.cancelled = true;
  state.studio?.cancel();
  cancelConvert();
}

async function exportStudioVideo() {
  if (state.exporting) return;
  hideWebmFallback();
  state.exportFlag = { cancelled: false };
  setExportUi(true);

  let renderBlob = null;
  const opts = getStudioOpts();
  const stamp = Date.now();
  const nativeMp4 = supportsNativeMp4();

  try {
    if (!state.view) throw new Error('Belum ada data timeline. Import JSON dulu.');

    if (nativeMp4) {
      setStudioProgress('Merender MP4', 0, 0);
      $('#studio-status').textContent = 'Merender MP4 (native)…';
      renderBlob = await ensureStudio().exportVideo(state.view, { ...opts, preferMp4: true }, (p) => {
        setStudioProgress('Merender MP4', p, p);
        $('#studio-status').textContent = `Merender MP4… ${Math.round(p * 100)}%`;
      });
      if (state.exportFlag.cancelled) throw new ExportCancelled();
      downloadBlob(renderBlob, `timeline-${stamp}.mp4`);
      setStudioProgress('Selesai', 1, 1);
      $('#studio-status').textContent = 'Selesai — MP4 terunduh (native, tanpa encoder).';
      return;
    }

    setStudioProgress('Tahap 1/2 · Merender', 0, 0);
    $('#studio-status').textContent = 'Merender video…';

    renderBlob = await ensureStudio().exportVideo(state.view, { ...opts, preferMp4: false }, (p) => {
      const overall = p * 0.45;
      setStudioProgress('Tahap 1/2 · Merender', overall, p);
      $('#studio-status').textContent = `Merender… ${Math.round(p * 100)}%`;
    });

    if (state.exportFlag.cancelled) throw new ExportCancelled();

    if (renderBlob.type.includes('mp4') || renderBlob._timelineIsMp4) {
      downloadBlob(renderBlob, `timeline-${stamp}.mp4`);
      setStudioProgress('Selesai', 1, 1);
      $('#studio-status').textContent = 'Selesai — MP4 terunduh.';
      return;
    }

    showWebmFallback(renderBlob);

    if (isFfmpegReady()) {
      setStudioProgress('Tahap 2/2 · Konversi', 0.5, 0);
      $('#studio-status').textContent = 'Encoder siap — mengonversi…';
    } else {
      setStudioProgress('Tahap 2/2 · Encoder', 0.48, 0);
      $('#studio-status').textContent = 'Menyiapkan encoder…';
    }

    const mp4Blob = await convertWebmToMp4(renderBlob, {
      bitrate: opts.videoBitsPerSecond,
      fps: opts.fps,
      flag: state.exportFlag,
      onStatus: (msg) => {
        $('#studio-status').textContent = msg;
      },
      onLoadProgress: (info) => {
        const p = info.ratio || 0;
        const overall = 0.48 + p * 0.12;
        let stage = 'Tahap 2/2 · Encoder';
        if (info.phase === 'ready') stage = 'Tahap 2/2 · Encoder siap';
        else if (info.phase === 'init') stage = 'Tahap 2/2 · Menyiapkan encoder';
        else if (info.cached) stage = 'Tahap 2/2 · Cache encoder';
        else stage = 'Tahap 2/2 · Mengunduh encoder';
        setStudioProgress(stage, overall, p);
        $('#studio-status').textContent = info.label || 'Encoder…';
      },
      onProgress: (p) => {
        const overall = 0.6 + p * 0.4;
        setStudioProgress('Tahap 2/2 · Mengonversi MP4', overall, p);
        $('#studio-status').textContent = `Mengonversi ke MP4… ${Math.round(p * 100)}%`;
      },
    });

    downloadBlob(mp4Blob, `timeline-${stamp}.mp4`);
    setStudioProgress('Selesai', 1, 1);
    $('#studio-status').textContent = 'Selesai — MP4 terunduh.';
    hideWebmFallback();
  } catch (err) {
    if (err?.name === 'ExportCancelled' || state.exportFlag.cancelled) {
      setStudioProgress('Dibatalkan', 0, 0);
      $('#studio-status').textContent = 'Dibatalkan — tidak ada file yang diunduh.';
    } else {
      console.error(err);
      const msg = err.message || 'Gagal export';
      $('#studio-status').textContent = msg;
      setStudioProgress('Gagal', $('#studio-progress')?.value || 0, 0);
      if (renderBlob && !String(renderBlob.type || '').includes('mp4')) {
        showWebmFallback(renderBlob);
        $('#studio-status').textContent = `${msg} — kamu bisa unduh WebM sekarang.`;
      }
    }
  } finally {
    setExportUi(false);
  }
}

function pickJson() {
  const input = $('#file-input');
  input.value = '';
  input.click();
}

function setupDnD() {
  const zone = $('#dropzone');
  const prevent = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, prevent));
  zone.addEventListener('dragenter', () => zone.classList.add('drag'));
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => {
    zone.classList.remove('drag');
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  });
  zone.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    pickJson();
  });
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickJson();
    }
  });
}

function init() {
  state.map = createTimelineMap($('#map'));
  setupDnD();

  $('#file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    closeStudio();
    handleFile(file);
  });
  $('#btn-pick-json')?.addEventListener('click', (e) => {
    e.stopPropagation();
    pickJson();
  });
  $('#btn-import')?.addEventListener('click', pickJson);
  $('#btn-import-studio')?.addEventListener('click', pickJson);
  $('#btn-sample').addEventListener('click', (e) => {
    e.stopPropagation();
    loadData(getSampleTimeline());
  });
  $('#btn-reset').addEventListener('click', () => {
    state.raw = null;
    state.view = null;
    state.map.clear();
    closeStudio();
    closeMoreMenu();
    showLanding();
  });

  $('#btn-apply-filters').addEventListener('click', applyFilters);
  $('#filter-query').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFilters();
  });

  $('#btn-heatmap').addEventListener('click', () => {
    state.heatmap = !state.heatmap;
    $('#btn-heatmap').setAttribute('aria-pressed', String(state.heatmap));
    if (state.view) state.map.draw(state.view, { heatmap: state.heatmap });
    closeMoreMenu();
  });

  $('#btn-play').addEventListener('click', togglePlay);
  $('#play-range').addEventListener('input', (e) => {
    stopPlay();
    state.playIdx = Number(e.target.value);
    const pts = state.view?.points || [];
    if (!pts[state.playIdx]) return;
    const trail = pts.slice(Math.max(0, state.playIdx - 30), state.playIdx + 1);
    state.map.setPlayhead(pts[state.playIdx], trail);
    $('#play-label').textContent = fmtDateTime(pts[state.playIdx].t);
  });
  $('#play-speed').addEventListener('change', () => {
    if (state.playing) {
      stopPlay();
      togglePlay();
    }
  });

  $('#btn-geojson').addEventListener('click', () => {
    exportGeoJSON();
    closeMoreMenu();
  });
  $('#btn-studio').addEventListener('click', () => {
    closeMoreMenu();
    openStudio();
  });
  $('#btn-close-studio').addEventListener('click', closeStudio);
  $('#btn-export-video').addEventListener('click', exportStudioVideo);
  $('#btn-cancel-export')?.addEventListener('click', () => {
    cancelStudioExport();
    $('#studio-status').textContent = 'Membatalkan…';
  });
  $('#btn-download-webm')?.addEventListener('click', () => {
    if (!state.lastWebm) return;
    downloadBlob(state.lastWebm, `timeline-${Date.now()}.webm`);
  });
  $('#btn-preview-video').addEventListener('click', () => {
    runStudioPreview();
  });

  $('#btn-sample-hero')?.addEventListener('click', () => {
    loadData(getSampleTimeline());
  });

  $('#btn-panel-toggle')?.addEventListener('click', () => {
    closeMoreMenu();
    togglePanel();
  });
  $('#btn-panel-handle')?.addEventListener('click', togglePanel);
  $('#panel-peek')?.addEventListener('click', () => setPanelOpen(true));
  $('#panel-backdrop')?.addEventListener('click', () => setPanelOpen(false));

  $('#btn-more')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#more-menu');
    setMoreMenuOpen(!!menu?.hidden);
  });
  document.addEventListener('click', (e) => {
    const menu = $('#more-menu');
    const btn = $('#btn-more');
    if (!menu || menu.hidden) return;
    if (menu.contains(e.target) || btn?.contains(e.target)) return;
    closeMoreMenu();
  });
  window.addEventListener('resize', () => {
    if (!isMobileLayout()) {
      setPanelOpen(true);
      closeMoreMenu();
      const backdrop = $('#panel-backdrop');
      if (backdrop) backdrop.hidden = true;
    } else if ($('#app') && !$('#app').hidden) {
      const open = $('#side-panel')?.classList.contains('panel-open');
      const backdrop = $('#panel-backdrop');
      if (backdrop) backdrop.hidden = !open;
    }
  });

  ['studio-speed', 'studio-trail', 'studio-res', 'studio-bitrate', 'studio-icon'].forEach((id) => {
    $(`#${id}`)?.addEventListener('change', () => {
      if ($('#studio').hidden) return;
      runStudioPreview();
    });
  });

  // Panel tabs
  $$('[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-panel]').forEach((b) => b.setAttribute('aria-selected', 'false'));
      btn.setAttribute('aria-selected', 'true');
      $$('[data-panel-body]').forEach((el) => {
        el.hidden = el.dataset.panelBody !== btn.dataset.panel;
      });
      if (isMobileLayout()) setPanelOpen(true);
    });
  });

  // Prefetch encoder into HTTP cache early (skip if browser can record MP4 natively)
  if (!supportsNativeMp4()) {
    const warm = () => prefetchEncoderAssets();
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 5000 });
    else setTimeout(warm, 2500);
  }
}

init();
