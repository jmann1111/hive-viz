# The Hive

The Hive is a 3D knowledge explorer for the Hive vault. It combines a spatial graph,
an Obsidian-style browser, an inline reader, and a direct retrieval path for opening
notes fast without routing through an agent layer.

## Architecture

See `docs/ARCHITECTURE.md` for the full technical design.

## Quick Start

```bash
npm install
npm run extract    # Extract vault metadata into graph JSON
npm run dev        # Start dev server with hot reload
npm run server     # Start Retriever backend on :8787
```

## Retriever Backend

Retriever is the direct low-latency retrieval path. It does not route through
OpenClaw and it does not run an agent framework.

### Endpoint

`POST /api/retriever/retrieve`

```json
{
  "query": "open hive conventions",
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "maxCandidates": 5
}
```

Structured response modes:

- `resolved_note`
- `candidate_notes`
- `clarification_request`

### Environment

- `HIVE_VAULT_ROOT`: absolute path to the Obsidian vault root
- `OPENAI_API_KEY`: required for OpenAI intent parsing
- `GEMINI_API_KEY`: required for Gemini intent parsing
- `RETRIEVER_SERVER_PORT`: optional, defaults to `8787`

### Notes

- Vite proxies `/api/*` to the Retriever server
- Providers only parse retrieval intent
- Local retrieval ranks notes from `public/graph.json`
- Every actionable path is validated against the vault root before response

## Stack

- **Three.js** + **OrbitControls** - 3D rendering
- **Vite** - Build tool and dev server
- **D3-force-3d** - 3D force-directed graph physics
- **YAML parser** - Vault frontmatter extraction

## Project Structure

```
src/
  core/        - Graph rendering, sidebar, reader, retriever panel, layout logic
  server/      - Retrieval endpoint, provider adapters, graph index, validation
  styles/      - Sidebar, reader, and retriever panel CSS
scripts/
  extract.js         - Vault metadata extraction script
  eval-retriever.js  - Retriever benchmark harness
public/
  graph.json   - Extracted vault graph (generated)
docs/
  ARCHITECTURE.md - Full technical design
```

## Part of The Hive

This repo was previously referred to as `hive-viz`. It is now treated as The Hive app.
