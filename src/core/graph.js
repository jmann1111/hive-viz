import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  forceZ
} from 'd3-force-3d';

const Z_MAX = 1000;
const PHI = 1.618033988749;
const SETTLE_ALPHA = 0.001;
const REHEAT_ALPHA = 0.3;

export class HiveGraph {
  constructor(graphData) {
    this.raw = graphData;
    this.nodes = this._buildNodes(graphData.nodes);
    this.edges = this._buildEdges(graphData.edges);
    this.nodeMap = new Map(this.nodes.map(n => [n.id, n]));
    this.adjacency = this._buildAdjacency();
    this.triangles = [];
    this.simulation = null;
    this.settled = false;
  }

  _buildNodes(rawNodes) {
    const dates = rawNodes
      .map(n => n.created)
      .filter(d => typeof d === 'string' && /^\d{4}/.test(d))
      .map(d => new Date(d).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const dateRange = maxDate - minDate || 1;

    return rawNodes.map(n => {
      const ts = (typeof n.created === 'string' && /^\d{4}/.test(n.created))
        ? new Date(n.created).getTime() : minDate;
      const zPos = ((ts - minDate) / dateRange) * Z_MAX;
      return {
        id: n.id, path: n.path, folder: n.folder,
        type: n.type, tags: n.tags, wordCount: n.wordCount,
        title: n.title, linkCount: n.links.length,
        created: n.created,
        fz: zPos,
        x: (Math.random() - 0.5) * 200,
        y: (Math.random() - 0.5) * 200,
        z: zPos
      };
    });
  }

  _buildEdges(rawEdges) {
    const nodeIds = new Set(this.nodes.map(n => n.id));
    return rawEdges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ source: e.source, target: e.target }));
  }

  _buildAdjacency() {
    const adj = new Map();
    for (const n of this.nodes) adj.set(n.id, new Set());
    for (const e of this.edges) {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      adj.get(s)?.add(t);
      adj.get(t)?.add(s);
    }
    return adj;
  }

  findTriangles() {
    const triangles = [];
    const adj = this.adjacency;
    const visited = new Set();

    for (const [a, neighborsA] of adj) {
      for (const b of neighborsA) {
        if (b <= a) continue;
        for (const c of adj.get(b)) {
          if (c <= b) continue;
          if (neighborsA.has(c)) {
            triangles.push([a, b, c]);
          }
        }
      }
    }
    this.triangles = triangles;
    console.log(`Found ${triangles.length} triangles in link topology`);
    return triangles;
  }

  getHubs(minDegree = 5) {
    const hubs = [];
    for (const [id, neighbors] of this.adjacency) {
      if (neighbors.size >= minDegree) {
        hubs.push({ id, degree: neighbors.size, neighbors: [...neighbors] });
      }
    }
    return hubs.sort((a, b) => b.degree - a.degree);
  }

  initSimulation() {
    this.simulation = forceSimulation(this.nodes, 3)
      .force('link', forceLink(this.edges)
        .id(d => d.id)
        .distance(30)
        .strength(0.3))
      .force('charge', forceManyBody()
        .strength(-15)
        .distanceMax(300))
      .force('x', forceX(0).strength(0.01))
      .force('y', forceY(0).strength(0.01))
      .force('z', forceZ().strength(d => 0.8).z(d => d.fz))
      .alphaDecay(0.02)
      .velocityDecay(0.3)
      .stop(); // We tick manually in render loop

    // Pre-settle 120 ticks for initial layout
    for (let i = 0; i < 120; i++) {
      this.simulation.tick();
      this.nodes.forEach(n => { n.z = n.fz; });
    }
    // Drop to ambient drift alpha
    this.simulation.alpha(SETTLE_ALPHA);
    this.settled = true;
    return this;
  }

  // Called every frame from render loop
  tick() {
    if (!this.simulation) return;
    this.simulation.tick();
    this.nodes.forEach(n => { n.z = n.fz; }); // Z always pinned to time
  }

  // Reheat simulation when something changes (drag, click, filter)
  reheat(alpha = REHEAT_ALPHA) {
    if (this.simulation) {
      this.simulation.alpha(alpha).restart();
    }
  }

  // Pin a node for dragging (sets fx, fy)
  pinNode(nodeId, x, y) {
    const node = this.nodeMap.get(nodeId);
    if (node) { node.fx = x; node.fy = y; }
  }

  // Release a pinned node
  unpinNode(nodeId) {
    const node = this.nodeMap.get(nodeId);
    if (node) { node.fx = null; node.fy = null; }
  }

  getNeighbors(nodeId) {
    return [...(this.adjacency.get(nodeId) || [])];
  }

  getNode(nodeId) {
    return this.nodeMap.get(nodeId);
  }
}
