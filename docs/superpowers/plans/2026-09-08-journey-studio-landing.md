# Journey Studio Landing Implementation Plan

> **For agentic workers:** Execute inline (user requested immediate implementation). Steps use checkbox syntax.

**Goal:** Redesign Timeline landing to Journey Studio and restyle app/studio chrome with shared tokens, preserving import/parse/export behavior.

**Architecture:** Token-first CSS rewrite; new landing markup; `landing-preview.js` hybrid static→Leaflet; minimal `app.js` wiring.

**Tech Stack:** Static HTML/CSS/ES modules, Leaflet, Geist font (CDN).

## Global Constraints

- Indonesian UI; Timeline brand retained.
- Colors: bg `#0B1210`, surface `#111D18`, elevated `#17271F`, border `#293C32`, text `#F2F6F3`/`#B1BFB6`/`#8D9F93`, mint `#64D8AB`, btn text `#092117`, gold `#E8BC76`.
- Do not change parse/export pipeline logic.
- Privacy: local JSON only — no zero-network claim.
- All import CTAs → existing `pickJson` / `handleFile` / `getSampleTimeline`.

### Task 1: Tokens + landing styles
- Modify: `public/styles.css`, `public/index.html` (font + theme-color)
- [ ] Replace `:root` tokens; rewrite landing; restyle buttons/app/studio chrome

### Task 2: Landing markup
- Modify: `public/index.html`
- [ ] Nav, hero, features, steps, import, footer per spec; keep `#app`/`#studio`

### Task 3: Hero preview module
- Create: `public/js/landing-preview.js`
- Modify: `public/js/app.js`, optionally `sample.js`
- [ ] Static fallback + Leaflet upgrade; init from `app.js`

### Task 4: Verify
- [ ] Cache-bust assets; sanity-check selectors/IDs still wired
