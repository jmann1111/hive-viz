import * as THREE from 'three';

const AMBIENT = 'ambient';
const FREE_MOVE = 'free_move';
const ATTACHED = 'attached';
const RAIL_TRAVEL = 'rail_travel';
const CONSTRUCTION = 'construction';

const VERGIL_WORLD_SCALE = 0.8;
const IDLE_FORWARD_OFFSET = 76;
const IDLE_RIGHT_OFFSET = 0;
const IDLE_DOWN_OFFSET = 34;
const TARGET_OFFSET = 28;
const TARGET_UP_OFFSET = 14;
const PATROL_RADIUS = 54;
const PATROL_HOLD_RADIUS = 24;
const PATROL_UP_OFFSET = 20;
const PATROL_HOLD_SECONDS = 2.15;
const ATTACHED_RADIUS = 42;
const ATTACHED_UP_OFFSET = 18;
const ATTACHED_LOOK_AHEAD = 22;
const WAYPOINT_REACHED_DISTANCE = 24;
const WAYPOINT_SETTLE_DISTANCE = 8;
const WAYPOINT_SNAP_DISTANCE = 1.6;
const SEGMENT_REACHED_DISTANCE = 18;
const COMMAND_BOUNDS_RADIUS = 16000;
const TRAIL_POINTS = 40;
const TRAIL_OFFSET = 11;
const MAX_SPEED = 20;
const RAIL_MAX_SPEED = 26;
const FREE_MOVE_MAX_SPEED = 24;
const IDLE_DRAG = 0.86;
const TARGET_DRAG = 0.8;
const ATTEND_DRAG = 0.86;
const ATTACHED_DRAG = 0.84;
const FREE_MOVE_DRAG = 0.84;
const RAIL_DRAG = 0.88;
const AMBIENT_POSITION_SMOOTH = 0.055;
const ATTEND_POSITION_SMOOTH = 0.11;
const TARGET_POSITION_SMOOTH = 0.2;
const ATTACHED_POSITION_SMOOTH = 0.16;
const FREE_MOVE_POSITION_SMOOTH = 0.12;
const RAIL_POSITION_SMOOTH = 0.14;
const ACTIVATION_DECAY = 0.88;
const COMMAND_PULSE_DECAY = 0.94;
const FREE_MOVE_LOOK_AHEAD = 32;
const AMBIENT_PURSUIT = 0.013;
const ATTEND_PURSUIT = 0.03;
const TARGET_PURSUIT = 0.055;
const ATTACHED_PURSUIT = 0.04;
const FREE_MOVE_PURSUIT = 0.06;
const RAIL_PURSUIT = 0.072;
const SPEECH_WORLD_OFFSET = 8.5;
const SPEECH_FADE_IN_MS = 120;
const SPEECH_FADE_OUT_MS = 180;
const SPEECH_MIN_DURATION_MS = 900;
const SPEECH_MAX_DURATION_MS = 2800;
const SPEECH_FLOAT_PIXELS = 12;
const CONSTRUCTION_DEFAULT_DURATION_MS = 9 * 60 * 1000;
const CONSTRUCTION_MIN_DURATION_MS = 90 * 1000;
const CONSTRUCTION_MAX_DURATION_MS = 12 * 60 * 1000;

function makeMetalMaterial(color, options = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: options.opacity ?? 0.96,
    depthWrite: options.depthWrite ?? true,
  });
}

function makeGlowMaterial(color, opacity = 0.75) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function clampPointToRadius(point, maxRadius) {
  if (point.lengthSq() <= maxRadius * maxRadius) {
    return point;
  }
  return point.setLength(maxRadius);
}

function cloneVector3(value) {
  if (!value) return null;
  if (value.isVector3) return value.clone();
  if (
    typeof value.x === 'number'
    && typeof value.y === 'number'
    && typeof value.z === 'number'
  ) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return null;
}

function hashId(value) {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function normalizeConstructionRoute(route) {
  const source = Array.isArray(route)
    ? { positions: route }
    : (route && typeof route === 'object' ? route : null);
  if (!source) return null;

  const rawPositions = Array.isArray(source.positions)
    ? source.positions
    : Array.isArray(source.points)
      ? source.points
      : [];
  const positions = rawPositions
    .map((entry) => cloneVector3(entry))
    .filter(Boolean);
  if (positions.length < 2) return null;

  const segmentLengths = [];
  const cumulativeLengths = [0];
  let totalLength = 0;
  for (let index = 1; index < positions.length; index += 1) {
    const segmentLength = positions[index - 1].distanceTo(positions[index]);
    segmentLengths.push(segmentLength);
    totalLength += segmentLength;
    cumulativeLengths.push(totalLength);
  }
  if (totalLength <= 0.0001) return null;

  const requestedDurationMs = Number(source.durationMs);
  const durationMs = THREE.MathUtils.clamp(
    Number.isFinite(requestedDurationMs) ? requestedDurationMs : CONSTRUCTION_DEFAULT_DURATION_MS,
    CONSTRUCTION_MIN_DURATION_MS,
    CONSTRUCTION_MAX_DURATION_MS,
  );

  return {
    positions,
    nodeIds: Array.isArray(source.nodeIds) ? [...source.nodeIds] : [],
    loop: Boolean(source.loop),
    durationMs,
    segmentLengths,
    cumulativeLengths,
    totalLength,
    distance: 0,
    progress: 0,
    segmentIndex: 0,
    speedPerSecond: totalLength / Math.max(durationMs / 1000, 1),
    status: 'ready',
  };
}

function createSpeechBubble() {
  if (typeof document === 'undefined') return null;

  const bubble = document.createElement('div');
  bubble.style.position = 'fixed';
  bubble.style.left = '0';
  bubble.style.top = '0';
  bubble.style.maxWidth = '220px';
  bubble.style.pointerEvents = 'none';
  bubble.style.zIndex = '40';
  bubble.style.opacity = '0';
  bubble.style.filter = 'blur(10px)';
  bubble.style.transform = 'translate(-9999px, -9999px) scale(0.96)';
  bubble.style.transformOrigin = 'center bottom';
  bubble.style.willChange = 'transform, opacity, filter';
  bubble.style.display = 'flex';
  bubble.style.flexDirection = 'column';
  bubble.style.alignItems = 'center';
  bubble.style.gap = '5px';

  const copy = document.createElement('div');
  copy.style.color = 'rgba(255, 235, 208, 0.96)';
  copy.style.fontFamily = '"Avenir Next", "Segoe UI", sans-serif';
  copy.style.fontSize = '11px';
  copy.style.fontWeight = '600';
  copy.style.letterSpacing = '0.02em';
  copy.style.lineHeight = '1.25';
  copy.style.textAlign = 'center';
  copy.style.textWrap = 'balance';
  copy.style.textShadow = '0 0 18px rgba(255, 187, 91, 0.24), 0 8px 24px rgba(0, 0, 0, 0.54)';

  const accent = document.createElement('div');
  accent.style.width = '100%';
  accent.style.maxWidth = '128px';
  accent.style.height = '1px';
  accent.style.opacity = '0.7';
  accent.style.background = 'linear-gradient(90deg, rgba(255, 196, 112, 0), rgba(255, 196, 112, 0.9), rgba(255, 196, 112, 0))';
  accent.style.boxShadow = '0 0 14px rgba(255, 196, 112, 0.32)';
  accent.style.transformOrigin = 'center center';

  bubble.append(copy, accent);
  document.body.appendChild(bubble);

  return { bubble, copy, accent };
}

function makeVergilBody() {
  const root = new THREE.Group();
  root.name = 'vergil-root';
  root.scale.setScalar(VERGIL_WORLD_SCALE);

  const floatRig = new THREE.Group();
  root.add(floatRig);

  const shell = new THREE.Group();
  floatRig.add(shell);

  const darkMetalMaterial = makeMetalMaterial(0x2c2118, { opacity: 0.98 });
  const bronzeMaterial = makeMetalMaterial(0x6e4d2e);
  const brassMaterial = makeMetalMaterial(0xc29658);
  const softBrassMaterial = makeMetalMaterial(0xe0c18d, { opacity: 0.92 });

  const topCap = new THREE.Mesh(
    new THREE.CylinderGeometry(4.5, 5.8, 3.1, 6),
    brassMaterial,
  );
  topCap.position.y = 8.2;
  shell.add(topCap);

  const topVent = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.8, 1.4, 6, 1, true),
    darkMetalMaterial,
  );
  topVent.position.y = 10.2;
  shell.add(topVent);

  const topFinial = new THREE.Mesh(
    new THREE.CylinderGeometry(0.68, 1.05, 2.8, 6),
    softBrassMaterial,
  );
  topFinial.position.y = 12.2;
  shell.add(topFinial);

  const canopyHalo = new THREE.Mesh(
    new THREE.TorusGeometry(5.4, 0.32, 10, 48),
    makeGlowMaterial(0xffd48f, 0.18),
  );
  canopyHalo.rotation.x = Math.PI / 2;
  canopyHalo.position.y = 8.8;
  shell.add(canopyHalo);

  const innerCore = new THREE.Mesh(
    new THREE.SphereGeometry(3.1, 22, 22),
    makeGlowMaterial(0xffcd76, 0.92),
  );
  floatRig.add(innerCore);

  const coreBloom = new THREE.Mesh(
    new THREE.SphereGeometry(5.3, 18, 18),
    makeGlowMaterial(0xffa544, 0.18),
  );
  floatRig.add(coreBloom);

  const eyeRing = new THREE.Mesh(
    new THREE.TorusGeometry(4.2, 0.28, 10, 52),
    makeGlowMaterial(0xffefc0, 0.54),
  );
  eyeRing.rotation.x = Math.PI / 2;
  eyeRing.scale.set(1.18, 1, 0.7);
  eyeRing.position.z = 0.2;
  floatRig.add(eyeRing);

  const eyeSlit = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.42, 0.46),
    makeGlowMaterial(0xfff5d3, 0.6),
  );
  eyeSlit.position.set(0, 0.1, 4.1);
  floatRig.add(eyeSlit);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(9.2, 0.2, 10, 72),
    makeGlowMaterial(0xffc980, 0.18),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 1.2;
  floatRig.add(halo);

  const cageTopRing = new THREE.Mesh(
    new THREE.TorusGeometry(5.6, 0.5, 10, 6),
    bronzeMaterial,
  );
  cageTopRing.rotation.x = Math.PI / 2;
  cageTopRing.position.y = 4.2;
  shell.add(cageTopRing);

  const cageBottomRing = new THREE.Mesh(
    new THREE.TorusGeometry(5.8, 0.54, 10, 6),
    bronzeMaterial,
  );
  cageBottomRing.rotation.x = Math.PI / 2;
  cageBottomRing.position.y = -4.8;
  shell.add(cageBottomRing);

  const hardlightFins = new THREE.Group();
  floatRig.add(hardlightFins);

  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI * 2 * i) / 6;
    const rib = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.4, 10.6, 6),
      i % 2 === 0 ? brassMaterial : bronzeMaterial,
    );
    rib.position.set(Math.cos(angle) * 4.9, -0.4, Math.sin(angle) * 4.1);
    rib.rotation.z = Math.PI / 18;
    hardlightFins.add(rib);

    const emberWindow = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 5.8, 1.6),
      makeGlowMaterial(i % 2 === 0 ? 0xffd081 : 0xffab52, 0.16),
    );
    emberWindow.position.set(Math.cos(angle) * 3.65, -0.2, Math.sin(angle) * 3.05);
    emberWindow.lookAt(emberWindow.position.clone().multiplyScalar(2));
    hardlightFins.add(emberWindow);
  }

  const shoulderBand = new THREE.Mesh(
    new THREE.TorusGeometry(8.1, 0.38, 10, 6),
    darkMetalMaterial,
  );
  shoulderBand.rotation.x = Math.PI / 2;
  shoulderBand.position.y = 1.4;
  shell.add(shoulderBand);

  const arms = [];
  for (const side of [1, -1]) {
    const armGroup = new THREE.Group();

    const sideColumn = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 9.8, 1.8),
      darkMetalMaterial,
    );
    sideColumn.position.set(side * 8.5, -0.2, 0);
    armGroup.add(sideColumn);

    const upperBrace = new THREE.Mesh(
      new THREE.BoxGeometry(6.1, 1.1, 1.3),
      brassMaterial,
    );
    upperBrace.position.set(side * 9.8, 4.2, 0);
    upperBrace.rotation.z = side * 0.44;
    armGroup.add(upperBrace);

    const lowerBrace = new THREE.Mesh(
      new THREE.BoxGeometry(6.1, 1.1, 1.3),
      brassMaterial,
    );
    lowerBrace.position.set(side * 9.8, -4.4, 0);
    lowerBrace.rotation.z = -side * 0.44;
    armGroup.add(lowerBrace);

    const lanternKnuckle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 3.6, 6),
      softBrassMaterial,
    );
    lanternKnuckle.rotation.z = Math.PI / 2;
    lanternKnuckle.position.set(side * 12.4, 0, 0);
    armGroup.add(lanternKnuckle);

    const sideGlow = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 0.22, 0.22),
      makeGlowMaterial(0xffdc9e, 0.42),
    );
    sideGlow.position.set(side * 9.2, 0, 0);
    armGroup.add(sideGlow);

    floatRig.add(armGroup);
    arms.push(armGroup);
  }

  const lowerArray = new THREE.Group();
  const lowerStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.92, 1.2, 6.4, 6),
    darkMetalMaterial,
  );
  lowerStem.position.y = -8.4;
  lowerArray.add(lowerStem);

  const lowerBell = new THREE.Mesh(
    new THREE.CylinderGeometry(2.3, 1.4, 3.8, 6),
    bronzeMaterial,
  );
  lowerBell.position.y = -11.3;
  lowerArray.add(lowerBell);

  const probe = new THREE.Mesh(
    new THREE.ConeGeometry(1.9, 4.6, 6),
    brassMaterial,
  );
  probe.position.y = -15;
  probe.rotation.x = Math.PI;
  lowerArray.add(probe);

  const probeGlow = new THREE.Mesh(
    new THREE.ConeGeometry(0.86, 3.2, 6),
    makeGlowMaterial(0xffbc62, 0.48),
  );
  probeGlow.position.y = -14.2;
  probeGlow.rotation.x = Math.PI;
  lowerArray.add(probeGlow);
  floatRig.add(lowerArray);

  const trailPositions = new Float32Array(TRAIL_POINTS * 3);

  const trailCoreGeometry = new THREE.BufferGeometry();
  const trailCoreAttr = new THREE.BufferAttribute(trailPositions, 3);
  trailCoreGeometry.setAttribute('position', trailCoreAttr);
  const trailCore = new THREE.Line(
    trailCoreGeometry,
    new THREE.LineBasicMaterial({
      color: 0xffd79b,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  const trailGlowGeometry = new THREE.BufferGeometry();
  const trailGlowAttr = new THREE.BufferAttribute(trailPositions.slice(), 3);
  trailGlowGeometry.setAttribute('position', trailGlowAttr);
  const trailGlow = new THREE.Line(
    trailGlowGeometry,
    new THREE.LineBasicMaterial({
      color: 0xffa648,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  trailGlow.scale.setScalar(1.04);

  const trailDustGeometry = new THREE.BufferGeometry();
  const trailDustAttr = new THREE.BufferAttribute(trailPositions.slice(), 3);
  trailDustGeometry.setAttribute('position', trailDustAttr);
  const trailDust = new THREE.Points(
    trailDustGeometry,
    new THREE.PointsMaterial({
      color: 0xffc47b,
      size: 4.6,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );

  const wakeHalo = new THREE.Mesh(
    new THREE.SphereGeometry(2.8, 16, 16),
    makeGlowMaterial(0xffbf6a, 0.2),
  );
  wakeHalo.position.set(0, -11.6, 0);
  floatRig.add(wakeHalo);

  const wakePlumeGlow = new THREE.Mesh(
    new THREE.ConeGeometry(2.8, 11.5, 14, 1, true),
    makeGlowMaterial(0xff9340, 0.1),
  );
  wakePlumeGlow.rotation.x = Math.PI;
  wakePlumeGlow.position.y = -15.5;
  floatRig.add(wakePlumeGlow);

  const wakePlumeCore = new THREE.Mesh(
    new THREE.ConeGeometry(1.3, 7.4, 14, 1, true),
    makeGlowMaterial(0xffd6a2, 0.14),
  );
  wakePlumeCore.rotation.x = Math.PI;
  wakePlumeCore.position.y = -14.3;
  floatRig.add(wakePlumeCore);

  const mendRing = new THREE.Mesh(
    new THREE.TorusGeometry(10, 0.34, 12, 72),
    makeGlowMaterial(0xffcb7f, 0.0),
  );
  mendRing.rotation.x = Math.PI / 2;
  mendRing.visible = false;

  const mendSpark = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 14, 14),
    makeGlowMaterial(0xffe2b8, 0.0),
  );
  mendSpark.visible = false;

  const commandMarker = new THREE.Group();
  commandMarker.visible = false;

  const commandDisc = new THREE.Mesh(
    new THREE.CircleGeometry(18, 48),
    makeGlowMaterial(0xffb35d, 0.05),
  );
  commandDisc.rotation.x = -Math.PI / 2;
  commandDisc.position.y = 0.06;
  commandMarker.add(commandDisc);

  const commandRing = new THREE.Mesh(
    new THREE.TorusGeometry(18.8, 0.48, 14, 64),
    makeGlowMaterial(0xffd090, 0.16),
  );
  commandRing.rotation.x = Math.PI / 2;
  commandMarker.add(commandRing);

  const commandOuterRing = new THREE.Mesh(
    new THREE.TorusGeometry(27.5, 0.34, 14, 72),
    makeGlowMaterial(0xffe5bf, 0.08),
  );
  commandOuterRing.rotation.x = Math.PI / 2;
  commandMarker.add(commandOuterRing);

  const commandBurstRing = new THREE.Mesh(
    new THREE.TorusGeometry(13.4, 0.52, 14, 64),
    makeGlowMaterial(0xfff2d9, 0.0),
  );
  commandBurstRing.rotation.x = Math.PI / 2;
  commandMarker.add(commandBurstRing);

  const commandSpire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.62, 32, 12, 1, true),
    makeGlowMaterial(0xffd697, 0.0),
  );
  commandSpire.position.y = 15;
  commandMarker.add(commandSpire);

  const commandChevronGroup = new THREE.Group();
  commandMarker.add(commandChevronGroup);
  const commandChevrons = [];
  for (let i = 0; i < 3; i += 1) {
    const commandChevron = new THREE.Mesh(
      new THREE.ConeGeometry(3.8, 8.4, 4),
      makeGlowMaterial(0xffefcf, 0.0),
    );
    commandChevron.rotation.x = Math.PI;
    commandChevronGroup.add(commandChevron);
    commandChevrons.push(commandChevron);
  }

  const commandCore = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 16, 16),
    makeGlowMaterial(0xffd597, 0.28),
  );
  commandCore.position.y = 4.2;
  commandMarker.add(commandCore);

  return {
    root,
    floatRig,
    shell,
    innerCore,
    eyeRing,
    halo,
    hardlightFins,
    arms,
    lowerArray,
    wakeHalo,
    wakePlumeGlow,
    wakePlumeCore,
    mendRing,
    mendSpark,
    trailCore,
    trailGlow,
    trailDust,
    trailPositions,
    trailAttrs: [trailCoreAttr, trailGlowAttr, trailDustAttr],
    commandMarker,
    commandDisc,
    commandRing,
    commandOuterRing,
    commandBurstRing,
    commandSpire,
    commandChevronGroup,
    commandChevrons,
    commandCore,
  };
}

export function createVergil(scene, options = {}) {
  const body = makeVergilBody();
  scene.add(body.root);
  scene.add(body.trailGlow);
  scene.add(body.trailCore);
  scene.add(body.trailDust);
  scene.add(body.mendRing);
  scene.add(body.mendSpark);
  scene.add(body.commandMarker);
  const speechBubble = createSpeechBubble();
  const overlayRenderer = options.renderer || null;
  const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;
  const onNodeArrival = typeof options.onNodeArrival === 'function' ? options.onNodeArrival : null;

  const state = {
    mode: AMBIENT,
    lastUpdateElapsed: null,
    commandMode: false,
    target: null,
    attendUser: false,
    patrolTargets: [],
    patrolIndex: 0,
    patrolHoldUntil: 0,
    mendPulse: 0,
    activationPulse: 0,
    lastMendTarget: null,
    lastTarget: null,
    commandTarget: null,
    commandPreview: null,
    commandPulse: 0,
    attachedNodeId: null,
    attachedTarget: null,
    railNodeIds: [],
    railPositions: [],
    railSegmentIndex: 0,
    smoothedLookTarget: new THREE.Vector3(),
    smoothedDesiredPosition: new THREE.Vector3(),
    seededDesiredPosition: false,
    seededTrail: false,
    trailHead: new THREE.Vector3(),
    freeMoveFacing: new THREE.Vector3(0, 0, 1),
    velocity: new THREE.Vector3(),
    lastPosition: new THREE.Vector3(),
    speechText: '',
    speechStartedMs: 0,
    speechDurationMs: 0,
    speechUntilMs: 0,
    construction: {
      active: false,
      positions: [],
      nodeIds: [],
      segmentLengths: [],
      cumulativeLengths: [0],
      totalLength: 0,
      distance: 0,
      durationMs: CONSTRUCTION_DEFAULT_DURATION_MS,
      speedPerSecond: 0,
      progress: 0,
      segmentIndex: 0,
      loop: false,
      status: 'idle',
    },
  };

  const cameraForward = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const desiredLookTarget = new THREE.Vector3();
  const worldTarget = new THREE.Vector3();
  const steering = new THREE.Vector3();
  const speedVector = new THREE.Vector3();
  const projectedPosition = new THREE.Vector3();
  const orbitOffset = new THREE.Vector3();
  const trailDirection = new THREE.Vector3();
  const trailAnchor = new THREE.Vector3();
  const activeMendTarget = new THREE.Vector3();
  const railDestination = new THREE.Vector3();
  const attachedAnchor = new THREE.Vector3();
  const markerScale = new THREE.Vector3();
  const commandMarkerPosition = new THREE.Vector3();
  const freeMoveDirection = new THREE.Vector3();

  function getState() {
    return state.mode;
  }

  function getAttachedNodeId() {
    return state.attachedNodeId || null;
  }

  function getConstructionState() {
    return {
      active: Boolean(state.construction.active),
      progress: THREE.MathUtils.clamp(state.construction.progress || 0, 0, 1),
      durationMs: state.construction.durationMs,
      segmentIndex: state.construction.segmentIndex,
      totalLength: state.construction.totalLength,
      loop: Boolean(state.construction.loop),
      status: state.construction.status || (state.construction.active ? 'constructing' : 'idle'),
    };
  }

  function emitStateChange() {
    if (onStateChange) {
      onStateChange(state.mode);
    }
  }

  function setMode(nextMode) {
    if (state.mode === nextMode) return;
    state.mode = nextMode;
    emitStateChange();
  }

  function seedTrail(position) {
    for (let i = 0; i < TRAIL_POINTS; i += 1) {
      body.trailPositions[(i * 3)] = position.x;
      body.trailPositions[(i * 3) + 1] = position.y;
      body.trailPositions[(i * 3) + 2] = position.z;
    }
    for (const attr of body.trailAttrs) {
      attr.array.set(body.trailPositions);
      attr.needsUpdate = true;
    }
    state.lastPosition.copy(position);
    state.trailHead.copy(position);
    state.seededTrail = true;
  }

  function pushTrail(position) {
    if (!state.seededTrail) {
      seedTrail(position);
      return;
    }

    for (let i = TRAIL_POINTS - 1; i > 0; i -= 1) {
      body.trailPositions[(i * 3)] = body.trailPositions[((i - 1) * 3)];
      body.trailPositions[(i * 3) + 1] = body.trailPositions[((i - 1) * 3) + 1];
      body.trailPositions[(i * 3) + 2] = body.trailPositions[((i - 1) * 3) + 2];
    }

    body.trailPositions[0] = position.x;
    body.trailPositions[1] = position.y;
    body.trailPositions[2] = position.z;
    for (const attr of body.trailAttrs) {
      attr.array.set(body.trailPositions);
      attr.needsUpdate = true;
    }
  }

  function showCommandMarker(position) {
    if (!position) {
      body.commandMarker.visible = false;
      return;
    }
    body.commandMarker.visible = true;
    body.commandMarker.position.copy(position);
  }

  function clearCommandMarker() {
    body.commandMarker.visible = false;
  }

  function pulseCommandMarker(strength = 1) {
    state.commandPulse = Math.max(state.commandPulse, strength);
  }

  function primeMovement(targetPosition) {
    if (!targetPosition) return;
    state.smoothedDesiredPosition.copy(targetPosition);
    state.seededDesiredPosition = true;
    freeMoveDirection.copy(targetPosition).sub(body.root.position);
    if (freeMoveDirection.lengthSq() > 0.0001) {
      state.freeMoveFacing.copy(freeMoveDirection.normalize());
    }
  }

  function computeFreeMovePosition(camera) {
    if (!state.commandTarget) return false;

    desiredPosition.copy(state.commandTarget);
    freeMoveDirection.copy(state.commandTarget).sub(body.root.position);
    if (freeMoveDirection.lengthSq() > 0.0001) {
      state.freeMoveFacing.copy(freeMoveDirection.normalize());
    } else if (state.velocity.lengthSq() > 0.0001) {
      state.freeMoveFacing.copy(state.velocity).normalize();
    } else if (state.freeMoveFacing.lengthSq() < 0.0001) {
      camera.getWorldDirection(cameraForward);
      state.freeMoveFacing.copy(cameraForward).normalize();
    }

    desiredLookTarget.copy(desiredPosition)
      .addScaledVector(state.freeMoveFacing, FREE_MOVE_LOOK_AHEAD);
    desiredLookTarget.y += 3.2;
    return true;
  }

  function getCommandMarkerTarget() {
    if (state.commandMode && state.commandPreview) {
      return state.commandPreview;
    }
    if (state.commandTarget) {
      return state.commandTarget;
    }
    return null;
  }

  function clearRailState() {
    state.railNodeIds = [];
    state.railPositions = [];
    state.railSegmentIndex = 0;
  }

  function resetConstructionState(status = 'idle') {
    state.construction.active = false;
    state.construction.positions = [];
    state.construction.nodeIds = [];
    state.construction.segmentLengths = [];
    state.construction.cumulativeLengths = [0];
    state.construction.totalLength = 0;
    state.construction.distance = 0;
    state.construction.durationMs = CONSTRUCTION_DEFAULT_DURATION_MS;
    state.construction.speedPerSecond = 0;
    state.construction.progress = 0;
    state.construction.segmentIndex = 0;
    state.construction.loop = false;
    state.construction.status = status;
  }

  function stopConstruction(options = {}) {
    const {
      settleToAmbient = true,
      clearMarker = false,
      status = 'idle',
      preserveProgress = status === 'complete',
    } = options;
    const wasActive = state.construction.active || state.mode === CONSTRUCTION;
    const finalProgress = preserveProgress ? state.construction.progress : 0;
    const finalDurationMs = state.construction.durationMs;
    const finalSegmentIndex = state.construction.segmentIndex;
    const finalTotalLength = state.construction.totalLength;
    const finalLoop = state.construction.loop;
    resetConstructionState(status);
    if (preserveProgress) {
      state.construction.progress = finalProgress;
      state.construction.durationMs = finalDurationMs;
      state.construction.segmentIndex = finalSegmentIndex;
      state.construction.totalLength = finalTotalLength;
      state.construction.loop = finalLoop;
    }
    if (clearMarker) {
      clearCommandMarker();
    }
    if (wasActive && settleToAmbient) {
      setMode(AMBIENT);
    }
    return wasActive;
  }

  function startConstruction(route, options = {}) {
    const normalizedRoute = normalizeConstructionRoute({
      ...(route && typeof route === 'object' && !Array.isArray(route) ? route : {}),
      positions: Array.isArray(route) ? route : (route?.positions || route?.points),
      durationMs: options.durationMs ?? route?.durationMs,
      loop: options.loop ?? route?.loop,
      nodeIds: options.nodeIds ?? route?.nodeIds,
    });
    if (!normalizedRoute) return false;

    clearCommandPreview();
    clearRailState();
    state.commandTarget = null;
    state.attachedNodeId = null;
    state.attachedTarget = null;
    state.velocity.set(0, 0, 0);
    state.construction.active = true;
    state.construction.positions = normalizedRoute.positions;
    state.construction.nodeIds = normalizedRoute.nodeIds;
    state.construction.segmentLengths = normalizedRoute.segmentLengths;
    state.construction.cumulativeLengths = normalizedRoute.cumulativeLengths;
    state.construction.totalLength = normalizedRoute.totalLength;
    state.construction.distance = 0;
    state.construction.durationMs = normalizedRoute.durationMs;
    state.construction.speedPerSecond = normalizedRoute.speedPerSecond;
    state.construction.progress = 0;
    state.construction.segmentIndex = 0;
    state.construction.loop = normalizedRoute.loop;
    state.construction.status = 'constructing';
    desiredPosition.copy(normalizedRoute.positions[0]);
    body.root.position.copy(normalizedRoute.positions[0]);
    state.lastPosition.copy(body.root.position);
    primeMovement(normalizedRoute.positions[0]);
    showCommandMarker(normalizedRoute.positions[normalizedRoute.positions.length - 1]);
    pulseCommandMarker(1);
    state.activationPulse = Math.max(state.activationPulse, 0.84);
    setMode(CONSTRUCTION);
    return true;
  }

  function advanceConstruction(deltaSeconds) {
    if (!state.construction.active || state.construction.positions.length < 2) {
      return false;
    }

    const positions = state.construction.positions;
    const totalLength = state.construction.totalLength;
    const distanceStep = Math.max(deltaSeconds, 0) * state.construction.speedPerSecond;
    let nextDistance = state.construction.distance + distanceStep;

    if (state.construction.loop && totalLength > 0) {
      nextDistance %= totalLength;
    } else if (nextDistance >= totalLength) {
      body.root.position.copy(positions[positions.length - 1]);
      desiredPosition.copy(positions[positions.length - 1]);
      desiredLookTarget.copy(positions[positions.length - 1]);
      state.construction.distance = totalLength;
      state.construction.progress = 1;
      state.construction.segmentIndex = positions.length - 2;
      state.construction.status = 'complete';
      state.activationPulse = Math.max(state.activationPulse, 1);
      stopConstruction({ settleToAmbient: true, status: 'complete' });
      return false;
    }

    state.construction.distance = nextDistance;
    state.construction.progress = totalLength > 0 ? nextDistance / totalLength : 0;

    let segmentIndex = 0;
    while (
      segmentIndex < state.construction.segmentLengths.length - 1
      && nextDistance > state.construction.cumulativeLengths[segmentIndex + 1]
    ) {
      segmentIndex += 1;
    }
    state.construction.segmentIndex = segmentIndex;

    const startDistance = state.construction.cumulativeLengths[segmentIndex];
    const segmentLength = state.construction.segmentLengths[segmentIndex] || 1;
    const segmentProgress = THREE.MathUtils.clamp((nextDistance - startDistance) / segmentLength, 0, 1);
    const segmentStart = positions[segmentIndex];
    const segmentEnd = positions[segmentIndex + 1] || positions[segmentIndex];

    desiredPosition.copy(segmentStart).lerp(segmentEnd, segmentProgress);
    desiredLookTarget.copy(segmentEnd);
    body.root.position.copy(desiredPosition);
    state.lastMendTarget = segmentEnd.clone();
    showCommandMarker(segmentEnd);
    pulseCommandMarker(0.42);
    return true;
  }

  function computeIdlePosition(camera) {
    camera.getWorldDirection(cameraForward);
    cameraForward.normalize();
    cameraRight.crossVectors(cameraForward, camera.up).normalize();
    cameraUp.copy(camera.up).normalize();

    desiredPosition.copy(camera.position)
      .addScaledVector(cameraForward, IDLE_FORWARD_OFFSET)
      .addScaledVector(cameraRight, IDLE_RIGHT_OFFSET)
      .addScaledVector(cameraUp, -IDLE_DOWN_OFFSET);

    desiredLookTarget.copy(camera.position).addScaledVector(cameraForward, 180);
  }

  function computePatrolPosition(elapsed) {
    if (state.patrolTargets.length === 0) {
      return false;
    }

    const patrolTarget = state.patrolTargets[state.patrolIndex % state.patrolTargets.length];
    if (!patrolTarget) {
      return false;
    }

    const holding = state.patrolHoldUntil > elapsed;
    const orbitPhase = elapsed * (holding ? 0.14 : 0.28) + (state.patrolIndex * 1.12);
    const orbitRadius = holding ? PATROL_HOLD_RADIUS : PATROL_RADIUS;
    orbitOffset.set(
      Math.cos(orbitPhase) * orbitRadius,
      PATROL_UP_OFFSET + (Math.sin(elapsed * (holding ? 0.62 : 1.1)) * (holding ? 1.6 : 3.5)) + (Math.sin((elapsed * 0.47) + state.patrolIndex) * (holding ? 0.9 : 1.8)),
      Math.sin(orbitPhase) * (orbitRadius * 0.88),
    );

    desiredPosition.copy(patrolTarget).add(orbitOffset);
    desiredLookTarget.copy(patrolTarget);
    return true;
  }

  function computeTargetPosition(camera) {
    camera.getWorldDirection(cameraForward);
    cameraForward.normalize();
    cameraRight.crossVectors(cameraForward, camera.up).normalize();
    cameraUp.copy(camera.up).normalize();

    worldTarget.copy(state.target);
    desiredPosition.copy(worldTarget)
      .addScaledVector(cameraRight, TARGET_OFFSET)
      .addScaledVector(cameraUp, TARGET_UP_OFFSET)
      .addScaledVector(cameraForward, -8);

    desiredLookTarget.copy(worldTarget);
  }

  function computeAttachedPosition(elapsed) {
    if (!state.attachedTarget) return false;

    const orbitSeed = hashId(state.attachedNodeId);
    const orbitPhase = elapsed * 0.54 + ((orbitSeed % 628) / 100);
    attachedAnchor.set(
      Math.cos(orbitPhase) * ATTACHED_RADIUS,
      ATTACHED_UP_OFFSET + (Math.sin((elapsed * 1.36) + (orbitSeed % 11)) * 2.8),
      Math.sin(orbitPhase) * (ATTACHED_RADIUS * 0.74),
    );
    desiredPosition.copy(state.attachedTarget).add(attachedAnchor);
    desiredLookTarget.copy(state.attachedTarget).addScaledVector(attachedAnchor.normalize(), ATTACHED_LOOK_AHEAD);
    state.lastMendTarget = state.attachedTarget.clone();
    return true;
  }

  function moveAlongSegment(targetPosition, smooth, maxSpeed, drag, pursuitStrength) {
    state.smoothedDesiredPosition.lerp(targetPosition, smooth);
    steering.copy(state.smoothedDesiredPosition).sub(body.root.position);
    const distanceToTarget = steering.length();
    const distanceBoost = THREE.MathUtils.clamp(distanceToTarget * 0.008, 0, maxSpeed * 0.85);
    const boostedMaxSpeed = maxSpeed + distanceBoost;
    const boostedPursuit = pursuitStrength + THREE.MathUtils.clamp(distanceToTarget * 0.00004, 0, 0.045);
    state.velocity.multiplyScalar(drag);
    state.velocity.addScaledVector(steering, boostedPursuit);
    if (state.velocity.length() > boostedMaxSpeed) {
      state.velocity.setLength(boostedMaxSpeed);
    }
    body.root.position.add(state.velocity);
  }

  function updateRailTravel() {
    if (state.railPositions.length === 0) {
      if (state.attachedTarget) {
        setMode(ATTACHED);
      } else if (state.commandTarget) {
        setMode(FREE_MOVE);
      } else {
        setMode(AMBIENT);
      }
      return;
    }

    const segmentTarget = state.railPositions[Math.min(state.railSegmentIndex, state.railPositions.length - 1)];
    if (!segmentTarget) {
      setMode(ATTACHED);
      return;
    }

    railDestination.copy(segmentTarget);
    desiredPosition.copy(railDestination);
    desiredLookTarget.copy(railDestination);

    if (body.root.position.distanceTo(railDestination) <= SEGMENT_REACHED_DISTANCE) {
      if (state.railSegmentIndex < state.railPositions.length - 1) {
        state.railSegmentIndex += 1;
      } else {
        const finalNodeId = state.railNodeIds[state.railNodeIds.length - 1] ?? state.attachedNodeId;
        const finalPosition = state.railPositions[state.railPositions.length - 1] ?? state.attachedTarget;
        clearRailState();
        if (finalPosition) {
          state.attachedNodeId = finalNodeId ?? state.attachedNodeId;
          state.attachedTarget = finalPosition.clone();
          state.commandTarget = finalPosition.clone();
          showCommandMarker(finalPosition);
          pulseCommandMarker(0.88);
          state.activationPulse = Math.max(state.activationPulse, 1);
          setMode(ATTACHED);
          onNodeArrival?.(state.attachedNodeId, {
            mode: RAIL_TRAVEL,
            position: finalPosition.clone(),
          });
        } else {
          setMode(AMBIENT);
        }
      }
    }
  }

  function setPreviewTarget(position) {
    if (!position) {
      state.target = null;
      return;
    }

    state.target = position.clone();
    state.lastTarget = position.clone();
  }

  function activateTarget(position) {
    if (position) {
      state.lastTarget = position.clone();
      state.target = position.clone();
    }
    state.activationPulse = 1;
  }

  function setCommandPreview(position) {
    const nextPreview = cloneVector3(position);
    if (!nextPreview) {
      state.commandPreview = null;
      return false;
    }

    clampPointToRadius(nextPreview, COMMAND_BOUNDS_RADIUS);
    state.commandPreview = nextPreview;
    showCommandMarker(nextPreview);
    return true;
  }

  function clearTarget() {
    state.target = null;
  }

  function clearCommandPreview() {
    state.commandPreview = null;
  }

  function clearCommand() {
    stopConstruction({ settleToAmbient: false });
    state.commandTarget = null;
    state.commandPreview = null;
    state.attachedNodeId = null;
    state.attachedTarget = null;
    state.velocity.set(0, 0, 0);
    clearRailState();
    clearCommandMarker();
    setMode(AMBIENT);
  }

  function setPatrolTargets(positions = []) {
    state.patrolTargets = positions
      .filter(Boolean)
      .map((position) => position.clone ? position.clone() : new THREE.Vector3(position.x, position.y, position.z));
    if (state.patrolIndex >= state.patrolTargets.length) {
      state.patrolIndex = 0;
    }
  }

  function setAttendUser(active) {
    state.attendUser = Boolean(active);
  }

  function setCommandMode(active) {
    state.commandMode = Boolean(active);
    if (!state.commandMode) {
      clearCommandPreview();
    }
  }

  function moveToWorld(point) {
    const nextPoint = cloneVector3(point);
    if (!nextPoint) return false;

    stopConstruction({ settleToAmbient: false });
    clampPointToRadius(nextPoint, COMMAND_BOUNDS_RADIUS);
    clearCommandPreview();
    state.commandTarget = nextPoint;
    state.attachedNodeId = null;
    state.attachedTarget = null;
    clearRailState();
    state.velocity.set(0, 0, 0);
    primeMovement(nextPoint);
    showCommandMarker(nextPoint);
    pulseCommandMarker(1);
    state.activationPulse = Math.max(state.activationPulse, 0.9);
    setMode(FREE_MOVE);
    return true;
  }

  function attachToNode(nodeId, position) {
    const nextPosition = cloneVector3(position);
    if (!nextPosition) return false;

    stopConstruction({ settleToAmbient: false });
    clearCommandPreview();
    state.commandTarget = nextPosition.clone();
    state.attachedNodeId = nodeId ?? null;
    state.attachedTarget = nextPosition;
    clearRailState();
    state.velocity.multiplyScalar(0.2);
    primeMovement(nextPosition);
    showCommandMarker(nextPosition);
    pulseCommandMarker(0.82);
    state.activationPulse = Math.max(state.activationPulse, 0.72);
    setMode(ATTACHED);
    return true;
  }

  function travelPath(pathNodeIds = [], positions = []) {
    const nextPositions = positions
      .map((position) => cloneVector3(position))
      .filter(Boolean);

    if (nextPositions.length === 0) {
      return false;
    }

    stopConstruction({ settleToAmbient: false });
    if (nextPositions.length === 1) {
      const loneNodeId = Array.isArray(pathNodeIds) && pathNodeIds.length > 0
        ? pathNodeIds[pathNodeIds.length - 1]
        : state.attachedNodeId;
      return attachToNode(loneNodeId, nextPositions[0]);
    }

    state.railNodeIds = Array.isArray(pathNodeIds) ? [...pathNodeIds] : [];
    state.railPositions = nextPositions;
    state.railSegmentIndex = 0;
    const finalPosition = nextPositions[nextPositions.length - 1];
    clearCommandPreview();
    state.commandTarget = finalPosition.clone();
    state.attachedNodeId = state.railNodeIds[0] ?? state.attachedNodeId;
    state.attachedTarget = finalPosition.clone();
    state.velocity.multiplyScalar(0.16);
    primeMovement(nextPositions[0]);
    showCommandMarker(finalPosition);
    pulseCommandMarker(0.9);
    setMode(RAIL_TRAVEL);
    return true;
  }

  function speak(text, options = {}) {
    const value = String(text || '').trim();
    if (!speechBubble || !value) return;
    const requestedDurationMs = typeof options === 'number'
      ? options
      : options.durationMs || 4200;
    const readingDurationMs = 880 + (value.length * 24);
    const durationMs = THREE.MathUtils.clamp(
      Math.min(requestedDurationMs, readingDurationMs),
      SPEECH_MIN_DURATION_MS,
      SPEECH_MAX_DURATION_MS,
    );
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    state.speechText = value;
    state.speechStartedMs = now;
    state.speechDurationMs = durationMs;
    state.speechUntilMs = now + durationMs;
    speechBubble.copy.textContent = value;
  }

  function setSpeech(text, durationMs) {
    speak(text, durationMs);
  }

  function updateSpeech(camera) {
    if (!speechBubble || !overlayRenderer) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!state.speechText || now > state.speechUntilMs) {
      speechBubble.bubble.style.opacity = '0';
      speechBubble.bubble.style.filter = 'blur(10px)';
      speechBubble.bubble.style.transform = 'translate(-9999px, -9999px) scale(0.96)';
      return;
    }

    const rect = overlayRenderer.domElement.getBoundingClientRect();
    body.innerCore.getWorldPosition(projectedPosition);
    projectedPosition.y += SPEECH_WORLD_OFFSET;
    projectedPosition.project(camera);

    const hasProjection = Number.isFinite(projectedPosition.x)
      && Number.isFinite(projectedPosition.y)
      && projectedPosition.z >= -1
      && projectedPosition.z <= 1;

    const x = hasProjection
      ? rect.left + ((projectedPosition.x * 0.5 + 0.5) * rect.width)
      : rect.left + (rect.width * 0.58);
    const y = hasProjection
      ? rect.top + ((-projectedPosition.y * 0.5 + 0.5) * rect.height) - 30
      : rect.top + rect.height - 220;
    const fadeIn = THREE.MathUtils.clamp((now - state.speechStartedMs) / SPEECH_FADE_IN_MS, 0, 1);
    const fadeOut = THREE.MathUtils.clamp((state.speechUntilMs - now) / SPEECH_FADE_OUT_MS, 0, 1);
    const visibility = THREE.MathUtils.smoothstep(Math.min(fadeIn, fadeOut), 0, 1);
    const lift = (1 - visibility) * SPEECH_FLOAT_PIXELS;
    speechBubble.bubble.style.opacity = visibility.toFixed(3);
    speechBubble.bubble.style.filter = `blur(${((1 - visibility) * 8).toFixed(2)}px)`;
    speechBubble.bubble.style.transform = `translate(calc(${x}px - 50%), ${y - lift}px) scale(${(0.96 + (visibility * 0.04)).toFixed(3)})`;
    speechBubble.accent.style.opacity = (0.16 + (visibility * 0.72)).toFixed(3);
    speechBubble.accent.style.transform = `scaleX(${(0.72 + (visibility * 0.28)).toFixed(3)})`;
  }

  function update(elapsed, camera) {
    const deltaSeconds = state.lastUpdateElapsed == null
      ? 0
      : Math.max(0, elapsed - state.lastUpdateElapsed);
    state.lastUpdateElapsed = elapsed;
    activeMendTarget.set(0, 0, 0);

    if (state.mode === RAIL_TRAVEL) {
      updateRailTravel();
    }

    if (state.mode === CONSTRUCTION) {
      advanceConstruction(deltaSeconds);
    }

    if (state.mode === CONSTRUCTION) {
      desiredLookTarget.y += 2;
    } else if (state.mode === FREE_MOVE) {
      if (!computeFreeMovePosition(camera)) {
        setMode(AMBIENT);
      }
    } else if (state.mode === ATTACHED) {
      if (!computeAttachedPosition(elapsed)) {
        setMode(AMBIENT);
      }
    } else if (state.mode === RAIL_TRAVEL) {
      if (state.railPositions.length === 0) {
        setMode(AMBIENT);
      } else {
        const segmentTarget = state.railPositions[Math.min(state.railSegmentIndex, state.railPositions.length - 1)];
        desiredPosition.copy(segmentTarget);
        desiredLookTarget.copy(segmentTarget);
      }
    } else if (state.attendUser) {
      computeIdlePosition(camera);
    } else if (state.target) {
      computeTargetPosition(camera);
    } else if (!computePatrolPosition(elapsed)) {
      computeIdlePosition(camera);
    }

    if (state.mode === AMBIENT && !state.target && !state.attendUser && state.patrolTargets.length > 0) {
      const patrolTarget = state.patrolTargets[state.patrolIndex % state.patrolTargets.length];
      if (patrolTarget && body.root.position.distanceTo(patrolTarget) < 34 && elapsed > state.patrolHoldUntil) {
        state.patrolHoldUntil = elapsed + PATROL_HOLD_SECONDS;
        state.mendPulse = 1;
        state.lastMendTarget = patrolTarget.clone();
      }
      if (patrolTarget && state.patrolHoldUntil > elapsed) {
        activeMendTarget.copy(patrolTarget);
      }
      if (state.patrolHoldUntil && elapsed > state.patrolHoldUntil) {
        state.patrolHoldUntil = 0;
        state.patrolIndex = (state.patrolIndex + 1) % state.patrolTargets.length;
      }
    }

    if (!state.seededDesiredPosition) {
      state.smoothedDesiredPosition.copy(desiredPosition);
      state.seededDesiredPosition = true;
    }

    const commandActive = state.mode === FREE_MOVE
      || state.mode === ATTACHED
      || state.mode === RAIL_TRAVEL
      || state.mode === CONSTRUCTION;
    const usingTargetFocus = state.mode === AMBIENT && Boolean(state.target);
    const usingAttendFocus = state.mode === AMBIENT && state.attendUser;

    let positionSmooth = AMBIENT_POSITION_SMOOTH;
    let drag = IDLE_DRAG;
    let pursuitStrength = AMBIENT_PURSUIT;
    let maxSpeed = MAX_SPEED;

    if (state.mode === CONSTRUCTION) {
      positionSmooth = 1;
      drag = 1;
      pursuitStrength = 0;
      maxSpeed = state.construction.speedPerSecond || RAIL_MAX_SPEED;
    } else if (state.mode === RAIL_TRAVEL) {
      positionSmooth = RAIL_POSITION_SMOOTH;
      drag = RAIL_DRAG;
      pursuitStrength = RAIL_PURSUIT;
      maxSpeed = RAIL_MAX_SPEED;
    } else if (state.mode === FREE_MOVE) {
      positionSmooth = FREE_MOVE_POSITION_SMOOTH;
      drag = FREE_MOVE_DRAG;
      pursuitStrength = FREE_MOVE_PURSUIT;
      maxSpeed = FREE_MOVE_MAX_SPEED;
    } else if (state.mode === ATTACHED) {
      positionSmooth = ATTACHED_POSITION_SMOOTH;
      drag = ATTACHED_DRAG;
      pursuitStrength = ATTACHED_PURSUIT;
      maxSpeed = MAX_SPEED;
    } else if (usingTargetFocus) {
      positionSmooth = TARGET_POSITION_SMOOTH;
      drag = TARGET_DRAG;
      pursuitStrength = TARGET_PURSUIT;
      maxSpeed = MAX_SPEED;
    } else if (usingAttendFocus) {
      positionSmooth = ATTEND_POSITION_SMOOTH;
      drag = ATTEND_DRAG;
      pursuitStrength = ATTEND_PURSUIT;
      maxSpeed = MAX_SPEED;
    }

    if (state.mode !== CONSTRUCTION) {
      moveAlongSegment(desiredPosition, positionSmooth, maxSpeed, drag, pursuitStrength);
    }

    if (state.mode === FREE_MOVE && state.commandTarget) {
      const distanceToCommand = body.root.position.distanceTo(state.commandTarget);
      if (distanceToCommand <= WAYPOINT_REACHED_DISTANCE) {
        const settleFactor = THREE.MathUtils.clamp(distanceToCommand / WAYPOINT_REACHED_DISTANCE, 0.08, 1);
        state.velocity.multiplyScalar(0.48 + (settleFactor * 0.28));
        if (distanceToCommand <= WAYPOINT_SETTLE_DISTANCE) {
          body.root.position.lerp(state.commandTarget, 0.22);
        }
        if (distanceToCommand <= WAYPOINT_SNAP_DISTANCE && state.velocity.lengthSq() <= 0.0008) {
          body.root.position.copy(state.commandTarget);
          state.velocity.set(0, 0, 0);
        }
      }
      state.lastMendTarget = state.commandTarget.clone();
    }

    desiredLookTarget.y += Math.sin(elapsed * (commandActive || usingTargetFocus ? 0.8 : 0.52)) * (commandActive || usingTargetFocus ? 1.5 : 3.2);
    state.smoothedLookTarget.lerp(
      desiredLookTarget,
      commandActive ? 0.24 : usingTargetFocus ? 0.24 : usingAttendFocus ? 0.11 : 0.05,
    );
    body.root.lookAt(state.smoothedLookTarget);

    const hover = (Math.sin(elapsed * 1.05) * 1.05) + (Math.sin((elapsed * 0.46) + 1.6) * 0.55);
    body.shell.rotation.y = elapsed * 0.24;
    speedVector.copy(body.root.position).sub(state.lastPosition);
    const speed = speedVector.length();
    const activeBankScale = commandActive || usingTargetFocus ? 0.055 : usingAttendFocus ? 0.032 : 0.018;
    const activePitchScale = commandActive || usingTargetFocus ? -0.045 : usingAttendFocus ? -0.028 : -0.016;
    const bank = THREE.MathUtils.clamp(speedVector.x * activeBankScale, -0.32, 0.32);
    const pitch = THREE.MathUtils.clamp(speedVector.y * activePitchScale, -0.18, 0.18);
    body.shell.rotation.z = (Math.sin(elapsed * 0.82) * 0.045) + bank;
    body.shell.rotation.x = pitch;
    body.innerCore.scale.setScalar(1 + (Math.sin(elapsed * 4.4) * 0.05));
    body.eyeRing.rotation.z = elapsed * 0.42;
    body.halo.rotation.z = -elapsed * 0.26;
    body.hardlightFins.rotation.y = elapsed * 0.2;
    body.lowerArray.rotation.x = Math.sin(elapsed * 0.92) * 0.08;
    body.wakePlumeGlow.rotation.z = Math.sin(elapsed * 0.88) * 0.08;
    body.wakePlumeCore.rotation.z = -Math.sin(elapsed * 0.76) * 0.05;

    body.floatRig.position.y = hover;
    body.floatRig.rotation.z = (Math.sin(elapsed * 0.9) * 0.03) + (bank * 0.35);
    body.floatRig.rotation.x = (Math.sin((elapsed * 0.8) + 0.8) * 0.025) + (pitch * 0.3);

    const armSpread = commandActive || usingTargetFocus ? 0.28 : 0.16;
    body.arms[0].rotation.z = armSpread + (Math.sin(elapsed * 2.1) * 0.06);
    body.arms[1].rotation.z = -armSpread + (Math.sin((elapsed * 2.1) + 1.7) * 0.06);

    if (state.activationPulse > 0.001) {
      state.activationPulse *= ACTIVATION_DECAY;
    } else {
      state.activationPulse = 0;
    }

    if (state.mendPulse > 0.001) {
      state.mendPulse *= 0.93;
    } else {
      state.mendPulse = 0;
    }

    if (state.commandPulse > 0.001) {
      state.commandPulse *= COMMAND_PULSE_DECAY;
    } else {
      state.commandPulse = 0;
    }

    const constructionBoost = state.mode === CONSTRUCTION
      ? 0.18 + (Math.sin(elapsed * 2.2) * 0.04)
      : 0;
    const pulse = state.activationPulse;
    const railMotion = state.mode === RAIL_TRAVEL ? 1 : 0;
    const freeMotion = state.mode === FREE_MOVE ? 1 : 0;
    const speedPulse = THREE.MathUtils.clamp(speed * 0.18, 0, 0.5);
    const mendGlow = state.mendPulse * 0.45;
    const pulseScale = 1 + (pulse * 0.58);
    body.halo.scale.setScalar(pulseScale + mendGlow);
    body.halo.material.opacity = 0.16 + (pulse * 0.4) + (speedPulse * 0.18) + (mendGlow * 0.8) + (railMotion * 0.06) + constructionBoost;
    body.innerCore.material.opacity = 0.8 + (pulse * 0.14) + (speedPulse * 0.1) + (mendGlow * 0.22) + (railMotion * 0.08) + (constructionBoost * 0.6);
    body.wakeHalo.scale.setScalar(1 + (speedPulse * 0.45) + (pulse * 0.16) + (mendGlow * 0.12) + (railMotion * 0.16) + (freeMotion * 0.08) + (constructionBoost * 0.45));
    body.wakeHalo.material.opacity = 0.08 + (speedPulse * 0.18) + (pulse * 0.1) + (mendGlow * 0.12) + (railMotion * 0.08) + (constructionBoost * 0.75);
    body.wakePlumeGlow.scale.set(
      1 + (speedPulse * 0.46) + (pulse * 0.18) + (railMotion * 0.14),
      1 + (speedPulse * 0.98) + (mendGlow * 0.18) + (railMotion * 0.2),
      1 + (speedPulse * 0.46) + (railMotion * 0.14),
    );
    body.wakePlumeCore.scale.set(
      1 + (speedPulse * 0.24) + (pulse * 0.08) + (railMotion * 0.08),
      1 + (speedPulse * 0.62) + (railMotion * 0.12),
      1 + (speedPulse * 0.24) + (railMotion * 0.08),
    );
    body.wakePlumeGlow.material.opacity = 0.04 + (speedPulse * 0.16) + (pulse * 0.06) + (mendGlow * 0.06) + (railMotion * 0.06) + (constructionBoost * 0.55);
    body.wakePlumeCore.material.opacity = 0.08 + (speedPulse * 0.14) + (pulse * 0.08) + (railMotion * 0.06) + (constructionBoost * 0.42);
    body.trailCore.material.opacity = 0.26 + (speedPulse * 0.22) + (pulse * 0.08) + (railMotion * 0.08) + (constructionBoost * 0.72);
    body.trailGlow.material.opacity = 0.08 + (speedPulse * 0.18) + (pulse * 0.06) + (railMotion * 0.08) + (constructionBoost * 0.9);
    body.trailDust.material.opacity = 0.05 + (speedPulse * 0.12) + (pulse * 0.04) + (railMotion * 0.04) + (constructionBoost * 0.42);
    body.trailDust.material.size = 3.2 + (speedPulse * 3.9) + (mendGlow * 1.6) + (railMotion * 1.2) + (constructionBoost * 10);

    if (speed > 0.06) {
      trailDirection.copy(speedVector).normalize();
    } else {
      body.root.getWorldDirection(trailDirection).multiplyScalar(-1);
    }
    trailAnchor.copy(body.root.position).addScaledVector(trailDirection, -TRAIL_OFFSET);
    if (!state.seededTrail) {
      seedTrail(trailAnchor);
    } else {
      const trailLerp = state.mode === RAIL_TRAVEL
        ? 0.28
        : commandActive
          ? 0.34
          : usingAttendFocus
            ? 0.24
            : 0.12;
      state.trailHead.lerp(trailAnchor, trailLerp);
      pushTrail(state.trailHead);
    }

    const mendTarget = activeMendTarget.lengthSq() > 0 ? activeMendTarget : state.lastMendTarget;
    if (mendTarget) {
      body.mendRing.visible = state.mendPulse > 0.001 || state.patrolHoldUntil > elapsed;
      body.mendSpark.visible = body.mendRing.visible;
      if (body.mendRing.visible) {
        body.mendRing.position.copy(mendTarget);
        body.mendSpark.position.copy(mendTarget);
        const mendScale = 0.88 + (state.mendPulse * 1.35) + (Math.sin(elapsed * 5.2) * 0.08);
        body.mendRing.scale.setScalar(mendScale);
        body.mendRing.material.opacity = 0.1 + (state.mendPulse * 0.22);
        body.mendSpark.scale.setScalar(0.82 + (state.mendPulse * 0.8));
        body.mendSpark.material.opacity = 0.08 + (state.mendPulse * 0.18);
      }
    } else {
      body.mendRing.visible = false;
      body.mendSpark.visible = false;
    }

    const commandMarkerTarget = getCommandMarkerTarget();
    if (commandMarkerTarget) {
      body.commandMarker.visible = true;
      commandMarkerPosition.copy(commandMarkerTarget);
      body.commandMarker.position.copy(commandMarkerPosition);

      const showingCommandPreview = state.commandMode && Boolean(state.commandPreview);
      const markerPulse = 1 + (Math.sin(elapsed * 3.2) * 0.08) + (state.commandPulse * 0.18);
      markerScale.setScalar(markerPulse);
      body.commandRing.scale.copy(markerScale);
      body.commandOuterRing.scale.setScalar(1.06 + (Math.sin((elapsed * 2.4) + 0.6) * 0.04) + (state.commandPulse * 0.3));
      body.commandDisc.scale.setScalar(1.02 + (state.commandPulse * 0.1));
      body.commandBurstRing.scale.setScalar(1 + (state.commandPulse * 2.8));
      body.commandBurstRing.position.y = 0.34 + (state.commandPulse * 0.34);
      body.commandSpire.position.y = 15 - (state.commandPulse * 1.2);
      body.commandSpire.scale.y = 0.82 + (state.commandPulse * 0.9);

      body.commandDisc.material.opacity = showingCommandPreview ? 0.08 : 0.12 + (state.commandPulse * 0.18);
      body.commandRing.material.opacity = showingCommandPreview ? 0.2 : 0.22 + (state.commandPulse * 0.24);
      body.commandOuterRing.material.opacity = showingCommandPreview ? 0.08 : 0.12 + (state.commandPulse * 0.16);
      body.commandBurstRing.material.opacity = showingCommandPreview ? 0.08 : state.commandPulse * 0.52;
      body.commandSpire.material.opacity = showingCommandPreview ? 0.08 : 0.08 + (state.commandPulse * 0.22);
      body.commandCore.material.opacity = showingCommandPreview ? 0.28 : 0.36 + (state.commandPulse * 0.34);
      body.commandCore.position.y = 4.2 + (Math.sin(elapsed * 2.2) * 1.1) + (state.commandPulse * 1.6);
      body.commandCore.scale.setScalar(1 + (state.commandPulse * 0.34));

      body.commandChevronGroup.visible = !showingCommandPreview || state.commandPulse > 0.04;
      body.commandChevrons.forEach((chevron, index) => {
        const trailPhase = (((elapsed * (showingCommandPreview ? 0.8 : 1.9)) + (index * 0.2)) % 1 + 1) % 1;
        const descent = 1 - trailPhase;
        chevron.position.set(0, 26 - (descent * 18) + (state.commandPulse * 4.8), 0);
        chevron.scale.setScalar(0.84 + (trailPhase * 0.42) + (state.commandPulse * 0.42));
        chevron.material.opacity = (showingCommandPreview ? 0.08 : 0.14 + (state.commandPulse * 0.28)) * trailPhase;
      });
    } else {
      body.commandMarker.visible = false;
    }

    state.lastPosition.copy(body.root.position);
    updateSpeech(camera);
  }

  function dispose() {
    scene.remove(body.root);
    scene.remove(body.trailGlow);
    scene.remove(body.trailCore);
    scene.remove(body.trailDust);
    scene.remove(body.mendRing);
    scene.remove(body.mendSpark);
    scene.remove(body.commandMarker);
    body.root.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    body.commandMarker.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    body.trailCore.geometry.dispose();
    body.trailCore.material.dispose();
    body.trailGlow.geometry.dispose();
    body.trailGlow.material.dispose();
    body.trailDust.geometry.dispose();
    body.trailDust.material.dispose();
    body.mendRing.geometry.dispose();
    body.mendRing.material.dispose();
    body.mendSpark.geometry.dispose();
    body.mendSpark.material.dispose();
    if (speechBubble?.bubble?.parentNode) {
      speechBubble.bubble.parentNode.removeChild(speechBubble.bubble);
    }
  }

  const controller = {
    root: body.root,
    update,
    setPreviewTarget,
    setCommandPreview,
    clearCommandPreview,
    activateTarget,
    clearTarget,
    setPatrolTargets,
    setPatrolNodes: setPatrolTargets,
    setPatrolPoints: setPatrolTargets,
    setAttendUser,
    setUserAttention: setAttendUser,
    setCommandMode,
    moveToWorld,
    attachToNode,
    travelPath,
    startConstruction,
    stopConstruction,
    clearCommand,
    clearMovementCommand: clearCommand,
    speak,
    setSpeech,
    getState,
    getMovementState: getState,
    getAttachedNodeId,
    getConstructionState,
    dispose,
  };

  Object.defineProperty(controller, 'currentState', {
    enumerable: true,
    get: getState,
  });

  Object.defineProperty(controller, 'commandMode', {
    enumerable: true,
    get() {
      return state.commandMode;
    },
  });

  return controller;
}
