import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Tesseract } from './core/tesseract.js';
import { buildEdges, buildNodes, buildSkybox, highlightSelection, clearSelection, updateSelectionPulse, highlightSearchResults } from './core/graph-scene.js';
import { createSidebar } from './core/sidebar.js';
import { initReader, openReader, closeReader, isReaderOpen } from './core/reader.js';
import { createRetrieverPanel } from './core/retriever-panel.js';
import { createRetrievalClient } from './core/retrieval-client.js';

// ============ RENDERER ============
const appEl = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

// ============ ZOOM SLIDER ============
// Controls how close the camera ends up to a node after flying.
// 0 = close-up (tight on the node), 1 = zoomed out (wide view, see more galaxy)
let zoomLevel = 0.6; // default: moderately wide

function createControls() {
  const style = document.createElement('style');
  style.textContent = `
    #hive-controls {
      position: absolute; bottom: 10px; right: 10px; z-index: 20;
      display: flex; align-items: center; gap: 12px;
      background: rgba(12,12,14,0.8); border: 1px solid #1c1c1f;
      border-radius: 14px; padding: 5px 12px;
    }
    #hive-controls span { font-size: 8px; color: #333; letter-spacing: 0.3px; user-select: none; text-transform: uppercase; }
    #hive-controls .ctrl-sep { width: 1px; height: 12px; background: #1c1c1f; }
    #hive-controls input[type="range"] {
      -webkit-appearance: none; appearance: none;
      width: 60px; height: 2px; background: #1c1c1f; border-radius: 1px;
      outline: none; cursor: pointer;
    }
    #hive-controls input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 8px; height: 8px; border-radius: 50%;
      background: #444; border: none; cursor: pointer;
    }
    #hive-controls input[type="range"]::-webkit-slider-thumb:hover { background: #666; }
    #hive-controls input[type="checkbox"] {
      width: 22px; height: 11px; border-radius: 6px; border: 1px solid #1c1c1f;
      background: #111; cursor: pointer; position: relative; transition: background 0.2s;
      appearance: none; -webkit-appearance: none; outline: none;
    }
    #hive-controls input[type="checkbox"]:checked { background: #222; }
    #hive-controls input[type="checkbox"]::after {
      content: ''; position: absolute; top: 1px; left: 1px;
      width: 7px; height: 7px; border-radius: 50%;
      background: #444; transition: transform 0.2s, background 0.2s;
    }
    #hive-controls input[type="checkbox"]:checked::after { transform: translateX(11px); background: #999; }
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'hive-controls';
  bar.innerHTML = `
    <span>Rotate</span>
    <input type="checkbox" id="rotate-toggle">
    <input type="range" id="rotate-speed" min="5" max="100" value="30">
    <div class="ctrl-sep"></div>
    <span>Zoom</span>
    <input type="range" id="zoom-slider" min="0" max="100" value="60">
  `;
  appEl.appendChild(bar);

  // Zoom
  document.getElementById('zoom-slider').addEventListener('input', (e) => {
    zoomLevel = parseInt(e.target.value) / 100;
    if (!cameraGoal && controls.target) {
      const targetDist = 40 + zoomLevel * 960;
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
      camera.position.copy(controls.target).add(dir.multiplyScalar(targetDist));
    }
  });

  // Rotate
  document.getElementById('rotate-toggle').addEventListener('change', (e) => {
    autoRotateOn = e.target.checked;
    syncAutoRotate();
  });
  document.getElementById('rotate-speed').addEventListener('input', (e) => {
    autoRotateSpeed = parseInt(e.target.value) / 100;
    syncAutoRotate();
  });
}

// ============ STATE ============
let tesseract = null;
let edgeHandle = null;
let nodeHandle = null;
let sidebarApi = null;
let retrieverPanel = null;
let selectedNode = null;
let lastNavTimestamp = 0;
let onSelectCallbacks = [];
const clock = new THREE.Clock();
const retrievalClient = createRetrievalClient();
let clarificationContext = null;

// ============ SMOOTH CAMERA ============
let flyState = null; // kept for compat checks
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
  controls.target.lerp(cameraTarget, SMOOTH_FACTOR);

  if (camera.position.distanceTo(cameraGoal) < 0.5) {
    cameraGoal = null;
    cameraTarget = null;
  }
}

function updateSize() {
  const w = appEl.clientWidth;
  const h = appEl.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
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


function createLegend() {
  const legend = document.createElement('div');
  legend.style.cssText = 'position:absolute;bottom:14px;left:14px;z-index:20;font-size:9px;line-height:1.6;color:#444;';
  const items = [
    ['#2299aa', 'Sessions'],
    ['#3377cc', 'Architecture'],
    ['#7744bb', 'Projects'],
    ['#5533aa', 'Decisions'],
    ['#22aacc', 'Playbooks'],
    ['#aa8833', 'Knowledge'],
    ['#33aa66', 'Ops'],
    ['#993355', 'Secure'],
  ];
  legend.innerHTML = items.map(([c, n]) =>
    `<div style="display:flex;align-items:center;gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0;opacity:0.7;"></span>${n}</div>`
  ).join('');
  appEl.appendChild(legend);
}

function syncAutoRotate() {
  controls.autoRotate = autoRotateOn;
  controls.autoRotateSpeed = 0.1 + autoRotateSpeed * 2.5; // maps 0-1 to 0.1-2.6
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

function resolveRetrieverNodeRef(ref) {
  if (!tesseract) return { node: null, validation: { nodeExists: false, pathExists: false } };
  return tesseract.resolveNodeRef(ref);
}

function toRetrieverResolvedState(resolved) {
  return {
    mode: 'resolved',
    resolved: {
      nodeId: resolved.nodeId,
      title: resolved.title,
      folder: resolved.folder,
      score: resolved.score,
    },
  };
}

function showRetrieverError(message) {
  retrieverPanel?.setState({
    mode: 'error',
    message,
  });
}

function applyResolvedRetrieverResult(resolved) {
  const resolution = resolveRetrieverNodeRef(resolved);
  if (!resolution.node) {
    showRetrieverError('Resolved path was not found in the loaded graph.');
    return;
  }

  retrieverPanel?.setState(toRetrieverResolvedState(resolved));
  openInlineNode(resolution.node.id, {
    deterministicFocus: true,
    forceFocus: true,
  });
}

function normalizeRetrieverCandidate(candidate) {
  const resolution = resolveRetrieverNodeRef(candidate);
  if (!resolution.node) return null;
  return {
    ...candidate,
    nodeId: resolution.node.id,
  };
}

async function submitRetrieverQuery(query, options = {}) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return;

  retrieverPanel?.setState({ mode: 'searching' });

  try {
    const response = await retrievalClient.retrieve(trimmed, clarificationContext, {
      provider: options.provider || retrieverPanel?.getProvider?.() || 'openai',
    });

    if (response.intent === 'resolved') {
      clarificationContext = null;
      applyResolvedRetrieverResult(response.resolved);
      return;
    }

    if (response.intent === 'candidates') {
      clarificationContext = null;
      const candidates = response.candidates.map(normalizeRetrieverCandidate).filter(Boolean);
      if (candidates.length === 0) {
        showRetrieverError('Returned candidates did not map to real notes.');
        return;
      }
      retrieverPanel?.setState({
        mode: 'candidates',
        candidates,
      });
      return;
    }

    clarificationContext = {
      previousQuery: trimmed,
      question: response.question,
    };
    retrieverPanel?.setState({
      mode: 'clarification',
      question: response.question,
    });
  } catch (error) {
    showRetrieverError(error.message || 'Retriever request failed.');
  }
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
  if (nodeId) {
    selectNode(nodeId);
  } else {
    deselectNode();
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

// ============ INIT ============
async function init() {
  updateSize();
  createControls();
  createLegend();

  const res = await fetch('/graph.json');
  const data = await res.json();
  tesseract = new Tesseract(data);
  tesseract.layoutGraph();

  const skybox = buildSkybox(scene);
  edgeHandle = buildEdges(scene, tesseract);
  nodeHandle = buildNodes(scene, tesseract);

  // Reader
  initReader();
  const handleOpenReader = (nodeId) => openReader(nodeId, tesseract);

  // Search highlighting
  const handleSearchHighlight = (matchingIds) => {
    if (nodeHandle) highlightSearchResults(nodeHandle, matchingIds);
  };

  // Sidebar
  sidebarApi = createSidebar(tesseract, selectNode, onSelectCallbacks, handleOpenReader, handleSearchHighlight);

  // Direct retrieval panel
  retrieverPanel = createRetrieverPanel({
    mount: document.getElementById('retriever-root'),
    onSubmit: submitRetrieverQuery,
    onCandidateSelect: (candidate) => {
      clarificationContext = null;
      applyResolvedRetrieverResult(candidate);
    },
  });

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
      retrieverPanel?.focus();
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

  // Render loop
  function animate() {
    requestAnimationFrame(animate);

    // Physics disabled - static layout

    const elapsed = clock.getElapsedTime();

    // Shader time updates
    if (edgeHandle?.material) edgeHandle.material.uniforms.uTime.value = elapsed;
    if (skybox?.starMat) skybox.starMat.uniforms.uTime.value = elapsed;

    // Selection pulse
    if (selectedNode && edgeHandle && nodeHandle) {
      updateSelectionPulse(elapsed, edgeHandle, nodeHandle, selectedNode, tesseract);
    }

    // Vortex dust currents (skip during flights)
    if (skybox?.dustMesh && !flyState) {
      const dp = skybox.dustMesh.userData.posAttr;
      const t = elapsed * 0.3;
      for (let i = 0; i < dp.count; i++) {
        const x = dp.array[i * 3];
        const y = dp.array[i * 3 + 1];
        const z = dp.array[i * 3 + 2];
        // Curl noise-ish vortex flow
        dp.array[i * 3] += Math.sin(z * 0.0008 + t) * 0.12;
        dp.array[i * 3 + 1] += Math.sin(x * 0.0006 + z * 0.0004 + t * 0.7) * 0.06;
        dp.array[i * 3 + 2] += Math.cos(x * 0.0008 + t) * 0.12;
        // Wrap around
        for (let j = 0; j < 3; j++) {
          if (dp.array[i * 3 + j] > 5000) dp.array[i * 3 + j] = -5000;
          if (dp.array[i * 3 + j] < -5000) dp.array[i * 3 + j] = 5000;
        }
      }
      dp.needsUpdate = true;
    }

    updateCamera();
    updateSelectedTitle();
    controls.update(); // autoRotate handled internally by OrbitControls
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
