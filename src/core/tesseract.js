// Tesseract corridor geometry generator
// Converts graph.json into a 3D spatial layout of corridors and panels

const CORRIDOR_WIDTH = 6;
const CORRIDOR_HEIGHT = 8;
const PANEL_SPACING = 3;
const PANEL_WIDTH = 2;
const PANEL_HEIGHT = 2.5;
const INTERSECTION_SIZE = 8;

// Skip raw data (1210 ChatGPT transcripts would make one corridor infinite)
const SKIP_PATHS = ['60-Knowledge/raw-data'];

// Folder -> corridor direction. Grid layout from central intersection.
// Layer 0 (y=0): main folders. Layer 1 (y=12): secondary folders.
const FOLDER_DIRECTIONS = {
  '10-Sessions':     { axis: 'z', sign: 1,  layer: 0 },
  '20-Architecture': { axis: 'x', sign: 1,  layer: 0 },
  '60-Knowledge':    { axis: 'z', sign: -1, layer: 0 },
  '70-Ops':          { axis: 'x', sign: -1, layer: 0 },
  '30-Projects':     { axis: 'z', sign: 1,  layer: 1 },
  '50-Playbooks':    { axis: 'x', sign: 1,  layer: 1 },
  '01-Daily':        { axis: 'z', sign: -1, layer: 1 },
  '40-Decisions':    { axis: 'x', sign: -1, layer: 1 },
  '80-Secure':       { axis: 'z', sign: 1,  layer: 2 },
  '39-Archive':      { axis: 'x', sign: 1,  layer: 2 },
  '00-Inbox':        { axis: 'z', sign: -1, layer: 2 },
  '99-Templates':    { axis: 'x', sign: -1, layer: 2 },
};
const LAYER_OFFSET = 12;

export class Tesseract {
  constructor(graphData) {
    // Filter out raw-data and root-level files
    this.nodes = graphData.nodes.filter(n => {
      if (SKIP_PATHS.some(p => n.path.startsWith(p))) return false;
      if (!n.folder || n.folder.endsWith('.md')) return false;
      return true;
    });
    this.edges = graphData.edges.filter(e => {
      const nodeIds = new Set(this.nodes.map(n => n.id));
      return nodeIds.has(e.source) && nodeIds.has(e.target);
    });
    this.corridors = new Map();
    this.panels = new Map();
    this.nodeIndex = new Map();
    this.adjacency = new Map();

    for (const n of this.nodes) this.nodeIndex.set(n.id, n);
    this._buildAdjacency();
    this._buildCorridors();
    this._placePanels();
    console.log(`Tesseract: ${this.nodes.length} nodes (${graphData.nodes.length - this.nodes.length} filtered), ${this.corridors.size} corridors, ${this.panels.size} panels`);
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
      const dir = FOLDER_DIRECTIONS[folder];
      if (!dir) continue;
      const yOffset = (dir.layer || 0) * LAYER_OFFSET;
      const length = nodes.length * PANEL_SPACING + INTERSECTION_SIZE;
      const start = { x: 0, y: yOffset, z: 0 };
      const end = { ...start };
      if (dir.axis === 'x') end.x = dir.sign * length;
      else end.z = dir.sign * length;
      this.corridors.set(folder, {
        folder, nodes, start, end, dir,
        width: CORRIDOR_WIDTH, height: CORRIDOR_HEIGHT,
        length, yOffset
      });
    }
  }

  _placePanels() {
    for (const [folder, corridor] of this.corridors) {
      const { dir, yOffset, nodes } = corridor;
      nodes.forEach((node, i) => {
        const dist = INTERSECTION_SIZE + i * PANEL_SPACING;
        const side = i % 2 === 0 ? 1 : -1;
        const pos = { x: 0, y: yOffset + CORRIDOR_HEIGHT * 0.35, z: 0 };
        const normal = { x: 0, y: 0, z: 0 };
        if (dir.axis === 'x') {
          pos.x = dir.sign * dist;
          pos.z = side * (CORRIDOR_WIDTH / 2);
          normal.z = -side;
        } else {
          pos.z = dir.sign * dist;
          pos.x = side * (CORRIDOR_WIDTH / 2);
          normal.x = -side;
        }
        this.panels.set(node.id, {
          id: node.id, title: node.title, folder,
          type: node.type, tags: node.tags, path: node.path,
          wordCount: node.wordCount, created: node.created,
          linkCount: (this.adjacency.get(node.id)?.size || 0),
          pos, normal, side,
          corridorDir: dir.axis, corridorSign: dir.sign,
          panelIndex: i
        });
      });
    }
  }

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

  getNeighbors(id) {
    return [...(this.adjacency.get(id) || [])].map(nId => this.panels.get(nId)).filter(Boolean);
  }
}
