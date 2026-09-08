# Timeline — Journey Studio landing + full UI restyle

**Date:** 2026-09-08  
**Site:** https://timeline.syahrul.web.id (`/home/timeline-site`)  
**Status:** Design approved in chat (approaches + §§1–4); awaiting user review of this written spec before implementation plan

## Goals

1. Redesign the landing page to the **Journey Studio** visual direction: precise, calm, personal map/travel product.
2. Communicate immediately: import Google Timeline JSON → explore journeys on a map → export shareable MP4.
3. Keep Indonesian UI copy and the **Timeline** brand.
4. Preserve existing functionality: routes, file parsing, sample data, map/heatmap/playback, GeoJSON export, studio MP4/WebM export.
5. Restyle **landing + app chrome + studio chrome** to one token system (full restyle). Video canvas frame content in `video.js` stays as-is.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Implementation approach | Token-first + rewrite landing HTML; minimal JS for preview + copy/states |
| Hero preview | **Hybrid:** static product mockup first → upgrade to Leaflet with sample route |
| Visual scope | Landing + app + studio chrome (not video frame pixels) |
| Typography | **Geist** (single family) via CDN/self-host equivalent |
| Privacy section | Remove standalone `#privasi`; place notes near hero CTAs and inside import panel |
| Privacy claim | JSON processed locally; do **not** claim zero network (tiles, fonts, attribution may load) |

## Visual system

### Colors

| Role | Hex |
|------|-----|
| Page background | `#0B1210` |
| Section / card surfaces | `#111D18` |
| Elevated surfaces | `#17271F` |
| Borders | `#293C32` |
| Primary text | `#F2F6F3` |
| Secondary text | `#B1BFB6` |
| Muted text | `#8D9F93` |
| Primary accent (mint) | `#64D8AB` |
| Primary button text | `#092117` |
| Destination highlight (gold) | `#E8BC76` |

Mint: primary actions, selected states, route lines.  
Gold: destinations / special points only, sparingly.

### Typography

- Family: Geist (fallback: system-ui, sans-serif).
- Desktop hero: 56–64px; mobile hero: 36–40px.
- Section titles: 30–36px; card titles: 18–20px.
- Body: 16px, ~1.6 line-height; labels: 13–14px.

### Layout

- 8px spacing system; ~80px section gap desktop / ~48px mobile.
- Content width ~1160px; gutters 24–32px desktop / 20px mobile.
- Radii: 16–20px major panels; 10–12px controls.
- Prefer subtle borders over heavy shadows; no oversized glows or excessive gradients.

### Motion & a11y

- Control/card transitions 150–250ms.
- Optional one-shot route-draw on hero preview; respect `prefers-reduced-motion`.
- Readable contrast, visible keyboard focus, accessible names for icon controls, keyboard access to file selection.
- Route endpoints distinguished by shape/label as well as color.
- Min control height 44px; hover / pressed / disabled / focus states.

## Page sequence

1. Sticky navigation  
2. Hero (copy + product preview) + privacy line near actions  
3. Features  
4. How it works  
5. Import panel + privacy note  
6. Footer  

## Navigation (~72px)

- Left: small route-inspired brand mark + “Timeline”.
- Right: Fitur, Cara kerja, GitHub, primary “Import Timeline” → `#import-zone`.
- Sticky; opaque or lightly translucent dark background; scroll-margin for anchors = nav height.
- Mobile: brand + Import visible; secondary links collapse (simple overflow/menu).

## Hero

**Copy**

- Eyebrow: `GOOGLE TIMELINE VISUALIZER`
- Headline: `Jejak perjalananmu,` / `jadi cerita.`
- Description: Jelajahi riwayat di peta, putar ulang rute, buat video MP4 siap dibagikan.
- Primary: `Import Timeline`
- Secondary: `Coba data contoh` → existing `getSampleTimeline()` / `loadData`
- Support: `File JSON diproses di perangkatmu.`

**Layout:** ~45% text / 55% preview desktop, vertically aligned, compact top spacing. Mobile: stack text above preview (preview height ~280–340px).

### Hero product preview (hybrid)

1. **Static fallback** (immediate): large map-like panel with roads/labels, mint route, start/end markers, toolbar labels `Peta` / `Heatmap` / `Studio`, playback strip, journey summary (distance, duration, places), badge `Contoh perjalanan`. Synthetic/demo stats only.
2. **Leaflet upgrade** after load: real map in preview container, sample polyline (reuse Jakarta sample coords from `sample.js` or a small demo export), OSM attribution preserved.
3. Interactive controls only if wired to the **preview** sample experience; otherwise decorative and not styled as primary clickable CTAs (`pointer-events` / aria as appropriate).
4. Does not enter the main app unless user chooses sample/import.

## Features (`#fitur`)

- Title: `Dari riwayat lokasi ke cerita perjalanan.`
- Supporting: `Jelajahi, pilih momen, lalu buat hasil yang bisa kamu bagikan.`
- Two large cards: **Jelajahi perjalanan** (map, filters, playback + small route preview); **Buat video perjalanan** (studio + MP4 + small timeline preview).
- Four compact cards: Heatmap aktivitas; Beragam format JSON; Export GeoJSON; Pemrosesan lokal.
- Consistent outline icons; short descriptions; no capabilities beyond current app.
- Cards are informational, not interactive affordances.

## How it works (`#cara-kerja`)

- Title: `Mulai dalam tiga langkah.`
- 01 Siapkan file Timeline — export Google JSON.  
- 02 Import dan jelajahi — filter to find journeys.  
- 03 Buat video — Studio → MP4.  
- Numbered badges + subtle connecting line on desktop; vertical on mobile.
- Help link “Cara mendapatkan file JSON” tied to accurate supported formats (Records.json, Semantic Location History, phone Timeline export).

## Import panel (`#import-zone`)

- Title: `Siap melihat kembali perjalananmu?`
- Description: Import JSON Timeline to start exploring.
- Elevated panel; large drop area; upload icon; `Tarik file JSON ke sini` / `atau pilih file dari perangkatmu`.
- Primary: `Pilih file JSON`; secondary: `Coba data contoh`.
- Supported formats in small text; short local-processing privacy note.
- States: idle → drag-over (mint border) → processing (filename + truthful progress; % only if real) → success (existing map app) → error with plain guidance + retry.
- Example error: `Format file belum dikenali. Pilih file JSON hasil export Google Timeline.`
- Consistent “Import” / “Pilih file” (not “Upload” for local files).
- All actions use the same underlying import flow (`#file-input`, dropzone, sample buttons).

## Footer

- Left: Timeline + `Ubah jejak perjalanan menjadi cerita.`
- Right: GitHub + help/privacy-relevant links (privacy note / import anchor).
- Keep `Tanpa akun` (matches current no-account experience).

## App + Studio chrome

- Apply the same CSS tokens to topbar, side panel, loader, menus, buttons, studio card/controls/progress.
- Route/selected states use mint; destination accents use gold sparingly.
- No behavior changes to parse, filter, heatmap, GeoJSON, studio export pipeline.

## Architecture

```
Landing HTML/CSS (Journey Studio)
        │
        ├─ Import / Sample CTAs ──► existing app.js loadData / pickJson
        │
        └─ landing-preview.js
              ├─ render static mock immediately
              └─ upgrade to Leaflet + sample route (attribution)
```

## Files

| File | Change |
|------|--------|
| `public/index.html` | Landing markup rewrite; Geist; theme-color; nav/hero/features/steps/import/footer; keep `#app` / `#studio` structure |
| `public/styles.css` | New tokens; landing layout; restyle app + studio chrome; button system |
| `public/js/app.js` | Nav mobile if needed; dropzone status copy; init landing preview; keep import/export orchestration |
| `public/js/landing-preview.js` | **New** — static fallback + Leaflet upgrade |
| `public/js/sample.js` | Optional small export for preview coords (reuse existing sample) |
| `public/js/map.js` | Only if needed for shared marker/route styling helpers — no logic rewrite |
| `public/js/parse.js`, `video.js`, `ffmpeg-*` | No functional changes |

## Out of scope

- Changing parse formats or export pipeline behavior.
- Redesigning the pixels drawn inside the studio canvas (OSM tiles, trail render).
- New features beyond current app capabilities.
- Claiming the entire app makes no network requests.

## Completion criteria

- Landing instantly answers: what it is, what the map/video look like, how to start (file or sample).
- Indonesian UI preserved; Timeline brand retained.
- Import, sample, map, heatmap, GeoJSON, studio MP4 paths still work.
- Hero preview labeled as example; hybrid load with attribution.
- App + studio chrome visually aligned to Journey Studio tokens.
- Responsive: no horizontal scroll; mobile hero/import usable.
- A11y and reduced-motion respected.

## Self-review notes (2026-09-08)

- No TBD placeholders left for core UX.
- Privacy claim explicitly limited to local JSON processing.
- Scope of “full restyle” clarified: chrome only for studio, not canvas content.
- Hero interactivity: interactive only if wired to preview; else decorative.
