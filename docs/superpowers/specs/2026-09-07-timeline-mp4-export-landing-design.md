# Timeline — MP4 export (ffmpeg.wasm) + landing marketing

**Date:** 2026-09-07  
**Site:** https://timeline.syahrul.web.id (`/home/timeline-site`)  
**Status:** Approved for implementation (user: spec + langsung implementasi)

## Goals

1. Export video **MP4** via two-stage client pipeline: WebM render → ffmpeg.wasm convert.
2. Clear **per-stage progress** and **cancel**.
3. Quality: presets **720p / 1080p / 1440p** + bitrate **Rendah / Normal / Tinggi**.
4. Landing = full marketing page (hero, fitur, cara kerja, privasi, dropzone).

## Architecture

```
Canvas animate → MediaRecorder (WebM) → @ffmpeg/ffmpeg (H.264 MP4) → download
     progress 1/2              progress 2/2 (+ load encoder once)
     cancel → stop recorder    cancel → ffmpeg.terminate()
```

- **Privacy:** all client-side; no upload.
- **ffmpeg:** single-thread `@ffmpeg/core` (no SharedArrayBuffer / no COOP-COEP required — avoids breaking Leaflet & fonts).
- **Assets:** vendor under `public/vendor/ffmpeg/` (self-hosted).

### Quality presets

| Preset | Size | Base bitrate |
|--------|------|--------------|
| 720p | 1280×720 | 4 Mbps |
| 1080p | 1920×1080 | 8 Mbps |
| 1440p | 2560×1440 | 14 Mbps |

Bitrate override: Rendah `0.6×` · Normal `1×` · Tinggi `1.5×` — applied to MediaRecorder `videoBitsPerSecond` and ffmpeg `-b:v`.

### Progress UX

- Stage labels: `Merender video…` → `Mengunduh encoder…` (first time) → `Mengonversi ke MP4…`
- Overall: `Tahap 1/2` / `Tahap 2/2` with % on bar.
- **Batalkan** visible only while exporting.

### Cancel / errors

- Cancel mid-render or mid-convert → status `Dibatalkan`, no auto MP4 download.
- Convert/load fail → offer download of intermediate WebM if available.
- `ExportCancelled` error type for clean UI handling.

## UI

### Landing (marketing)

1. Hero — brand Timeline, one headline, one support line, CTAs (Import + Sample), path visual (not feature cards).
2. Fitur — multi-format, filter/playback, heatmap, GeoJSON, studio + MP4, privacy.
3. Cara kerja — Export Google → Upload → Visualize / video.
4. Privasi — no server upload; encode local.
5. Dropzone — import JSON.

Keep existing dark teal/amber + Sora / IBM Plex.

### Studio

- Res: 720 / 1080 / 1440
- Bitrate: rendah / normal / tinggi
- Buttons: Preview · Export MP4 · Batalkan (during job)
- Hint: WebM first, then MP4 in-browser.

## Files

| File | Change |
|------|--------|
| `public/js/video.js` | Abortable WebM export + bitrate |
| `public/js/ffmpeg-export.js` | New: load/convert/cancel |
| `public/js/app.js` | Orchestrate 2 stages + UI |
| `public/index.html` | Landing + studio controls |
| `public/styles.css` | Marketing sections |
| `public/vendor/ffmpeg/` | ffmpeg + util + core |
| `README.md` | Document MP4 + presets |

## Out of scope

- Server-side ffmpeg
- Multi-thread ffmpeg / COOP-COEP
- Audio track

## Manual test

- [ ] Sample → 720p normal → MP4 downloads
- [ ] Cancel during render
- [ ] Cancel during convert
- [ ] Convert fail → WebM fallback download works
- [ ] 1440p + tinggi loads without crash (reasonable data)
- [ ] Landing sections readable on mobile + desktop

## Self-review

- No placeholders; scope matches user choices (opsi 3 pipeline, opsi 2 quality, opsi 3 landing).
- Single-thread choice documented (trade-off: slower encode, fewer deploy footguns).
