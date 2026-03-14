// Tesseract corridor geometry generator
// Converts graph.json into a 3D spatial layout of corridors and panels

const CORRIDOR_WIDTH = 6;
const CORRIDOR_HEIGHT = 8;
const PANEL_SPACING = 3;
const PANEL_WIDTH = 2;
const PANEL_HEIGHT = 2.5;
const INTERSECTION_SIZE = 8;

// Folder -> corridor direction mapping (radial layout from origin)
const FOLDER_DIRECTIONS = {
  '10-Sessions':     { axis: 'x', sign: 1 },
  '20-Architecture': { axis: 'z', sign: 1 },
  '30-Projects':     { axis: 'x', sign: -1 },
  '50-Playbooks':    { axis: 'z', sign: -1 },
  '60-Knowledge':    { axis: 'x', sign: 1, offset: 1 },
  '70-Ops':          { axis: 'z', sign: 1, offset: 1 },
  '01-Daily':        { axis: 'x', sign: -1, offset: 1 },
  '40-Decisions':    { axis: 'z', sign: -1, offset: 1 },
  '80-Secure':       { axis: 'x', sign: 1, offset: 2 },
  '39-Archive':      { axis: 'z', sign: 1, offset: 2 },
  '00-Inbox':        { axis: 'x', sign: -1, offset: 2 },
  '99-Templates':    { axis: 'z', sign: -1, offset: 2 },
};

export class Tesseract {
  constructor(graphData) {
    this.nodes = graphData.nodes;
    this.edges = graphData.edges;
    this.corridors = new Map();    // folderId -> corridor data
    this.panels = new Map();       // nodeId -> panel position data
    this.nodeIndex = new Map();    // nodeId -> node data
    this.adjacency = new Map();    // nodeId -> Set of linked nodeIds

    for (const n of this.nodes) this.nodeIndex.set(n.id, n);
    this._buildAdjacency();
    this._buildCorridors();
    this._placePanels();
  }

  _buildAdjacency() {
    for (const n of this.nodes) this.adjacency.set(n.id, new Set());
    for (const e of this.edges) {
      this.adjacency.get(e.source)?.add(e.target);
      this.adjacency.get(e.target)?.add(e.source);
    }
  }

  _buildCorridors() {
    // Group nodes by folder
    const folderGroups = new Map();
    for (const n of this.nodes) {
      const folder = n.folder;
      if (!folderGroups.has(folder)) folderGroups.set(folder, []);
      folderGroups.get(folder).push(n);
    }

    for (const [folder, nodes] of folderGroups) {
      const dir = FOLDER_DIRECTIONS[folder];
      if (!dir) continue;
      const yOffset = (dir.offset || 0) * (CORRIDOR_HEIGHT + 4);
      const length = nodes.length * PANEL_SPACING + INTERSECTION_SIZE;

      // Corridor start and end positions
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
        const side = i % 2 === 0 ? 1 : -1; // alternate walls
        const pos = { x: 0, y: yOffset + CORRIDOR_HEIGHT * 0.35, z: 0 };
        const normal = { x: 0, y: 0, z: 0 }; // wall face direction

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

  // Get waypoints for flying from one panel to another
  getFlightPath(fromId, toId) {
    const from = this.panels.get(fromId);
    const to = this.panels.get(toId);
    if (!from || !to) return null;

    const waypoints = [];
    // Pull back to corridor center from current panel
    const fromCenter = { ...from.pos };
    if (from.corridorDir === 'x') fromCenter.z = 0;
    else fromCenter.x = 0;
    fromCenter.y = from.pos.y + 1;
    waypoints.push(fromCenter);

    // If different corridors, route through intersection
    if (from.folder !== to.folder) {
      const fromCorridor = this.corridors.get(from.folder);
      const toCorridor = this.corridors.get(to.folder);
      // Fly to intersection center at source Y
      waypoints.push({
        x: 0, y: fromCorridor.yOffset + CORRIDOR_HEIGHT * 0.4, z: 0
      });
      // If different Y level, add vertical transition
      if (fromCorridor.yOffset !== toCorridor.yOffset) {
        waypoints.push({
          x: 0, y: toCorridor.yOffset + CORRIDOR_HEIGHT * 0.4, z: 0
        });
      }
    }

    // Fly down destination corridor center
    const toCenter = { ...to.pos };
    if (to.corridorDir === 'x') toCenter.z = 0;
    else toCenter.x = 0;
    toCenter.y = to.pos.y + 1;
    waypoints.push(toCenter);

    // Final approach: slide to face the panel
    const approach = { ...to.pos };
    approach.y = to.pos.y + 0.5;
    // Stand back from the wall
    if (to.normal.x !== 0) approach.x += to.normal.x * 2.5;
    if (to.normal.z !== 0) approach.z += to.normal.z * 2.5;
    waypoints.push(approach);

    return { waypoints, from, to };
  }

  // Search panels by text query
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

  getCorridorList() {
    return [...this.corridors.entries()].map(([folder, c]) => ({
      folder, fileCount: c.nodes.length, direction: c.dir
    }));
  }
}
