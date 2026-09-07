# Timeline Studio — stylized map, vehicle icon, video speed

**Date:** 2026-09-07  
**Status:** Approved — implement immediately

## Goals
1. Offline **stylized map** background with visit/city labels along the route.
2. **Vehicle/person icon** at trail head: auto from activity + Studio override.
3. **Video speed** 0.5×–8× for preview + export (replaces “Kecepatan render” label).

## Design
- Canvas draws land base + soft road grid from path bounds (no online tiles).
- Up to ~12 visit labels, spatially spread, unique names.
- Icons: motor / car / bike / walk / dot; rotation follows path tangent.
- Speed multiplier skips/advances frames (existing `speed` option, clearer UI).

## Out of scope
- Real OSM tiles, bundled road GeoJSON, audio.
