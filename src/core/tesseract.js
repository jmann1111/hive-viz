// Tesseract corridor geometry generator v3
// Biome worlds + scale + verticality

const PANEL_SPACING = 8; // 5x from original ~3 -> spread panels out
const INTERSECTION_SIZE = 20;
const SKIP_PATHS = ['60-Knowledge/raw-data'];

// ============ BIOME CONFIGS ============
// Each folder is its own WORLD with distinct visual DNA
const BIOMES = {
  '10-Sessions': {
    axis: 'z', sign: 1, layer: 0,
    width: 12, height: 14,
    gridStep: 4, gridDensity: 'clean',
    ceilingHeight: 14,
    bgTone: 0xf5f5f5,
    lineColor: 0x999999, lineDark: 0x444444,
    accent: 0x4477cc,
    style: 'antichamber-clean', // ref: 004_tesseract, 014_antichamber
    blocks: false,
  },
  '20-Architecture': {
    axis: 'x', sign: 1, layer: 0,
    width: 8, height: 20,  // canyon-like: narrow + tall
    gridStep: 1.5, gridDensity: 'dense',
    ceilingHeight: 20,
    bgTone: 0xe8e8e8,
    lineColor: 0x222222, lineDark: 0x111111,
    accent: 0x44aadd,
    style: 'dense-grid', // ref: 011_antichamber
    blocks: false,
  },  '60-Knowledge': {
    axis: 'z', sign: -1, layer: 0,
    width: 20, height: 50,  // massive open space, block city
    gridStep: 3, gridDensity: 'medium',
    ceilingHeight: 50,
    bgTone: 0xf0f0f0,
    lineColor: 0xaaaaaa, lineDark: 0x666666,
    accent: 0xddaa44,
    style: 'block-city', // ref: 050_hub (white block cityscape)
    blocks: true, blockDensity: 0.6, blockMaxHeight: 35, blockMinHeight: 2,
  },
  '70-Ops': {
    axis: 'x', sign: -1, layer: 0,
    width: 14, height: 24,
    gridStep: 2, gridDensity: 'medium',
    ceilingHeight: 24,
    bgTone: 0x222222,  // DARK biome
    lineColor: 0x888888, lineDark: 0xcccccc, // inverted: light lines on dark
    accent: 0x44dd88,
    style: 'dark-runway', // ref: 023_biome (dark floor + green glow)
    blocks: false, darkFloor: true,
  },
  '30-Projects': {
    axis: 'z', sign: 1, layer: 1,
    width: 10, height: 16,
    gridStep: 2, gridDensity: 'medium',
    ceilingHeight: 16,
    bgTone: 0xf0f0f0,
    lineColor: 0x444444, lineDark: 0x222222,
    accent: 0xcc4433,
    style: 'saturated-blocks', // ref: 023_biome (red block corridor)
    blocks: true, blockDensity: 0.8, blockMaxHeight: 12, blockMinHeight: 1,
    blockColors: [0xcc3333, 0xdd6633, 0xee8833, 0xcc4444, 0xbb2222],
  },  '50-Playbooks': {
    axis: 'x', sign: 1, layer: 1,
    width: 10, height: 12,
    gridStep: 3, gridDensity: 'clean',
    ceilingHeight: 12,
    bgTone: 0xf2f2f2,
    lineColor: 0x888888, lineDark: 0x555555,
    accent: 0x44aa88,
    style: 'antichamber-clean',
    blocks: false,
  },
  '01-Daily': {
    axis: 'z', sign: -1, layer: 1,
    width: 8, height: 10,
    gridStep: 3, gridDensity: 'clean',
    ceilingHeight: 10,
    bgTone: 0xf5f5f5,
    lineColor: 0xbbbbbb, lineDark: 0x888888,
    accent: 0x44bbcc,
    style: 'antichamber-clean',
    blocks: false,
  },
  '40-Decisions': { axis: 'x', sign: -1, layer: 1, width: 8, height: 10, gridStep: 3, gridDensity: 'clean', ceilingHeight: 10, bgTone: 0xf0f0f0, lineColor: 0x999999, lineDark: 0x666666, accent: 0x8866cc, style: 'antichamber-clean', blocks: false },
  '80-Secure':   { axis: 'z', sign: 1, layer: 2, width: 6, height: 8, gridStep: 2, gridDensity: 'dense', ceilingHeight: 8, bgTone: 0xe0e0e0, lineColor: 0x333333, lineDark: 0x111111, accent: 0xcc4466, style: 'dense-grid', blocks: false },
  '39-Archive':  { axis: 'x', sign: 1, layer: 2, width: 10, height: 14, gridStep: 4, gridDensity: 'clean', ceilingHeight: 14, bgTone: 0xf0f0f0, lineColor: 0xaaaaaa, lineDark: 0x777777, accent: 0x999999, style: 'antichamber-clean', blocks: false },
  '00-Inbox':    { axis: 'z', sign: -1, layer: 2, width: 8, height: 10, gridStep: 3, gridDensity: 'clean', ceilingHeight: 10, bgTone: 0xf5f5f5, lineColor: 0xbbbbbb, lineDark: 0x888888, accent: 0xaaaaaa, style: 'antichamber-clean', blocks: false },
  '99-Templates':{ axis: 'x', sign: -1, layer: 2, width: 6, height: 8, gridStep: 3, gridDensity: 'clean', ceilingHeight: 8, bgTone: 0xf0f0f0, lineColor: 0xaaaaaa, lineDark: 0x777777, accent: 0x888888, style: 'antichamber-clean', blocks: false },
};
const LAYER_OFFSET = 30; // Increased from 12 for more vertical separation
export class Tesseract {
  constructor(graphData) {
    this.nodes = graphData.nodes.filter(n => {
      if (SKIP_PATHS.some(p => n.path.startsWith(p))) return false;
      if (!n.folder || n.folder.endsWith('.md')) return false;
      return true;
    });
    const nodeIds = new Set(this.nodes.map(n => n.id));
    this.edges = graphData.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    this.corridors = new Map();
    this.panels = new Map();
    this.nodeIndex = new Map();
    this.adjacency = new Map();
    this.blocks = []; // vertical block elements
    for (const n of this.nodes) this.nodeIndex.set(n.id, n);
    this._buildAdjacency();
    this._buildCorridors();
    this._placePanels();
    this._generateBlocks();
    console.log(`Tesseract v3: ${this.nodes.length} nodes, ${this.corridors.size} corridors, ${this.panels.size} panels, ${this.blocks.length} blocks`);
  }

  _buildAdjacency() {
    for (const n of this.nodes) this.adjacency.set(n.id, new Set());
    for (const e of this.edges) {
      this.adjacency.get(e.source)?.add(e.target);
      this.adjacency.get(e.target)?.add(e.source);
    }
  }
  _buildCorridors() {
    const folderGroups = new Map();
    for (const n of this.nodes) {
      const f = n.folder;
      if (!folderGroups.has(f)) folderGroups.set(f, []);
      folderGroups.get(f).push(n);
    }
    for (const [folder, nodes] of folderGroups) {
      const biome = BIOMES[folder];
      if (!biome) continue;
      const yOffset = (biome.layer || 0) * LAYER_OFFSET;
      const length = nodes.length * PANEL_SPACING + INTERSECTION_SIZE;
      this.corridors.set(folder, {
        folder, nodes, biome, length, yOffset,
        width: biome.width, height: biome.height,
      });
    }
  }

  _placePanels() {
    for (const [folder, corridor] of this.corridors) {
      const { biome, yOffset, nodes } = corridor;
      const dir = { axis: biome.axis, sign: biome.sign };
      nodes.forEach((node, i) => {
        const dist = INTERSECTION_SIZE + i * PANEL_SPACING;
        const side = i % 2 === 0 ? 1 : -1;
        const w2 = biome.width / 2;
        const pos = { x: 0, y: yOffset + biome.height * 0.35, z: 0 };
        const normal = { x: 0, y: 0, z: 0 };        if (dir.axis === 'x') {
          pos.x = dir.sign * dist;
          pos.z = side * w2;
          normal.z = -side;
        } else {
          pos.z = dir.sign * dist;
          pos.x = side * w2;
          normal.x = -side;
        }
        this.panels.set(node.id, {
          id: node.id, title: node.title, folder,
          type: node.type, tags: node.tags, path: node.path,
          wordCount: node.wordCount, created: node.created,
          linkCount: (this.adjacency.get(node.id)?.size || 0),
          pos, normal, side, biome,
          corridorDir: dir.axis, corridorSign: dir.sign,
          panelIndex: i,
        });
      });
    }
  }

  _generateBlocks() {
    // Generate vertical block elements for block-city and saturated-blocks biomes
    for (const [folder, corridor] of this.corridors) {
      const { biome, yOffset, length } = corridor;
      if (!biome.blocks) continue;
      const w2 = biome.width / 2;
      const count = Math.floor(length * biome.blockDensity * 0.5);      const seed = folder.charCodeAt(0); // deterministic pseudo-random
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const dist = INTERSECTION_SIZE + t * length;
        const h = biome.blockMinHeight + Math.abs(Math.sin(seed * i * 0.73)) * (biome.blockMaxHeight - biome.blockMinHeight);
        const bw = 1 + Math.abs(Math.sin(seed * i * 1.37)) * 3;
        const bd = 1 + Math.abs(Math.sin(seed * i * 2.17)) * 3;
        // Position along corridor walls and scattered in middle
        const laneOffset = (Math.sin(seed * i * 0.47) > 0 ? 1 : -1) * (Math.abs(Math.sin(seed * i * 0.91)) * w2 * 0.8);
        const pos = { x: 0, y: yOffset, z: 0 };
        if (biome.axis === 'x') { pos.x = biome.sign * dist; pos.z = laneOffset; }
        else { pos.z = biome.sign * dist; pos.x = laneOffset; }
        const color = biome.blockColors
          ? biome.blockColors[Math.floor(Math.abs(Math.sin(seed * i * 3.14)) * biome.blockColors.length)]
          : biome.lineColor;
        this.blocks.push({ pos, width: bw, depth: bd, height: h, color, folder, biome });
      }
    }
  }

  getBiome(folder) { return BIOMES[folder]; }

  search(query) {
    const q = query.toLowerCase();
    const results = [];
    for (const [id, panel] of this.panels) {
      const score = (
        (panel.title.toLowerCase().includes(q) ? 10 : 0) +
        (panel.id.toLowerCase().includes(q) ? 5 : 0) +
        (panel.tags.some(t => t.toLowerCase().includes(q)) ? 3 : 0) +
        (panel.type.toLowerCase().includes(q) ? 2 : 0)
      );
      if (score > 0) results.push({ ...panel, score });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  getPanel(id) { return this.panels.get(id); }
  getNeighbors(id) { return [...(this.adjacency.get(id) || [])].map(nId => this.panels.get(nId)).filter(Boolean); }
}