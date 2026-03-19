// Tesseract v4 - Force-directed graph layout
// Stripped corridors/biomes. Pure graph data + d3-force-3d layout.

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force-3d';
import {
  buildPresetCoordinates,
  enrichLayoutRecords,
  LAYOUT_PRESETS,
  normalizeLayoutPreset,
} from './layout-presets.js';

const SKIP_PATHS = ['60-Knowledge/raw-data'];
const VAULT_ROOT_PREFIXES = [
  '/Users/jasonmann/Documents/The-Hive/',
  '/Users/jasonmann/Documents/The-Hive-Sync/',
];

// Folder display order for sidebar
export const FOLDER_ORDER = [
  '00-Inbox', '01-Daily', '10-Sessions', '20-Architecture',
  '30-Projects', '39-Archive', '40-Decisions', '50-Playbooks',
  '60-Knowledge', '70-Ops', '80-Secure', '99-Templates',
];

function getEdgePairKey(aNodeId, bNodeId) {
  const a = String(aNodeId || '');
  const b = String(bNodeId || '');
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function createSeededRandom(seed = 1) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalizeSeed(seed = 1) {
  return (Number(seed) >>> 0) || 1;
}

export class Tesseract {
  constructor(graphData) {
    this.nodes = graphData.nodes.filter(n => {
      if (SKIP_PATHS.some(p => n.path.startsWith(p))) return false;
      if (!n.folder || n.folder.endsWith('.md')) return false;
      return true;
    });
    const nodeIds = new Set(this.nodes.map(n => n.id));
    this.edges = graphData.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    this.nodeIndex = new Map();
    this.pathIndex = new Map();
    this.adjacency = new Map();
    this.edgeIndexByPair = new Map();

    for (const n of this.nodes) {
      this.nodeIndex.set(n.id, n);
      const normalizedPath = Tesseract.normalizeVaultPath(n.path);
      if (normalizedPath) this.pathIndex.set(normalizedPath, n);
    }
    this._buildAdjacency();

    console.log(`Tesseract v4: ${this.nodes.length} nodes, ${this.edges.length} edges`);
  }

  _buildAdjacency() {
    for (const n of this.nodes) this.adjacency.set(n.id, new Set());
    this.edgeIndexByPair.clear();
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      this.adjacency.get(e.source)?.add(e.target);
      this.adjacency.get(e.target)?.add(e.source);
      this.edgeIndexByPair.set(getEdgePairKey(e.source, e.target), i);
    }
  }

  // Run d3-force-3d simulation, returns when converged
  // Stores x, y, z on each node object
  layoutGraph(options = {}) {
    const {
      seed = null,
      scaleTarget = 14000,
      randomize = seed != null,
      preset = null,
    } = options;
    const normalizedPreset = preset ? normalizeLayoutPreset(preset) : null;
    if (normalizedPreset) {
      return this._applyPresetLayout(normalizedPreset, {
        seed: normalizeSeed(seed ?? Date.now()),
        scaleTarget,
      });
    }
    const random = randomize ? createSeededRandom(seed) : Math.random;

    // d3-force-3d mutates the nodes/edges arrays, so make copies with refs
    const simNodes = this.nodes.map((n) => {
      const simNode = {
        id: n.id,
        _node: n, // back-reference
      };
      if (randomize) {
        const theta = random() * Math.PI * 2;
        const phi = Math.acos((random() * 2) - 1);
        const radius = 40 + (random() * 220);
        simNode.x = radius * Math.sin(phi) * Math.cos(theta);
        simNode.y = radius * Math.sin(phi) * Math.sin(theta);
        simNode.z = radius * Math.cos(phi);
      }
      return simNode;
    });
    const simNodeMap = new Map(simNodes.map(n => [n.id, n]));

    const simLinks = this.edges
      .filter(e => simNodeMap.has(e.source) && simNodeMap.has(e.target))
      .map(e => ({ source: e.source, target: e.target }));

    const linkDistance = randomize ? 92 + (random() * 58) : 120;
    const linkStrength = randomize ? 0.14 + (random() * 0.12) : 0.2;
    const chargeStrength = randomize ? -220 - (random() * 150) : -300;
    const collisionRadius = randomize ? 14 + (random() * 6) : 15;

    const sim = forceSimulation(simNodes, 3)
      .force('link', forceLink(simLinks).id(d => d.id).distance(linkDistance).strength(linkStrength))
      .force('charge', forceManyBody().strength(chargeStrength))
      .force('center', forceCenter(0, 0, 0))
      .force('collide', forceCollide(collisionRadius))
      .stop();

    // Run to convergence
    sim.tick(300);

    // Scale positions to fill a massive volume
    let maxR = 0;
    for (const sn of simNodes) {
      const r = Math.sqrt(sn.x * sn.x + sn.y * sn.y + sn.z * sn.z);
      if (r > maxR) maxR = r;
    }
    const scale = maxR > 0 ? scaleTarget / maxR : 1;

    for (const sn of simNodes) {
      sn._node.x = sn.x * scale;
      sn._node.y = sn.y * scale;
      sn._node.z = sn.z * scale;
      sn._node.vx = 0;
      sn._node.vy = 0;
      sn._node.vz = 0;
      sn._node.linkCount = this.adjacency.get(sn.id)?.size || 0;
    }

    // Store simulation and scale for later drag interactions
    this.simulation = sim;
    this.simNodes = simNodes;
    this.simNodeMap = simNodeMap;
    this.scale = scale;
    this.layoutSeed = seed;
    this.layoutPreset = null;
    // Save original forces for drag restore
    this._originalCharge = sim.force('charge');
    this._originalCenter = sim.force('center');
    this._originalCollide = sim.force('collide');

    return this;
  }

  reshuffleLayout(seed = Date.now()) {
    return this.layoutGraph({
      seed,
      randomize: true,
    });
  }

  applyLayoutPreset(preset, options = {}) {
    const normalizedPreset = normalizeLayoutPreset(preset);
    const seed = normalizeSeed(options.seed ?? Date.now());
    const scaleTarget = Number.isFinite(options.scaleTarget) ? options.scaleTarget : 14000;
    return this._applyPresetLayout(normalizedPreset, { seed, scaleTarget });
  }

  getAvailableLayoutPresets() {
    return [...LAYOUT_PRESETS];
  }

  // Reheat simulation (for drag interactions)
  reheat(alpha = 0.3) {
    this.simulation.alpha(alpha).restart();
  }

  // Enter drag mode: disable global forces, only keep links
  startDrag() {
    this.simulation.force('charge', null);
    this.simulation.force('center', null);
    this.simulation.force('collide', null);
    // Pin all non-dragged nodes so only connected ones move via link force
    for (const sn of this.simNodes) {
      if (sn.fx == null) { // not already pinned
        sn._savedX = sn.x; sn._savedY = sn.y; sn._savedZ = sn.z;
        sn.fx = sn.x; sn.fy = sn.y; sn.fz = sn.z;
        sn._autoPinned = true;
      }
    }
  }

  // Exit drag mode: restore all forces
  endDrag() {
    // Restore forces
    this.simulation
      .force('charge', this._originalCharge)
      .force('center', this._originalCenter)
      .force('collide', this._originalCollide);
    // Unpin auto-pinned nodes
    for (const sn of this.simNodes) {
      if (sn._autoPinned) {
        sn.fx = null; sn.fy = null; sn.fz = null;
        delete sn._autoPinned;
      }
    }
  }

  // Pin a node for dragging (world coords -> sim coords)
  pinNode(nodeId, x, y, z) {
    const sn = this.simNodeMap.get(nodeId);
    if (sn) {
      sn.fx = x / this.scale;
      sn.fy = y / this.scale;
      sn.fz = z / this.scale;
      // Unpin direct neighbors so they can stretch
      const neighbors = this.adjacency.get(nodeId);
      if (neighbors) {
        for (const nid of neighbors) {
          const nsn = this.simNodeMap.get(nid);
          if (nsn && nsn._autoPinned) {
            nsn.fx = null; nsn.fy = null; nsn.fz = null;
            delete nsn._autoPinned;
          }
        }
      }
    }
  }

  // Unpin a node
  unpinNode(nodeId) {
    const sn = this.simNodeMap.get(nodeId);
    if (sn) { sn.fx = null; sn.fy = null; sn.fz = null; }
  }

  // Tick simulation (call each frame when active)
  tickSimulation() {
    if (this.simulation.alpha() < 0.001) return false;
    this.simulation.tick(1);
    // Sync positions back (sim coords -> world coords via scale)
    for (const sn of this.simNodes) {
      sn._node.x = sn.x * this.scale;
      sn._node.y = sn.y * this.scale;
      sn._node.z = sn.z * this.scale;
    }
    return true;
  }

  getNode(id) { return this.nodeIndex.get(id); }

  getNodeByPath(path) {
    return this.pathIndex.get(Tesseract.normalizeVaultPath(path));
  }

  resolveNodeRef(ref = {}) {
    const normalizedPath = Tesseract.normalizeVaultPath(ref.path);
    if (!normalizedPath) {
      return {
        node: null,
        validation: { nodeExists: false, pathExists: false },
      };
    }

    const nodeByPath = this.pathIndex.get(normalizedPath) || null;
    const nodeExists = Boolean(ref.nodeId && this.nodeIndex.has(ref.nodeId));
    const pathExists = Boolean(nodeByPath);

    if (!nodeByPath) {
      return {
        node: null,
        validation: { nodeExists, pathExists: false },
      };
    }

    if (ref.nodeId && nodeByPath.id !== ref.nodeId) {
      return {
        node: null,
        validation: { nodeExists, pathExists: true },
      };
    }

    return {
      node: nodeByPath,
      validation: { nodeExists: true, pathExists: true },
    };
  }

  getNeighbors(id) {
    return [...(this.adjacency.get(id) || [])]
      .map(nId => this.nodeIndex.get(nId))
      .filter(Boolean);
  }

  getEdgeIndexByPair(aNodeId, bNodeId) {
    if (!aNodeId || !bNodeId) return null;
    const edgeIndex = this.edgeIndexByPair.get(getEdgePairKey(aNodeId, bNodeId));
    return Number.isInteger(edgeIndex) ? edgeIndex : null;
  }

  getShortestPath(startNodeId, endNodeId) {
    if (!startNodeId || !endNodeId) return null;
    if (!this.nodeIndex.has(startNodeId) || !this.nodeIndex.has(endNodeId)) return null;
    if (startNodeId === endNodeId) return [startNodeId];

    const queue = [startNodeId];
    const visited = new Set([startNodeId]);
    const parents = new Map();

    while (queue.length > 0) {
      const currentId = queue.shift();
      const neighbors = this.adjacency.get(currentId);
      if (!neighbors) continue;

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        parents.set(neighborId, currentId);

        if (neighborId === endNodeId) {
          const path = [endNodeId];
          let walkId = endNodeId;
          while (parents.has(walkId)) {
            walkId = parents.get(walkId);
            path.push(walkId);
          }
          return path.reverse();
        }

        queue.push(neighborId);
      }
    }

    return null;
  }

  getNodesByFolder() {
    const map = new Map();
    for (const n of this.nodes) {
      if (!map.has(n.folder)) map.set(n.folder, []);
      map.get(n.folder).push(n);
    }
    for (const [, nodes] of map) {
      nodes.sort((a, b) => (b.linkCount || 0) - (a.linkCount || 0));
    }
    return map;
  }

  // Build a nested folder tree from node paths
  getFolderTree() {
    const root = { name: '', children: new Map(), nodes: [] };
    for (const n of this.nodes) {
      const parts = (n.path || '').split('/');
      parts.pop(); // remove filename
      let current = root;
      for (const part of parts) {
        if (!current.children.has(part)) {
          current.children.set(part, { name: part, children: new Map(), nodes: [] });
        }
        current = current.children.get(part);
      }
      current.nodes.push(n);
    }
    // Sort nodes in each folder by link count
    const sortTree = (node) => {
      node.nodes.sort((a, b) => (b.linkCount || 0) - (a.linkCount || 0));
      for (const child of node.children.values()) sortTree(child);
    };
    sortTree(root);
    return root;
  }

  search(query) {
    const q = query.toLowerCase();
    const results = [];
    for (const n of this.nodes) {
      const title = n.title || n.id;
      const score = (
        (title.toLowerCase().includes(q) ? 10 : 0) +
        (n.id.toLowerCase().includes(q) ? 5 : 0) +
        ((n.tags || []).some(t => t.toLowerCase().includes(q)) ? 3 : 0) +
        ((n.type || '').toLowerCase().includes(q) ? 2 : 0)
      );
      if (score > 0) results.push({ ...n, score });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  // Get edge data with positions and weights for rendering
  getEdgesWithPositions() {
    return this.edges.map(e => {
      const s = this.nodeIndex.get(e.source);
      const t = this.nodeIndex.get(e.target);
      if (!s || !t) return null;
      const sLinks = this.adjacency.get(e.source)?.size || 1;
      const tLinks = this.adjacency.get(e.target)?.size || 1;
      return {
        source: e.source,
        target: e.target,
        sourcePos: { x: s.x, y: s.y, z: s.z },
        targetPos: { x: t.x, y: t.y, z: t.z },
        sourceFolder: s.folder,
        targetFolder: t.folder,
        weight: Math.min(sLinks, tLinks),
      };
    }).filter(Boolean);
  }

  static normalizeVaultPath(path = '') {
    let normalized = String(path || '').trim().replace(/\\/g, '/');
    if (!normalized) return '';

    for (const prefix of VAULT_ROOT_PREFIXES) {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length);
        break;
      }
    }

    return normalized.replace(/^\/+/, '').replace(/\/+/g, '/');
  }

  _createSimulation(simNodes, simLinks, options = {}) {
    const {
      linkDistance = 120,
      linkStrength = 0.2,
      chargeStrength = -300,
      collisionRadius = 15,
    } = options;

    return forceSimulation(simNodes, 3)
      .force('link', forceLink(simLinks).id((d) => d.id).distance(linkDistance).strength(linkStrength))
      .force('charge', forceManyBody().strength(chargeStrength))
      .force('center', forceCenter(0, 0, 0))
      .force('collide', forceCollide(collisionRadius))
      .stop();
  }

  _applyPresetLayout(preset, options = {}) {
    const seed = normalizeSeed(options.seed ?? Date.now());
    const scaleTarget = Number.isFinite(options.scaleTarget) ? options.scaleTarget : 14000;
    const records = enrichLayoutRecords(this.nodes, {
      adjacency: this.adjacency,
      folderOrder: FOLDER_ORDER,
    });
    const coordinates = buildPresetCoordinates(records, { preset, seed });
    const simNodes = this.nodes.map((node) => {
      const target = coordinates.get(node.id) || { x: 0, y: 0, z: 0 };
      return {
        id: node.id,
        _node: node,
        x: target.x,
        y: target.y,
        z: target.z,
      };
    });
    const simNodeMap = new Map(simNodes.map((node) => [node.id, node]));
    const simLinks = this.edges
      .filter((edge) => simNodeMap.has(edge.source) && simNodeMap.has(edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target }));

    let maxRadius = 0;
    for (const simNode of simNodes) {
      const radius = Math.sqrt((simNode.x * simNode.x) + (simNode.y * simNode.y) + (simNode.z * simNode.z));
      if (radius > maxRadius) maxRadius = radius;
    }

    const scale = maxRadius > 0 ? scaleTarget / maxRadius : 1;
    for (const simNode of simNodes) {
      simNode._node.x = simNode.x * scale;
      simNode._node.y = simNode.y * scale;
      simNode._node.z = simNode.z * scale;
      simNode._node.vx = 0;
      simNode._node.vy = 0;
      simNode._node.vz = 0;
      simNode._node.linkCount = this.adjacency.get(simNode.id)?.size || 0;
    }

    const simulation = this._createSimulation(simNodes, simLinks, {
      linkDistance: 116,
      linkStrength: 0.18,
      chargeStrength: -260,
      collisionRadius: 14,
    });

    this.simulation = simulation;
    this.simNodes = simNodes;
    this.simNodeMap = simNodeMap;
    this.scale = scale;
    this.layoutSeed = seed;
    this.layoutPreset = preset;
    this._originalCharge = simulation.force('charge');
    this._originalCenter = simulation.force('center');
    this._originalCollide = simulation.force('collide');

    return this;
  }
}
