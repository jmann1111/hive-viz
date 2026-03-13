# Hive Viz: Architecture

## Vision

A 3D interactive visualization where The Hive vault is rendered as a living,
growing temporal structure. The Z-axis is time. Files are nodes positioned by
creation date along the time axis and force-directed by their wikilinks on
the X/Y plane. The result is an organism that you can rotate, zoom, scrub
through time, and watch grow from a single ChatGPT conversation in June 2023
to a 1,400+ file knowledge system.

## Core Concept: Temporal Topology

Traditional knowledge graph visualizers (including Obsidian's) use 2D or 3D
force-directed layouts where every node is equidistant in time. This flattens
the most interesting dimension: growth.

Our approach maps time to the Z-axis:
- Z=0: June 29, 2023 (first ChatGPT conversation)
- Z=max: Today (latest vault file)
- Each file is positioned at the Z-coordinate matching its creation date
- X/Y positions are determined by force simulation (link attraction, repulsion)

This produces emergent visual structures:
- **Trunk:** The dense ChatGPT transcript layer (2023-2025) forms a thick core
- **Branches:** Architecture docs, playbooks, session logs branch off the trunk
  at the time they were created
- **Canopy:** Recent files (March 2026 build sprint) form a dense crown
- **Bridges:** Cross-temporal links (nuggets referencing old transcripts) create
  visible spiraling connections like DNA helices

## Data Pipeline

### Step 1: Extraction (scripts/extract.js)

Reads every .md file in The Hive vault and extracts:
- `id`: filename without extension
- `path`: relative path from vault root
- `folder`: top-level folder (00-Inbox, 10-Sessions, etc.)
- `created`: from YAML frontmatter `date` field, or file birthtime
- `tags`: from YAML frontmatter
- `type`: from YAML frontmatter (session-log, architecture, knowledge, etc.)
- `links`: array of outgoing wikilink targets (parsed from [[target]] syntax)
- `wordCount`: approximate content size
- `title`: first H1 heading or filename

Output: `public/graph.json` with shape:
```json
{
  "nodes": [
    {
      "id": "2026-03-13-vault-merge-mining-dispatch-therapy",
      "path": "10-Sessions/2026-03-13-vault-merge-mining-dispatch-therapy.md",
      "folder": "10-Sessions",
      "created": "2026-03-13",
      "type": "session-log",
      "tags": ["session-log", "vault-sync", "mining"],
      "links": ["SOUL", "psychological-profile", "open-loops"],
      "wordCount": 2450,
      "title": "Vault merge, mining dispatch, and therapy session"
    }
  ],
  "edges": [
    { "source": "node-id", "target": "node-id" }
  ],
  "meta": {
    "totalFiles": 1417,
    "dateRange": ["2023-06-29", "2026-03-13"],
    "extractedAt": "2026-03-13T..."
  }
}
```

### Step 2: Graph Construction (src/core/graph.js)

- Parse graph.json into node/edge structures
- Compute temporal Z-positions: normalize dates to [0, Z_MAX] range
- Initialize force simulation (d3-force-3d):
  - Link force: connected nodes attract (spring constant proportional to link count)
  - Repulsion force: all nodes repel (prevents overlap)
  - Z-axis constraint: nodes are pinned to their temporal Z (time is not negotiable)
  - Folder clustering: mild force pulling same-folder nodes toward shared centroid

### Step 3: Rendering (src/rendering/)

Three.js scene with:

**Nodes:**
- InstancedMesh for performance (1,400+ nodes)
- Size: proportional to wordCount (bigger files = bigger nodes)
- Color: by folder (see Color Palette below)
- Glow/bloom: nodes with high link count glow brighter
- Hub nodes (SOUL, psychological-profile, command-center) are visibly larger

**Edges:**
- BufferGeometry lines (not LineSegments, for proper transparency)
- Opacity: proportional to temporal distance (cross-era links are more visible)
- Color: gradient between source and target folder colors
- Cross-temporal edges (links spanning >6 months) get special spiral rendering

**Environment:**
- Background: deep space black (#050510)
- Ambient particles: subtle floating dust/stars
- Fog: depth fog so distant time layers fade naturally
- Post-processing: UnrealBloomPass for node glow

## Color Palette (by folder)

| Folder | Color | Hex | Meaning |
|--------|-------|-----|---------|
| 10-Sessions | Electric Blue | #3b82f6 | Active work |
| 20-Architecture | Purple | #8b5cf6 | Structure |
| 30-Projects | Amber | #f59e0b | Creation |
| 50-Playbooks | Teal | #14b8a6 | Process |
| 60-Knowledge | Green | #22c55e | Accumulated wisdom |
| 60-Knowledge/raw-data | Dim Gray | #374151 | Source material |
| 70-Ops | Rose | #f43f5e | Infrastructure |
| 01-Daily | Cyan | #06b6d4 | Rhythm |
| Other | White | #e2e8f0 | Misc |

## Interaction Design

### Camera
- OrbitControls: rotate, zoom, pan
- Default view: slightly angled to see temporal depth (not straight-on)
- Smooth transitions when clicking nodes or using timeline
- Keyboard shortcuts: R (reset view), T (top-down), S (side/timeline view)

### Timeline Scrubber
- Horizontal slider at bottom of screen
- Scrub left to right: June 2023 to present
- As you scrub, nodes fade in at their creation date
- "Growth animation": play button auto-scrubs from start to present
  showing the vault growing in real-time (accelerated)
- Speed control: 1x, 5x, 20x, 100x

### Node Interaction
- Hover: show filename tooltip + link count
- Click: expand info panel (title, type, tags, linked nodes, word count)
- Double-click: highlight all connected nodes and edges
- Right-click: open file in Obsidian (obsidian://open?vault=The-Hive&file=...)

### Search
- Search box filters and highlights matching nodes
- Unmatched nodes dim but don't disappear (maintain spatial context)

### Filtering
- Toggle folders on/off (checkbox panel)
- Filter by type (session-log, architecture, knowledge, etc.)
- Filter by tag
- Isolate a time range

## Visual Modes

### Mode 1: Galaxy (default)
Z-axis is time, X/Y is force-directed. Looks like an expanding star system.
Dense core (early files), branching arms (new domains), bright hubs.

### Mode 2: DNA Helix
Same temporal Z-axis, but X/Y positions wrap around a central axis
in a helical pattern. Cross-temporal links form the rungs.
Folder colors create a barber-pole effect showing domain cycling over time.

### Mode 3: Tree of Life
Root at the bottom (2023), branches grow upward. Folder clustering
creates distinct branches. New files are leaves at the canopy.
Links between branches create visible vines.

### Mode 4: Flat (Obsidian-compatible)
Collapses Z to 0. Standard 3D force-directed graph.
Useful for comparison with Obsidian's native graph view.

## Build Phases

### Phase 1: Data + Static Render (MVP)
- [ ] Build extraction script (scripts/extract.js)
- [ ] Generate graph.json from vault
- [ ] Basic Three.js scene with instanced nodes
- [ ] Color by folder, size by word count
- [ ] Simple lines for edges
- [ ] OrbitControls
- [ ] Camera positioned to show temporal depth
**Goal:** See the vault in 3D with time as a dimension. Rotatable.

### Phase 2: Timeline + Animation
- [ ] Timeline scrubber UI
- [ ] Growth animation (nodes fade in chronologically)
- [ ] Play/pause/speed controls
- [ ] Smooth camera transitions
**Goal:** Watch the vault grow from 2023 to now.

### Phase 3: Interaction + Info
- [ ] Hover tooltips
- [ ] Click to expand node info panel
- [ ] Double-click to highlight connections
- [ ] Search bar with highlight/dim
- [ ] Folder toggle checkboxes
- [ ] Open in Obsidian (obsidian:// deep links)
**Goal:** Navigate and explore the vault interactively.

### Phase 4: Visual Modes + Polish
- [ ] Galaxy mode (default, already built)
- [ ] DNA Helix mode
- [ ] Tree of Life mode
- [ ] Flat mode
- [ ] Bloom post-processing
- [ ] Particle environment
- [ ] Edge spiral rendering for cross-temporal links
- [ ] Performance optimization for 1,400+ nodes
**Goal:** Multiple stunning visual representations.

### Phase 5: Integration
- [ ] Live reload: watch vault for changes, update graph
- [ ] Obsidian plugin wrapper (optional)
- [ ] Export: screenshot, video recording for content
- [ ] Embed in Hive Product landing page
**Goal:** Production-ready tool and content generator.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Rendering | Three.js (r128+) | Industry standard, huge ecosystem, WebGL |
| Physics | d3-force-3d | Proven force simulation with 3D support |
| Build | Vite | Fast HMR, ES module native, zero config |
| Data | Custom extraction (Node.js) | Direct vault access, YAML parsing |
| UI overlay | Vanilla DOM + CSS | No framework needed for panels/controls |
| Post-processing | Three.js EffectComposer | Bloom, depth of field |

## File Conventions

- All source in ES module format (import/export)
- No TypeScript (fast iteration > type safety for a viz project)
- Extraction script is Node.js (runs on iMac, reads vault directly)
- Dev server hosts on localhost:5173 (Vite default)
- graph.json is generated, not committed (add to .gitignore)

## Related

- [[vault-conventions]] - Vault structure this visualizes
- [[memory-service]] - Semantic search layer
- [[hive-product]] - Product this supports
- [[content-strategy]] - Video content this generates
