# The Tesseract: Hive Viz v2

## Core Concept
A first-person navigable dimension. The vault's folder hierarchy defines
the architecture of an impossible geometric space. You move through it
like Cooper in the Interstellar Tesseract. Walt is the navigator: you
tell him where to go, he flies you there.

## Visual Language: Antichamber
- Background: pure white/light gray (#f0f0f0)
- Geometry: thin dark lines (#111, #333, #888, #ddd)
- No color. No glow. No particles. No bloom. No fog.
- Beauty from PRECISION and DEPTH, not effects

## Space = Data
- Folders are corridors stretching into deep perspective
- Files are rectangular panels on corridor walls
- Wikilinks are doorways between corridors
- Hub files sit at corridor intersections

## Navigation Model
- You tell Walt where to go in chat
- Walt writes to public/nav-command.json via MCP
- Viz polls every 500ms, triggers cinematic camera flight
- Pathfinding: shortest corridor path via waypoints
- Camera: CatmullRomCurve3 spline, ease-in-out, slight banking

## Arrival
- Camera decelerates facing destination panel
- Content panel fades in (title, type, tags, connections, Obsidian link)
- Connected files are clickable (triggers next navigation)

## Control Channel
- Walt writes: {"target": "SOUL", "timestamp": N}
- Viz reads: public/nav-command.json (polled every 500ms)
- Viz searches panels by title/id/tags, navigates to best match

## Tech Stack
- Three.js (LineSegments, BufferGeometry, PerspectiveCamera)
- Vite dev server (localhost:5173)
- No external dependencies beyond Three.js
- DOM overlays for content panels
- graph.json from existing extract.js (1424 nodes, 2507 edges)

## Files
- src/core/tesseract.js: Corridor geometry + panel placement + pathfinding
- src/main.js: Renderer, flight system, content panel, nav polling
- scripts/extract.js: Vault metadata extraction (unchanged from v1)
- public/graph.json: Generated data
- public/nav-command.json: Walt navigation channel
