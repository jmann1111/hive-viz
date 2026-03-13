# Hive Viz - Temporal Knowledge Visualizer

A 3D interactive visualization of The Hive vault where time is a spatial dimension.
Instead of a flat force-directed graph, files exist in a temporal space where the
Z-axis represents time (June 2023 to present), creating a structure that looks like
a growing organism: part DNA helix, part tree of life, part expanding galaxy.

## Architecture

See `docs/ARCHITECTURE.md` for the full technical design.

## Quick Start

```bash
npm install
npm run extract    # Extract vault metadata into graph JSON
npm run dev        # Start dev server with hot reload
```

## Stack

- **Three.js** + **OrbitControls** - 3D rendering
- **Vite** - Build tool and dev server
- **D3-force-3d** - 3D force-directed graph physics
- **YAML parser** - Vault frontmatter extraction

## Project Structure

```
src/
  core/        - Graph data structures, force simulation, temporal mapping
  rendering/   - Three.js scene, materials, shaders, particle effects
  ui/          - Controls, timeline scrubber, info panels, search
  data/        - Data loading, filtering, graph mutations
scripts/
  extract.js   - Vault metadata extraction script
public/
  graph.json   - Extracted vault graph (generated)
docs/
  ARCHITECTURE.md - Full technical design
```

## Part of The Hive

This project lives under the Hive umbrella. See `30-Projects/hive-viz/` in the vault.
