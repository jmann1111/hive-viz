# Hive Viz - Galaxy Knowledge Visualizer

## Workflow (MANDATORY)
1. **Plan first.** For any non-trivial change (3+ steps), enter plan mode and write the plan before coding.
2. **Read lessons.** Check ~/.claude/lessons/global.md and .claude/lessons.md (if exists) for relevant patterns.
3. **Verify before done.** Screenshot, check logs, test the actual output before marking complete.
4. **Capture mistakes.** After ANY correction or self-caught error, append to the appropriate lessons file.
5. **One visual change at a time.** Make a change, screenshot, verify, then next change. No blind bulk edits.


## What This Is
A 3D galaxy simulator where The Hive (Obsidian vault) is rendered as a galaxy.
The curated brain (~220 connected nodes) is a bright nebula at the center.
~1,200 imported transcripts are dim scattered stars in the outer field.
You orbit the galaxy, click a node to fly into it FPS-style, and it expands
into a mini-constellation of its sections.

## ARCHITECTURE SPEC (read this FIRST)
The full spec is at: /Users/jasonmann/Documents/The-Hive/20-Architecture/hive-viz-galaxy.md
Read it via the filesystem before writing ANY code. It has:
- The metaphor (galaxy, nebula, void)
- Visual language (connection-based sizing/brightness)
- Navigation (orbit + FPS + transitions)
- Node interaction (hover labels, click expansion, section sub-nodes)
- Data pipeline (graph.json processing)
- File structure
- Build phases (what to build in what order)
- Performance budget
- Scope fence (what NOT to build)

## Tech Stack
- Vite + React
- @react-three/fiber (R3F)
- @react-three/drei (Stars, OrbitControls, Billboard, Line)
- @react-three/postprocessing (Bloom, Vignette)
- Zustand (state management)
- graph.json in /public/ (1,424 nodes, 2,507 edges)

## Design Iteration Workflow (CRITICAL)

This project uses a VISUAL FEEDBACK LOOP. Do NOT code blind.

### The Loop:
1. Make code changes
2. Wait for Vite hot reload (~1s)
3. Use Puppeteer MCP to screenshot localhost:5173
4. LOOK at the screenshot before making more changes
5. Iterate frame by frame

### Puppeteer Commands:
```
puppeteer_launch({ headless: false })
puppeteer_new_page({ pageId: "viz" })
puppeteer_navigate({ pageId: "viz", url: "http://localhost:5173" })
puppeteer_screenshot({ pageId: "viz", path: "screenshots/current.png" })
```

### Rules:
- After EVERY visual change, take a screenshot
- Compare to the design intent before proceeding
- Save screenshots to /screenshots/ with descriptive names
- If something looks wrong, fix it BEFORE moving on
- The galaxy should feel like deep space imagery, not a tech demo

## Build Order
Phase 1: Void (skybox + star field + orbit)
Phase 2: Threads (edges + bloom + postprocessing)
Phase 3: Flight (click-to-fly + FPS controls)
Phase 4: Expansion (node opens into sections)
Phase 5: Polish (camera feel, aberration, performance)

## Data Source
- /public/graph.json - 36K lines, 1,424 nodes, 2,507 edges
- Each node has: id, name, path, folder, type, date, tags, link_count
- Curated nodes: folders 00-80 (exclude 60-Knowledge/raw-data/)
- Raw-data nodes: 60-Knowledge/raw-data/ (~1,200 files)

## Visual Rules
- Connection density IS the visual hierarchy (not color)
- More links = bigger + brighter. Orphans = dim specks.
- Base color: warm white / soft blue-white
- Edge threads: faint cyan/blue, opacity from connection density
- Bloom makes hub nodes radiate. Without bloom it's dots. With bloom it's a galaxy.
- Monochromatic luminosity variation, like real deep-space imagery
