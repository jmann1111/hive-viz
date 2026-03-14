# Sacred Bioluminescence Theme Spec

## Core Concept
Sacred geometry emerging from biological data. The mathematical patterns of nature
(Platonic solids, Flower of Life, Fibonacci sequences, golden ratio) rendered as
living, glowing, organic structures. The geometry emerges from the data, not painted on.

## Node Geometry (Platonic Solids by Type)
- Sessions (10-Sessions): IcosahedronGeometry (water/flow, 20 faces)
- Architecture (20-Architecture): OctahedronGeometry (air/thought, 8 faces)
- Knowledge (60-Knowledge): DodecahedronGeometry (cosmos/wisdom, 12 faces)
- Ops + Playbooks (70-Ops, 50-Playbooks): BoxGeometry (earth/foundation)
- Projects (30-Projects): TetrahedronGeometry (fire/creation, 4 faces)
- Daily notes (01-Daily): Small 2D hexagons (time/honeycomb)

Each solid: wireframe shell + glowing inner core (two meshes per type).
Wireframe edges pulse softly. Inner glow breathes on phi timing (1.618s in, 1s out).
Higher link count = brighter core.

## Hub Nodes (Sacred Anchors)
SOUL, command-center, psychological-profile, walt-boot, vault-conventions, open-loops
get Metatron's Cube / Seed of Life as 3D wireframe mandala.
3-4x larger, slow autonomous rotation, concentric light rings radiating outward.

## Bioluminescent Color Palette
| Folder           | Core    | Shell   | Analog       |
|------------------|---------|---------|--------------|
| 10-Sessions      | #1a6bff | #0a2a66 | Jellyfish    |
| 20-Architecture  | #9b4dff | #3a1866 | Amethyst     |
| 30-Projects      | #ffaa00 | #664400 | Firefly      |
| 50-Playbooks     | #00e6b0 | #004d3a | Sea anemone  |
| 60-Knowledge     | #00ff66 | #003d1a | Moss glow    |
| 70-Ops           | #ff3366 | #661428 | Deep coral   |
| 01-Daily         | #00ccff | #003344 | Plankton     |

Implementation: ShaderMaterial with emissive + fresnel glow + additive blending.

## Edge Rendering (Sacred Web)
- Luminous bezier-curved tendrils (not straight lines)
- Cross-temporal edges (>6 months span) get golden spiral curvature
- Convergent edges create emergent Flower of Life triangulation
- Signal-pulse on click: Fibonacci timing (1,1,2,3,5,8... frame intervals)

## Environment
- Deep void background (#050510)
- Flower of Life grid at 3-5% opacity, vast scale, slow rotation
- Hexagonal floating particles (luminous pollen, not round)
- Depth fog tuned for bioluminescent emergence

## Interaction Animations
- Hover: wireframe brightens, solid begins slow rotation
- Click: camera spirals to node (golden ratio path, not linear)
  Signal pulses ripple outward. Info panel with sacred geometry border.
- Drag: geometric afterimage trail (triangulated comet tail)
- Timeline: nodes crystallize face-by-face (~200ms, crystal growth)

## Timing Constants
- Phi breathing: 1.618s inhale, 1.0s exhale (2.618s cycle)
- Fibonacci pulse: [1, 1, 2, 3, 5, 8, 13, 21] frame intervals
- Hub rotation: 0.001 rad/frame (~6.28s per revolution)
- Crystallization: 200ms per node appearance
- Camera spiral: 1.2s duration with ease-in-out


## Emergent Sacred Geometry (from actual wikilinks)

The sacred geometry is NOT decorative. It is the actual link topology
of the vault, revealed visually. The wikilinks ARE the sacred geometry.

### Geometric Motif Detection (at graph build time)

**Triangles (3-cliques):**
Three nodes all linking to each other. The most common sacred building block.
Render the three edges as a filled translucent triangle face with soft glow.
A vault with 2,507 edges will contain hundreds of these.
Visual: thin translucent mesh faces between the three nodes, breathing softly.

**Hub Coronas (star subgraphs):**
A node linked to 5+ nodes that also interlink with each other.
Render the outer ring of connections as a sacred geometry mandala.
More connections = more complex mandala pattern.
- 5 connections: pentagonal corona (golden ratio)
- 6 connections: hexagonal / Flower of Life cell
- 12+ connections: Metatron's Cube corona
- 20+ connections: full sacred mandala with nested rings
SOUL, command-center, vault-conventions each generate unique mandalas
because their connection topologies are structurally different.

**Pentagonal Subgraphs (5-cycles):**
Five interconnected nodes forming a cycle.
Render with phi-proportioned edge thickness (1.618:1 ratio).
The golden ratio is literally in the link structure.

**Bridge Arcs (cross-temporal links):**
Links spanning >6 months in creation date.
Render as golden spiral curves, not straight lines.
These are the DNA helix rungs, the deep connections across time.

### Multi-Scale Beauty

**Zoomed out (the organism):**
The whole graph reads as a bioluminescent organism with visible geometric
internal structure. Triangulated mesh faces create a translucent skeletal
quality, like a deep-sea creature whose geometry is visible through its skin.
Hub coronas are the bright organs. Edge density creates natural luminous tissue.

**Mid zoom (the constellations):**
Individual sacred geometry formations visible around hub nodes. Each hub's
mandala is visually unique because it reflects that file's actual connection
topology. You can tell SOUL from command-center at a glance by the shape
of their coronas.

**Zoomed in (the connections):**
Individual curved edges between Platonic solids. Triangle faces glow softly
between three connected nodes. Signal pulses travel along geometric pathways,
lighting each triangle face as the pulse passes through.

### Timeline Integration

As the timeline scrubs forward:
- Triangles FORM the instant the third link closes the loop (3 edges flash)
- Hub coronas build petal by petal as new files link to a hub
- The sacred geometry grows from chaos in real time
- Early vault (2023): sparse, mostly isolated nodes and simple triangles
- Mid vault (2024-2025): clusters forming, first coronas emerging
- Current vault (2026): dense geometric mesh, full mandalas, visible structure

### Implementation Notes

Triangle detection: enumerate all 3-cliques in the edge list.
For 2,507 edges this is O(n * sqrt(n)) with adjacency lists.
Pre-compute at graph build time, store as face array.

Render triangles as: THREE.Mesh with BufferGeometry, one face per triangle.
Material: MeshBasicMaterial, transparent, opacity 0.04-0.08, additive blending.
Color: average of the three node folder colors.
Breathing: animate opacity on phi-ratio cycle (same as nodes).

Hub coronas: for each node with degree >= 5, compute the convex hull
of its neighbors' XY positions (ignoring Z). Render as wireframe polygon
with sacred geometry subdivision (bisect each edge, connect midpoints
to create inner star pattern). Use LineLoop or custom geometry.
