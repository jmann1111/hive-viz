// Graph scene renderer - edges + nodes in Three.js
// Single LineSegments for edges, Points for nodes
// Selection highlighting via buffer attribute updates

import * as THREE from 'three';

// Folder color map - each domain gets a signature hue
const FOLDER_COLORS = {
  '10-Sessions':     new THREE.Color(0x2299aa),
  '20-Architecture': new THREE.Color(0x3377cc),
  '30-Projects':     new THREE.Color(0x7744bb),
  '39-Archive':      new THREE.Color(0x554477),
  '40-Decisions':    new THREE.Color(0x5533aa),
  '50-Playbooks':    new THREE.Color(0x22aacc),
  '60-Knowledge':    new THREE.Color(0xaa8833),
  '70-Ops':          new THREE.Color(0x33aa66),
  '80-Secure':       new THREE.Color(0x993355),
  '01-Daily':        new THREE.Color(0x7788aa),
  '00-Inbox':        new THREE.Color(0x667788),
  '99-Templates':    new THREE.Color(0x556666),
};
const DEFAULT_FOLDER_COLOR = new THREE.Color(0x5577aa);
const EDGE_SELECTED = new THREE.Color(0x44ccee);
const NODE_SELECTED = new THREE.Color(0x55ccee);
const NODE_COLOR = new THREE.Color(0x6088aa); // fallback

function getFolderColor(folder) {
  return FOLDER_COLORS[folder] || DEFAULT_FOLDER_COLOR;
}

export function buildEdges(scene, tesseract) {
  const edgeData = tesseract.getEdgesWithPositions();
  const vertexCount = edgeData.length * 2;

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const alphas = new Float32Array(vertexCount);
  // Store default colors/alphas for reset
  const defaultColors = new Float32Array(vertexCount * 3);
  const defaultAlphas = new Float32Array(vertexCount);

  // Find max weight for normalization
  let maxWeight = 1;
  for (const e of edgeData) {
    if (e.weight > maxWeight) maxWeight = e.weight;
  }

  // Build edge index: nodeId -> [edgeIndices] for fast selection
  const edgeIndex = new Map(); // nodeId -> Set of vertex pair indices

  for (let i = 0; i < edgeData.length; i++) {
    const e = edgeData[i];
    const vi = i * 2;

    positions[vi * 3] = e.sourcePos.x;
    positions[vi * 3 + 1] = e.sourcePos.y;
    positions[vi * 3 + 2] = e.sourcePos.z;
    positions[(vi + 1) * 3] = e.targetPos.x;
    positions[(vi + 1) * 3 + 1] = e.targetPos.y;
    positions[(vi + 1) * 3 + 2] = e.targetPos.z;

    // Color: blend the folder colors of source and target nodes
    const srcColor = getFolderColor(e.sourceFolder);
    const tgtColor = getFolderColor(e.targetFolder);
    const c = new THREE.Color().lerpColors(srcColor, tgtColor, 0.5);
    // Brightness from weight
    const t = Math.log(1 + e.weight) / Math.log(1 + maxWeight);
    c.multiplyScalar(0.5 + t * 0.3); // 50-80% brightness
    const alpha = 0.45 + t * 0.2;

    colors[vi * 3] = c.r; colors[vi * 3 + 1] = c.g; colors[vi * 3 + 2] = c.b;
    colors[(vi + 1) * 3] = c.r; colors[(vi + 1) * 3 + 1] = c.g; colors[(vi + 1) * 3 + 2] = c.b;
    alphas[vi] = alpha;
    alphas[vi + 1] = alpha;

    // Copy defaults
    defaultColors[vi * 3] = c.r; defaultColors[vi * 3 + 1] = c.g; defaultColors[vi * 3 + 2] = c.b;
    defaultColors[(vi + 1) * 3] = c.r; defaultColors[(vi + 1) * 3 + 1] = c.g; defaultColors[(vi + 1) * 3 + 2] = c.b;
    defaultAlphas[vi] = alpha;
    defaultAlphas[vi + 1] = alpha;

    // Edge index for selection
    for (const nodeId of [e.source, e.target]) {
      if (!edgeIndex.has(nodeId)) edgeIndex.set(nodeId, new Set());
      edgeIndex.get(nodeId).add(i);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  const alphaAttr = new THREE.BufferAttribute(alphas, 1);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colorAttr);
  geometry.setAttribute('alpha', alphaAttr);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
    },
    vertexShader: `
      attribute float alpha;
      attribute vec3 color;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vDist;
      void main() {
        vAlpha = alpha;
        vColor = color;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vDist = length(position) * 0.002; // for flow pattern
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vDist;
      void main() {
        // Subtle flowing dash pattern
        float flow = sin(vDist * 8.0 - uTime * 1.5) * 0.5 + 0.5;
        float shimmer = 0.85 + 0.15 * flow;
        gl_FragColor = vec4(vColor * shimmer, vAlpha * shimmer);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.LineSegments(geometry, material);
  scene.add(mesh);

  return {
    mesh,
    material,
    posAttr,
    colorAttr,
    alphaAttr,
    defaultColors,
    defaultAlphas,
    edgeIndex,
    edgeData,
    vertexCount,
  };
}

export function buildNodes(scene, tesseract) {
  const nodes = tesseract.nodes;
  const positions = new Float32Array(nodes.length * 3);
  const colors = new Float32Array(nodes.length * 3);
  const sizes = new Float32Array(nodes.length);
  const defaultSizes = new Float32Array(nodes.length);
  const defaultColors = new Float32Array(nodes.length * 3);
  const nodeIdByIndex = new Map();
  const indexByNodeId = new Map();

  let maxLinks = 1;
  for (const n of nodes) {
    if ((n.linkCount || 0) > maxLinks) maxLinks = n.linkCount;
  }

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    positions[i * 3] = n.x;
    positions[i * 3 + 1] = n.y;
    positions[i * 3 + 2] = n.z;

    const t = Math.log(1 + (n.linkCount || 0)) / Math.log(1 + maxLinks);
    const folderC = getFolderColor(n.folder);
    const c = folderC.clone().multiplyScalar(0.5 + t * 0.5); // 50-100% of folder color
    // Recency glow: nodes created in last 30 days get a white shift
    if (n.created) {
      const age = (Date.now() - new Date(n.created).getTime()) / (1000 * 60 * 60 * 24);
      if (age < 30) {
        const recency = 1 - age / 30; // 1.0 = today, 0 = 30 days ago
        c.lerp(new THREE.Color(0xffffff), recency * 0.25); // up to 25% white shift
      }
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    defaultColors[i * 3] = c.r;
    defaultColors[i * 3 + 1] = c.g;
    defaultColors[i * 3 + 2] = c.b;

    const size = 2 + t * 10;
    sizes[i] = size;
    defaultSizes[i] = size;

    nodeIdByIndex.set(i, n.id);
    indexByNodeId.set(n.id, i);
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  const sizeAttr = new THREE.BufferAttribute(sizes, 1);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colorAttr);
  geometry.setAttribute('size', sizeAttr);

  const material = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (600.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 40.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        // Soft circle
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float a = 1.0 - smoothstep(0.3, 0.5, d);
        gl_FragColor = vec4(vColor, a * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Points(geometry, material);
  scene.add(mesh);

  return {
    mesh,
    posAttr,
    colorAttr,
    sizeAttr,
    defaultSizes,
    defaultColors,
    nodeIdByIndex,
    indexByNodeId,
    nodeCount: nodes.length,
  };
}

// ============ SKYBOX: Stars + Nebula + Dust ============
export function buildSkybox(scene) {
  // === Background Stars + Galaxy Band ===
  const STAR_COUNT = 6000;
  const BAND_EXTRA = 3000;
  const TOTAL_STARS = STAR_COUNT + BAND_EXTRA;
  const starPositions = new Float32Array(TOTAL_STARS * 3);
  const starColors = new Float32Array(TOTAL_STARS * 3);
  const starSizes = new Float32Array(TOTAL_STARS);
  const starPhases = new Float32Array(TOTAL_STARS); // for twinkle

  const starPalette = [
    new THREE.Color(0xddeeff),  // cool white
    new THREE.Color(0xbbccee),  // blue-white
    new THREE.Color(0x99aadd),  // soft blue
    new THREE.Color(0xaabbcc),  // steel blue
    new THREE.Color(0xccddee),  // pale blue
  ];

  for (let i = 0; i < TOTAL_STARS; i++) {
    const isBand = i >= STAR_COUNT;
    const r = 12000 + Math.random() * 6000;
    if (isBand) {
      // Galaxy band: concentrated near the XZ plane (Y gaussian)
      const theta = Math.random() * Math.PI * 2;
      const bandY = (Math.random() + Math.random() + Math.random() - 1.5) * 1500; // gaussian-ish, narrow
      const bandR = 10000 + Math.random() * 8000;
      starPositions[i * 3] = bandR * Math.cos(theta);
      starPositions[i * 3 + 1] = bandY;
      starPositions[i * 3 + 2] = bandR * Math.sin(theta);
    } else {
      // Regular: uniform sphere shell
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }

    const c = starPalette[Math.floor(Math.random() * starPalette.length)];
    starColors[i * 3] = c.r;
    starColors[i * 3 + 1] = c.g;
    starColors[i * 3 + 2] = c.b;

    starSizes[i] = isBand ? (0.3 + Math.random() * 1.5) : (0.5 + Math.random() * 2.5);
    starPhases[i] = Math.random() * 100; // random twinkle phase
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
  starGeo.setAttribute('phase', new THREE.BufferAttribute(starPhases, 1));

  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: `
      uniform float uTime;
      attribute float size;
      attribute float phase;
      attribute vec3 color;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = color;
        // Each star twinkles at its own speed
        vTwinkle = 0.7 + 0.3 * sin(uTime * (0.5 + phase * 0.03) + phase);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (200.0 / -mvPos.z);
        gl_PointSize = clamp(gl_PointSize, 0.5, 4.0);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float a = 1.0 - smoothstep(0.0, 0.5, d);
        gl_FragColor = vec4(vColor * vTwinkle, a * 0.8);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  scene.add(new THREE.Points(starGeo, starMat));

  // === Nebula Clouds (procedural sprite planes) ===
  // Nebula clouds - colors echo folder palette at very low opacity
  const nebulaConfigs = [
    { pos: [3000, 1500, -5000], size: 6000, color: 0x112244, opacity: 0.035, rotation: 0.3 },   // blue (architecture)
    { pos: [-4000, -2000, -3000], size: 5000, color: 0x0a1a2a, opacity: 0.04, rotation: -0.2 },  // deep teal (sessions)
    { pos: [1000, -3000, 4000], size: 7000, color: 0x1a1508, opacity: 0.025, rotation: 0.5 },    // warm gold hint (knowledge)
    { pos: [-2000, 4000, 2000], size: 4000, color: 0x150a22, opacity: 0.04, rotation: -0.4 },    // purple (projects)
    { pos: [5000, 0, 1000], size: 5500, color: 0x081a10, opacity: 0.03, rotation: 0.1 },         // green hint (ops)
    { pos: [-3000, 0, -4000], size: 4000, color: 0x180a18, opacity: 0.03, rotation: 0.7 },       // magenta (secure)
    { pos: [2000, 3000, -2000], size: 3000, color: 0x0a1520, opacity: 0.04, rotation: -0.6 },    // cyan (playbooks)
    { pos: [-1000, -4000, -1000], size: 5000, color: 0x0f0f22, opacity: 0.03, rotation: 0.4 },   // indigo (decisions)
  ];

  // Create a procedural nebula texture (radial gradient)
  const nebulaCanvas = document.createElement('canvas');
  nebulaCanvas.width = 256;
  nebulaCanvas.height = 256;
  const ctx = nebulaCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const nebulaTexture = new THREE.CanvasTexture(nebulaCanvas);

  for (const nc of nebulaConfigs) {
    const geo = new THREE.PlaneGeometry(nc.size, nc.size);
    const mat = new THREE.MeshBasicMaterial({
      map: nebulaTexture,
      color: nc.color,
      transparent: true,
      opacity: nc.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...nc.pos);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, nc.rotation);
    // Billboard-ish: face roughly toward center
    mesh.lookAt(0, 0, 0);
    mesh.rotateZ(nc.rotation);
    scene.add(mesh);
  }

  // === Dust Particles (drifting for parallax) ===
  const DUST_COUNT = 1500;
  const dustPositions = new Float32Array(DUST_COUNT * 3);
  const dustVelocities = new Float32Array(DUST_COUNT * 3);

  for (let i = 0; i < DUST_COUNT; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 10000;
    dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 10000;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 10000;
    dustVelocities[i * 3] = (Math.random() - 0.5) * 0.15;
    dustVelocities[i * 3 + 1] = (Math.random() - 0.5) * 0.1;
    dustVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
  }

  const dustGeo = new THREE.BufferGeometry();
  const dustPosAttr = new THREE.BufferAttribute(dustPositions, 3);
  dustGeo.setAttribute('position', dustPosAttr);

  const dustMat = new THREE.PointsMaterial({
    color: 0x334466,
    size: 2,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const dustMesh = new THREE.Points(dustGeo, dustMat);
  scene.add(dustMesh);

  // Store for animation
  dustMesh.userData.velocities = dustVelocities;
  dustMesh.userData.posAttr = dustPosAttr;

  return { dustMesh, starMat };
}

// Update positions from simulation (call each frame when sim is active)
export function syncPositions(tesseract, edgeHandle, nodeHandle) {
  const nodes = tesseract.nodes;

  // Update node positions
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    nodeHandle.posAttr.array[i * 3] = n.x;
    nodeHandle.posAttr.array[i * 3 + 1] = n.y;
    nodeHandle.posAttr.array[i * 3 + 2] = n.z;
  }
  nodeHandle.posAttr.needsUpdate = true;

  // Update edge positions
  for (let i = 0; i < edgeHandle.edgeData.length; i++) {
    const e = edgeHandle.edgeData[i];
    const s = tesseract.nodeIndex.get(e.source);
    const t = tesseract.nodeIndex.get(e.target);
    if (!s || !t) continue;
    const vi = i * 2;
    edgeHandle.posAttr.array[vi * 3] = s.x;
    edgeHandle.posAttr.array[vi * 3 + 1] = s.y;
    edgeHandle.posAttr.array[vi * 3 + 2] = s.z;
    edgeHandle.posAttr.array[(vi + 1) * 3] = t.x;
    edgeHandle.posAttr.array[(vi + 1) * 3 + 1] = t.y;
    edgeHandle.posAttr.array[(vi + 1) * 3 + 2] = t.z;
  }
  edgeHandle.posAttr.needsUpdate = true;
}

// Highlight edges connected to a node - keep galaxy visible, brighten selection
export function highlightSelection(edgeHandle, nodeHandle, nodeId, tesseract) {
  const connectedEdges = edgeHandle.edgeIndex.get(nodeId);
  if (!connectedEdges) return;

  const neighbors = new Set(tesseract.adjacency.get(nodeId) || []);

  // Slightly dim unselected edges (70% of default) so selection pops
  for (let i = 0; i < edgeHandle.vertexCount; i++) {
    edgeHandle.colorAttr.array[i * 3] = edgeHandle.defaultColors[i * 3] * 0.7;
    edgeHandle.colorAttr.array[i * 3 + 1] = edgeHandle.defaultColors[i * 3 + 1] * 0.7;
    edgeHandle.colorAttr.array[i * 3 + 2] = edgeHandle.defaultColors[i * 3 + 2] * 0.7;
    edgeHandle.alphaAttr.array[i] = edgeHandle.defaultAlphas[i] * 0.7;
  }

  // Brighten selected edges: amplify their own base color + white shift
  for (const ei of connectedEdges) {
    const vi = ei * 2;
    edgeHandle.alphaAttr.array[vi] = 0.85;
    edgeHandle.alphaAttr.array[vi + 1] = 0.85;
    // Take default color and brighten it (add 40% white)
    for (let v = vi; v <= vi + 1; v++) {
      edgeHandle.colorAttr.array[v * 3] = Math.min(1, edgeHandle.defaultColors[v * 3] * 1.8 + 0.2);
      edgeHandle.colorAttr.array[v * 3 + 1] = Math.min(1, edgeHandle.defaultColors[v * 3 + 1] * 1.8 + 0.2);
      edgeHandle.colorAttr.array[v * 3 + 2] = Math.min(1, edgeHandle.defaultColors[v * 3 + 2] * 1.8 + 0.2);
    }
  }

  edgeHandle.alphaAttr.needsUpdate = true;
  edgeHandle.colorAttr.needsUpdate = true;

  // Boost selected + neighbors using their own base colors
  for (let i = 0; i < nodeHandle.nodeCount; i++) {
    const nid = nodeHandle.nodeIdByIndex.get(i);
    if (nid === nodeId) {
      // Selected: amplify own color + white shift
      nodeHandle.colorAttr.array[i * 3] = Math.min(1, nodeHandle.defaultColors[i * 3] * 2.0 + 0.3);
      nodeHandle.colorAttr.array[i * 3 + 1] = Math.min(1, nodeHandle.defaultColors[i * 3 + 1] * 2.0 + 0.3);
      nodeHandle.colorAttr.array[i * 3 + 2] = Math.min(1, nodeHandle.defaultColors[i * 3 + 2] * 2.0 + 0.3);
      nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i] * 2.5;
    } else if (neighbors.has(nid)) {
      // Neighbors: brighten own color
      nodeHandle.colorAttr.array[i * 3] = Math.min(1, nodeHandle.defaultColors[i * 3] * 1.6 + 0.1);
      nodeHandle.colorAttr.array[i * 3 + 1] = Math.min(1, nodeHandle.defaultColors[i * 3 + 1] * 1.6 + 0.1);
      nodeHandle.colorAttr.array[i * 3 + 2] = Math.min(1, nodeHandle.defaultColors[i * 3 + 2] * 1.6 + 0.1);
      nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i] * 1.5;
    } else {
      // Restore default
      nodeHandle.colorAttr.array[i * 3] = nodeHandle.defaultColors[i * 3];
      nodeHandle.colorAttr.array[i * 3 + 1] = nodeHandle.defaultColors[i * 3 + 1];
      nodeHandle.colorAttr.array[i * 3 + 2] = nodeHandle.defaultColors[i * 3 + 2];
      nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i];
    }
  }
  nodeHandle.colorAttr.needsUpdate = true;
  nodeHandle.sizeAttr.needsUpdate = true;
}

// Clear selection, restore defaults
export function clearSelection(edgeHandle, nodeHandle) {
  edgeHandle.colorAttr.array.set(edgeHandle.defaultColors);
  edgeHandle.alphaAttr.array.set(edgeHandle.defaultAlphas);
  edgeHandle.colorAttr.needsUpdate = true;
  edgeHandle.alphaAttr.needsUpdate = true;

  nodeHandle.sizeAttr.array.set(nodeHandle.defaultSizes);
  nodeHandle.colorAttr.array.set(nodeHandle.defaultColors);
  nodeHandle.sizeAttr.needsUpdate = true;
  nodeHandle.colorAttr.needsUpdate = true;
}

// Selection pulse: amplifies base colors, not flat override
export function updateSelectionPulse(elapsed, edgeHandle, nodeHandle, nodeId, tesseract) {
  if (!nodeId) return;
  const connectedEdges = edgeHandle.edgeIndex.get(nodeId);
  if (!connectedEdges) return;
  const neighbors = new Set(tesseract.adjacency.get(nodeId) || []);

  // Pulse wave
  const wave = Math.sin(elapsed * 2.5);
  const brightness = 1.5 + 0.5 * wave; // oscillates 1.0 to 2.0
  const edgeAlpha = 0.6 + 0.25 * wave;

  // Pulse selected edges: amplify their base color
  for (const ei of connectedEdges) {
    const vi = ei * 2;
    edgeHandle.alphaAttr.array[vi] = edgeAlpha;
    edgeHandle.alphaAttr.array[vi + 1] = edgeAlpha;
    for (let v = vi; v <= vi + 1; v++) {
      edgeHandle.colorAttr.array[v * 3] = Math.min(1, edgeHandle.defaultColors[v * 3] * brightness + 0.15);
      edgeHandle.colorAttr.array[v * 3 + 1] = Math.min(1, edgeHandle.defaultColors[v * 3 + 1] * brightness + 0.15);
      edgeHandle.colorAttr.array[v * 3 + 2] = Math.min(1, edgeHandle.defaultColors[v * 3 + 2] * brightness + 0.15);
    }
  }
  edgeHandle.alphaAttr.needsUpdate = true;
  edgeHandle.colorAttr.needsUpdate = true;

  // Pulse nodes: amplify their own base color
  const nodeBright = 1.6 + 0.6 * wave;
  for (let i = 0; i < nodeHandle.nodeCount; i++) {
    const nid = nodeHandle.nodeIdByIndex.get(i);
    if (nid === nodeId) {
      nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i] * (2.0 + 0.5 * wave);
      nodeHandle.colorAttr.array[i * 3] = Math.min(1, nodeHandle.defaultColors[i * 3] * nodeBright + 0.25);
      nodeHandle.colorAttr.array[i * 3 + 1] = Math.min(1, nodeHandle.defaultColors[i * 3 + 1] * nodeBright + 0.25);
      nodeHandle.colorAttr.array[i * 3 + 2] = Math.min(1, nodeHandle.defaultColors[i * 3 + 2] * nodeBright + 0.25);
    } else if (neighbors.has(nid)) {
      const phase = i * 0.3;
      const nBright = 1.3 + 0.3 * Math.sin(elapsed * 2.0 + phase);
      nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i] * (1.3 + 0.2 * Math.sin(elapsed * 2.0 + phase));
      nodeHandle.colorAttr.array[i * 3] = Math.min(1, nodeHandle.defaultColors[i * 3] * nBright + 0.08);
      nodeHandle.colorAttr.array[i * 3 + 1] = Math.min(1, nodeHandle.defaultColors[i * 3 + 1] * nBright + 0.08);
      nodeHandle.colorAttr.array[i * 3 + 2] = Math.min(1, nodeHandle.defaultColors[i * 3 + 2] * nBright + 0.08);
    }
  }
  nodeHandle.sizeAttr.needsUpdate = true;
  nodeHandle.colorAttr.needsUpdate = true;
}

// Highlight search matches in 3D (amplify matching nodes' own colors)
export function highlightSearchResults(nodeHandle, matchingIds) {
  if (!matchingIds || matchingIds.size === 0) {
    // Restore defaults
    nodeHandle.sizeAttr.array.set(nodeHandle.defaultSizes);
    nodeHandle.colorAttr.array.set(nodeHandle.defaultColors);
  } else {
    for (let i = 0; i < nodeHandle.nodeCount; i++) {
      const nid = nodeHandle.nodeIdByIndex.get(i);
      if (matchingIds.has(nid)) {
        nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i] * 2.5;
        // Amplify own color
        nodeHandle.colorAttr.array[i * 3] = Math.min(1, nodeHandle.defaultColors[i * 3] * 2.2 + 0.3);
        nodeHandle.colorAttr.array[i * 3 + 1] = Math.min(1, nodeHandle.defaultColors[i * 3 + 1] * 2.2 + 0.3);
        nodeHandle.colorAttr.array[i * 3 + 2] = Math.min(1, nodeHandle.defaultColors[i * 3 + 2] * 2.2 + 0.3);
      } else {
        nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i];
        nodeHandle.colorAttr.array[i * 3] = nodeHandle.defaultColors[i * 3];
        nodeHandle.colorAttr.array[i * 3 + 1] = nodeHandle.defaultColors[i * 3 + 1];
        nodeHandle.colorAttr.array[i * 3 + 2] = nodeHandle.defaultColors[i * 3 + 2];
      }
    }
  }
  nodeHandle.sizeAttr.needsUpdate = true;
  nodeHandle.colorAttr.needsUpdate = true;
}
