import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Tesseract } from './core/tesseract.js';
import {
  buildEdges,
  buildNodes,
  buildSkybox,
  clearSelection,
  clearTravelOverlay,
  highlightSearchResults,
  highlightSelection,
  setTravelOverlay,
  syncPositions,
  tickTravelOverlay,
  updateSelectionPulse,
} from './core/graph-scene.js';
import { createSidebar } from './core/sidebar.js';
import { initReader, openReader, closeReader, isReaderOpen } from './core/reader.js';
import { createOrb } from './core/orb.js';
import { createRetrievalClient } from './core/retrieval-client.js';
import { createVergil } from './core/vergil.js';
import { createMinimap } from './core/minimap.js';

// ============ RENDERER ============
const appEl = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020208);
scene.fog = new THREE.FogExp2(0x020208, 0.00005);

const camera = new THREE.PerspectiveCamera(60, 1, 1, 42000);
camera.position.set(980, 420, 1500); // Start inside the galaxy, but preserve the sense of scale

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 1.2;
controls.enablePan = false;
controls.enableZoom = false;
controls.minDistance = 120;
controls.maxDistance = 15000;

// ============ STATE ============
let tesseract = null;
let edgeHandle = null;
let nodeHandle = null;
let skybox = null;
let sidebarApi = null;
let orb = null;
let minimap = null;
let selectedNode = null;
let lastNavTimestamp = 0;
let onSelectCallbacks = [];
const clock = new THREE.Clock();
const retrievalClient = createRetrievalClient();
let clarificationContext = null;
let pendingOrbSelection = null;
let orbCandidates = [];
let vergil = null;
let commandMode = false;
let followMode = 'off';
let followCameraAnchor = null;
let railTravelState = null;
let selectionJourneyState = null;
let selectionArrivalState = null;
let layoutTransitionState = null;
let attachedVergilNodeId = null;
let commandHoverPoint = null;
let commandHoverNodeId = null;
let lastVergilState = 'ambient';
let vergilAttentionUntil = 0;
let vergilAttendingUser = false;
let vergilPatrolResumeTimer = null;
let activeLayoutPreset = 'cluster';
let constructionModeState = {
  active: false,
  progress: 0,
  durationMs: 0,
  startedAtMs: 0,
  route: [],
  routeIndex: 0,
  energizedEdgeIndices: new Set(),
};
let desiredCameraDistance = camera.position.distanceTo(controls.target);
let zoomBounds = {
  min: controls.minDistance,
  max: controls.maxDistance,
};
let orbViewState = {
  mode: 'idle',
  candidates: [],
  candidateHints: [],
  question: '',
  message: '',
  resolved: null,
  armedSelection: null,
  controls: {
    commandMode: false,
    follow: false,
    followMode: 'off',
    rotate: false,
    activeLayoutPreset: 'cluster',
    constructionMode: {
      active: false,
      progress: 0,
      durationMs: 0,
      status: 'idle',
    },
  },
  vergilState: 'ambient',
};

const VERGIL_ATTENTION_MS = 4200;
const VERGIL_BRIEF_ATTENTION_MS = 2600;
const VERGIL_SPEECH_MS = 4800;
const VERGIL_PATROL_LIMIT = 6;
const COMMAND_WORLD_RADIUS = 16000;
const RAIL_SEGMENT_ADVANCE_DISTANCE = 18;
const COMMAND_CURSOR_SIZE = 34;
const SELECTION_SETTLE_DURATION = 1.15;
const SHUFFLE_SETTLE_DURATION = 1.9;
const GRAPH_CAMERA_DISTANCE_MIN = 920;
const GRAPH_CAMERA_DISTANCE_MAX = 1880;
const GRAPH_ZOOM_MAX_FACTOR = 0.68;
const GRAPH_ZOOM_MIN_FACTOR = 0.02;
const GRAPH_ZOOM_MAX_DISTANCE_MIN = 1680;
const GRAPH_ZOOM_MAX_DISTANCE_MAX = 4800;
const CONSTRUCTION_MODE_DURATION_MS = 9 * 60 * 1000;

const FOLLOW_DISTANCE_BANDS = Object.freeze({
  off: { min: 0, max: Infinity, default: 1100 },
  fov: { min: 120, max: 260, default: 176 },
  close: { min: 300, max: 620, default: 430 },
  medium: { min: 520, max: 1060, default: 720 },
  far: { min: 820, max: 1880, default: 1260 },
});

let graphRadius = 14000;
const tempRailSegment = new THREE.Vector3();
const tempRailPoint = new THREE.Vector3();
const tempJourneyTarget = new THREE.Vector3();
const tempJourneyGoal = new THREE.Vector3();
const tempJourneyOffset = new THREE.Vector3();

function callVergil(methodNames, ...args) {
  if (!vergil) return undefined;
  const names = Array.isArray(methodNames) ? methodNames : [methodNames];
  for (const methodName of names) {
    const fn = vergil?.[methodName];
    if (typeof fn === 'function') {
      return fn(...args);
    }
  }
  return undefined;
}

function normalizeVergilState(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'object') {
    if (typeof value.state === 'string') return value.state.toLowerCase();
    if (typeof value.mode === 'string') return value.mode.toLowerCase();
  }
  return null;
}

function readVergilState() {
  const reported = normalizeVergilState(callVergil(['getState', 'getMovementState', 'getMode']));
  if (reported) {
    lastVergilState = reported;
  }
  return lastVergilState;
}

function readAttachedVergilNodeId() {
  const reported = callVergil(['getAttachedNodeId']);
  attachedVergilNodeId = typeof reported === 'string' && reported ? reported : null;
  return attachedVergilNodeId;
}

function setOrbState(nextState = {}) {
  orbViewState = {
    ...orbViewState,
    ...nextState,
  };
  orb?.setState?.(orbViewState);
}

function getConstructionModeView() {
  return {
    active: Boolean(constructionModeState.active),
    progress: Number.isFinite(constructionModeState.progress) ? constructionModeState.progress : 0,
    durationMs: Number.isFinite(constructionModeState.durationMs) ? constructionModeState.durationMs : 0,
    status: constructionModeState.active ? 'constructing' : 'idle',
  };
}

function syncOrbTacticalState(extraState = {}) {
  const mergedControls = {
    commandMode,
    follow: followMode !== 'off',
    followMode,
    rotate: autoRotateOn,
    activeLayoutPreset,
    constructionMode: getConstructionModeView(),
    ...(extraState.controls || {}),
  };
  setOrbState({
    ...extraState,
    controls: mergedControls,
    vergilState: readVergilState(),
  });
}

function setVergilAttention(active) {
  if (vergilAttendingUser === active) return;
  vergilAttendingUser = active;
  callVergil(['setUserAttention', 'setAttendUser'], active);
}

function setCommandMode(active) {
  commandMode = Boolean(active);
  callVergil(['setCommandMode'], commandMode);
  if (!commandMode) {
    commandHoverPoint = null;
    commandHoverNodeId = null;
    callVergil(['clearCommandPreview']);
    setCommandCursorVisible(false);
  }
  renderer.domElement.style.cursor = commandMode ? 'none' : '';
  syncOrbTacticalState();
}

function getFollowBand(mode = followMode) {
  return FOLLOW_DISTANCE_BANDS[mode] || FOLLOW_DISTANCE_BANDS.off;
}

function clampDistanceForMode(distance, mode = followMode) {
  const band = getFollowBand(mode);
  return THREE.MathUtils.clamp(distance, band.min || zoomBounds.min, band.max === Infinity ? zoomBounds.max : band.max);
}

function setDesiredCameraDistance(distance, options = {}) {
  desiredCameraDistance = clampDistanceForMode(distance, followMode);
  if (followCameraAnchor?.offset) {
    clampFollowOffset(followCameraAnchor.offset, followMode);
  }
  if (options.syncCameraPosition) {
    const offset = camera.position.clone().sub(controls.target);
    if (offset.lengthSq() < 1) {
      offset.set(0, 0, 1);
    }
    offset.setLength(desiredCameraDistance);
    camera.position.copy(controls.target).add(offset);
  }
}

function setFollowMode(mode = 'off') {
  const normalizedMode = String(mode || 'off').toLowerCase();
  followMode = FOLLOW_DISTANCE_BANDS[normalizedMode] ? normalizedMode : 'off';
  if (followMode === 'off') {
    followCameraAnchor = null;
    syncAutoRotate();
    syncOrbTacticalState();
    return;
  }

  const focusTarget = getVergilPosition() || controls.target.clone();
  const offset = camera.position.clone().sub(focusTarget);
  if (offset.lengthSq() < 1) {
    offset.set(320, 180, 540);
  }
  const band = getFollowBand(followMode);
  const nextDistance = THREE.MathUtils.clamp(offset.length() || band.default, band.min, band.max);
  desiredCameraDistance = nextDistance;
  offset.setLength(nextDistance);
  offset.y = THREE.MathUtils.clamp(offset.y, 90, Math.max(180, nextDistance * 0.62));
  followCameraAnchor = { offset };
  syncAutoRotate();
  syncOrbTacticalState();
}

function setRotateEnabled(active) {
  autoRotateOn = Boolean(active);
  syncAutoRotate();
  syncOrbTacticalState();
}

function clearVergilPatrolResume() {
  if (vergilPatrolResumeTimer) {
    window.clearTimeout(vergilPatrolResumeTimer);
    vergilPatrolResumeTimer = null;
  }
}

function scheduleVergilPatrolResume(delayMs = 2600) {
  clearVergilPatrolResume();
  vergilPatrolResumeTimer = window.setTimeout(() => {
    vergilPatrolResumeTimer = null;
    if (vergilAttendingUser || pendingOrbSelection) return;
    vergil?.clearTarget?.();
    syncVergilPatrol(selectedNode);
  }, delayMs);
}

function pingVergilAttention(durationMs = VERGIL_ATTENTION_MS) {
  vergilAttentionUntil = performance.now() + durationMs;
  setVergilAttention(true);
}

function syncVergilAttention(now = performance.now()) {
  const shouldAttend = now < vergilAttentionUntil;
  setVergilAttention(shouldAttend);
}

function speakVergil(message, durationMs = VERGIL_SPEECH_MS) {
  if (!message) return;
  callVergil(['speak', 'setSpeech'], message, durationMs);
}

function buildPatrolNodeIds(anchorNodeId = selectedNode) {
  const ids = [];

  if (pendingOrbSelection?.nodeId) {
    ids.push(pendingOrbSelection.nodeId);
  }

  if (anchorNodeId) {
    ids.push(anchorNodeId);
  }

  if (ids.length > 0) {
    const anchor = ids[0];
    const neighbors = tesseract?.getNeighbors(anchor) || [];
    neighbors
      .sort((a, b) => (b.linkCount || 0) - (a.linkCount || 0))
      .slice(0, VERGIL_PATROL_LIMIT - 1)
      .forEach((neighbor) => ids.push(neighbor.id));
  } else if (breadcrumbHistory.length > 0) {
    breadcrumbHistory.slice(-VERGIL_PATROL_LIMIT).forEach((nodeId) => ids.push(nodeId));
  } else if (Array.isArray(tesseract?.nodes)) {
    tesseract.nodes
      .slice()
      .sort((a, b) => (b.linkCount || 0) - (a.linkCount || 0))
      .slice(0, VERGIL_PATROL_LIMIT)
      .forEach((node) => ids.push(node.id));
  }

  return [...new Set(ids)].filter(Boolean);
}

function syncVergilPatrol(anchorNodeId = selectedNode) {
  if (!tesseract) return;
  const points = buildPatrolNodeIds(anchorNodeId)
    .map((nodeId) => nodeWorldPosition(nodeId))
    .filter(Boolean);

  callVergil(['setPatrolNodes', 'setPatrolPoints'], points);
}

function computeGraphRadius() {
  if (!Array.isArray(tesseract?.nodes) || tesseract.nodes.length === 0) return graphRadius;
  let maxRadius = 0;
  for (const node of tesseract.nodes) {
    const radius = Math.sqrt((node.x * node.x) + (node.y * node.y) + (node.z * node.z));
    if (radius > maxRadius) maxRadius = radius;
  }
  return Math.max(3200, maxRadius);
}

function syncCameraBounds() {
  graphRadius = computeGraphRadius();
  zoomBounds.min = Math.max(120, graphRadius * GRAPH_ZOOM_MIN_FACTOR);
  zoomBounds.max = THREE.MathUtils.clamp(
    graphRadius * GRAPH_ZOOM_MAX_FACTOR,
    GRAPH_ZOOM_MAX_DISTANCE_MIN,
    GRAPH_ZOOM_MAX_DISTANCE_MAX,
  );
  controls.minDistance = zoomBounds.min;
  controls.maxDistance = zoomBounds.max;
  desiredCameraDistance = clampDistanceForMode(desiredCameraDistance, followMode);
}

function getCameraFocusTarget() {
  if (cameraTargetDesired) return cameraTargetDesired.clone();
  if (controls?.target?.clone) return controls.target.clone();
  return new THREE.Vector3();
}

function computeGraphExtentsXZ() {
  if (!Array.isArray(tesseract?.nodes) || tesseract.nodes.length === 0) {
    return {
      minX: -1,
      maxX: 1,
      minZ: -1,
      maxZ: 1,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const node of tesseract.nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minZ = Math.min(minZ, node.z);
    maxZ = Math.max(maxZ, node.z);
  }

  return {
    minX,
    maxX,
    minZ,
    maxZ,
  };
}

function computeCameraFootprintXZ() {
  const focusTarget = getCameraFocusTarget();
  const planePoint = focusTarget.clone();
  const planeNormal = new THREE.Vector3(0, 1, 0);
  const corners = [
    new THREE.Vector3(-1, -1, 0.5),
    new THREE.Vector3(1, -1, 0.5),
    new THREE.Vector3(1, 1, 0.5),
    new THREE.Vector3(-1, 1, 0.5),
  ];

  return corners.map((corner) => {
    const worldPoint = corner.clone().unproject(camera);
    const direction = worldPoint.sub(camera.position).normalize();
    const ray = new THREE.Ray(camera.position.clone(), direction);
    const hit = intersectRayWithPlane(ray, planePoint, planeNormal)
      || focusTarget.clone().addScaledVector(direction, Math.max(desiredCameraDistance, 1));
    return { x: hit.x, z: hit.z };
  });
}

function applyZoomDelta(deltaY, source = 'canvas') {
  const zoomFactor = Math.exp(deltaY * 0.0011);
  const nextDistance = desiredCameraDistance * zoomFactor;
  setDesiredCameraDistance(nextDistance);

  if (followMode === 'off') {
    const focusTarget = getCameraFocusTarget();
    const offset = camera.position.clone().sub(focusTarget);
    if (offset.lengthSq() < 1) {
      offset.set(0, 0, 1);
    }
    offset.setLength(desiredCameraDistance);
    camera.position.copy(focusTarget).add(offset);
    controls.target.copy(focusTarget);
  }

  if (source === 'minimap' && followMode !== 'off') {
    syncOrbTacticalState();
  }
}

function panCameraFromMinimap(normalized) {
  if (!normalized || !tesseract) return;
  if (followMode !== 'off') {
    setFollowMode('off');
  }

  const extents = computeGraphExtentsXZ();
  const targetX = THREE.MathUtils.lerp(extents.minX, extents.maxX, normalized.x);
  const targetZ = THREE.MathUtils.lerp(extents.minZ, extents.maxZ, normalized.y);
  const currentTarget = getCameraFocusTarget();
  const deltaX = targetX - currentTarget.x;
  const deltaZ = targetZ - currentTarget.z;

  controls.target.x += deltaX;
  controls.target.z += deltaZ;
  camera.position.x += deltaX;
  camera.position.z += deltaZ;
  cameraGoal = null;
  cameraTarget = null;
  cameraGoalDesired = null;
  cameraTargetDesired = null;
}

function getConstructionModeSnapshot() {
  const reported = callVergil(['getConstructionState']) || {};
  return {
    ...constructionModeState,
    ...reported,
    active: Boolean(reported.active ?? constructionModeState.active),
    progress: Number.isFinite(reported.progress) ? reported.progress : constructionModeState.progress,
    durationMs: Number.isFinite(reported.durationMs) ? reported.durationMs : constructionModeState.durationMs,
    segmentIndex: Number.isFinite(reported.segmentIndex) ? reported.segmentIndex : constructionModeState.segmentIndex,
    status: reported.status || (constructionModeState.active ? 'constructing' : 'idle'),
  };
}

function stopConstructionMode(options = {}) {
  const wasActive = constructionModeState.active || Boolean(callVergil(['getConstructionState'])?.active);
  callVergil(['stopConstruction'], {
    settleToAmbient: options.settleToAmbient !== false,
    preserveProgress: Boolean(options.preserveProgress),
    status: options.status || 'idle',
  });

  constructionModeState = {
    active: false,
    progress: options.preserveProgress ? constructionModeState.progress : 0,
    durationMs: constructionModeState.durationMs,
    startedAtMs: 0,
    route: [],
    routeIndex: 0,
    segmentIndex: 0,
    energizedEdgeIndices: new Set(),
    status: options.status || 'idle',
  };

  if (wasActive && !railTravelState && edgeHandle && nodeHandle) {
    clearTravelOverlay(edgeHandle, nodeHandle);
  }
  syncOrbTacticalState();
}

function buildConstructionRoute() {
  if (!Array.isArray(tesseract?.nodes) || tesseract.nodes.length === 0) return null;

  const folderBuckets = new Map();
  for (const node of [...tesseract.nodes].sort((a, b) => {
    if ((b.linkCount || 0) !== (a.linkCount || 0)) return (b.linkCount || 0) - (a.linkCount || 0);
    if ((a.folder || '') !== (b.folder || '')) return (a.folder || '').localeCompare(b.folder || '');
    return (a.title || a.id).localeCompare(b.title || b.id);
  })) {
    if (!folderBuckets.has(node.folder)) folderBuckets.set(node.folder, []);
    folderBuckets.get(node.folder).push(node.id);
  }

  const itinerary = [];
  const bucketEntries = [...folderBuckets.values()];
  const startNodeId = readAttachedVergilNodeId() || selectedNode || bucketEntries[0]?.[0] || tesseract.nodes[0]?.id;
  if (startNodeId) itinerary.push(startNodeId);

  while (bucketEntries.some((bucket) => bucket.length > 0) && itinerary.length < Math.min(180, tesseract.nodes.length)) {
    for (const bucket of bucketEntries) {
      const nextNodeId = bucket.shift();
      if (nextNodeId && !itinerary.includes(nextNodeId)) {
        itinerary.push(nextNodeId);
      }
    }
  }

  const routeNodeIds = [];
  const routePositions = [];
  let previousNodeId = null;

  for (const nodeId of itinerary) {
    const position = nodeWorldPosition(nodeId);
    if (!position) continue;

    if (!previousNodeId) {
      routeNodeIds.push(nodeId);
      routePositions.push(position);
      previousNodeId = nodeId;
      continue;
    }

    const pathNodeIds = tesseract.getShortestPath(previousNodeId, nodeId) || [previousNodeId, nodeId];
    const pathPositions = pathNodeIds.map((pathNodeId) => nodeWorldPosition(pathNodeId)).filter(Boolean);
    if (pathPositions.length === 0) continue;

    for (let index = 1; index < pathPositions.length; index += 1) {
      routeNodeIds.push(pathNodeIds[index]);
      routePositions.push(pathPositions[index]);
    }
    previousNodeId = nodeId;
  }

  if (routePositions.length < 2) return null;

  return {
    nodeIds: routeNodeIds,
    positions: routePositions,
    durationMs: CONSTRUCTION_MODE_DURATION_MS,
    loop: false,
  };
}

function startConstructionMode() {
  const route = buildConstructionRoute();
  if (!route) return;

  clearVergilPatrolResume();
  selectionJourneyState = null;
  selectionArrivalState = null;
  pendingOrbSelection = null;
  orbCandidates = [];
  clearRailTravelState();
  followCameraAnchor = null;

  constructionModeState = {
    active: true,
    progress: 0,
    durationMs: route.durationMs,
    startedAtMs: performance.now(),
    route,
    routeIndex: 0,
    segmentIndex: 0,
    energizedEdgeIndices: new Set(),
    status: 'constructing',
  };

  callVergil(['startConstruction'], route, {
    durationMs: route.durationMs,
    loop: false,
    nodeIds: route.nodeIds,
  });
  updateVergilOperationalState('construction', { attachedNodeId: null });
  pingVergilAttention(VERGIL_ATTENTION_MS);
  speakVergil('Beginning construction sweep.', VERGIL_BRIEF_ATTENTION_MS);
  syncOrbTacticalState();
}

function captureNodePositions() {
  return new Map(tesseract.nodes.map((node) => [
    node.id,
    { x: node.x, y: node.y, z: node.z },
  ]));
}

function applyNodePositions(snapshot) {
  if (!snapshot) return;
  for (const node of tesseract.nodes) {
    const next = snapshot.get(node.id);
    if (!next) continue;
    node.x = next.x;
    node.y = next.y;
    node.z = next.z;
  }
  syncPositions(tesseract, edgeHandle, nodeHandle);
}

function triggerGraphLayoutPreset(preset = activeLayoutPreset) {
  if (!tesseract || !edgeHandle || !nodeHandle || layoutTransitionState) return;
  if (constructionModeState.active) {
    stopConstructionMode({ settleToAmbient: false });
  }

  const fromPositions = captureNodePositions();
  const layoutSeed = Date.now();
  const anchorNodeId = readAttachedVergilNodeId() || selectedNode || null;
  activeLayoutPreset = String(preset || activeLayoutPreset || 'cluster').toLowerCase();

  clearVergilPatrolResume();
  selectionJourneyState = null;
  selectionArrivalState = null;
  clearRailTravelState();
  followCameraAnchor = null;

  tesseract.applyLayoutPreset(activeLayoutPreset, {
    seed: layoutSeed,
    scaleTarget: Math.max(14000, graphRadius),
  });
  const toPositions = captureNodePositions();
  applyNodePositions(fromPositions);

  layoutTransitionState = {
    startedAt: clock.getElapsedTime(),
    duration: SHUFFLE_SETTLE_DURATION,
    fromPositions,
    toPositions,
    anchorNodeId,
    preset: activeLayoutPreset,
    seed: layoutSeed,
  };

  pingVergilAttention(VERGIL_BRIEF_ATTENTION_MS);
  speakVergil(`Reweaving the lattice into ${activeLayoutPreset.replace(/[-_]+/g, ' ')}.`, VERGIL_BRIEF_ATTENTION_MS);
  syncOrbTacticalState();
}

// ============ SMOOTH CAMERA ============
let flyState = null; // kept for compat checks
let cameraGoal = null;
let cameraTarget = null;
let cameraGoalDesired = null;
let cameraTargetDesired = null;
const BASE_FOV = 60;
const CAMERA_GOAL_SMOOTH = 0.08;
const CAMERA_TARGET_SMOOTH = 0.1;
const CAMERA_MOVE_SMOOTH = 0.026;
const CAMERA_TARGET_MOVE_SMOOTH = 0.036;


function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0) / 4294967295;
}

function computeNodeFocusFrame(nodeId, options = {}) {
  const node = tesseract.getNode(nodeId);
  if (!node) return null;

  const target = new THREE.Vector3(node.x, node.y, node.z);
  const approachDist = THREE.MathUtils.clamp(
    desiredCameraDistance || graphRadius * 0.115,
    GRAPH_CAMERA_DISTANCE_MIN,
    Math.min(GRAPH_CAMERA_DISTANCE_MAX, zoomBounds.max),
  );
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
  const tiltAngle = (9 + tiltSeed * 9) * Math.PI / 180;
  const spinAngle = spinSeed * Math.PI * 2;
  const seededOffsetDir = new THREE.Vector3()
    .addScaledVector(fromCenter, Math.cos(tiltAngle))
    .addScaledVector(right, Math.sin(tiltAngle) * Math.cos(spinAngle))
    .addScaledVector(realUp, Math.sin(tiltAngle) * Math.sin(spinAngle))
    .normalize();
  const currentOffsetDir = camera.position.clone().sub(target);
  if (currentOffsetDir.lengthSq() < 1) {
    currentOffsetDir.copy(seededOffsetDir);
  } else {
    currentOffsetDir.normalize();
  }
  const offsetDir = currentOffsetDir.lerp(seededOffsetDir, 0.24).normalize();

  const nextGoal = target.clone().add(offsetDir.multiplyScalar(approachDist));
  return {
    target,
    goal: nextGoal,
  };
}

function flyToNode(nodeId, options = {}) {
  const frame = computeNodeFocusFrame(nodeId, options);
  if (!frame) return;

  if (!cameraGoal) cameraGoal = frame.goal.clone();
  if (!cameraTarget) cameraTarget = frame.target.clone();

  cameraGoalDesired = frame.goal;
  cameraTargetDesired = frame.target.clone();
}

let userDragging = false;

function shouldFollowVergil() {
  const movementState = readVergilState();
  return followMode !== 'off' && (
    movementState === 'free_move'
    || movementState === 'rail_travel'
    || movementState === 'attached'
    || movementState === 'construction'
  );
}

function clampFollowOffset(offset, mode = followMode) {
  if (!offset || offset.lengthSq() < 1) return offset;
  const band = getFollowBand(mode);
  const maxDistance = band.max === Infinity ? zoomBounds.max : band.max;
  const clampedLength = THREE.MathUtils.clamp(offset.length(), band.min || zoomBounds.min, maxDistance);
  offset.setLength(clampedLength);
  offset.y = THREE.MathUtils.clamp(offset.y, 48, Math.max(220, clampedLength * 0.72));
  return offset;
}

function getSelectionJourneyProgress() {
  if (!selectionJourneyState || !railTravelState || !vergil?.root?.position) return 0;
  const positions = railTravelState.positions || [];
  if (positions.length < 2) return 0;
  const segmentCount = Math.max(1, positions.length - 1);
  const currentIndex = THREE.MathUtils.clamp(railTravelState.activeSegmentIndex || 0, 0, segmentCount - 1);
  const start = positions[currentIndex];
  const end = positions[currentIndex + 1];
  if (!start || !end) return currentIndex / segmentCount;
  tempRailSegment.copy(end).sub(start);
  const lengthSq = tempRailSegment.lengthSq();
  let segmentProgress = 0;
  if (lengthSq > 0.0001) {
    tempRailPoint.copy(vergil.root.position).sub(start);
    segmentProgress = THREE.MathUtils.clamp(tempRailPoint.dot(tempRailSegment) / lengthSq, 0, 1);
  }
  return THREE.MathUtils.clamp((currentIndex + segmentProgress) / segmentCount, 0, 1);
}

function updateSelectionJourneyCamera() {
  if (!selectionJourneyState?.targetNodeId) return false;
  const frame = computeNodeFocusFrame(selectionJourneyState.targetNodeId, {
    deterministic: selectionJourneyState.options?.deterministicFocus !== false,
  });
  if (!frame) return false;
  const vergilPosition = getVergilPosition();
  if (!vergilPosition) {
    cameraGoalDesired = frame.goal;
    cameraTargetDesired = frame.target.clone();
    return true;
  }

  const progress = getSelectionJourneyProgress();
  const focusBlend = THREE.MathUtils.lerp(0.18, 1, progress);
  tempJourneyTarget.copy(vergilPosition).lerp(frame.target, focusBlend);
  tempJourneyOffset.copy(frame.goal).sub(frame.target);
  tempJourneyGoal.copy(tempJourneyTarget).addScaledVector(tempJourneyOffset, THREE.MathUtils.lerp(1.18, 1, progress));
  cameraGoalDesired = tempJourneyGoal.clone();
  cameraTargetDesired = tempJourneyTarget.clone();
  return true;
}

function updateFollowCamera() {
  if (!shouldFollowVergil() || !vergil?.root?.position) {
    followCameraAnchor = null;
    return false;
  }

  const nextTarget = vergil.root.position.clone();
  if (followMode === 'fov') {
    const forward = new THREE.Vector3();
    vergil.root.getWorldDirection(forward);
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, 1);
    forward.normalize();
    const band = getFollowBand('fov');
    const followDistance = THREE.MathUtils.clamp(desiredCameraDistance || band.default, band.min, band.max);
    desiredCameraDistance = followDistance;
    const desiredTarget = nextTarget.clone().addScaledVector(forward, followDistance * 1.5);
    const desiredPosition = nextTarget.clone()
      .addScaledVector(forward, -followDistance)
      .add(new THREE.Vector3(0, Math.max(46, followDistance * 0.42), 0));
    controls.target.lerp(desiredTarget, 0.14);
    camera.position.lerp(desiredPosition, 0.12);
    return true;
  }

  if (!followCameraAnchor?.offset) {
    followCameraAnchor = {
      offset: camera.position.clone().sub(controls.target),
    };
    clampFollowOffset(followCameraAnchor.offset, followMode);
  }

  if (userDragging) {
    followCameraAnchor.offset.copy(camera.position).sub(controls.target);
    clampFollowOffset(followCameraAnchor.offset, followMode);
    desiredCameraDistance = followCameraAnchor.offset.length();
    return false;
  }

  if (followCameraAnchor.offset.lengthSq() < 1) {
    const band = getFollowBand(followMode);
    followCameraAnchor.offset.set(band.default * 0.4, band.default * 0.22, band.default * 0.66);
  }

  const band = getFollowBand(followMode);
  desiredCameraDistance = THREE.MathUtils.clamp(desiredCameraDistance || band.default, band.min, band.max);
  followCameraAnchor.offset.setLength(desiredCameraDistance);
  clampFollowOffset(followCameraAnchor.offset, followMode);

  const desiredPosition = nextTarget.clone().add(followCameraAnchor.offset);
  controls.target.lerp(nextTarget, 0.1);
  camera.position.lerp(desiredPosition, 0.085);
  return true;
}

function updateCamera() {
  const journeyCameraActive = updateSelectionJourneyCamera();
  if (!journeyCameraActive && updateFollowCamera()) {
    cameraGoal = null;
    cameraTarget = null;
    cameraGoalDesired = null;
    cameraTargetDesired = null;
    return;
  }
  if (!cameraGoalDesired || !cameraTargetDesired) return;
  // Don't fight with user's manual orbit
  if (userDragging) {
    cameraGoal = null;
    cameraTarget = null;
    cameraGoalDesired = null;
    cameraTargetDesired = null;
    return;
  }

  if (!cameraGoal) cameraGoal = cameraGoalDesired.clone();
  if (!cameraTarget) cameraTarget = cameraTargetDesired.clone();

  cameraGoal.lerp(cameraGoalDesired, CAMERA_GOAL_SMOOTH);
  cameraTarget.lerp(cameraTargetDesired, CAMERA_TARGET_SMOOTH);

  camera.position.lerp(cameraGoal, CAMERA_MOVE_SMOOTH);
  controls.target.lerp(cameraTarget, CAMERA_TARGET_MOVE_SMOOTH);

  if (
    camera.position.distanceTo(cameraGoalDesired) < 0.5 &&
    controls.target.distanceTo(cameraTargetDesired) < 0.5
  ) {
    cameraGoal = null;
    cameraTarget = null;
    cameraGoalDesired = null;
    cameraTargetDesired = null;
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

const commandCursor = document.createElement('div');
commandCursor.style.cssText = `
  position: fixed;
  width: ${COMMAND_CURSOR_SIZE}px;
  height: ${COMMAND_CURSOR_SIZE}px;
  display: none;
  pointer-events: none;
  z-index: 19;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  border: 1px solid rgba(150, 208, 255, 0.72);
  box-shadow:
    0 0 18px rgba(92, 164, 255, 0.24),
    inset 0 0 16px rgba(91, 170, 255, 0.1);
  background: radial-gradient(circle, rgba(123, 187, 255, 0.14), rgba(14, 24, 42, 0) 68%);
  backdrop-filter: blur(4px);
`;
const commandCursorDot = document.createElement('div');
commandCursorDot.style.cssText = `
  position: absolute;
  inset: 50% auto auto 50%;
  width: 5px;
  height: 5px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: rgba(231, 244, 255, 0.92);
  box-shadow: 0 0 10px rgba(138, 203, 255, 0.52);
`;
commandCursor.appendChild(commandCursorDot);
document.body.appendChild(commandCursor);

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

function setCommandCursorVisible(visible) {
  commandCursor.style.display = visible ? 'block' : 'none';
}

function updateCommandCursor(clientX, clientY, options = {}) {
  commandCursor.style.left = `${clientX}px`;
  commandCursor.style.top = `${clientY}px`;
  commandCursor.style.borderColor = options.nodeTarget
    ? 'rgba(194, 229, 255, 0.92)'
    : 'rgba(150, 208, 255, 0.72)';
  commandCursor.style.boxShadow = options.nodeTarget
    ? '0 0 22px rgba(110, 188, 255, 0.38), inset 0 0 16px rgba(140, 208, 255, 0.16)'
    : '0 0 18px rgba(92, 164, 255, 0.24), inset 0 0 16px rgba(91, 170, 255, 0.1)';
  commandCursorDot.style.transform = options.nodeTarget
    ? 'translate(-50%, -50%) scale(1.18)'
    : 'translate(-50%, -50%) scale(1)';
}

function spawnCommandClickPulse(clientX, clientY, tone = 'world') {
  const pulse = document.createElement('div');
  pulse.style.cssText = `
    position: fixed;
    left: ${clientX}px;
    top: ${clientY}px;
    width: 22px;
    height: 22px;
    pointer-events: none;
    z-index: 18;
    transform: translate(-50%, -50%);
    border-radius: 999px;
    border: 1px solid ${tone === 'node' ? 'rgba(214, 238, 255, 0.9)' : 'rgba(118, 194, 255, 0.88)'};
    box-shadow: 0 0 20px ${tone === 'node' ? 'rgba(162, 213, 255, 0.34)' : 'rgba(71, 142, 255, 0.28)'};
  `;
  document.body.appendChild(pulse);
  const animation = pulse.animate(
    [
      { opacity: 0.95, transform: 'translate(-50%, -50%) scale(0.72)' },
      { opacity: 0.48, transform: 'translate(-50%, -56%) scale(1.45)' },
      { opacity: 0, transform: 'translate(-50%, -64%) scale(2.2)' },
    ],
    {
      duration: 420,
      easing: 'cubic-bezier(0.18, 0.82, 0.24, 1)',
      fill: 'forwards',
    },
  );
  animation.onfinish = () => pulse.remove();
}

// ============ AUTO-ROTATION ============
let autoRotateOn = false;
let lastInteraction = performance.now();
const IDLE_TIMEOUT = 5000;
const AUTO_ROTATE_SPEED = 0.35;

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
  controls.autoRotate = autoRotateOn && followMode !== 'fov';
  controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
  controls.enableRotate = followMode !== 'fov';
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
function nodeWorldPosition(nodeId) {
  const node = tesseract?.getNode(nodeId);
  if (!node) return null;
  return new THREE.Vector3(node.x, node.y, node.z);
}

function findNearestNodeIdToPosition(position) {
  if (!position || !Array.isArray(tesseract?.nodes)) return null;
  let nearestNodeId = null;
  let nearestDistanceSq = Infinity;
  for (const node of tesseract.nodes) {
    const dx = node.x - position.x;
    const dy = node.y - position.y;
    const dz = node.z - position.z;
    const distanceSq = (dx * dx) + (dy * dy) + (dz * dz);
    if (distanceSq < nearestDistanceSq) {
      nearestDistanceSq = distanceSq;
      nearestNodeId = node.id;
    }
  }
  return nearestNodeId;
}

function getVergilPosition() {
  if (!vergil?.root?.position) return null;
  return vergil.root.position.clone();
}

function clearRailTravelState() {
  railTravelState = null;
  if (edgeHandle && nodeHandle) {
    clearTravelOverlay(edgeHandle, nodeHandle);
  }
}

function setRailTravelState(nextState) {
  railTravelState = nextState ? {
    ...nextState,
    activeSegmentProgress: Number.isFinite(nextState.activeSegmentProgress) ? nextState.activeSegmentProgress : 0,
    litEdgeIndices: nextState.litEdgeIndices instanceof Set
      ? nextState.litEdgeIndices
      : new Set(Array.isArray(nextState.litEdgeIndices) ? nextState.litEdgeIndices : []),
  } : null;
  if (!railTravelState) {
    clearRailTravelState();
    return;
  }
  if (!edgeHandle || !nodeHandle) return;
  const startNodeId = railTravelState.pathNodeIds?.[railTravelState.activeSegmentIndex] || null;
  const activeEdgeIndex = tesseract?.getEdgeIndexByPair?.(
    startNodeId,
    railTravelState.pathNodeIds?.[railTravelState.activeSegmentIndex + 1],
  );
  setTravelOverlay(edgeHandle, nodeHandle, {
    pathNodeIds: railTravelState.pathNodeIds,
    beamEdgeIndex: activeEdgeIndex,
    beamOriginNodeId: startNodeId,
    beamProgress: railTravelState.activeSegmentProgress,
    beamStrength: railTravelState.activeIntensity,
    recentEdgeIndices: [...railTravelState.litEdgeIndices],
    recentIntensity: railTravelState.recentIntensity,
    decayPerSecond: railTravelState.decayPerSecond,
    arrivalNodeId: null,
    reset: true,
    resetRecent: true,
  }, tesseract);
}

function clearVergilCommand() {
  if (constructionModeState.active) {
    stopConstructionMode({ settleToAmbient: false });
  }
  clearRailTravelState();
  attachedVergilNodeId = null;
  callVergil(['clearCommand', 'clearTarget']);
  syncOrbTacticalState({ vergilState: 'ambient' });
}

function updateVergilOperationalState(nextState, options = {}) {
  if (typeof nextState === 'string' && nextState) {
    lastVergilState = nextState;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'attachedNodeId')) {
    attachedVergilNodeId = options.attachedNodeId;
  }
  syncOrbTacticalState();
}

function intersectRayWithPlane(ray, planePoint, planeNormal) {
  const denominator = planeNormal.dot(ray.direction);
  if (Math.abs(denominator) < 1e-5) return null;

  const distance = planePoint.clone().sub(ray.origin).dot(planeNormal) / denominator;
  if (distance <= 0) return null;
  return ray.origin.clone().addScaledVector(ray.direction, distance);
}

function getCommandAnchor() {
  const focusTarget = nodeWorldPosition(selectedNode)
    || controls.target?.clone?.()
    || new THREE.Vector3();
  const vergilPosition = getVergilPosition();

  if (vergilPosition && vergilPosition.distanceTo(focusTarget) <= 2200) {
    return vergilPosition;
  }

  return focusTarget;
}

function worldCommandPointFromPointer(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const commandAnchor = getCommandAnchor();
  const cameraDistance = camera.position.distanceTo(commandAnchor);
  const commandRadius = THREE.MathUtils.clamp(cameraDistance * 0.55, 360, 2200);
  const planeNormal = camera.position.clone().sub(commandAnchor).normalize();
  const commandPoint = intersectRayWithPlane(raycaster.ray, commandAnchor, planeNormal)
    || raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, Math.max(commandRadius, cameraDistance * 0.35));

  const relativePoint = commandPoint.sub(commandAnchor);
  if (relativePoint.lengthSq() > commandRadius * commandRadius) {
    relativePoint.setLength(commandRadius);
  }
  relativePoint.y = THREE.MathUtils.clamp(relativePoint.y, -commandRadius * 0.58, commandRadius * 0.58);
  commandPoint.copy(commandAnchor).add(relativePoint);

  if (commandPoint.lengthSq() > COMMAND_WORLD_RADIUS * COMMAND_WORLD_RADIUS) {
    commandPoint.setLength(COMMAND_WORLD_RADIUS);
  }

  return commandPoint;
}

function clearCommandHover() {
  commandHoverPoint = null;
  commandHoverNodeId = null;
  callVergil(['clearCommandPreview']);
  setCommandCursorVisible(false);
}

function updateCommandHoverFromPointer(clientX, clientY) {
  if (!commandMode) {
    clearCommandHover();
    return;
  }

  const hoveredNodeId = hitTestNode(clientX, clientY);
  const hoverPoint = hoveredNodeId ? nodeWorldPosition(hoveredNodeId) : worldCommandPointFromPointer(clientX, clientY);
  if (!hoverPoint) {
    clearCommandHover();
    return;
  }

  commandHoverNodeId = hoveredNodeId;
  commandHoverPoint = hoverPoint.clone();
  callVergil(['setCommandPreview'], commandHoverPoint.clone());
  updateCommandCursor(clientX, clientY, { nodeTarget: Boolean(hoveredNodeId) });
  setCommandCursorVisible(true);
}

function commandVergilToWorld(point) {
  if (!point) return;
  if (constructionModeState.active) {
    stopConstructionMode({ settleToAmbient: false });
  }
  clearRailTravelState();
  attachedVergilNodeId = null;
  callVergil(['moveToWorld'], point.clone());
  updateVergilOperationalState('free_move', { attachedNodeId: null });
}

function commandVergilToNode(nodeId) {
  const position = nodeWorldPosition(nodeId);
  if (!position) return;
  if (constructionModeState.active) {
    stopConstructionMode({ settleToAmbient: false });
  }

  const currentAttachedNodeId = readAttachedVergilNodeId();
  if (currentAttachedNodeId && currentAttachedNodeId !== nodeId) {
    const pathNodeIds = tesseract?.getShortestPath?.(currentAttachedNodeId, nodeId) || null;
    const pathPositions = pathNodeIds?.map((pathNodeId) => nodeWorldPosition(pathNodeId)).filter(Boolean) || [];

    if (Array.isArray(pathNodeIds) && pathNodeIds.length > 1 && pathPositions.length === pathNodeIds.length) {
      callVergil(['travelPath'], pathNodeIds, pathPositions);
      setRailTravelState({
        kind: 'command',
        pathNodeIds,
        positions: pathPositions,
        destinationNodeId: nodeId,
        activeSegmentIndex: 0,
        activeIntensity: 1,
        recentIntensity: 0.82,
        decayPerSecond: 0.95,
      });
      updateVergilOperationalState('rail_travel', { attachedNodeId: currentAttachedNodeId });
      pingVergilAttention(VERGIL_BRIEF_ATTENTION_MS);
      speakVergil('Routing through the lattice.', VERGIL_BRIEF_ATTENTION_MS);
      return;
    }
  }

  clearRailTravelState();
  callVergil(['attachToNode'], nodeId, position.clone());
  updateVergilOperationalState('attached', { attachedNodeId: nodeId });
  pingVergilAttention(VERGIL_BRIEF_ATTENTION_MS);
  speakVergil(`Attached to ${tesseract?.getNode(nodeId)?.title || 'node'}.`, VERGIL_BRIEF_ATTENTION_MS);
}

function issueVergilCommand(clientX, clientY) {
  const commandedNodeId = commandHoverNodeId || hitTestNode(clientX, clientY);
  if (commandedNodeId) {
    spawnCommandClickPulse(clientX, clientY, 'node');
    commandVergilToNode(commandedNodeId);
    return;
  }

  const point = commandHoverPoint?.clone() || worldCommandPointFromPointer(clientX, clientY);
  if (!point) return;
  spawnCommandClickPulse(clientX, clientY, 'world');
  commandVergilToWorld(point);
}

function completeSelectionArrival(nodeId, options = {}, elapsed = clock.getElapsedTime()) {
  const traveledEdgeIndices = [...(railTravelState?.litEdgeIndices || [])];
  selectionJourneyState = null;
  railTravelState = null;
  attachedVergilNodeId = nodeId;
  updateVergilOperationalState('attached', { attachedNodeId: nodeId });
  selectionArrivalState = { nodeId, startedAt: elapsed };
  const connectedEdges = [...(edgeHandle?.edgeIndex?.get(nodeId) || [])];
  selectNode(nodeId, {
    deterministicFocus: options.deterministicFocus !== false,
    forceFocus: true,
    source: options.source || 'graph',
  });
  if (edgeHandle && nodeHandle) {
    setTravelOverlay(edgeHandle, nodeHandle, {
      recentEdgeIndices: [...new Set([...traveledEdgeIndices, ...connectedEdges])],
      recentStrength: 0.42,
      decayPerSecond: 1.12,
      waveEdgeIndices: connectedEdges,
      waveOriginNodeId: nodeId,
      waveDuration: 0.86,
      waveStrength: 0.7,
      arrivalNodeId: nodeId,
      arrivalStrength: 0.38,
      arrivalDuration: 0.96,
      elapsed,
      reset: false,
      resetRecent: true,
    }, tesseract);
  }
  pingVergilAttention(VERGIL_BRIEF_ATTENTION_MS);
  speakVergil('Selection lock confirmed.', VERGIL_BRIEF_ATTENTION_MS);
  if (options.openOnArrival) {
    sidebarApi?.openInlineReader?.(nodeId);
  }
}

function requestGraphSelection(nodeId, options = {}) {
  if (!nodeId || !tesseract) return;
  if (constructionModeState.active) {
    stopConstructionMode({ settleToAmbient: false });
  }
  clearVergilPatrolResume();
  const previousSelectedNode = selectedNode;

  if (nodeId === selectedNode && !selectionJourneyState) {
    flyToNode(nodeId, { deterministic: options.deterministicFocus !== false });
    if (options.openOnArrival) {
      sidebarApi?.openInlineReader?.(nodeId);
    }
    return;
  }

  selectionArrivalState = null;
  clearRailTravelState();
  if (edgeHandle && nodeHandle) {
    clearSelection(edgeHandle, nodeHandle);
  }
  selectedTitle.style.display = 'none';
  selectedNode = null;

  const currentAttachedNodeId = readAttachedVergilNodeId();
  const startNodeId = currentAttachedNodeId
    || previousSelectedNode
    || findNearestNodeIdToPosition(getVergilPosition());
  const destinationPosition = nodeWorldPosition(nodeId);
  if (!destinationPosition) return;

  if (!startNodeId || startNodeId === nodeId) {
    callVergil(['attachToNode'], nodeId, destinationPosition.clone());
    updateVergilOperationalState('attached', { attachedNodeId: nodeId });
    completeSelectionArrival(nodeId, options);
    return;
  }

  const pathNodeIds = tesseract.getShortestPath(startNodeId, nodeId);
  const pathPositions = pathNodeIds?.map((pathNodeId) => nodeWorldPosition(pathNodeId)).filter(Boolean) || [];
  if (!Array.isArray(pathNodeIds) || pathNodeIds.length < 2 || pathPositions.length !== pathNodeIds.length) {
    callVergil(['attachToNode'], nodeId, destinationPosition.clone());
    updateVergilOperationalState('attached', { attachedNodeId: nodeId });
    completeSelectionArrival(nodeId, options);
    return;
  }

  selectionJourneyState = {
    targetNodeId: nodeId,
    options: {
      deterministicFocus: options.deterministicFocus !== false,
      source: options.source || 'graph',
      openOnArrival: Boolean(options.openOnArrival),
    },
  };
  callVergil(['travelPath'], pathNodeIds, pathPositions);
  setRailTravelState({
    kind: 'selection',
    pathNodeIds,
    positions: pathPositions,
    destinationNodeId: nodeId,
    activeSegmentIndex: 0,
    activeIntensity: 1,
    recentIntensity: 0.94,
    decayPerSecond: 0.52,
  });
  updateVergilOperationalState('rail_travel', { attachedNodeId: startNodeId });
  pingVergilAttention(VERGIL_BRIEF_ATTENTION_MS);
  speakVergil('Riding the lattice.', VERGIL_BRIEF_ATTENTION_MS);
}

function updateConstructionMode() {
  const previousActive = constructionModeState.active;
  const snapshot = getConstructionModeSnapshot();
  constructionModeState = {
    ...constructionModeState,
    ...snapshot,
    active: Boolean(snapshot.active),
    progress: snapshot.progress,
    durationMs: snapshot.durationMs,
    segmentIndex: Number.isFinite(snapshot.segmentIndex) ? snapshot.segmentIndex : 0,
    status: snapshot.status || (snapshot.active ? 'constructing' : 'idle'),
    energizedEdgeIndices: constructionModeState.energizedEdgeIndices || new Set(),
  };

  if (!constructionModeState.active) {
    if (previousActive && !railTravelState && edgeHandle && nodeHandle) {
      clearTravelOverlay(edgeHandle, nodeHandle);
    }
    if (previousActive) {
      syncOrbTacticalState();
    }
    return;
  }

  const routeNodeIds = constructionModeState.route?.nodeIds || [];
  if (routeNodeIds.length < 2 || !edgeHandle || !nodeHandle) {
    syncOrbTacticalState();
    return;
  }

  const activeSegmentIndex = THREE.MathUtils.clamp(constructionModeState.segmentIndex || 0, 0, routeNodeIds.length - 2);
  const previousSegmentIndex = Number.isFinite(constructionModeState.routeIndex) ? constructionModeState.routeIndex : activeSegmentIndex;
  if (activeSegmentIndex > previousSegmentIndex) {
    for (let index = previousSegmentIndex; index < activeSegmentIndex; index += 1) {
      const traveledEdgeIndex = tesseract?.getEdgeIndexByPair?.(routeNodeIds[index], routeNodeIds[index + 1]);
      if (traveledEdgeIndex != null) {
        constructionModeState.energizedEdgeIndices.add(traveledEdgeIndex);
      }
    }
  }
  constructionModeState.routeIndex = activeSegmentIndex;

  const activeEdgeIndex = tesseract?.getEdgeIndexByPair?.(
    routeNodeIds[activeSegmentIndex],
    routeNodeIds[activeSegmentIndex + 1],
  );
  setTravelOverlay(edgeHandle, nodeHandle, {
    activeEdgeIndex,
    recentEdgeIndices: [...constructionModeState.energizedEdgeIndices],
    activeIntensity: 0.84,
    recentIntensity: 0.38,
    recentStrength: 0.4,
    decayPerSecond: 0.03,
    reset: true,
  }, tesseract);

  syncOrbTacticalState();
}

function updateRailTravelOverlay(elapsed) {
  if (!edgeHandle || !nodeHandle) return;
  if (constructionModeState.active) {
    return;
  }
  if (!railTravelState || !vergil?.root?.position) {
    tickTravelOverlay(elapsed, edgeHandle, nodeHandle);
    return;
  }

  const currentPosition = railTravelState.positions[railTravelState.activeSegmentIndex];
  const nextPosition = railTravelState.positions[railTravelState.activeSegmentIndex + 1];
  let activeSegmentProgress = 0;
  if (currentPosition && nextPosition) {
    tempRailSegment.copy(nextPosition).sub(currentPosition);
    const segmentLengthSq = tempRailSegment.lengthSq();
    if (segmentLengthSq > 0.0001) {
      tempRailPoint.copy(vergil.root.position).sub(currentPosition);
      activeSegmentProgress = THREE.MathUtils.clamp(tempRailPoint.dot(tempRailSegment) / segmentLengthSq, 0, 1);
    }
  }
  railTravelState.activeSegmentProgress = activeSegmentProgress;

  if (nextPosition && (
    activeSegmentProgress >= 0.995
    || vergil.root.position.distanceTo(nextPosition) <= RAIL_SEGMENT_ADVANCE_DISTANCE
  )) {
    const previousEdgeIndex = tesseract?.getEdgeIndexByPair?.(
      railTravelState.pathNodeIds?.[railTravelState.activeSegmentIndex],
      railTravelState.pathNodeIds?.[railTravelState.activeSegmentIndex + 1],
    );
    if (previousEdgeIndex != null) {
      railTravelState.litEdgeIndices.add(previousEdgeIndex);
    }
    railTravelState.activeSegmentIndex += 1;
    railTravelState.activeSegmentProgress = 0;
    if (railTravelState.activeSegmentIndex >= railTravelState.positions.length - 1) {
      const completedTravel = railTravelState;
      if (completedTravel.kind === 'selection') {
        railTravelState.activeSegmentIndex = Math.max(0, completedTravel.positions.length - 2);
        return;
      }
      attachedVergilNodeId = railTravelState.destinationNodeId;
      railTravelState = null;
      updateVergilOperationalState('attached', { attachedNodeId: attachedVergilNodeId });
      setTravelOverlay(edgeHandle, nodeHandle, {
        pathNodeIds: completedTravel.pathNodeIds,
        recentEdgeIndices: [...completedTravel.litEdgeIndices],
        arrivalNodeId: completedTravel.destinationNodeId,
        arrivalStrength: 1,
        arrivalDuration: 1.6,
        beamEdgeIndex: null,
        beamOriginNodeId: null,
        beamProgress: 0,
        beamStrength: 0,
        recentIntensity: completedTravel.recentIntensity,
        decayPerSecond: completedTravel.decayPerSecond,
        reset: true,
        resetRecent: true,
      }, tesseract);
      speakVergil('Arrival confirmed.', VERGIL_BRIEF_ATTENTION_MS);
      return;
    }
  }

  const activeEdgeIndex = tesseract?.getEdgeIndexByPair?.(
    railTravelState.pathNodeIds?.[railTravelState.activeSegmentIndex],
    railTravelState.pathNodeIds?.[railTravelState.activeSegmentIndex + 1],
  );
  setTravelOverlay(edgeHandle, nodeHandle, {
    pathNodeIds: railTravelState.pathNodeIds,
    beamEdgeIndex: activeEdgeIndex,
    beamOriginNodeId: railTravelState.pathNodeIds?.[railTravelState.activeSegmentIndex] || null,
    beamProgress: railTravelState.activeSegmentProgress,
    beamStrength: railTravelState.activeIntensity,
    recentEdgeIndices: [...railTravelState.litEdgeIndices],
    recentIntensity: railTravelState.recentIntensity,
    decayPerSecond: railTravelState.decayPerSecond,
    reset: true,
    resetRecent: true,
  }, tesseract);
  tickTravelOverlay(elapsed, edgeHandle, nodeHandle);
}

function selectNode(nodeId, options = {}) {
  const { deterministicFocus = true, forceFocus = false, source = 'graph' } = options;
  const wasSameNode = nodeId === selectedNode;
  selectedNode = nodeId;
  if (nodeId && edgeHandle && nodeHandle) {
    highlightSelection(edgeHandle, nodeHandle, nodeId, tesseract);
    if (!wasSameNode || forceFocus) {
      flyToNode(nodeId, { deterministic: deterministicFocus });
    }
    const position = nodeWorldPosition(nodeId);
    if (position && (source === 'orb' || forceFocus)) {
      vergil?.setPreviewTarget(position);
    }
    syncVergilPatrol(nodeId);
    // Breadcrumb
    if (!breadcrumbHistory.includes(nodeId)) {
      breadcrumbHistory.push(nodeId);
      if (breadcrumbHistory.length > 10) breadcrumbHistory.shift();
      updateBreadcrumbs();
    }
  } else {
    clearSelection(edgeHandle, nodeHandle);
    vergil?.clearTarget();
    syncVergilPatrol(null);
  }

  if (source !== 'orb' && pendingOrbSelection && pendingOrbSelection.nodeId !== nodeId) {
    pendingOrbSelection = null;
    if (orbCandidates.length > 0) {
      setOrbState({
        mode: 'candidates',
        candidates: orbCandidates,
      });
    } else if (!clarificationContext) {
      setOrbState({ mode: 'idle' });
    }
  }

  for (const cb of onSelectCallbacks) cb(nodeId);
}

function deselectNode() {
  if (constructionModeState.active) {
    stopConstructionMode({ settleToAmbient: false });
  }
  selectionJourneyState = null;
  selectionArrivalState = null;
  selectedNode = null;
  selectedTitle.style.display = 'none';
  clearVergilPatrolResume();
  clearRailTravelState();
  if (edgeHandle && nodeHandle) clearSelection(edgeHandle, nodeHandle);
  vergil?.clearTarget();
  syncVergilPatrol(null);
  for (const cb of onSelectCallbacks) cb(null);
}

function openInlineNode(nodeId, options = {}) {
  if (!nodeId) return;
  selectNode(nodeId, {
    deterministicFocus: options.deterministicFocus !== false,
    forceFocus: Boolean(options.forceFocus),
    source: options.source || 'graph',
  });
  sidebarApi?.openInlineReader(nodeId);
}

function resolveOrbNodeRef(ref) {
  if (!tesseract) return { node: null, validation: { nodeExists: false, pathExists: false } };
  return tesseract.resolveNodeRef(ref);
}

function toOrbArmedState(selection) {
  return {
    mode: 'armed',
    armedSelection: selection,
  };
}

function showOrbError(message) {
  speakVergil(message, VERGIL_SPEECH_MS);
  setOrbState({
    mode: 'error',
    message,
  });
}

function previewOrbSelection(selection, options = {}) {
  clearVergilPatrolResume();
  const resolution = resolveOrbNodeRef(selection);
  if (!resolution.node) {
    showOrbError('Resolved path was not found in the loaded graph.');
    return;
  }

  pendingOrbSelection = {
    ...selection,
    nodeId: resolution.node.id,
    source: options.source || 'resolved',
  };

  speakVergil(`Target lock on ${resolution.node.title || resolution.node.id}. Activate when ready.`, VERGIL_SPEECH_MS);
  pingVergilAttention(VERGIL_BRIEF_ATTENTION_MS);

  selectNode(resolution.node.id, {
    deterministicFocus: true,
    forceFocus: true,
    source: 'orb',
  });

  if (pendingOrbSelection.source === 'candidates' && orbCandidates.length > 0) {
    setOrbState({
      mode: 'candidates',
      candidates: orbCandidates,
      armedSelection: pendingOrbSelection,
    });
    return;
  }

  setOrbState(toOrbArmedState(pendingOrbSelection));
}

function activatePendingOrbSelection() {
  if (!pendingOrbSelection) return;
  clearVergilPatrolResume();
  const activatedSelection = pendingOrbSelection;

  const position = nodeWorldPosition(activatedSelection.nodeId);
  if (position) {
    vergil?.activateTarget(position);
  }

  speakVergil(`Node engaged. Opening ${activatedSelection.title || 'the note'}.`, VERGIL_BRIEF_ATTENTION_MS);

  openInlineNode(activatedSelection.nodeId, {
    deterministicFocus: true,
    forceFocus: true,
    source: 'orb',
  });
  pendingOrbSelection = null;
  orbCandidates = [];
  setOrbState({ mode: 'idle' });
  scheduleVergilPatrolResume();
}

function dismissPendingOrbSelection() {
  if (!pendingOrbSelection) return;
  clearVergilPatrolResume();
  pendingOrbSelection = null;
  speakVergil('Standing down. The field is still live if you want another pass.', VERGIL_BRIEF_ATTENTION_MS);
  vergil?.clearTarget?.();
  syncVergilPatrol(selectedNode);

  if (orbCandidates.length > 0) {
    setOrbState({
      mode: 'candidates',
      candidates: orbCandidates,
    });
    return;
  }

  setOrbState({ mode: 'idle' });
}

function normalizeOrbCandidate(candidate) {
  const resolution = resolveOrbNodeRef(candidate);
  if (!resolution.node) return null;
  return {
    ...candidate,
    nodeId: resolution.node.id,
  };
}

async function submitOrbQuery(query, options = {}) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return;
  const followUpContext = clarificationContext;
  pendingOrbSelection = null;
  orbCandidates = [];
  pingVergilAttention();
  speakVergil(`Scanning for ${trimmed}.`, VERGIL_BRIEF_ATTENTION_MS);

  setOrbState({ mode: 'searching' });

  try {
    const response = await retrievalClient.retrieve(trimmed, followUpContext, {
      maxCandidates: options.maxCandidates,
    });

    if (response.intent === 'resolved') {
      clarificationContext = null;
      speakVergil(`I found ${response.resolved?.title || 'a strong match'}. I will hold on it for you.`, VERGIL_SPEECH_MS);
      previewOrbSelection(response.resolved, {
        source: 'resolved',
      });
      return;
    }

    if (response.intent === 'candidates') {
      clarificationContext = null;
      const candidates = response.candidates.map(normalizeOrbCandidate).filter(Boolean);
      if (candidates.length === 0) {
        showOrbError('Returned candidates did not map to real notes.');
        return;
      }
      orbCandidates = candidates;
      const lead = candidates[0];
      speakVergil(
        lead
          ? `I have a few plausible locks. ${lead.title} is leading, but I would rather let you choose.`
          : 'I have a few plausible locks. Choose the one you actually meant.',
        VERGIL_SPEECH_MS,
      );
      setOrbState({
        mode: 'candidates',
        candidates,
      });
      return;
    }

    clarificationContext = {
      previousQuery: followUpContext?.previousQuery || trimmed,
      question: response.question,
    };
    speakVergil(response.question, VERGIL_SPEECH_MS);
    setOrbState({
      mode: 'clarification',
      question: response.question,
      candidateHints: response.candidateHints || [],
    });
  } catch (error) {
    showOrbError(error.message || 'Orb request failed.');
  }
}

// ============ CLICK DETECTION ============
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 32;
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

controls.addEventListener('start', () => {
  userDragging = true;
});

controls.addEventListener('end', () => {
  userDragging = false;
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (commandMode && e.button === 2) {
    e.preventDefault();
    updateCommandHoverFromPointer(e.clientX, e.clientY);
    issueVergilCommand(e.clientX, e.clientY);
    mouseDownPos = null;
    return;
  }

  mouseDownPos = { x: e.clientX, y: e.clientY, button: e.button };
  if (commandMode) {
    updateCommandHoverFromPointer(e.clientX, e.clientY);
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!commandMode) return;
  updateCommandHoverFromPointer(e.clientX, e.clientY);
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!mouseDownPos) return;
  const dx = e.clientX - mouseDownPos.x;
  const dy = e.clientY - mouseDownPos.y;
  const button = mouseDownPos.button;
  mouseDownPos = null;
  if (Math.abs(dx) + Math.abs(dy) > 5) return;

  if (button !== 0) return;

  const nodeId = hitTestNode(e.clientX, e.clientY);
  if (nodeId) {
    requestGraphSelection(nodeId, {
      deterministicFocus: true,
      source: 'graph',
    });
  } else {
    deselectNode();
  }
});

renderer.domElement.addEventListener('pointercancel', () => {
  mouseDownPos = null;
  clearCommandHover();
});

renderer.domElement.addEventListener('pointerleave', () => {
  clearCommandHover();
});

renderer.domElement.addEventListener('pointerenter', (event) => {
  if (commandMode) {
    updateCommandHoverFromPointer(event.clientX, event.clientY);
  }
});

renderer.domElement.addEventListener('contextmenu', (event) => {
  if (!commandMode) return;
  event.preventDefault();
});

renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault();
  applyZoomDelta(event.deltaY, 'canvas');
}, { passive: false });


// ============ NAV POLLING ============
async function pollNavCommand() {
  try {
    const res = await fetch('/nav-command.json?t=' + Date.now());
    if (!res.ok) return;
    const cmd = await res.json();
    if (cmd.timestamp && cmd.timestamp !== lastNavTimestamp && cmd.target) {
      lastNavTimestamp = cmd.timestamp;
      const hits = tesseract.search(cmd.target);
      if (hits.length > 0) {
        requestGraphSelection(hits[0].id, {
          deterministicFocus: true,
          source: 'nav-command',
          openOnArrival: false,
        });
      }
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
  syncAutoRotate();

  const res = await fetch('/graph.json');
  const data = await res.json();
  tesseract = new Tesseract(data);
  tesseract.layoutGraph({ preset: activeLayoutPreset });

  syncCameraBounds();
  skybox = buildSkybox(scene);
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
  sidebarApi = createSidebar(tesseract, {
    onNavigate: (nodeId, options = {}) => {
      requestGraphSelection(nodeId, {
        deterministicFocus: options.deterministicFocus !== false,
        source: options.source || 'sidebar',
        openOnArrival: false,
      });
    },
    onOpenNode: (nodeId, options = {}) => {
      requestGraphSelection(nodeId, {
        deterministicFocus: options.deterministicFocus !== false,
        source: options.source || 'sidebar',
        openOnArrival: true,
      });
    },
  }, onSelectCallbacks, handleOpenReader, handleSearchHighlight);

  minimap = createMinimap({
    mount: appEl,
    onPan: ({ x, y }) => {
      panCameraFromMinimap({ x, y });
    },
    onZoom: ({ deltaY }) => {
      applyZoomDelta(deltaY, 'minimap');
    },
  });

  // Orb
  orb = createOrb({
    mount: document.getElementById('orb-root'),
    onSubmit: submitOrbQuery,
    onControlToggle: (key, value) => {
      if (key === 'commandMode') {
        setCommandMode(value);
        return;
      }
      if (key === 'follow' || key === 'followMode') {
        setFollowMode(typeof value === 'string' ? value : (value ? 'medium' : 'off'));
        return;
      }
      if (key === 'rotate') {
        setRotateEnabled(value);
        return;
      }
      if (key === 'layoutPreset') {
        triggerGraphLayoutPreset(value);
        return;
      }
      if (key === 'constructionMode') {
        if (value) {
          startConstructionMode();
        } else {
          stopConstructionMode({ settleToAmbient: true });
        }
      }
    },
    onCandidateSelect: (candidate) => {
      clarificationContext = null;
      previewOrbSelection(candidate, {
        source: 'candidates',
      });
    },
    onActivateSelection: activatePendingOrbSelection,
    onDismissSelection: dismissPendingOrbSelection,
    onFocusChange: (focused) => {
      if (focused) {
        pingVergilAttention();
        speakVergil('I am listening.', VERGIL_BRIEF_ATTENTION_MS);
      }
      if (!focused) {
        vergilAttentionUntil = Math.max(vergilAttentionUntil, performance.now() + VERGIL_BRIEF_ATTENTION_MS);
      }
    },
    onInputActivity: ({ active }) => {
      if (active) pingVergilAttention();
    },
  });

  vergil = createVergil(scene, {
    renderer,
    onStateChange: (nextState) => {
      updateVergilOperationalState(nextState);
    },
    onNodeArrival: (nodeId, meta = {}) => {
      if (meta.mode !== 'rail_travel') return;
      if (!selectionJourneyState || selectionJourneyState.targetNodeId !== nodeId) return;
      completeSelectionArrival(nodeId, selectionJourneyState.options, clock.getElapsedTime());
    },
  });
  syncVergilPatrol(null);
  setDesiredCameraDistance(camera.position.distanceTo(controls.target));
  syncOrbTacticalState();

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
      orb?.focus();
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

    const elapsed = clock.getElapsedTime();

    // Shader time updates
    if (edgeHandle?.material) edgeHandle.material.uniforms.uTime.value = elapsed;
    if (nodeHandle?.material?.uniforms?.uTime) nodeHandle.material.uniforms.uTime.value = elapsed;
    if (skybox?.starMat) skybox.starMat.uniforms.uTime.value = elapsed;

    if (layoutTransitionState) {
      const progress = THREE.MathUtils.clamp(
        (elapsed - layoutTransitionState.startedAt) / layoutTransitionState.duration,
        0,
        1,
      );
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      for (const node of tesseract.nodes) {
        const from = layoutTransitionState.fromPositions.get(node.id);
        const to = layoutTransitionState.toPositions.get(node.id);
        if (!from || !to) continue;
        node.x = THREE.MathUtils.lerp(from.x, to.x, eased);
        node.y = THREE.MathUtils.lerp(from.y, to.y, eased);
        node.z = THREE.MathUtils.lerp(from.z, to.z, eased);
      }
      syncPositions(tesseract, edgeHandle, nodeHandle);
      if (progress >= 1) {
        layoutTransitionState = null;
        syncCameraBounds();
        if (selectedNode) {
          flyToNode(selectedNode, { deterministic: true });
        }
        const anchorNodeId = readAttachedVergilNodeId() || selectedNode;
        const anchorPosition = anchorNodeId ? nodeWorldPosition(anchorNodeId) : null;
        if (anchorNodeId && anchorPosition) {
          callVergil(['attachToNode'], anchorNodeId, anchorPosition.clone());
          updateVergilOperationalState('attached', { attachedNodeId: anchorNodeId });
        }
        syncVergilPatrol(selectedNode);
        syncOrbTacticalState();
      }
    }

    // Selection pulse
    if (selectedNode && edgeHandle && nodeHandle) {
      const arrivalSettled = !selectionArrivalState
        || selectionArrivalState.nodeId !== selectedNode
        || (elapsed - selectionArrivalState.startedAt) >= SELECTION_SETTLE_DURATION;
      if (selectionArrivalState?.nodeId === selectedNode && arrivalSettled) {
        selectionArrivalState = null;
      }
      if (arrivalSettled) {
        updateSelectionPulse(elapsed, edgeHandle, nodeHandle, selectedNode, tesseract);
      }
    } else if (edgeHandle?.material && nodeHandle?.material) {
      // Idle pulse lives in the shaders when nothing is selected.
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

    syncVergilAttention();
    vergil?.update(elapsed, camera);
    updateConstructionMode();
    updateCamera();
    updateSelectedTitle();
    updateRailTravelOverlay(elapsed);
    const currentVergilState = readVergilState();
    if (currentVergilState !== orbViewState.vergilState) {
      syncOrbTacticalState({ vergilState: currentVergilState });
    }
    controls.update(); // autoRotate handled internally by OrbitControls
    minimap?.update?.({
      nodes: tesseract?.nodes || [],
      selectedNodeId: selectedNode,
      cameraTarget: getCameraFocusTarget(),
      cameraFootprint: computeCameraFootprintXZ(),
      zoomRatio: THREE.MathUtils.clamp(
        (desiredCameraDistance - zoomBounds.min) / Math.max(1, zoomBounds.max - zoomBounds.min),
        0,
        1,
      ),
      layoutPreset: activeLayoutPreset,
    });
    skybox?.update?.(camera, elapsed);
    renderer.render(scene, camera);
  }
  animate();
  console.log('Hive Viz alive.');
}

// Wait for password gate unlock before initializing
if (window.__hiveUnlocked) {
  init().catch(e => console.error('Init failed:', e));
} else {
  window.addEventListener('hive-unlock', () => {
    init().catch(e => console.error('Init failed:', e));
  });
}
