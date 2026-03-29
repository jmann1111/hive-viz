const FOLDER_COLORS = {
  '10-Sessions': '#2299aa',
  '20-Architecture': '#3377cc',
  '30-Projects': '#7744bb',
  '40-Decisions': '#5533aa',
  '50-Playbooks': '#22aacc',
  '60-Knowledge': '#aa8833',
  '70-Ops': '#33aa66',
  '99-Secure': '#993355',
};

function colorForFolder(folder) {
  return FOLDER_COLORS[folder] || '#5e74a8';
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clampToDisc(x, y) {
  const length = Math.hypot(x, y);
  if (length <= 1) return { x, y };
  const inv = 1 / Math.max(length, 0.0001);
  return {
    x: x * inv,
    y: y * inv,
  };
}

function pointToSphere(canvas, point) {
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  const radius = Math.min(canvas.width, canvas.height) * 0.5 - 18;
  const clamped = clampToDisc(
    (point.x - cx) / radius,
    (cy - point.y) / radius,
  );
  const z = Math.sqrt(Math.max(0, 1 - (clamped.x * clamped.x) - (clamped.y * clamped.y)));
  return {
    x: clamped.x,
    y: clamped.y,
    z,
  };
}

function createRoot() {
  const root = document.createElement('div');
  root.className = 'hv-minimap';
  root.style.cssText = `
    position: absolute;
    left: 14px;
    bottom: 14px;
    z-index: 19;
    width: 192px;
    pointer-events: auto;
    user-select: none;
  `;

  root.innerHTML = `
    <div style="
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(122, 151, 206, 0.18);
      border-radius: 18px;
      background:
        radial-gradient(circle at 18% 18%, rgba(109, 154, 255, 0.1), transparent 28%),
        linear-gradient(180deg, rgba(10, 13, 18, 0.82), rgba(4, 7, 11, 0.94));
      box-shadow:
        0 16px 40px rgba(0, 0, 0, 0.36),
        inset 0 1px 0 rgba(226, 239, 255, 0.05),
        inset 0 0 24px rgba(84, 132, 224, 0.08);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
    ">
      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding: 8px 10px 6px;
        color:#9db4de;
        font-size:9px;
        letter-spacing:0.18em;
        text-transform:uppercase;
      ">
        <span>Navigator Globe</span>
        <span data-minimap-layout style="color:#6f7e98;">Cluster</span>
      </div>
      <div style="padding: 0 8px 8px;">
        <canvas width="176" height="176" data-minimap-canvas style="
          display:block;
          width:176px;
          height:176px;
          border-radius:14px;
          cursor: grab;
          background:
            radial-gradient(circle at 50% 42%, rgba(33, 49, 78, 0.52), rgba(6, 10, 17, 0.96));
        "></canvas>
      </div>
      <div style="
        padding: 0 10px 9px;
        color:#687894;
        font-size:8px;
        letter-spacing:0.16em;
        text-transform:uppercase;
      ">
        Drag globe to orbit · wheel to zoom
      </div>
    </div>
  `;

  return root;
}

function drawGlobeGrid(ctx, cx, cy, radius) {
  ctx.save();
  ctx.strokeStyle = 'rgba(96, 135, 210, 0.14)';
  ctx.lineWidth = 1;
  const latitudes = [-60, -30, 0, 30, 60];
  for (const latitude of latitudes) {
    const radians = latitude * (Math.PI / 180);
    const y = cy - (Math.sin(radians) * radius);
    const rx = Math.max(8, Math.cos(radians) * radius);
    ctx.beginPath();
    ctx.ellipse(cx, y, rx, Math.max(3, rx * 0.18), 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const meridians = [-60, -30, 0, 30, 60];
  for (const longitude of meridians) {
    const radians = longitude * (Math.PI / 180);
    const rx = Math.max(8, Math.cos(radians) * radius);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, radius, Math.PI * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSphere(ctx, canvas, nodes, selectedNodeId, graphCenter, graphRadius, cameraPosition) {
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  const radius = Math.min(canvas.width, canvas.height) * 0.5 - 18;

  const fill = ctx.createRadialGradient(
    cx - (radius * 0.18),
    cy - (radius * 0.24),
    radius * 0.08,
    cx,
    cy,
    radius,
  );
  fill.addColorStop(0, 'rgba(65, 102, 178, 0.34)');
  fill.addColorStop(0.45, 'rgba(18, 28, 49, 0.66)');
  fill.addColorStop(1, 'rgba(4, 7, 13, 0.95)');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  drawGlobeGrid(ctx, cx, cy, radius);

  const usableRadius = radius * 0.9;
  ctx.globalCompositeOperation = 'lighter';
  for (const node of nodes) {
    const nx = (node.x - graphCenter.x) / Math.max(graphRadius, 1);
    const ny = (node.y - graphCenter.y) / Math.max(graphRadius, 1);
    const nz = (node.z - graphCenter.z) / Math.max(graphRadius, 1);
    const pointX = cx + (nx * usableRadius);
    const pointY = cy - (ny * usableRadius);
    const alpha = 0.12 + (clamp01((nz + 1) * 0.5) * 0.4);
    const nodeRadius = node.id === selectedNodeId ? 2.8 : 1.45;
    ctx.globalAlpha = node.id === selectedNodeId ? 0.92 : alpha;
    ctx.fillStyle = colorForFolder(node.folder);
    ctx.beginPath();
    ctx.arc(pointX, pointY, nodeRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(189, 220, 255, 0.2)';
  ctx.lineWidth = 1.25;
  ctx.shadowColor = 'rgba(108, 176, 255, 0.3)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const viewX = cameraPosition.x - graphCenter.x;
  const viewY = cameraPosition.y - graphCenter.y;
  const viewZ = cameraPosition.z - graphCenter.z;
  const viewLength = Math.hypot(viewX, viewY, viewZ) || 1;
  const markerX = cx + ((viewX / viewLength) * radius);
  const markerY = cy - ((viewY / viewLength) * radius);

  ctx.save();
  ctx.strokeStyle = 'rgba(226, 242, 255, 0.92)';
  ctx.lineWidth = 1.4;
  ctx.fillStyle = 'rgba(130, 184, 255, 0.12)';
  ctx.shadowColor = 'rgba(112, 172, 255, 0.4)';
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(markerX, markerY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(markerX, markerY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(markerX, markerY, 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(245, 251, 255, 0.96)';
  ctx.fill();
  ctx.restore();
}

export function createMinimap({ mount, onOrbit, onZoom }) {
  const root = createRoot();
  mount.appendChild(root);

  const canvas = root.querySelector('[data-minimap-canvas]');
  const ctx = canvas.getContext('2d');
  const layoutLabel = root.querySelector('[data-minimap-layout]');

  const state = {
    dragging: false,
    pointerId: null,
    lastPoint: null,
    lastSpherePoint: null,
  };

  function getPointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const point = getPointerPoint(event);
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.lastPoint = point;
    state.lastSpherePoint = pointToSphere(canvas, point);
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!state.dragging || state.pointerId !== event.pointerId) return;
    const point = getPointerPoint(event);
    const currentSpherePoint = pointToSphere(canvas, point);
    onOrbit?.({
      from: state.lastSpherePoint,
      to: currentSpherePoint,
      deltaX: (point.x - state.lastPoint.x) / Math.max(canvas.width, 1),
      deltaY: (point.y - state.lastPoint.y) / Math.max(canvas.height, 1),
    });
    state.lastPoint = point;
    state.lastSpherePoint = currentSpherePoint;
  });

  function stopDrag(event) {
    if (!state.dragging) return;
    if (event && state.pointerId != null && event.pointerId !== state.pointerId) return;
    state.dragging = false;
    state.pointerId = null;
    state.lastPoint = null;
    state.lastSpherePoint = null;
    canvas.style.cursor = 'grab';
  }

  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('pointerleave', () => {
    if (!state.dragging) canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    onZoom?.({
      deltaY: event.deltaY,
      source: 'minimap',
    });
  }, { passive: false });

  function update(nextState) {
    const {
      nodes = [],
      selectedNodeId = null,
      graphCenter = { x: 0, y: 0, z: 0 },
      graphRadius = 1,
      cameraPosition = { x: 0, y: 0, z: 1 },
      layoutPreset = 'Cluster',
    } = nextState || {};

    layoutLabel.textContent = String(layoutPreset || 'Cluster').replace(/[-_]/g, ' ');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(6, 10, 18, 0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!Array.isArray(nodes) || nodes.length === 0) return;

    drawSphere(ctx, canvas, nodes, selectedNodeId, graphCenter, graphRadius, cameraPosition);
  }

  return {
    root,
    update,
    destroy() {
      root.remove();
    },
  };
}
