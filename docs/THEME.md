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
