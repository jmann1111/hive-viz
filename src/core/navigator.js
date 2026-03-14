// Navigator: Axis-aligned corridor flight through actual Tesseract geometry
// Every flight goes: corridor -> hub -> corridor. Hub is the universal router.

export class Navigator {
  constructor(tesseract) {
    this.tesseract = tesseract;
    // Build hub positions per layer
    this.hubs = new Map(); // layer -> {x, y, z}
    for (const [folder, corridor] of tesseract.corridors) {
      const layer = corridor.biome.layer || 0;
      if (!this.hubs.has(layer)) {
        this.hubs.set(layer, { x: 0, y: corridor.yOffset + corridor.height * 0.4, z: 0 });
      }
    }
  }

  // Get the corridor center position for a panel (where camera should fly)
  _corridorCenter(panel) {
    const y = panel.pos.y + 0.5; // slightly above panel center
    // Camera flies down corridor center (offset 0 on the cross-axis)
    if (panel.corridorDir === 'x') {
      return { x: panel.pos.x, y, z: 0 };
    } else {
      return { x: 0, y, z: panel.pos.z };
    }
  }
  // Build a flight plan: sequence of typed segments
  plan(fromPos, targetId) {
    const panel = this.tesseract.getPanel(targetId);
    if (!panel) return null;

    const dest = this._corridorCenter(panel);
    const panelFace = {
      x: panel.pos.x + (panel.normal.x || 0) * 4,
      y: panel.pos.y + 1.5,
      z: panel.pos.z + (panel.normal.z || 0) * 4,
    };
    const srcLayer = this._nearestLayer(fromPos.y);
    const dstLayer = panel.biome.layer || 0;
    const srcHub = this.hubs.get(srcLayer) || { x: 0, y: fromPos.y, z: 0 };
    const dstHub = this.hubs.get(dstLayer) || { x: 0, y: dest.y, z: 0 };

    const segments = [];
    const eyeH = 1.5; // camera height offset
    // === PHASE 1: Get to hub (axis-aligned legs) ===
    const startPos = { x: fromPos.x, y: srcHub.y, z: fromPos.z };

    // Leg 1a: travel along X toward hub (x -> 0)
    if (Math.abs(startPos.x) > 3) {
      segments.push({
        type: 'straight',
        from: { x: startPos.x, y: startPos.y, z: startPos.z },
        to: { x: 0, y: startPos.y, z: startPos.z },
        axis: 'x',
      });
    }
    // Leg 1b: turn at (0, y, z) to face Z-axis
    if (Math.abs(startPos.z) > 3 && Math.abs(startPos.x) > 3) {
      segments.push({
        type: 'turn',
        pos: { x: 0, y: startPos.y, z: startPos.z },
        fromHeading: startPos.x > 0 ? Math.PI : 0, // was facing toward 0
        toHeading: startPos.z > 0 ? Math.PI * 1.5 : Math.PI * 0.5,
      });
    }
    // Leg 1c: travel along Z toward hub (z -> 0)
    if (Math.abs(startPos.z) > 3) {
      segments.push({
        type: 'straight',
        from: { x: 0, y: startPos.y, z: startPos.z },
        to: { x: 0, y: startPos.y, z: 0 },
        axis: 'z',
      });
    }
    // === PHASE 2: Vertical if layer change ===
    if (srcLayer !== dstLayer) {
      segments.push({
        type: 'vertical',
        pos: { x: 0, z: 0 },
        fromY: srcHub.y,
        toY: dstHub.y,
      });
    }

    const hubY = dstHub.y;

    // === PHASE 3: Hub to target corridor ===
    // Determine heading to face the target corridor
    const targetHeading = this._axisHeading(panel.corridorDir, panel.corridorSign);

    // Turn at hub to face target corridor
    const prevHeading = segments.length > 0 ? this._lastHeading(segments) : 0;
    if (Math.abs(this._angleDiff(prevHeading, targetHeading)) > 0.1) {
      segments.push({
        type: 'turn',
        pos: { x: 0, y: hubY, z: 0 },
        fromHeading: prevHeading,
        toHeading: targetHeading,
      });
    }
    // Straight down target corridor to near the panel
    segments.push({
      type: 'straight',
      from: { x: 0, y: hubY, z: 0 },
      to: { x: dest.x, y: hubY, z: dest.z },
      axis: panel.corridorDir,
    });

    // Arrive: final approach to face the panel
    segments.push({
      type: 'arrive',
      from: { x: dest.x, y: hubY, z: dest.z },
      to: { x: panelFace.x, y: panelFace.y, z: panelFace.z },
      lookTarget: { x: panel.pos.x, y: panel.pos.y, z: panel.pos.z },
    });

    // Calculate timing for each segment
    return this._timePlan(segments);
  }
  _timePlan(segments) {
    // Assign duration to each segment based on type and distance
    for (const seg of segments) {
      if (seg.type === 'straight') {
        const d = Math.sqrt(
          (seg.to.x-seg.from.x)**2 + (seg.to.y-seg.from.y)**2 + (seg.to.z-seg.from.z)**2
        );
        // Speed: ~80 units/sec cruise, so duration = distance / speed
        // Min 0.8s, max 4s per straight
        seg.duration = Math.max(0.8, Math.min(4, d / 80));
        seg.distance = d;
      } else if (seg.type === 'turn') {
        // Turns are quick: 0.4 to 0.8 seconds based on angle
        const angle = Math.abs(this._angleDiff(seg.fromHeading, seg.toHeading));
        seg.duration = 0.4 + (angle / Math.PI) * 0.4;
      } else if (seg.type === 'vertical') {
        const d = Math.abs(seg.toY - seg.fromY);
        seg.duration = Math.max(0.6, Math.min(2, d / 40));
      } else if (seg.type === 'arrive') {
        seg.duration = 1.2; // always 1.2 seconds for smooth landing
      }
    }
    // Compute cumulative start times
    let t = 0;
    for (const seg of segments) {
      seg.startTime = t;
      t += seg.duration;
    }
    return { segments, totalDuration: t };
  }
  _nearestLayer(y) {
    let best = 0, bestDist = Infinity;
    for (const [layer, hub] of this.hubs) {
      const d = Math.abs(hub.y - y);
      if (d < bestDist) { bestDist = d; best = layer; }
    }
    return best;
  }

  _axisHeading(axis, sign) {
    // Heading in radians: +Z=0, +X=PI/2, -Z=PI, -X=3PI/2
    if (axis === 'z' && sign > 0) return 0;
    if (axis === 'x' && sign > 0) return Math.PI / 2;
    if (axis === 'z' && sign < 0) return Math.PI;
    if (axis === 'x' && sign < 0) return Math.PI * 1.5;
    return 0;
  }

  _angleDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  _lastHeading(segments) {
    for (let i = segments.length - 1; i >= 0; i--) {
      const s = segments[i];
      if (s.type === 'turn') return s.toHeading;
      if (s.type === 'straight') {        const dx = s.to.x - s.from.x, dz = s.to.z - s.from.z;
        return Math.atan2(dx, dz);
      }
    }
    return 0;
  }
}