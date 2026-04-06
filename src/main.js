import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Tesseract } from './core/tesseract.js';
import { buildEdges, buildNodes, buildSkybox, highlightSelection, clearSelection, highlightSearchResults, syncPositions } from './core/graph-scene.js';
import { createSidebar } from './core/sidebar.js';
import { initReader, openReader, closeReader, isReaderOpen } from './core/reader.js';

// ============ RENDERER ============
const appEl = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(window.devicePixelRatio);
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020208);
scene.fog = new THREE.FogExp2(0x020208, 0.00005);

const camera = new THREE.PerspectiveCamera(60, 1, 1, 30000);
camera.position.set(200, 100, 300); // Start INSIDE the galaxy

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 1.2;
controls.minDistance = 30;
controls.maxDistance = 800; // Never escape the galaxy

// ============ ZOOM ============
let zoomLevel = 0.6;

// ============ STATE ============
let tesseract = null;
let edgeHandle = null;
let nodeHandle = null;
let skyboxRef = null;
let sidebarApi = null;
let selectedNode = null;
let lastNavTimestamp = 0;
let onSelectCallbacks = [];
const clock = new THREE.Clock();

// ============ SMOOTH CAMERA ============
let cameraGoal = null;
let cameraTarget = null;
const BASE_FOV = 60;
const SMOOTH_FACTOR = 0.045;


function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0) / 4294967295;
}

function flyToNode(nodeId, options = {}) {
  const node = tesseract.getNode(nodeId);
  if (!node) return;

  const target = new THREE.Vector3(node.x, node.y, node.z);
  const approachDist = 40 + zoomLevel * 960;
  const deterministic = options.deterministic !== false;

  // Position camera outside the node, biased away from center
  const fromCenter = target.clone();
  if (fromCenter.length() < 1) fromCenter.set(1, 0, 0);
  fromCenter.normalize();

  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(fromCenter.dot(up)) > 0.95) up.set(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(fromCenter, up).normalize();
  const realUp = new THREE.Vector3().crossVectors(right, fromCenter).normalize();

  const tiltSeed = deterministic ? hashString(`${nodeId}:tilt`) : Math.random();
  const spinSeed = deterministic ? hashString(`${nodeId}:spin`) : Math.random();
  const tiltAngle = (14 + tiltSeed * 16) * Math.PI / 180;
  const spinAngle = spinSeed * Math.PI * 2;
  const offsetDir = new THREE.Vector3()
    .addScaledVector(fromCenter, Math.cos(tiltAngle))
    .addScaledVector(right, Math.sin(tiltAngle) * Math.cos(spinAngle))
    .addScaledVector(realUp, Math.sin(tiltAngle) * Math.sin(spinAngle))
    .normalize();

  cameraGoal = target.clone().add(offsetDir.multiplyScalar(approachDist));
  cameraTarget = target;
}

let userDragging = false;

function updateCamera() {
  if (!cameraGoal || !cameraTarget) return;
  // Don't fight with user's manual orbit
  if (userDragging) {
    cameraGoal = null;
    cameraTarget = null;
    return;
  }

  camera.position.lerp(cameraGoal, SMOOTH_FACTOR);
  // Don't move the orbit target away from center during auto-rotate
  if (!autoRotateOn) {
    controls.target.lerp(cameraTarget, SMOOTH_FACTOR);
  }

  if (camera.position.distanceTo(cameraGoal) < 0.5) {
    cameraGoal = null;
    cameraTarget = null;
  }
}

function updateSize() {
  // Re-read DPR every resize -- handles dragging between monitors
  const dpr = window.devicePixelRatio;
  renderer.setPixelRatio(dpr);

  const w = appEl.clientWidth;
  const h = appEl.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);

  // Update shader uniforms so point sizes match the new DPR
  if (nodeHandle?.material?.uniforms?.uPixelRatio) nodeHandle.material.uniforms.uPixelRatio.value = dpr;
  if (skyboxRef?.starMat?.uniforms?.uPixelRatio) skyboxRef.starMat.uniforms.uPixelRatio.value = dpr;
}



// ============ SELECTED NODE TITLE (floats above node in 3D) ============
const selectedTitle = document.createElement('div');
selectedTitle.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:14;font-size:11px;color:rgba(180,180,180,0.7);letter-spacing:0.3px;white-space:nowrap;text-align:center;transform:translate(-50%,-100%);';
document.body.appendChild(selectedTitle);

function updateSelectedTitle() {
  if (!selectedNode || !tesseract) {
    selectedTitle.style.display = 'none';
    return;
  }
  const node = tesseract.getNode(selectedNode);
  if (!node) { selectedTitle.style.display = 'none'; return; }

  // Project node position to screen, offset upward
  const pos = new THREE.Vector3(node.x, node.y, node.z);
  pos.project(camera);
  if (pos.z > 1) { selectedTitle.style.display = 'none'; return; }

  const rect = renderer.domElement.getBoundingClientRect();
  const x = (pos.x * 0.5 + 0.5) * rect.width + rect.left;
  const y = (-pos.y * 0.5 + 0.5) * rect.height + rect.top - 20; // 20px above node

  selectedTitle.style.left = x + 'px';
  selectedTitle.style.top = y + 'px';
  selectedTitle.textContent = (node.title || node.id) + (node.linkCount ? `  \u00b7  ${node.linkCount}` : '');
  selectedTitle.style.display = 'block';
}

// ============ AUTO-ROTATION ============
let autoRotateOn = false;
let autoRotateSpeed = 0.3; // 0-1
let lastInteraction = performance.now();
const IDLE_TIMEOUT = 5000;

function resetIdleTimer() {
  lastInteraction = performance.now();
}



function syncAutoRotate() {
  controls.autoRotate = autoRotateOn;
  controls.autoRotateSpeed = 0.1 + autoRotateSpeed * 2.5; // maps 0-1 to 0.1-2.6
  // Always rotate around the true center, not a selected node
  if (autoRotateOn) {
    controls.target.set(0, 0, 0);
  }
}

// ============ LIGHTSHOW ============
let lightMode = 0; // 0 = off
let lightSpeed = 1.0;
let lightIntensity = 1.0;

const LIGHTSHOW_PRESETS = {
  off: { label: 'Off', mode: 0 },
  spectrum: { label: 'Spectrum Wave', mode: 1 },
  starlight: { label: 'Starlight', mode: 4 },
  aurora: { label: 'Aurora Borealis', mode: 6 },
  matrix: { label: 'Matrix', mode: 7 },
  heartbeat: { label: 'Heartbeat', mode: 8 },
  ocean: { label: 'Ocean', mode: 9 },
  lightning: { label: 'Lightning', mode: 10 },
  lava: { label: 'Lava', mode: 11 },
  frozen: { label: 'Frozen', mode: 12 },
  reactive: { label: 'Reactive Pulse', mode: 13 },
  strobe: { label: 'Strobe', mode: 14 },
  comet: { label: 'Comet', mode: 15 },
  plasma: { label: 'Plasma', mode: 16 },
  fireflies: { label: 'Fireflies', mode: 17 },
  electricity: { label: 'Electricity', mode: 18 },
};

function syncLightshow() {
  if (nodeHandle?.material?.uniforms) {
    nodeHandle.material.uniforms.uLightMode.value = lightMode;
    nodeHandle.material.uniforms.uLightSpeed.value = lightSpeed;
    nodeHandle.material.uniforms.uLightIntensity.value = lightIntensity;
  }
  if (edgeHandle?.material?.uniforms) {
    edgeHandle.material.uniforms.uLightMode.value = lightMode;
    edgeHandle.material.uniforms.uLightSpeed.value = lightSpeed;
    edgeHandle.material.uniforms.uLightIntensity.value = lightIntensity;
  }
}

// ============ BREADCRUMB TRAIL ============
const breadcrumbHistory = []; // last 10 node IDs
let breadcrumbLine = null;

function updateBreadcrumbs() {
  if (breadcrumbHistory.length < 2) return;

  const positions = [];
  for (const nid of breadcrumbHistory) {
    const n = tesseract.getNode(nid);
    if (n) positions.push(n.x, n.y, n.z);
  }

  if (breadcrumbLine) {
    scene.remove(breadcrumbLine);
    breadcrumbLine.geometry.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  // Fade: oldest = dim, newest = bright
  const colors = [];
  const count = positions.length / 3;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    colors.push(0.2 + t * 0.15, 0.35 + t * 0.25, 0.5 + t * 0.3);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  breadcrumbLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.3,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(breadcrumbLine);
}

// ============ SELECTION ============
function selectNode(nodeId, options = {}) {
  const { deterministicFocus = true, forceFocus = false } = options;
  const wasSameNode = nodeId === selectedNode;
  selectedNode = nodeId;
  if (nodeId && edgeHandle && nodeHandle) {
    highlightSelection(edgeHandle, nodeHandle, nodeId, tesseract);
    if (!wasSameNode || forceFocus) {
      flyToNode(nodeId, { deterministic: deterministicFocus });
    }
    // Breadcrumb
    if (!breadcrumbHistory.includes(nodeId)) {
      breadcrumbHistory.push(nodeId);
      if (breadcrumbHistory.length > 10) breadcrumbHistory.shift();
      updateBreadcrumbs();
    }
  } else {
    clearSelection(edgeHandle, nodeHandle);
  }
  for (const cb of onSelectCallbacks) cb(nodeId);
}

function deselectNode() {
  selectedNode = null;
  selectedTitle.style.display = 'none';
  if (edgeHandle && nodeHandle) clearSelection(edgeHandle, nodeHandle);
  for (const cb of onSelectCallbacks) cb(null);
}

function openInlineNode(nodeId, options = {}) {
  if (!nodeId) return;
  selectNode(nodeId, {
    deterministicFocus: options.deterministicFocus !== false,
    forceFocus: Boolean(options.forceFocus),
  });
  sidebarApi?.openInlineReader(nodeId);
}


// ============ CLICK DETECTION ============
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 20;
const mouse = new THREE.Vector2();
let mouseDownPos = null;

function hitTestNode(clientX, clientY) {
  if (!nodeHandle) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(nodeHandle.mesh);
  if (intersects.length > 0) {
    return nodeHandle.nodeIdByIndex.get(intersects[0].index) || null;
  }
  return null;
}

let lastClickTime = 0;
let lastClickNode = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  mouseDownPos = { x: e.clientX, y: e.clientY };
  userDragging = true;
});

renderer.domElement.addEventListener('pointerup', (e) => {
  userDragging = false;
  if (!mouseDownPos) return;
  const dx = e.clientX - mouseDownPos.x;
  const dy = e.clientY - mouseDownPos.y;
  mouseDownPos = null;
  if (Math.abs(dx) + Math.abs(dy) > 5) return;

  const nodeId = hitTestNode(e.clientX, e.clientY);
  const now = performance.now();

  if (nodeId) {
    // Double-click: open inline reader
    if (nodeId === lastClickNode && now - lastClickTime < 400) {
      openInlineNode(nodeId, { deterministicFocus: true, forceFocus: true });
      lastClickNode = null;
    } else {
      selectNode(nodeId);
      lastClickNode = nodeId;
    }
    lastClickTime = now;
  } else {
    deselectNode();
    lastClickNode = null;
  }
});


// ============ NAV POLLING ============
async function pollNavCommand() {
  try {
    const res = await fetch('/nav-command.json?t=' + Date.now());
    if (!res.ok) return;
    const cmd = await res.json();
    if (cmd.timestamp && cmd.timestamp !== lastNavTimestamp && cmd.target) {
      lastNavTimestamp = cmd.timestamp;
      const hits = tesseract.search(cmd.target);
      if (hits.length > 0) selectNode(hits[0].id);
    }
  } catch (e) { /* nav-command.json may not exist */ }
}

// ============ SIDEBAR TOGGLE (Shift+Tab) ============
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  setTimeout(updateSize, 260);
}

// ============ LAYOUT PRESETS ============
const LAYOUT_PRESETS = {
  galaxy: { label: 'Galaxy', fn: layoutGalaxy },
  sphere: { label: 'Sphere', fn: layoutSphere },
  ring: { label: 'Halo Ring', fn: layoutRing },
  pyramid: { label: 'Pyramid', fn: layoutPyramid },
  grid: { label: 'Grid Cube', fn: layoutGrid },
  spiral: { label: 'Spiral Tower', fn: layoutSpiral },
  torus_knot: { label: 'Torus Knot', fn: layoutTorusKnot },
  vesica: { label: 'Vesica Piscis', fn: layoutVesica },
  icosahedron: { label: 'Icosahedron', fn: layoutIcosahedron },
  mobius: { label: 'Mobius Strip', fn: layoutMobius },
  infinity: { label: 'Infinity', fn: layoutInfinity },
  wave: { label: 'Wave', fn: layoutWave },
  shell: { label: 'Nautilus', fn: layoutShell },
  constellation: { label: 'Constellation', fn: layoutConstellation },
  atom: { label: 'Atom', fn: layoutAtom },
  tornado: { label: 'Tornado', fn: layoutTornado },
  hourglass: { label: 'Hourglass', fn: layoutHourglass },
  crown: { label: 'Crown', fn: layoutCrown },
  heart: { label: 'Heart', fn: layoutHeart },
};

let layoutTransition = null; // { from, to, t, duration }

function sortedNodeIndices(tesseract) {
  // Sort by folder then link count for visual clustering
  const nodes = tesseract.nodes;
  const indices = Array.from({ length: nodes.length }, (_, i) => i);
  indices.sort((a, b) => {
    const fa = nodes[a].folder || '';
    const fb = nodes[b].folder || '';
    if (fa !== fb) return fa.localeCompare(fb);
    return (nodes[b].linkCount || 0) - (nodes[a].linkCount || 0);
  });
  return indices;
}

function layoutGalaxy(tesseract) {
  // Restore original d3-force positions
  return tesseract.nodes.map(n => ({ x: n._origX, y: n._origY, z: n._origZ }));
}


function layoutSphere(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const radius = 250;
  // Fibonacci sphere for even distribution
  const phi = (1 + Math.sqrt(5)) / 2;
  for (let rank = 0; rank < n; rank++) {
    const y = 1 - (2 * rank) / (n - 1);
    const r = Math.sqrt(1 - y * y);
    const theta = 2 * Math.PI * rank / phi;
    // Hub nodes (high link count) get slightly larger radius
    const linkBoost = 1 + (tesseract.nodes[sorted[rank]].linkCount || 0) * 0.002;
    positions[sorted[rank]] = {
      x: Math.cos(theta) * r * radius * linkBoost,
      y: y * radius * linkBoost,
      z: Math.sin(theta) * r * radius * linkBoost,
    };
  }
  return positions;
}

function layoutRing(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const radius = 300;
  const tubeRadius = 30;
  for (let rank = 0; rank < n; rank++) {
    const t = rank / n;
    const angle = t * Math.PI * 2;
    // Torus: main circle + tube offset
    const tubeAngle = (rank * 7.3) % (Math.PI * 2); // spread around tube
    const r = radius + Math.cos(tubeAngle) * tubeRadius;
    positions[sorted[rank]] = {
      x: Math.cos(angle) * r,
      y: Math.sin(tubeAngle) * tubeRadius,
      z: Math.sin(angle) * r,
    };
  }
  return positions;
}

function layoutPyramid(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const S = 300; // half-width of base
  const H = 500; // height
  const apex = { x: 0, y: H * 0.5, z: 0 };
  const base = [
    { x: -S, y: -H * 0.5, z: -S },
    { x:  S, y: -H * 0.5, z: -S },
    { x:  S, y: -H * 0.5, z:  S },
    { x: -S, y: -H * 0.5, z:  S },
  ];
  // 8 edges: 4 base + 4 lateral
  const edges = [
    [base[0], base[1]], [base[1], base[2]], [base[2], base[3]], [base[3], base[0]],
    [base[0], apex], [base[1], apex], [base[2], apex], [base[3], apex],
  ];
  const edgeCount = Math.floor(n * 0.5);
  const faceCount = Math.floor(n * 0.3);
  let placed = 0;
  // Nodes along edges
  for (let i = 0; i < edgeCount && placed < n; i++) {
    const edge = edges[i % edges.length];
    const t = (Math.floor(i / edges.length) + 0.5) / Math.ceil(edgeCount / edges.length);
    const j = 4;
    positions[sorted[placed]] = {
      x: edge[0].x + (edge[1].x - edge[0].x) * t + Math.sin(placed * 127.1) * j,
      y: edge[0].y + (edge[1].y - edge[0].y) * t + Math.sin(placed * 311.7) * j,
      z: edge[0].z + (edge[1].z - edge[0].z) * t + Math.sin(placed * 419.2) * j,
    };
    placed++;
  }
  // Nodes on 4 triangular faces
  for (let i = 0; i < faceCount && placed < n; i++) {
    const fi = i % 4;
    const a = base[fi], b = base[(fi + 1) % 4];
    let u = Math.abs(Math.sin(placed * 127.1 + 0.5));
    let v = Math.abs(Math.sin(placed * 311.7 + 0.5));
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    positions[sorted[placed]] = {
      x: a.x * u + b.x * v + apex.x * w,
      y: a.y * u + b.y * v + apex.y * w,
      z: a.z * u + b.z * v + apex.z * w,
    };
    placed++;
  }
  // Base fill
  for (; placed < n; placed++) {
    const u = Math.sin(placed * 127.1) * 0.5 + 0.5;
    const v = Math.sin(placed * 311.7) * 0.5 + 0.5;
    positions[sorted[placed]] = {
      x: -S + u * 2 * S,
      y: -H * 0.5,
      z: -S + v * 2 * S,
    };
  }
  return positions;
}

function layoutGrid(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const S = 250; // half-side
  // 8 corners
  const corners = [];
  for (let x = -1; x <= 1; x += 2)
    for (let y = -1; y <= 1; y += 2)
      for (let z = -1; z <= 1; z += 2)
        corners.push({ x: x * S, y: y * S, z: z * S });
  // 12 edges (pairs differing in exactly 1 axis)
  const edgeList = [];
  for (let i = 0; i < 8; i++)
    for (let j = i + 1; j < 8; j++) {
      const dx = corners[i].x !== corners[j].x ? 1 : 0;
      const dy = corners[i].y !== corners[j].y ? 1 : 0;
      const dz = corners[i].z !== corners[j].z ? 1 : 0;
      if (dx + dy + dz === 1) edgeList.push([corners[i], corners[j]]);
    }
  const edgeN = Math.floor(n * 0.6);
  const faceN = Math.floor(n * 0.25);
  let placed = 0;
  // Edge nodes: distribute evenly across 12 edges
  for (let i = 0; i < edgeN && placed < n; i++) {
    const edge = edgeList[i % edgeList.length];
    const t = (Math.floor(i / edgeList.length) + 0.5) / Math.ceil(edgeN / edgeList.length);
    const j = 3;
    positions[sorted[placed]] = {
      x: edge[0].x + (edge[1].x - edge[0].x) * t + Math.sin(placed * 127.1) * j,
      y: edge[0].y + (edge[1].y - edge[0].y) * t + Math.sin(placed * 311.7) * j,
      z: edge[0].z + (edge[1].z - edge[0].z) * t + Math.sin(placed * 419.2) * j,
    };
    placed++;
  }
  // Face nodes: distribute across 6 faces
  const faces = [
    ['x', -S], ['x', S], ['y', -S], ['y', S], ['z', -S], ['z', S],
  ];
  for (let i = 0; i < faceN && placed < n; i++) {
    const face = faces[i % 6];
    const u = (Math.sin(placed * 127.1) * 0.5 + 0.5) * 2 * S - S;
    const v = (Math.sin(placed * 311.7) * 0.5 + 0.5) * 2 * S - S;
    const pos = { x: 0, y: 0, z: 0 };
    if (face[0] === 'x') { pos.x = face[1]; pos.y = u; pos.z = v; }
    else if (face[0] === 'y') { pos.x = u; pos.y = face[1]; pos.z = v; }
    else { pos.x = u; pos.y = v; pos.z = face[1]; }
    positions[sorted[placed]] = pos;
    placed++;
  }
  // Sparse interior
  for (; placed < n; placed++) {
    positions[sorted[placed]] = {
      x: (Math.sin(placed * 127.1) * 0.5 + 0.5) * 2 * S - S,
      y: (Math.sin(placed * 311.7) * 0.5 + 0.5) * 2 * S - S,
      z: (Math.sin(placed * 419.2) * 0.5 + 0.5) * 2 * S - S,
    };
  }
  return positions;
}

function layoutSpiral(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const height = 700;
  const turns = 8;
  for (let rank = 0; rank < n; rank++) {
    const t = rank / (n - 1);
    const angle = t * Math.PI * 2 * turns;
    const radius = 50 + t * 200; // expanding spiral
    positions[sorted[rank]] = {
      x: Math.cos(angle) * radius,
      y: (t - 0.5) * height,
      z: Math.sin(angle) * radius,
    };
  }
  return positions;
}

function layoutTorusKnot(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const R = 200, r = 80, p = 2, q = 3;
  for (let rank = 0; rank < n; rank++) {
    const t = (rank / n) * Math.PI * 2 * p;
    const phi = (rank / n) * Math.PI * 2 * q;
    const x = (R + r * Math.cos(phi)) * Math.cos(t);
    const y = (R + r * Math.cos(phi)) * Math.sin(t);
    const z = r * Math.sin(phi);
    positions[sorted[rank]] = { x, y, z };
  }
  return positions;
}

function layoutVesica(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const R = 180, offset = 120;
  for (let rank = 0; rank < n; rank++) {
    const circle = rank % 2;
    const t = (rank / n) * Math.PI * 2 * 3;
    const r = R * (0.3 + 0.7 * Math.abs(Math.sin(t * 0.5)));
    const cx = circle === 0 ? -offset / 2 : offset / 2;
    positions[sorted[rank]] = {
      x: cx + Math.cos(t) * r * 0.7,
      y: Math.sin(t) * r,
      z: ((rank * 7) % 50 - 25),
    };
  }
  return positions;
}

function layoutIcosahedron(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const phi = (1 + Math.sqrt(5)) / 2;
  const verts = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ];
  const scale = 180;
  for (let rank = 0; rank < n; rank++) {
    const v = verts[rank % verts.length];
    const shell = Math.floor(rank / verts.length);
    const jitter = shell * 12;
    const angle = rank * 2.399;
    positions[sorted[rank]] = {
      x: v[0] * scale + Math.cos(angle) * jitter,
      y: v[1] * scale + Math.sin(angle) * jitter,
      z: v[2] * scale + Math.cos(angle * 1.3) * jitter,
    };
  }
  return positions;
}

function layoutMobius(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const R = 250, w = 60;
  for (let rank = 0; rank < n; rank++) {
    const t = (rank / n) * Math.PI * 2;
    const s = ((rank % 5) / 4 - 0.5) * w;
    const halfT = t / 2;
    positions[sorted[rank]] = {
      x: (R + s * Math.cos(halfT)) * Math.cos(t),
      y: (R + s * Math.cos(halfT)) * Math.sin(t) * 0.5,
      z: s * Math.sin(halfT),
    };
  }
  return positions;
}

function layoutInfinity(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const scale = 250;
  for (let rank = 0; rank < n; rank++) {
    const t = (rank / n) * Math.PI * 2;
    const r = scale * Math.cos(t);
    const layer = ((rank * 7) % 20 - 10) * 3;
    positions[sorted[rank]] = {
      x: r * Math.cos(t),
      y: r * Math.sin(t) * 0.5,
      z: layer,
    };
  }
  return positions;
}

function layoutWave(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const side = Math.ceil(Math.sqrt(n));
  const spacing = 25;
  for (let rank = 0; rank < n; rank++) {
    const ix = rank % side;
    const iz = Math.floor(rank / side);
    const x = (ix - side / 2) * spacing;
    const z = (iz - side / 2) * spacing;
    const y = Math.sin(ix * 0.3) * Math.cos(iz * 0.3) * 80;
    positions[sorted[rank]] = { x, y, z };
  }
  return positions;
}

function layoutShell(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  for (let rank = 0; rank < n; rank++) {
    const t = (rank / n) * 6 * Math.PI;
    const r = 10 + t * 12;
    const y = (rank / n - 0.5) * 400;
    positions[sorted[rank]] = {
      x: Math.cos(t) * r,
      y,
      z: Math.sin(t) * r,
    };
  }
  return positions;
}

function layoutConstellation(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  // Random but deterministic scatter in a flat-ish disc
  for (let rank = 0; rank < n; rank++) {
    const hash1 = Math.sin(rank * 127.1 + 311.7) * 43758.5453;
    const hash2 = Math.sin(rank * 269.5 + 183.3) * 43758.5453;
    const hash3 = Math.sin(rank * 419.2 + 371.9) * 43758.5453;
    const r = 50 + (hash1 - Math.floor(hash1)) * 350;
    const angle = (hash2 - Math.floor(hash2)) * Math.PI * 2;
    positions[sorted[rank]] = {
      x: Math.cos(angle) * r,
      y: ((hash3 - Math.floor(hash3)) - 0.5) * 80,
      z: Math.sin(angle) * r,
    };
  }
  return positions;
}

function layoutAtom(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const nucleus = Math.floor(n * 0.15);
  const orbits = 3;
  for (let rank = 0; rank < n; rank++) {
    if (rank < nucleus) {
      // Dense core
      const phi2 = (1 + Math.sqrt(5)) / 2;
      const y = 1 - (2 * rank) / (nucleus - 1);
      const r = Math.sqrt(1 - y * y);
      const theta = 2 * Math.PI * rank / phi2;
      positions[sorted[rank]] = {
        x: Math.cos(theta) * r * 40,
        y: y * 40,
        z: Math.sin(theta) * r * 40,
      };
    } else {
      const orbit = (rank - nucleus) % orbits;
      const t = ((rank - nucleus) / (n - nucleus)) * Math.PI * 2 * 8;
      const R = 150 + orbit * 80;
      const tilt = orbit * Math.PI / orbits;
      const x = Math.cos(t) * R;
      const y2 = Math.sin(t) * R * Math.cos(tilt);
      const z = Math.sin(t) * R * Math.sin(tilt);
      positions[sorted[rank]] = { x, y: y2, z };
    }
  }
  return positions;
}

function layoutTornado(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  for (let rank = 0; rank < n; rank++) {
    const t = rank / n;
    const angle = t * Math.PI * 2 * 12;
    const r = 20 + t * t * 300;
    const y = (t - 0.5) * 600;
    positions[sorted[rank]] = {
      x: Math.cos(angle) * r,
      y,
      z: Math.sin(angle) * r,
    };
  }
  return positions;
}

function layoutHourglass(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  for (let rank = 0; rank < n; rank++) {
    const t = (rank / n) * 2 - 1; // -1 to 1
    const r = 30 + 200 * Math.abs(t);
    const angle = rank * 2.399;
    positions[sorted[rank]] = {
      x: Math.cos(angle) * r,
      y: t * 300,
      z: Math.sin(angle) * r,
    };
  }
  return positions;
}

function layoutCrown(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  const points = 8;
  for (let rank = 0; rank < n; rank++) {
    const t = (rank / n) * Math.PI * 2;
    const r = 200;
    const spike = Math.pow(Math.abs(Math.sin(t * points / 2)), 3) * 120;
    const layer = (rank % 4) * 15;
    positions[sorted[rank]] = {
      x: Math.cos(t) * r,
      y: spike + layer,
      z: Math.sin(t) * r,
    };
  }
  return positions;
}


function layoutHeart(tesseract) {
  const sorted = sortedNodeIndices(tesseract);
  const n = sorted.length;
  const positions = new Array(n);
  for (let rank = 0; rank < n; rank++) {
    const t = (rank / n) * Math.PI * 2;
    // Heart parametric
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const layer = ((rank * 11) % 20 - 10) * 4;
    const scale = 18;
    positions[sorted[rank]] = {
      x: x * scale,
      y: y * scale,
      z: layer,
    };
  }
  return positions;
}

function startLayoutTransition(presetName) {
  if (!tesseract || !nodeHandle) return;
  const preset = LAYOUT_PRESETS[presetName];
  if (!preset) return;

  const nodes = tesseract.nodes;
  const from = nodes.map(n => ({ x: n.x, y: n.y, z: n.z }));
  const to = preset.fn(tesseract);

  // Safety: fill any missing positions so no node flies to origin
  for (let i = 0; i < nodes.length; i++) {
    if (!to[i]) to[i] = { x: from[i].x, y: from[i].y, z: from[i].z };
  }

  layoutTransition = { from, to, t: 0, duration: 1.5 };
}

function updateLayoutTransition(dt) {
  if (!layoutTransition || !tesseract) return;
  layoutTransition.t += dt / layoutTransition.duration;

  const t = Math.min(layoutTransition.t, 1);
  // Smoothstep easing
  const ease = t * t * (3 - 2 * t);
  const nodes = tesseract.nodes;

  for (let i = 0; i < nodes.length; i++) {
    const f = layoutTransition.from[i];
    const to = layoutTransition.to[i];
    if (!f || !to) continue;
    nodes[i].x = f.x + (to.x - f.x) * ease;
    nodes[i].y = f.y + (to.y - f.y) * ease;
    nodes[i].z = f.z + (to.z - f.z) * ease;
  }

  syncPositions(tesseract, edgeHandle, nodeHandle);

  if (t >= 1) layoutTransition = null;
}

let layoutStripOpen = false;
let lightStripOpen = false;
let focusedPanel = null; // 'layouts' | 'lightshow' | null
let currentLayoutIndex = 0;
let currentLightIndex = 0;
const layoutKeys = Object.keys(LAYOUT_PRESETS);
const lightKeys = Object.keys(LIGHTSHOW_PRESETS);

function createLayoutMenu() {
  const container = document.createElement('div');
  container.style.cssText = `
    position:absolute;bottom:52px;left:0;right:0;z-index:19;
    display:flex;flex-direction:column;align-items:center;pointer-events:none;
  `;

  const btnStyle = `
    background:rgba(8,8,10,0.85);border:1px solid rgba(255,255,255,0.08);
    border-radius:6px;color:#666;font-size:10px;font-family:inherit;
    padding:5px 12px;cursor:pointer;letter-spacing:0.3px;
    transition:color 0.15s,border-color 0.15s;text-transform:uppercase;
    pointer-events:auto;
  `;

  const itemStyle = `
    background:transparent;border:1px solid rgba(255,255,255,0.06);
    border-radius:4px;color:#777;font-size:10px;font-family:inherit;
    padding:4px 10px;cursor:pointer;letter-spacing:0.2px;
    transition:color 0.12s,border-color 0.12s,background 0.12s;
    white-space:nowrap;flex-shrink:0;
  `;

  // -- Horizontal scrollable strip for layouts --
  const layoutStrip = document.createElement('div');
  layoutStrip.style.cssText = `
    display:none;width:100%;overflow-x:auto;overflow-y:hidden;
    padding:6px 16px;pointer-events:auto;
    scrollbar-width:none;-ms-overflow-style:none;
  `;
  const layoutInner = document.createElement('div');
  layoutInner.style.cssText = 'display:flex;gap:5px;justify-content:center;flex-wrap:nowrap;min-width:min-content;margin:0 auto;';

  const layoutBtns = [];
  for (const [key, { label }] of Object.entries(LAYOUT_PRESETS)) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = itemStyle;
    btn.dataset.key = key;
    btn.addEventListener('mouseenter', () => { btn.style.color = '#ccc'; btn.style.borderColor = 'rgba(255,255,255,0.15)'; });
    btn.addEventListener('mouseleave', () => updateLayoutHighlight());
    btn.addEventListener('click', () => {
      currentLayoutIndex = layoutKeys.indexOf(key);
      focusedPanel = 'layouts';
      startLayoutTransition(key);
      updateLayoutHighlight();
      updateFocusIndicator();
      updateCurrentLabel();
    });
    layoutInner.appendChild(btn);
    layoutBtns.push(btn);
  }
  layoutStrip.appendChild(layoutInner);

  function updateLayoutHighlight() {
    layoutBtns.forEach((b, i) => {
      const active = i === currentLayoutIndex;
      b.style.color = active ? '#ccc' : '#777';
      b.style.borderColor = active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)';
      b.style.background = active ? 'rgba(255,255,255,0.04)' : 'transparent';
    });
  }

  // -- Horizontal scrollable strip for lightshow --
  const lightStrip = document.createElement('div');
  lightStrip.style.cssText = `
    display:none;width:100%;pointer-events:auto;
    padding:4px 16px 2px;
  `;

  const lightPresetRow = document.createElement('div');
  lightPresetRow.style.cssText = `
    display:flex;gap:5px;justify-content:center;flex-wrap:nowrap;min-width:min-content;
    margin:0 auto;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;
  `;

  const lightBtns = [];
  for (const [key, item] of Object.entries(LIGHTSHOW_PRESETS)) {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    btn.style.cssText = itemStyle;
    btn.addEventListener('mouseenter', () => { btn.style.color = '#ccc'; btn.style.borderColor = 'rgba(255,255,255,0.15)'; });
    btn.addEventListener('mouseleave', () => updateLightHighlight());
    btn.addEventListener('click', () => {
      currentLightIndex = lightKeys.indexOf(key);
      focusedPanel = 'lightshow';
      lightMode = item.mode;
      syncLightshow();
      updateLightHighlight();
      updateToggleStyles();
      updateFocusIndicator();
      updateCurrentLabel();
    });
    lightPresetRow.appendChild(btn);
    lightBtns.push(btn);
  }

  function updateLightHighlight() {
    lightBtns.forEach((b, i) => {
      const active = i === currentLightIndex;
      b.style.color = active ? '#ccc' : '#777';
      b.style.borderColor = active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)';
      b.style.background = active ? 'rgba(255,255,255,0.04)' : 'transparent';
    });
  }

  // Sliders row
  const sliderRow = document.createElement('div');
  sliderRow.style.cssText = 'display:flex;align-items:center;gap:16px;justify-content:center;padding:4px 16px;';

  const speedLabel = document.createElement('span');
  speedLabel.textContent = 'Speed';
  speedLabel.style.cssText = 'color:#555;font-size:9px;text-transform:uppercase;letter-spacing:0.3px;';
  const speedSlider = document.createElement('input');
  speedSlider.type = 'range'; speedSlider.min = '0.1'; speedSlider.max = '4'; speedSlider.step = '0.1'; speedSlider.value = '1';
  speedSlider.style.cssText = 'width:80px;accent-color:#555;height:3px;';
  speedSlider.addEventListener('input', () => { lightSpeed = parseFloat(speedSlider.value); syncLightshow(); });

  const intLabel = document.createElement('span');
  intLabel.textContent = 'Intensity';
  intLabel.style.cssText = 'color:#555;font-size:9px;text-transform:uppercase;letter-spacing:0.3px;';
  const intSlider = document.createElement('input');
  intSlider.type = 'range'; intSlider.min = '0'; intSlider.max = '1'; intSlider.step = '0.05'; intSlider.value = '1';
  intSlider.style.cssText = 'width:80px;accent-color:#555;height:3px;';
  intSlider.addEventListener('input', () => { lightIntensity = parseFloat(intSlider.value); syncLightshow(); });

  sliderRow.appendChild(speedLabel);
  sliderRow.appendChild(speedSlider);
  sliderRow.appendChild(intLabel);
  sliderRow.appendChild(intSlider);

  lightStrip.appendChild(lightPresetRow);
  lightStrip.appendChild(sliderRow);

  // -- Current label showing active preset --
  const currentLabel = document.createElement('div');
  currentLabel.style.cssText = `
    color:#555;font-size:9px;letter-spacing:0.5px;text-transform:uppercase;
    margin-bottom:4px;pointer-events:none;text-align:center;min-height:14px;
  `;

  function updateCurrentLabel() {
    const parts = [];
    if (layoutStripOpen) parts.push(LAYOUT_PRESETS[layoutKeys[currentLayoutIndex]]?.label || '');
    if (lightStripOpen) parts.push(LIGHTSHOW_PRESETS[lightKeys[currentLightIndex]]?.label || '');
    if (focusedPanel) parts.push('< arrow keys >');
    currentLabel.textContent = parts.join('  \u00b7  ');
  }

  // -- Toggle buttons --
  const layoutToggle = document.createElement('button');
  layoutToggle.textContent = 'Layouts';
  layoutToggle.style.cssText = btnStyle;

  const lightToggle = document.createElement('button');
  lightToggle.textContent = 'Lightshow';
  lightToggle.style.cssText = btnStyle + 'margin-left:6px;';

  function updateToggleStyles() {
    layoutToggle.style.color = layoutStripOpen ? '#aaa' : '#666';
    layoutToggle.style.borderColor = layoutStripOpen ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)';
    if (lightStripOpen) {
      lightToggle.style.color = '#aaa';
      lightToggle.style.borderColor = 'rgba(255,255,255,0.15)';
    } else if (lightMode > 0) {
      lightToggle.style.color = '#888';
      lightToggle.style.borderColor = 'rgba(255,255,255,0.12)';
    } else {
      lightToggle.style.color = '#666';
      lightToggle.style.borderColor = 'rgba(255,255,255,0.08)';
    }
  }

  function updateFocusIndicator() {
    layoutStrip.style.borderBottom = (focusedPanel === 'layouts' && layoutStripOpen)
      ? '1px solid rgba(255,255,255,0.1)' : 'none';
    lightStrip.style.borderBottom = (focusedPanel === 'lightshow' && lightStripOpen)
      ? '1px solid rgba(255,255,255,0.1)' : 'none';
  }

  const rotateBtn = document.createElement('button');
  rotateBtn.textContent = 'Rotate';
  rotateBtn.style.cssText = btnStyle + 'margin-left:6px;';
  function updateRotateBtn() {
    rotateBtn.style.color = autoRotateOn ? '#aaa' : '#555';
    rotateBtn.style.borderColor = autoRotateOn ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)';
  }
  updateRotateBtn();
  rotateBtn.addEventListener('click', () => {
    autoRotateOn = !autoRotateOn;
    syncAutoRotate();
    updateRotateBtn();
  });
  rotateBtn.addEventListener('mouseenter', () => { if (!autoRotateOn) rotateBtn.style.color = '#999'; });
  rotateBtn.addEventListener('mouseleave', () => updateRotateBtn());

  function togglePanel(panel) {
    if (panel === 'layouts') {
      layoutStripOpen = !layoutStripOpen;
      layoutStrip.style.display = layoutStripOpen ? 'block' : 'none';
      if (layoutStripOpen) {
        focusedPanel = 'layouts';
        updateLayoutHighlight();
        scrollToActive(layoutInner, layoutBtns, currentLayoutIndex);
      } else if (focusedPanel === 'layouts') {
        focusedPanel = lightStripOpen ? 'lightshow' : null;
      }
    } else if (panel === 'lightshow') {
      lightStripOpen = !lightStripOpen;
      lightStrip.style.display = lightStripOpen ? 'block' : 'none';
      if (lightStripOpen) {
        focusedPanel = 'lightshow';
        updateLightHighlight();
        scrollToActive(lightPresetRow, lightBtns, currentLightIndex);
      } else if (focusedPanel === 'lightshow') {
        focusedPanel = layoutStripOpen ? 'layouts' : null;
      }
    }
    updateToggleStyles();
    updateFocusIndicator();
    updateCurrentLabel();
  }

  function scrollToActive(container, btns, idx) {
    const btn = btns[idx];
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  layoutToggle.addEventListener('click', () => togglePanel('layouts'));
  lightToggle.addEventListener('click', () => togglePanel('lightshow'));
  layoutToggle.addEventListener('mouseenter', () => { if (!layoutStripOpen) layoutToggle.style.color = '#999'; });
  layoutToggle.addEventListener('mouseleave', () => { if (!layoutStripOpen) layoutToggle.style.color = '#666'; });
  lightToggle.addEventListener('mouseenter', () => { if (!lightStripOpen) lightToggle.style.color = '#999'; });
  lightToggle.addEventListener('mouseleave', () => updateToggleStyles());

  // -- Arrow key cycling + Tab to swap focus --
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    // Tab: swap focus between open panels
    if (e.key === 'Tab' && !e.shiftKey && layoutStripOpen && lightStripOpen) {
      e.preventDefault();
      focusedPanel = focusedPanel === 'layouts' ? 'lightshow' : 'layouts';
      updateFocusIndicator();
      updateCurrentLabel();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!focusedPanel) return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (focusedPanel === 'layouts') {
        currentLayoutIndex = (currentLayoutIndex + dir + layoutKeys.length) % layoutKeys.length;
        startLayoutTransition(layoutKeys[currentLayoutIndex]);
        updateLayoutHighlight();
        updateCurrentLabel();
        scrollToActive(layoutInner, layoutBtns, currentLayoutIndex);
      } else if (focusedPanel === 'lightshow') {
        currentLightIndex = (currentLightIndex + dir + lightKeys.length) % lightKeys.length;
        lightMode = LIGHTSHOW_PRESETS[lightKeys[currentLightIndex]].mode;
        syncLightshow();
        updateLightHighlight();
        updateToggleStyles();
        updateCurrentLabel();
        scrollToActive(lightPresetRow, lightBtns, currentLightIndex);
      }
    }
  });

  // -- Assemble --
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;align-items:center;justify-content:center;pointer-events:auto;';
  btnRow.appendChild(layoutToggle);
  btnRow.appendChild(lightToggle);
  btnRow.appendChild(rotateBtn);

  container.appendChild(layoutStrip);
  container.appendChild(lightStrip);
  container.appendChild(currentLabel);
  container.appendChild(btnRow);
  appEl.appendChild(container);
}

// ============ SEARCH BAR (minimal, monochrome) ============
function createSearchBar(tesseract) {
  const shell = document.createElement('div');
  shell.style.cssText = 'position:absolute;bottom:18px;left:50%;transform:translateX(-50%);z-index:18;width:min(420px, calc(100% - 32px));';

  const input = document.createElement('input');
  input.id = 'hive-search-input';
  input.type = 'text';
  input.placeholder = 'Search...';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.style.cssText = `
    width:100%;padding:10px 14px;
    background:rgba(8,8,10,0.85);border:1px solid rgba(255,255,255,0.08);
    border-radius:8px;color:#999;font-size:13px;font-family:inherit;
    outline:none;letter-spacing:0.2px;
    transition:border-color 0.15s,color 0.15s;
  `;

  const dropdown = document.createElement('div');
  dropdown.style.cssText = `
    position:absolute;bottom:100%;left:0;right:0;margin-bottom:4px;
    background:rgba(8,8,10,0.92);border:1px solid rgba(255,255,255,0.06);
    border-radius:8px;overflow:hidden;display:none;
    max-height:280px;overflow-y:auto;
  `;

  shell.appendChild(dropdown);
  shell.appendChild(input);
  appEl.appendChild(shell);

  input.addEventListener('focus', () => { input.style.borderColor = 'rgba(255,255,255,0.15)'; input.style.color = '#ccc'; });
  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 150);
    input.style.borderColor = 'rgba(255,255,255,0.08)'; input.style.color = '#999';
  });

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 2) { dropdown.style.display = 'none'; return; }
    const hits = tesseract.search(q).slice(0, 8);
    if (hits.length === 0) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = hits.map((h, i) =>
      `<div data-idx="${i}" style="padding:7px 12px;cursor:pointer;font-size:12px;color:#888;border-bottom:1px solid rgba(255,255,255,0.03);transition:background 0.1s,color 0.1s;">
        <div style="color:#bbb;font-size:12px;">${h.title || h.id}</div>
        <div style="font-size:9px;color:#444;margin-top:2px;">${h.folder || ''}</div>
      </div>`
    ).join('');
    dropdown.style.display = 'block';

    // Highlight on hover
    dropdown.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.background = 'rgba(255,255,255,0.04)'; el.style.color = '#ccc'; });
      el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; el.style.color = '#888'; });
      el.addEventListener('click', () => {
        selectNode(hits[parseInt(el.dataset.idx)].id);
        input.value = '';
        dropdown.style.display = 'none';
        input.blur();
      });
    });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;
      const hits = tesseract.search(q);
      if (hits.length > 0) {
        selectNode(hits[0].id);
        input.value = '';
        dropdown.style.display = 'none';
        input.blur();
      }
    }
    if (e.key === 'Escape') {
      input.value = '';
      dropdown.style.display = 'none';
      input.blur();
    }
  });
}

// ============ INIT ============
async function init() {
  updateSize();

  const res = await fetch('/graph.json');
  const data = await res.json();
  tesseract = new Tesseract(data);
  tesseract.layoutGraph();

  // Save original force-layout positions for "Galaxy" preset
  for (const n of tesseract.nodes) {
    n._origX = n.x;
    n._origY = n.y;
    n._origZ = n.z;
  }

  skyboxRef = buildSkybox(scene);
  edgeHandle = buildEdges(scene, tesseract);
  nodeHandle = buildNodes(scene, tesseract);

  // Apply pixel ratio to point shaders for DPI-correct rendering
  const dpr = window.devicePixelRatio;
  if (nodeHandle?.material?.uniforms?.uPixelRatio) {
    nodeHandle.material.uniforms.uPixelRatio.value = dpr;
  }
  if (skyboxRef?.starMat?.uniforms?.uPixelRatio) {
    skyboxRef.starMat.uniforms.uPixelRatio.value = dpr;
  }

  // Reader
  initReader();
  const handleOpenReader = (nodeId) => openReader(nodeId, tesseract);

  // Search highlighting
  const handleSearchHighlight = (matchingIds) => {
    if (nodeHandle) highlightSearchResults(nodeHandle, matchingIds);
  };

  // Sidebar
  sidebarApi = createSidebar(tesseract, selectNode, onSelectCallbacks, handleOpenReader, handleSearchHighlight);

  // Minimal search bar (Cmd/Ctrl+K) + layout menu
  createSearchBar(tesseract);
  createLayoutMenu();

  // Idle drift reset on interaction
  for (const evt of ['pointerdown', 'pointermove', 'wheel', 'keydown']) {
    window.addEventListener(evt, resetIdleTimer, { passive: true });
  }

  // Nav polling
  setInterval(pollNavCommand, 500);

  // Keyboard
  window.addEventListener('keydown', (e) => {
    // Shift+Tab: toggle sidebar
    if (e.shiftKey && e.key === 'Tab') {
      e.preventDefault();
      toggleSidebar();
      return;
    }
    if (e.key === 'Escape') {
      if (isReaderOpen()) { closeReader(); return; }
      deselectNode();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const searchInput = document.getElementById('hive-search-input');
      if (searchInput) { searchInput.focus(); searchInput.select(); }
      return;
    }
    if (e.key === '/' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      document.getElementById('sidebar-search')?.focus();
    }
  });

  // Resize
  window.addEventListener('resize', updateSize);
  new ResizeObserver(updateSize).observe(appEl);

  // Render loop -- all animation is GPU-driven via uTime uniforms
  let lastTime = performance.now();
  function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    const elapsed = clock.getElapsedTime();

    // Push time to all shaders (GPU handles pulse, dust, twinkle, flow)
    if (edgeHandle?.material) edgeHandle.material.uniforms.uTime.value = elapsed;
    if (skyboxRef?.starMat) skyboxRef.starMat.uniforms.uTime.value = elapsed;
    if (skyboxRef?.dustMat) skyboxRef.dustMat.uniforms.uTime.value = elapsed;
    if (nodeHandle?.material) nodeHandle.material.uniforms.uTime.value = elapsed;

    // Layout transition (smooth interpolation between presets)
    if (layoutTransition) updateLayoutTransition(dt);

    updateCamera();
    updateSelectedTitle();
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
  console.log('The Hive alive.');
}

// Wait for password gate unlock before initializing
if (window.__hiveUnlocked) {
  init().catch(e => console.error('Init failed:', e));
} else {
  window.addEventListener('hive-unlock', () => {
    init().catch(e => console.error('Init failed:', e));
  });
}
