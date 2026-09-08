# Timeline — Google Timeline Visualizer

Live: https://timeline.syahrul.web.id  
Source: https://github.com/muhamadsyahrulmubarok/timeline-site

Client-side app untuk visualisasi JSON export Google Timeline / Location History.

## Fitur
- Parser multi-format: Records.json, Semantic Location History, Phone Takeout (`semanticSegments`)
- Peta gelap (Leaflet + CARTO) dengan jalur berwarna per aktivitas
- Filter tanggal, aktivitas, pencarian tempat
- Playback scrubber
- Heatmap
- Export GeoJSON
- Studio video: background **OpenStreetMap** (tanpa API key) + label kota/tempat, ringkasan akhir (km / kota / kunjungan), ikon motor/mobil/sepeda/jalan, kecepatan 0.5×–8×, resolusi 720p/1080p/1440p, bitrate
- Export **MP4** via native MediaRecorder when possible, else WebM → **ffmpeg_asm.js** (Muaz Khan Ffmpeg.js), progress per tahap, batal jelas
- Landing marketing: hero, fitur, cara kerja, privasi, import

## Privacy
Semua parsing & render di browser. File JSON tidak diunggah ke server. Encoder ffmpeg.wasm juga lokal (`public/vendor/ffmpeg/`).

## Deploy
Static di `/home/timeline-site/public`, Nginx `timeline.syahrul.web.id`, Let's Encrypt.

Vendor ffmpeg_asm.js (Muaz Khan): `public/vendor/ffmpeg-asm/` — lihat https://github.com/muaz-khan/Ffmpeg.js

## Cara export dari Google
1. **Ponsel (baru):** Google Maps → Settings → Timeline → Export Timeline data
2. **Takeout (lama):** takeout.google.com → Location History → JSON

## Spec
`docs/superpowers/specs/2026-09-07-timeline-mp4-export-landing-design.md`
