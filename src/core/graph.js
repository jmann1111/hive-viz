import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  forceZ
} from 'd3-force-3d';

const Z_MAX = 1000;

export class HiveGraph {
  constructor(graphData) {
    this.raw = graphData;
    this.nodes = this._buildNodes(graphData.nodes);
    this.edges = this._buildEdges(graphData.edges);
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
        id: n.id,
        path: n.path,
        folder: n.folder,
        type: n.type,
        tags: n.tags,
        wordCount: n.wordCount,
        title: n.title,
        linkCount: n.links.length,
        created: n.created,
        fz: zPos,  // pinned Z position (temporal)
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
      .on('end', () => { this.settled = true; });

    // Run 200 ticks to pre-settle
    for (let i = 0; i < 200; i++) {
      this.simulation.tick();
      // Re-pin Z after each tick
      this.nodes.forEach(n => { n.z = n.fz; });
    }
    this.settled = true;
    return this;
  }

  tick() {
    if (!this.settled && this.simulation) {
      this.simulation.tick();
      this.nodes.forEach(n => { n.z = n.fz; });
    }
  }

  getNodePositions() {
    return this.nodes.map(n => ({ x: n.x, y: n.y, z: n.z }));
  }
}
