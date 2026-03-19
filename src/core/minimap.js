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
        <span>Navigator</span>
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
            radial-gradient(circle at 50% 50%, rgba(24, 34, 52, 0.36), rgba(6, 10, 17, 0.92));
        "></canvas>
      </div>
      <div style="
        padding: 0 10px 9px;
        color:#687894;
        font-size:8px;
        letter-spacing:0.16em;
        text-transform:uppercase;
      ">
        Drag lens to pan · wheel to zoom
      </div>
    </div>
  `;

  return root;
}

export function createMinimap({ mount, onPan, onZoom }) {
  const root = createRoot();
  mount.appendChild(root);

  const canvas = root.querySelector('[data-minimap-canvas]');
  const ctx = canvas.getContext('2d');
  const layoutLabel = root.querySelector('[data-minimap-layout]');

  const state = {
    dragging: false,
    pointerId: null,
    lastView: null,
  };

  function lensHitTest(x, y) {
    const view = state.lastView;
    if (!view?.lens) return false;
    const { cx, cy, rx, ry } = view.lens;
    return Math.abs(x - cx) <= rx && Math.abs(y - cy) <= ry;
  }

  function getPointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      nx: clamp01((event.clientX - rect.left) / rect.width),
      ny: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  function panFromPointer(event) {
    const point = getPointerPoint(event);
    onPan?.({
      x: point.nx,
      y: point.ny,
    });
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const point = getPointerPoint(event);
    state.dragging = true;
    state.pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = lensHitTest(point.x, point.y) ? 'grabbing' : 'crosshair';
    panFromPointer(event);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!state.dragging || state.pointerId !== event.pointerId) return;
    panFromPointer(event);
  });

  function stopDrag(event) {
    if (!state.dragging) return;
    if (event && state.pointerId != null && event.pointerId !== state.pointerId) return;
    state.dragging = false;
    state.pointerId = null;
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

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(92, 122, 177, 0.12)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      const x = Math.round(t * canvas.width) + 0.5;
      const y = Math.round(t * canvas.height) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, canvas.height - 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(canvas.width - 8, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function project(nodes) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minZ = Math.min(minZ, node.z);
      maxZ = Math.max(maxZ, node.z);
    }
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const pad = 14;
    const usableW = canvas.width - pad * 2;
    const usableH = canvas.height - pad * 2;

    return {
      minX,
      maxX,
      minZ,
      maxZ,
      spanX,
      spanZ,
      pad,
      usableW,
      usableH,
      toCanvas(node) {
        return {
          x: pad + ((node.x - minX) / spanX) * usableW,
          y: pad + ((node.z - minZ) / spanZ) * usableH,
        };
      },
      toNormalized(pointX, pointZ) {
        return {
          x: clamp01((pointX - minX) / spanX),
          y: clamp01((pointZ - minZ) / spanZ),
        };
      },
    };
  }

  function update(nextState) {
    const {
      nodes = [],
      selectedNodeId = null,
      cameraTarget = { x: 0, z: 0 },
      cameraFootprint = [],
      zoomRatio = 0.5,
      layoutPreset = 'Cluster',
    } = nextState || {};

    layoutLabel.textContent = String(layoutPreset || 'Cluster').replace(/[-_]/g, ' ');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(6, 10, 18, 0.88)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid();

    if (!Array.isArray(nodes) || nodes.length === 0) return;

    const projection = project(nodes);

    ctx.save();
    ctx.lineWidth = 1;
    ctx.globalCompositeOperation = 'lighter';
    for (const node of nodes) {
      const point = projection.toCanvas(node);
      const radius = node.id === selectedNodeId ? 2.8 : 1.45;
      const alpha = node.id === selectedNodeId ? 0.9 : 0.38;
      const color = colorForFolder(node.folder);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.globalAlpha = alpha;
      ctx.fill();
    }
    ctx.restore();

    const targetNorm = projection.toNormalized(cameraTarget.x, cameraTarget.z);
    const fallbackRadius = 16 + (1 - clamp01(zoomRatio)) * 36;
    const footprint = Array.isArray(cameraFootprint) && cameraFootprint.length >= 3
      ? cameraFootprint.map((point) => projection.toCanvas(point))
      : [];
    let lens = {
      cx: projection.pad + targetNorm.x * projection.usableW,
      cy: projection.pad + targetNorm.y * projection.usableH,
      rx: fallbackRadius,
      ry: fallbackRadius,
      polygon: [],
    };

    if (footprint.length >= 3) {
      const xs = footprint.map((point) => point.x);
      const ys = footprint.map((point) => point.y);
      lens = {
        cx: xs.reduce((sum, value) => sum + value, 0) / xs.length,
        cy: ys.reduce((sum, value) => sum + value, 0) / ys.length,
        rx: Math.max(12, (Math.max(...xs) - Math.min(...xs)) * 0.5),
        ry: Math.max(12, (Math.max(...ys) - Math.min(...ys)) * 0.5),
        polygon: footprint,
      };
    }
    state.lastView = { lens };

    ctx.save();
    ctx.strokeStyle = 'rgba(193, 223, 255, 0.74)';
    ctx.lineWidth = 1.4;
    ctx.shadowColor = 'rgba(126, 177, 255, 0.32)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(89, 149, 255, 0.08)';
    if (lens.polygon.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(lens.polygon[0].x, lens.polygon[0].y);
      for (let index = 1; index < lens.polygon.length; index += 1) {
        ctx.lineTo(lens.polygon[index].x, lens.polygon[index].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lens.cx, lens.cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(216, 235, 255, 0.9)';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(lens.cx, lens.cy, lens.rx, lens.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  return {
    root,
    update,
    destroy() {
      root.remove();
    },
  };
}
