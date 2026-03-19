// Graph scene renderer - edges + nodes in Three.js
// Single LineSegments for edges, Points for nodes
// Selection highlighting via buffer attribute updates

import * as THREE from 'three';

// Folder color map - each domain gets a signature hue
const FOLDER_COLORS = {
  '10-Sessions':     new THREE.Color(0x14b8ff),
  '20-Architecture': new THREE.Color(0x2f7dff),
  '30-Projects':     new THREE.Color(0x8d58ff),
  '39-Archive':      new THREE.Color(0x5342bb),
  '40-Decisions':    new THREE.Color(0x6a45ff),
  '50-Playbooks':    new THREE.Color(0x17c8ff),
  '60-Knowledge':    new THREE.Color(0xffb948),
  '70-Ops':          new THREE.Color(0x2edb7a),
  '80-Secure':       new THREE.Color(0xe04688),
  '01-Daily':        new THREE.Color(0x7d91c8),
  '00-Inbox':        new THREE.Color(0x6f87ae),
  '99-Templates':    new THREE.Color(0x5b708e),
};
const DEFAULT_FOLDER_COLOR = new THREE.Color(0x4d72d7);
const EDGE_SELECTED = new THREE.Color(0x44ccee);
const NODE_SELECTED = new THREE.Color(0x55ccee);
const NODE_COLOR = new THREE.Color(0x6088aa); // fallback
const TRAVEL_EDGE_COLOR = new THREE.Color(0x6fc6ff);
const TRAVEL_EDGE_CORE = new THREE.Color(0xe8f7ff);
const ARRIVAL_NODE_COLOR = new THREE.Color(0xbbe8ff);

function getFolderColor(folder) {
  return FOLDER_COLORS[folder] || DEFAULT_FOLDER_COLOR;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hashString(value) {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return (hash >>> 0) / 4294967295;
}

function hash01(value, salt = '') {
  return hashString(`${salt}:${value}`);
}

function tuneGraphColor(color, saturationBoost = 0.12, lightnessScale = 0.86, lightnessLift = 0.055) {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return new THREE.Color().setHSL(
    hsl.h,
    clamp01(hsl.s + saturationBoost),
    clamp01(hsl.l * lightnessScale + lightnessLift),
  );
}

function mixColors(colorA, colorB, alpha) {
  return new THREE.Color().copy(colorA).lerp(colorB, clamp01(alpha));
}

function glowChannel(base, glow, brightness, glowMix, maxValue = 1.2) {
  return Math.min(maxValue, base * brightness + glow * glowMix);
}

function setGlowColor(buffer, offset, defaults, brightness, glowColor, glowMix, maxValue = 1.2) {
  buffer[offset] = glowChannel(defaults[offset], glowColor.r, brightness, glowMix, maxValue);
  buffer[offset + 1] = glowChannel(defaults[offset + 1], glowColor.g, brightness, glowMix, maxValue);
  buffer[offset + 2] = glowChannel(defaults[offset + 2], glowColor.b, brightness, glowMix, maxValue);
}

function zeroAttribute(attr) {
  attr.array.fill(0);
  attr.needsUpdate = true;
}

function setEdgeTravelIntensity(travelAttr, edgeIndex, intensity) {
  if (edgeIndex == null || edgeIndex < 0) return;
  const clamped = clamp01(intensity);
  const vi = edgeIndex * 2;
  if (vi + 1 >= travelAttr.count) return;
  travelAttr.array[vi] = Math.max(travelAttr.array[vi], clamped);
  travelAttr.array[vi + 1] = Math.max(travelAttr.array[vi + 1], clamped);
}

function createTravelState() {
  return {
    activeEdgeIndices: new Set(),
    recentEdgeDecay: new Map(),
    beamEdgeIndex: null,
    beamOriginNodeId: null,
    beamProgress: 0,
    beamStrength: 0,
    pathEdgeIndices: [],
    waveEdgeIndices: [],
    waveOriginNodeId: null,
    waveStartedAt: null,
    waveDuration: 0.8,
    waveStrength: 0,
    arrivalNodeId: null,
    arrivalDuration: 1.8,
    arrivalStrength: 1,
    arrivalStartedAt: null,
    lastTickAt: null,
    decayPerSecond: 1.1,
    activeIntensity: 1,
    recentIntensity: 0.76,
  };
}

function resolvePathEdgeIndices(pathNodeIds = [], tesseract) {
  if (!Array.isArray(pathNodeIds) || pathNodeIds.length < 2 || !tesseract) return [];
  const edgeIndices = [];
  for (let i = 1; i < pathNodeIds.length; i++) {
    const edgeIndex = tesseract.getEdgeIndexByPair(pathNodeIds[i - 1], pathNodeIds[i]);
    if (edgeIndex != null) edgeIndices.push(edgeIndex);
  }
  return edgeIndices;
}

export function buildEdges(scene, tesseract) {
  const edgeData = tesseract.getEdgesWithPositions();
  const vertexCount = edgeData.length * 2;
  let maxRadius = 1;
  for (const node of tesseract.nodes || []) {
    maxRadius = Math.max(maxRadius, Math.hypot(node.x || 0, node.y || 0, node.z || 0));
  }

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const alphas = new Float32Array(vertexCount);
  const travel = new Float32Array(vertexCount);
  const waveProgress = new Float32Array(vertexCount);
  const waveCoord = new Float32Array(vertexCount);
  const waveStrength = new Float32Array(vertexCount);
  const hotness = new Float32Array(vertexCount);
  const driftPhase = new Float32Array(vertexCount);
  const depthVariance = new Float32Array(vertexCount);
  const clusterPhase = new Float32Array(vertexCount);
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

    const edgeKey = `${e.source}|${e.target}|${i}`;
    const alwaysHot = 0.14 + Math.pow(hash01(edgeKey, 'hot'), 1.45) * 0.86;
    const phase = hash01(edgeKey, 'phase') * Math.PI * 2;
    const familyPhase = hash01(`${e.sourceFolder}|${e.targetFolder}`, 'cluster') * Math.PI * 2;
    const midX = (e.sourcePos.x + e.targetPos.x) * 0.5;
    const midY = (e.sourcePos.y + e.targetPos.y) * 0.5;
    const midZ = (e.sourcePos.z + e.targetPos.z) * 0.5;
    const radialDepth = clamp01(Math.hypot(midX, midY, midZ) / maxRadius);
    const depthBias = clamp01(radialDepth * 0.82 + hash01(edgeKey, 'depth') * 0.18);

    // Color: blend the folder colors of source and target nodes
    const srcColor = tuneGraphColor(getFolderColor(e.sourceFolder), 0.06, 0.74, 0.04);
    const tgtColor = tuneGraphColor(getFolderColor(e.targetFolder), 0.06, 0.74, 0.04);
    const c = new THREE.Color().lerpColors(srcColor, tgtColor, 0.5);
    // Idle and selected should share one family, so the base field already carries a restrained version of the selected energy.
    const t = Math.log(1 + e.weight) / Math.log(1 + maxWeight);
    const accent = mixColors(srcColor, tgtColor, 0.35);
    c.multiplyScalar(0.4 + t * 0.06 + alwaysHot * 0.075 + depthBias * 0.036);
    c.lerp(accent, 0.14 + t * 0.11 + alwaysHot * 0.1);
    c.lerp(TRAVEL_EDGE_COLOR, 0.022 + alwaysHot * 0.065 + depthBias * 0.034);
    c.offsetHSL(0, 0.022 + t * 0.024 + alwaysHot * 0.022, 0.008 + t * 0.012 + depthBias * 0.01);
    const alpha = 0.11 + t * 0.048 + alwaysHot * 0.16 + depthBias * 0.06;

    colors[vi * 3] = c.r; colors[vi * 3 + 1] = c.g; colors[vi * 3 + 2] = c.b;
    colors[(vi + 1) * 3] = c.r; colors[(vi + 1) * 3 + 1] = c.g; colors[(vi + 1) * 3 + 2] = c.b;
    alphas[vi] = alpha;
    alphas[vi + 1] = alpha;
    waveCoord[vi] = 0;
    waveCoord[vi + 1] = 1;
    hotness[vi] = alwaysHot;
    hotness[vi + 1] = alwaysHot;
    driftPhase[vi] = phase;
    driftPhase[vi + 1] = phase;
    depthVariance[vi] = depthBias;
    depthVariance[vi + 1] = depthBias;
    clusterPhase[vi] = familyPhase;
    clusterPhase[vi + 1] = familyPhase;

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
  const travelAttr = new THREE.BufferAttribute(travel, 1);
  const waveProgressAttr = new THREE.BufferAttribute(waveProgress, 1);
  const waveCoordAttr = new THREE.BufferAttribute(waveCoord, 1);
  const waveStrengthAttr = new THREE.BufferAttribute(waveStrength, 1);
  const hotnessAttr = new THREE.BufferAttribute(hotness, 1);
  const driftPhaseAttr = new THREE.BufferAttribute(driftPhase, 1);
  const depthVarianceAttr = new THREE.BufferAttribute(depthVariance, 1);
  const clusterPhaseAttr = new THREE.BufferAttribute(clusterPhase, 1);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colorAttr);
  geometry.setAttribute('alpha', alphaAttr);
  geometry.setAttribute('travel', travelAttr);
  geometry.setAttribute('waveProgress', waveProgressAttr);
  geometry.setAttribute('waveCoord', waveCoordAttr);
  geometry.setAttribute('waveStrength', waveStrengthAttr);
  geometry.setAttribute('hotness', hotnessAttr);
  geometry.setAttribute('driftPhase', driftPhaseAttr);
  geometry.setAttribute('depthVariance', depthVarianceAttr);
  geometry.setAttribute('clusterPhase', clusterPhaseAttr);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
    },
    vertexShader: `
      attribute float alpha;
      attribute vec3 color;
      attribute float travel;
      attribute float waveProgress;
      attribute float waveCoord;
      attribute float waveStrength;
      attribute float hotness;
      attribute float driftPhase;
      attribute float depthVariance;
      attribute float clusterPhase;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vDist;
      varying float vTravel;
      varying float vWaveProgress;
      varying float vWaveCoord;
      varying float vWaveStrength;
      varying float vHotness;
      varying float vDriftPhase;
      varying float vDepthVariance;
      varying float vClusterPhase;
      void main() {
        vAlpha = alpha;
        vColor = color;
        vTravel = travel;
        vWaveProgress = waveProgress;
        vWaveCoord = waveCoord;
        vWaveStrength = waveStrength;
        vHotness = hotness;
        vDriftPhase = driftPhase;
        vDepthVariance = depthVariance;
        vClusterPhase = clusterPhase;
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
      varying float vTravel;
      varying float vWaveProgress;
      varying float vWaveCoord;
      varying float vWaveStrength;
      varying float vHotness;
      varying float vDriftPhase;
      varying float vDepthVariance;
      varying float vClusterPhase;
      void main() {
        float flow = sin(vDist * 8.0 - uTime * 1.5) * 0.5 + 0.5;
        float clusterTime = uTime * (0.16 + vDepthVariance * 0.05);
        float ambientRise = max(0.0, sin(clusterTime + vClusterPhase + vDist * 0.22));
        float ambientRebound = max(0.0, sin(clusterTime + vClusterPhase + vDist * 0.22 - 0.72));
        float ambientCrest = max(0.0, sin(clusterTime + vClusterPhase + vDist * 0.22 - 0.16));
        float ambientPulse = clamp(
          pow(ambientRise, 2.55) * (0.088 + vDepthVariance * 0.034 + vHotness * 0.024) +
          pow(ambientRebound, 1.65) * (0.048 + vHotness * 0.038) +
          ambientCrest * (0.024 + vDepthVariance * 0.012),
          0.0,
          0.195
        );
        float emberWave = 0.5 + 0.5 * sin(uTime * (0.24 + vHotness * 0.12) + vDriftPhase + vDist * (0.5 + vDepthVariance * 0.65));
        float emberGate = smoothstep(0.7, 0.955, emberWave);
        float ember = emberGate * emberGate * (0.018 + vHotness * 0.095);
        float shimmer = 0.66 + ambientPulse * 1.18 + ember * 1.9 + 0.024 * flow + vDepthVariance * 0.082 + vHotness * 0.052;
        float electric = clamp(vTravel, 0.0, 1.0);
        float waveProgress = clamp(vWaveProgress, 0.0, 1.0);
        float waveStrength = clamp(vWaveStrength, 0.0, 1.0);
        float waveHead = smoothstep(waveProgress - 0.16, waveProgress - 0.03, vWaveCoord) * (1.0 - smoothstep(waveProgress + 0.02, waveProgress + 0.14, vWaveCoord));
        float waveWake = (1.0 - smoothstep(waveProgress - 0.24, waveProgress + 0.04, vWaveCoord)) * step(vWaveCoord, waveProgress + 0.04);
        float ripple = clamp((waveHead * 0.96 + waveWake * 0.24) * waveStrength, 0.0, 1.0);
        vec3 idleAccent = mix(vColor, vec3(${TRAVEL_EDGE_COLOR.r.toFixed(4)}, ${TRAVEL_EDGE_COLOR.g.toFixed(4)}, ${TRAVEL_EDGE_COLOR.b.toFixed(4)}), 0.03 + vHotness * 0.11 + vDepthVariance * 0.05);
        vec3 baseColor = idleAccent * (0.82 + ambientPulse * 1.2 + ember * 1.28 + flow * 0.024 + vHotness * 0.06);
        vec3 travelColor = mix(vec3(${TRAVEL_EDGE_COLOR.r.toFixed(4)}, ${TRAVEL_EDGE_COLOR.g.toFixed(4)}, ${TRAVEL_EDGE_COLOR.b.toFixed(4)}), vec3(${TRAVEL_EDGE_CORE.r.toFixed(4)}, ${TRAVEL_EDGE_CORE.g.toFixed(4)}, ${TRAVEL_EDGE_CORE.b.toFixed(4)}), 0.52 + 0.22 * flow);
        vec3 rippleColor = mix(vec3(${TRAVEL_EDGE_COLOR.r.toFixed(4)}, ${TRAVEL_EDGE_COLOR.g.toFixed(4)}, ${TRAVEL_EDGE_COLOR.b.toFixed(4)}), vec3(${TRAVEL_EDGE_CORE.r.toFixed(4)}, ${TRAVEL_EDGE_CORE.g.toFixed(4)}, ${TRAVEL_EDGE_CORE.b.toFixed(4)}), 0.34 + 0.46 * waveHead);
        vec3 traveledColor = mix(baseColor, max(baseColor, travelColor * (0.84 + 0.54 * electric)), electric);
        vec3 finalColor = mix(traveledColor, max(traveledColor, rippleColor * (0.72 + 0.34 * ripple)), ripple);
        float finalAlpha = clamp(vAlpha * shimmer + electric * (0.24 + 0.34 * flow) + ripple * 0.16, 0.0, 0.94);
        gl_FragColor = vec4(finalColor, finalAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.LineSegments(geometry, material);
  mesh.onBeforeRender = () => {
    material.uniforms.uTime.value = performance.now() * 0.001;
  };
  scene.add(mesh);

  return {
    mesh,
    material,
    posAttr,
    colorAttr,
    alphaAttr,
    travelAttr,
    waveProgressAttr,
    waveCoordAttr,
    waveStrengthAttr,
    hotnessAttr,
    driftPhaseAttr,
    depthVarianceAttr,
    clusterPhaseAttr,
    defaultColors,
    defaultAlphas,
    edgeIndex,
    edgeData,
    vertexCount,
    travelState: createTravelState(),
  };
}

export function buildNodes(scene, tesseract) {
  const nodes = tesseract.nodes;
  const positions = new Float32Array(nodes.length * 3);
  const colors = new Float32Array(nodes.length * 3);
  const sizes = new Float32Array(nodes.length);
  const arrival = new Float32Array(nodes.length);
  const hotness = new Float32Array(nodes.length);
  const driftPhase = new Float32Array(nodes.length);
  const depthVariance = new Float32Array(nodes.length);
  const clusterPhase = new Float32Array(nodes.length);
  const defaultSizes = new Float32Array(nodes.length);
  const defaultColors = new Float32Array(nodes.length * 3);
  const nodeIdByIndex = new Map();
  const indexByNodeId = new Map();

  let maxLinks = 1;
  let maxRadius = 1;
  for (const n of nodes) {
    if ((n.linkCount || 0) > maxLinks) maxLinks = n.linkCount;
    maxRadius = Math.max(maxRadius, Math.hypot(n.x || 0, n.y || 0, n.z || 0));
  }

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    positions[i * 3] = n.x;
    positions[i * 3 + 1] = n.y;
    positions[i * 3 + 2] = n.z;

    const t = Math.log(1 + (n.linkCount || 0)) / Math.log(1 + maxLinks);
    const nodeKey = `${n.id}|${i}`;
    const alwaysHot = 0.16 + Math.pow(hash01(nodeKey, 'hot'), 1.7) * 0.84;
    const phase = hash01(nodeKey, 'phase') * Math.PI * 2;
    const familyPhase = hash01(n.folder || 'default', 'cluster') * Math.PI * 2;
    const depthBias = clamp01((Math.hypot(n.x || 0, n.y || 0, n.z || 0) / maxRadius) * 0.8 + hash01(nodeKey, 'depth') * 0.2);
    const folderC = tuneGraphColor(getFolderColor(n.folder), 0.08, 0.76, 0.04);
    const c = folderC.clone().multiplyScalar(0.72 + t * 0.08 + alwaysHot * 0.07);
    c.lerp(TRAVEL_EDGE_COLOR, 0.02 + alwaysHot * 0.06 + depthBias * 0.03);
    c.offsetHSL(0, 0.018 + t * 0.018 + alwaysHot * 0.018, 0.008 + t * 0.01 + depthBias * 0.008);
    // Recency glow: nodes created in last 30 days get a white shift
    if (n.created) {
      const age = (Date.now() - new Date(n.created).getTime()) / (1000 * 60 * 60 * 24);
      if (age < 30) {
        const recency = 1 - age / 30; // 1.0 = today, 0 = 30 days ago
        c.lerp(folderC.clone().offsetHSL(0.01, 0.02, 0.06), recency * 0.16);
        c.lerp(new THREE.Color(0xffffff), recency * 0.02);
      }
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    defaultColors[i * 3] = c.r;
    defaultColors[i * 3 + 1] = c.g;
    defaultColors[i * 3 + 2] = c.b;

    const size = 3.9 + t * 14.2 + alwaysHot * 1.4 + depthBias * 0.8;
    sizes[i] = size;
    defaultSizes[i] = size;
    hotness[i] = alwaysHot;
    driftPhase[i] = phase;
    depthVariance[i] = depthBias;
    clusterPhase[i] = familyPhase;

    nodeIdByIndex.set(i, n.id);
    indexByNodeId.set(n.id, i);
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  const sizeAttr = new THREE.BufferAttribute(sizes, 1);
  const arrivalAttr = new THREE.BufferAttribute(arrival, 1);
  const hotnessAttr = new THREE.BufferAttribute(hotness, 1);
  const driftPhaseAttr = new THREE.BufferAttribute(driftPhase, 1);
  const depthVarianceAttr = new THREE.BufferAttribute(depthVariance, 1);
  const clusterPhaseAttr = new THREE.BufferAttribute(clusterPhase, 1);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colorAttr);
  geometry.setAttribute('size', sizeAttr);
  geometry.setAttribute('arrival', arrivalAttr);
  geometry.setAttribute('hotness', hotnessAttr);
  geometry.setAttribute('driftPhase', driftPhaseAttr);
  geometry.setAttribute('depthVariance', depthVarianceAttr);
  geometry.setAttribute('clusterPhase', clusterPhaseAttr);

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: `
      uniform float uTime;
      attribute float size;
      attribute vec3 color;
      attribute float arrival;
      attribute float hotness;
      attribute float driftPhase;
      attribute float depthVariance;
      attribute float clusterPhase;
      varying vec3 vColor;
      varying float vArrival;
      varying float vAmbientPulse;
      varying float vHotness;
      varying float vDepthVariance;
      varying float vSparkle;
      void main() {
        vColor = color;
        vArrival = arrival;
        vHotness = hotness;
        vDepthVariance = depthVariance;
        float cycle = uTime * (0.18 + depthVariance * 0.06) + length(position) * 0.0008 + clusterPhase;
        float ambientRise = max(0.0, sin(cycle));
        float ambientRebound = max(0.0, sin(cycle - 0.68));
        float ambientCrest = max(0.0, sin(cycle - 0.14));
        vAmbientPulse = clamp(
          pow(ambientRise, 2.45) * (0.056 + hotness * 0.036) +
          pow(ambientRebound, 1.62) * (0.034 + depthVariance * 0.022) +
          ambientCrest * 0.016,
          0.0,
          0.14
        );
        float sparkleWave = 0.5 + 0.5 * sin(uTime * (0.42 + hotness * 0.18) + driftPhase + depthVariance * 4.0);
        vSparkle = smoothstep(0.76, 0.98, sparkleWave) * (0.03 + hotness * 0.13);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (1.0 + arrival * 0.18 + vAmbientPulse * 0.14 + vSparkle * 0.24) * (660.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 1.4, 54.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vArrival;
      varying float vAmbientPulse;
      varying float vHotness;
      varying float vDepthVariance;
      varying float vSparkle;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float a = 1.0 - smoothstep(0.26, 0.5, d);
        float arrival = clamp(vArrival, 0.0, 1.0);
        vec3 arrivalColor = mix(vec3(${TRAVEL_EDGE_COLOR.r.toFixed(4)}, ${TRAVEL_EDGE_COLOR.g.toFixed(4)}, ${TRAVEL_EDGE_COLOR.b.toFixed(4)}), vec3(${ARRIVAL_NODE_COLOR.r.toFixed(4)}, ${ARRIVAL_NODE_COLOR.g.toFixed(4)}, ${ARRIVAL_NODE_COLOR.b.toFixed(4)}), 0.55);
        vec3 ambientColor = mix(vColor, vec3(${TRAVEL_EDGE_COLOR.r.toFixed(4)}, ${TRAVEL_EDGE_COLOR.g.toFixed(4)}, ${TRAVEL_EDGE_COLOR.b.toFixed(4)}), 0.016 + vHotness * 0.044 + vDepthVariance * 0.02 + vAmbientPulse * 0.036);
        vec3 sparkColor = mix(ambientColor, vec3(${ARRIVAL_NODE_COLOR.r.toFixed(4)}, ${ARRIVAL_NODE_COLOR.g.toFixed(4)}, ${ARRIVAL_NODE_COLOR.b.toFixed(4)}), 0.14 + vSparkle * 0.38);
        vec3 finalColor = mix(sparkColor, max(sparkColor, arrivalColor * (0.68 + 0.2 * arrival)), arrival);
        float halo = smoothstep(0.5, 0.08, d) * (arrival * 0.2 + vAmbientPulse * (0.04 + vHotness * 0.022) + vSparkle * 0.12);
        gl_FragColor = vec4(finalColor, clamp(a * (0.88 + vAmbientPulse * 0.08 + vDepthVariance * 0.028 + vSparkle * 0.14) + halo, 0.0, 0.97));
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
    material,
    posAttr,
    colorAttr,
    sizeAttr,
    arrivalAttr,
    hotnessAttr,
    driftPhaseAttr,
    depthVarianceAttr,
    clusterPhaseAttr,
    defaultSizes,
    defaultColors,
    nodeIdByIndex,
    indexByNodeId,
    nodeCount: nodes.length,
    travelState: createTravelState(),
  };
}

// ============ SKYBOX: Stars + Nebula + Dust ============
export function buildSkybox(scene) {
  const cameraAnchored = [];
  const veilMaterials = [];

  function registerCameraAnchored(object, offset) {
    object.userData.skyboxOffset = offset.clone();
    cameraAnchored.push(object);
    scene.add(object);
    return object;
  }

  function syncCameraAnchored(camera) {
    if (!camera) return;
    for (const object of cameraAnchored) {
      object.position.copy(camera.position).add(object.userData.skyboxOffset);
    }
  }

  function syncSkybox(camera, elapsed) {
    syncCameraAnchored(camera);
    if (typeof elapsed === 'number') {
      starMat.uniforms.uTime.value = elapsed;
      outerStarMat.uniforms.uTime.value = elapsed;
      for (const material of veilMaterials) {
        material.uniforms.uTime.value = elapsed;
      }
    }
  }

  // === Camera-anchored far star field ===
  const STAR_COUNT = 6400;
  const BAND_EXTRA = 2800;
  const TOTAL_STARS = STAR_COUNT + BAND_EXTRA;
  const starPositions = new Float32Array(TOTAL_STARS * 3);
  const starColors = new Float32Array(TOTAL_STARS * 3);
  const starSizes = new Float32Array(TOTAL_STARS);
  const starPhases = new Float32Array(TOTAL_STARS);
  const starBands = new Float32Array(TOTAL_STARS);

  const starPalette = [
    new THREE.Color(0xe4f2ff),
    new THREE.Color(0xc7dcff),
    new THREE.Color(0xaec8f4),
    new THREE.Color(0x97b5e2),
    new THREE.Color(0x7fa0d3),
  ];

  for (let i = 0; i < TOTAL_STARS; i++) {
    const key = `star-${i}`;
    const isBand = i >= STAR_COUNT;
    const theta = hash01(key, 'theta') * Math.PI * 2;
    const isBandValue = isBand ? 1 : 0;
    if (isBand) {
      const bandRadius = 14500 + hash01(key, 'radius') * 9000;
      const bandY = (
        hash01(key, 'band-y0') +
        hash01(key, 'band-y1') +
        hash01(key, 'band-y2') -
        1.5
      ) * 1700;
      starPositions[i * 3] = bandRadius * Math.cos(theta);
      starPositions[i * 3 + 1] = bandY;
      starPositions[i * 3 + 2] = bandRadius * Math.sin(theta);
    } else {
      const radius = 17500 + hash01(key, 'radius') * 7000;
      const phi = Math.acos(hash01(key, 'phi') * 2 - 1);
      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = radius * Math.cos(phi);
    }

    const paletteIndex = Math.floor(hash01(key, 'palette') * starPalette.length) % starPalette.length;
    const color = starPalette[paletteIndex].clone().multiplyScalar(0.8 + hash01(key, 'brightness') * 0.3);
    starColors[i * 3] = color.r;
    starColors[i * 3 + 1] = color.g;
    starColors[i * 3 + 2] = color.b;
    starSizes[i] = (isBand ? 0.9 : 0.8) + hash01(key, 'size') * (isBand ? 1.35 : 1.05);
    starPhases[i] = hash01(key, 'phase') * Math.PI * 2;
    starBands[i] = isBandValue;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
  starGeo.setAttribute('phase', new THREE.BufferAttribute(starPhases, 1));
  starGeo.setAttribute('band', new THREE.BufferAttribute(starBands, 1));

  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: `
      uniform float uTime;
      attribute float size;
      attribute float phase;
      attribute float band;
      attribute vec3 color;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float twinkle = 0.975 + 0.025 * sin(uTime * (0.03 + band * 0.035) + phase);
        float breathing = 0.5 + 0.5 * sin(uTime * (0.018 + band * 0.02) + phase * 0.7);
        vColor = color * twinkle;
        vAlpha = 0.34 + band * 0.14 + breathing * 0.08;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(size * (0.96 + band * 0.2 + breathing * 0.12), 0.9, 3.4);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float core = 1.0 - smoothstep(0.0, 0.2, d);
        float halo = 1.0 - smoothstep(0.12, 0.5, d);
        gl_FragColor = vec4(vColor, clamp(core * 0.38 + halo * vAlpha, 0.0, 0.8));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const starPoints = registerCameraAnchored(
    new THREE.Points(starGeo, starMat),
    new THREE.Vector3(0, 0, 0),
  );

  // Ultra-faint outer shell to keep the void deep without camera shimmer.
  const OUTER_STAR_COUNT = 2600;
  const outerStarPositions = new Float32Array(OUTER_STAR_COUNT * 3);
  const outerStarColors = new Float32Array(OUTER_STAR_COUNT * 3);
  const outerStarSizes = new Float32Array(OUTER_STAR_COUNT);
  const outerStarPhases = new Float32Array(OUTER_STAR_COUNT);
  const outerPalette = [
    new THREE.Color(0xa8bedc),
    new THREE.Color(0x8fa8cc),
    new THREE.Color(0x718eb8),
  ];

  for (let i = 0; i < OUTER_STAR_COUNT; i++) {
    const key = `outer-star-${i}`;
    const theta = hash01(key, 'theta') * Math.PI * 2;
    const phi = Math.acos(hash01(key, 'phi') * 2 - 1);
    const radius = 29000 + hash01(key, 'radius') * 17000;
    outerStarPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    outerStarPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    outerStarPositions[i * 3 + 2] = radius * Math.cos(phi);

    const paletteIndex = Math.floor(hash01(key, 'palette') * outerPalette.length) % outerPalette.length;
    const color = outerPalette[paletteIndex].clone().multiplyScalar(0.58 + hash01(key, 'brightness') * 0.22);
    outerStarColors[i * 3] = color.r;
    outerStarColors[i * 3 + 1] = color.g;
    outerStarColors[i * 3 + 2] = color.b;
    outerStarSizes[i] = 0.45 + hash01(key, 'size') * 0.55;
    outerStarPhases[i] = hash01(key, 'phase') * Math.PI * 2;
  }

  const outerStarGeo = new THREE.BufferGeometry();
  outerStarGeo.setAttribute('position', new THREE.BufferAttribute(outerStarPositions, 3));
  outerStarGeo.setAttribute('color', new THREE.BufferAttribute(outerStarColors, 3));
  outerStarGeo.setAttribute('size', new THREE.BufferAttribute(outerStarSizes, 1));
  outerStarGeo.setAttribute('phase', new THREE.BufferAttribute(outerStarPhases, 1));

  const outerStarMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: `
      uniform float uTime;
      attribute float size;
      attribute float phase;
      attribute vec3 color;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float shimmer = 0.985 + 0.015 * sin(uTime * 0.02 + phase);
        vColor = color * shimmer;
        vAlpha = 0.14 + 0.04 * (0.5 + 0.5 * sin(uTime * 0.012 + phase * 0.8));
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(size, 0.5, 1.3);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float a = 1.0 - smoothstep(0.1, 0.5, d);
        gl_FragColor = vec4(vColor, a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  registerCameraAnchored(
    new THREE.Points(outerStarGeo, outerStarMat),
    new THREE.Vector3(0, 0, 0),
  );

  const planetConfigs = [
    {
      offset: new THREE.Vector3(34000, 6400, -26000),
      radius: 2100,
      color: 0x5873ab,
      glow: 0x9bc1ff,
      opacity: 0.16,
    },
    {
      offset: new THREE.Vector3(-32000, -5200, 28000),
      radius: 1600,
      color: 0x4f628f,
      glow: 0x8eb4f2,
      opacity: 0.13,
      ringColor: 0x9bc6ff,
    },
    {
      offset: new THREE.Vector3(6000, 9800, 36000),
      radius: 2500,
      color: 0x4c537f,
      glow: 0xb5c8ff,
      opacity: 0.12,
    },
    {
      offset: new THREE.Vector3(-40000, 8400, -22000),
      radius: 1300,
      color: 0x3f557d,
      glow: 0x86aef2,
      opacity: 0.1,
    },
    {
      offset: new THREE.Vector3(18000, -9000, 42000),
      radius: 1700,
      color: 0x6170a2,
      glow: 0xb0d8ff,
      opacity: 0.1,
      ringColor: 0x7fa8ef,
    },
  ];

  for (const config of planetConfigs) {
    const group = new THREE.Group();
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(config.radius, 28, 28),
      new THREE.MeshBasicMaterial({
        color: config.color,
        transparent: true,
        opacity: config.opacity,
        depthWrite: false,
      }),
    );
    group.add(planet);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(config.radius * 1.16, 24, 24),
      new THREE.MeshBasicMaterial({
        color: config.glow,
        transparent: true,
        opacity: config.opacity * 0.38,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(atmosphere);

    if (config.ringColor) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(config.radius * 1.35, config.radius * 1.9, 48),
        new THREE.MeshBasicMaterial({
          color: config.ringColor,
          transparent: true,
          opacity: config.opacity * 0.26,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI * 0.42;
      ring.rotation.z = Math.PI * 0.18;
      group.add(ring);
    }

    registerCameraAnchored(group, config.offset);
  }

  const sunGroup = new THREE.Group();
  const sunCore = new THREE.Mesh(
    new THREE.SphereGeometry(3800, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0xf4d8a2,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  );
  sunGroup.add(sunCore);
  const sunAura = new THREE.Mesh(
    new THREE.SphereGeometry(5400, 28, 28),
    new THREE.MeshBasicMaterial({
      color: 0xf5c97a,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sunGroup.add(sunAura);
  registerCameraAnchored(sunGroup, new THREE.Vector3(52000, 15000, -48000));

  // === Visible planetarium shell: faint dome, ribs, oculus, and structured atmosphere ===
  const domeRadius = 15400;
  const domeGeometry = new THREE.SphereGeometry(domeRadius, 72, 72);
  const domeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uColorA: { value: new THREE.Color(0x0b1630) },
      uColorB: { value: new THREE.Color(0x163056) },
      uGlow: { value: new THREE.Color(0x345f96) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uGlow;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      void main() {
        vec3 shellDir = normalize(vWorldPosition);
        float polar = acos(clamp(shellDir.y, -1.0, 1.0));
        float azimuth = atan(shellDir.z, shellDir.x);
        float ribAz = pow(1.0 - abs(sin(azimuth * 12.0)), 22.0);
        float ribPolar = pow(1.0 - abs(sin((polar - 0.24) * 8.0)), 18.0);
        float ribs = ribAz * 0.7 + ribPolar * 0.45;
        float oculus = smoothstep(0.3, 0.06, polar);
        float horizon = smoothstep(0.18, 0.86, 1.0 - abs(shellDir.y));
        float drift = 0.5 + 0.5 * sin(uTime * 0.05 + azimuth * 4.0 + polar * 6.0);
        vec3 color = mix(uColorA, uColorB, 0.24 + 0.38 * horizon + 0.14 * drift);
        color = mix(color, uGlow, ribs * 0.26 + oculus * 0.22);
        float alpha = 0.015 + horizon * 0.018 + ribs * 0.03 + oculus * 0.04;
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.08));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  veilMaterials.push(domeMaterial);
  scene.add(new THREE.Mesh(domeGeometry, domeMaterial));

  const atmosphereConfigs = [
    {
      radius: domeRadius * 0.96,
      colorA: new THREE.Color(0x163760),
      colorB: new THREE.Color(0x2c5a86),
      opacity: 0.12,
      noiseScale: 0.00046,
      rotation: [0.06, 0.22, -0.04],
    },
    {
      radius: domeRadius * 0.84,
      colorA: new THREE.Color(0x0f2748),
      colorB: new THREE.Color(0x2f5f8a),
      opacity: 0.08,
      noiseScale: 0.00062,
      rotation: [-0.08, 0.58, 0.03],
    },
  ];

  for (const config of atmosphereConfigs) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        uColorA: { value: config.colorA },
        uColorB: { value: config.colorB },
        uOpacity: { value: config.opacity },
        uNoiseScale: { value: config.noiseScale },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uOpacity;
        uniform float uNoiseScale;
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;
        void main() {
          vec3 shellDir = normalize(vWorldPosition);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float fresnel = pow(1.0 - abs(dot(normalize(vWorldNormal), viewDir)), 1.45);
          float azimuth = atan(shellDir.z, shellDir.x);
          float polar = acos(clamp(shellDir.y, -1.0, 1.0));
          float ribs = pow(1.0 - abs(sin(azimuth * 10.0)), 18.0) * 0.24;
          float swirl =
            sin(vWorldPosition.x * uNoiseScale + uTime * 0.05) *
            sin(vWorldPosition.y * uNoiseScale * 1.3 - uTime * 0.04) *
            sin(vWorldPosition.z * uNoiseScale * 0.82 + uTime * 0.03);
          float body = smoothstep(-0.48, 0.78, swirl);
          float canopy = smoothstep(0.2, 1.0, sin(polar * 1.3) * 0.5 + 0.5);
          vec3 color = mix(uColorA, uColorB, 0.26 + 0.46 * body + canopy * 0.12);
          float alpha = clamp((0.012 + fresnel * 0.05 + body * 0.028 + ribs * 0.03) * uOpacity, 0.0, 0.085);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });
    veilMaterials.push(material);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(config.radius, 54, 54), material);
    shell.rotation.set(...config.rotation);
    scene.add(shell);
  }

  const ribMaterial = new THREE.MeshBasicMaterial({
    color: 0x3a6ea1,
    transparent: true,
    opacity: 0.05,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ribRadii = [domeRadius * 0.86, domeRadius * 0.9, domeRadius * 0.94];
  for (let index = 0; index < ribRadii.length; index += 1) {
    const rib = new THREE.Mesh(
      new THREE.TorusGeometry(ribRadii[index], 20, 16, 120),
      ribMaterial,
    );
    rib.rotation.set(index * 0.38, index * 0.72, index * 0.24);
    scene.add(rib);
  }

  const oculusRing = new THREE.Mesh(
    new THREE.TorusGeometry(domeRadius * 0.2, 18, 16, 96),
    new THREE.MeshBasicMaterial({
      color: 0x6b9ed3,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  oculusRing.position.set(0, domeRadius * 0.82, 0);
  oculusRing.rotation.x = Math.PI * 0.5;
  scene.add(oculusRing);

  const INNER_STAR_COUNT = 1800;
  const innerStarPositions = new Float32Array(INNER_STAR_COUNT * 3);
  const innerStarColors = new Float32Array(INNER_STAR_COUNT * 3);
  const innerStarSizes = new Float32Array(INNER_STAR_COUNT);
  const innerStarPhases = new Float32Array(INNER_STAR_COUNT);
  for (let i = 0; i < INNER_STAR_COUNT; i += 1) {
    const key = `inner-star-${i}`;
    const theta = hash01(key, 'theta') * Math.PI * 2;
    const phi = Math.acos(hash01(key, 'phi') * 2 - 1);
    const radius = domeRadius * (0.72 + hash01(key, 'radius') * 0.22);
    innerStarPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    innerStarPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    innerStarPositions[i * 3 + 2] = radius * Math.cos(phi);
    const color = starPalette[Math.floor(hash01(key, 'palette') * starPalette.length) % starPalette.length]
      .clone()
      .multiplyScalar(0.36 + hash01(key, 'brightness') * 0.16);
    innerStarColors[i * 3] = color.r;
    innerStarColors[i * 3 + 1] = color.g;
    innerStarColors[i * 3 + 2] = color.b;
    innerStarSizes[i] = 1.1 + hash01(key, 'size') * 1.8;
    innerStarPhases[i] = hash01(key, 'phase') * Math.PI * 2;
  }

  const innerStarGeo = new THREE.BufferGeometry();
  innerStarGeo.setAttribute('position', new THREE.BufferAttribute(innerStarPositions, 3));
  innerStarGeo.setAttribute('color', new THREE.BufferAttribute(innerStarColors, 3));
  innerStarGeo.setAttribute('size', new THREE.BufferAttribute(innerStarSizes, 1));
  innerStarGeo.setAttribute('phase', new THREE.BufferAttribute(innerStarPhases, 1));

  const innerStarMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: `
      uniform float uTime;
      attribute float size;
      attribute float phase;
      attribute vec3 color;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float twinkle = 0.985 + 0.015 * sin(uTime * 0.06 + phase);
        vColor = color * twinkle;
        vAlpha = 0.1 + 0.06 * (0.5 + 0.5 * sin(uTime * 0.05 + phase * 0.8));
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(size * (0.92 + 0.08 * sin(uTime * 0.08 + phase)), 1.0, 3.2);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float core = 1.0 - smoothstep(0.0, 0.18, d);
        float halo = 1.0 - smoothstep(0.14, 0.5, d);
        gl_FragColor = vec4(vColor, clamp(core * 0.14 + halo * vAlpha, 0.0, 0.34));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  veilMaterials.push(innerStarMat);
  scene.add(new THREE.Points(innerStarGeo, innerStarMat));

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
    color: 0x3a5272,
    size: 1.8,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const dustMesh = new THREE.Points(dustGeo, dustMat);
  scene.add(dustMesh);

  // Store for animation
  dustMesh.userData.velocities = dustVelocities;
  dustMesh.userData.posAttr = dustPosAttr;
  starPoints.onBeforeRender = (_renderer, _scene, camera) => {
    syncSkybox(camera, starMat.uniforms.uTime.value);
  };

  return {
    dustMesh,
    starMat,
    update: syncSkybox,
  };
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

function setSelectionBackground(edgeHandle, nodeHandle) {
  for (let i = 0; i < edgeHandle.vertexCount; i++) {
    const hotness = edgeHandle.hotnessAttr?.array[i] ?? 0;
    const depth = edgeHandle.depthVarianceAttr?.array[i] ?? 0;
    setGlowColor(
      edgeHandle.colorAttr.array,
      i * 3,
      edgeHandle.defaultColors,
      0.62 + hotness * 0.07 + depth * 0.04,
      TRAVEL_EDGE_COLOR,
      0.008 + hotness * 0.02 + depth * 0.018,
      1.02,
    );
    edgeHandle.alphaAttr.array[i] = Math.min(
      0.6,
      edgeHandle.defaultAlphas[i] * (0.78 + hotness * 0.06) + depth * 0.025,
    );
  }

  for (let i = 0; i < nodeHandle.nodeCount; i++) {
    const hotness = nodeHandle.hotnessAttr?.array[i] ?? 0;
    const depth = nodeHandle.depthVarianceAttr?.array[i] ?? 0;
    setGlowColor(
      nodeHandle.colorAttr.array,
      i * 3,
      nodeHandle.defaultColors,
      0.78 + hotness * 0.06 + depth * 0.025,
      TRAVEL_EDGE_COLOR,
      0.006 + hotness * 0.016 + depth * 0.008,
      1.04,
    );
    nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i] * (0.96 + hotness * 0.025);
  }
}

// Highlight edges connected to a node - keep galaxy visible, brighten selection
export function highlightSelection(edgeHandle, nodeHandle, nodeId, tesseract) {
  const connectedEdges = edgeHandle.edgeIndex.get(nodeId);
  if (!connectedEdges) return;

  const neighbors = new Set(tesseract.adjacency.get(nodeId) || []);

  setSelectionBackground(edgeHandle, nodeHandle);

  // Selected edges stay in the idle family and simply tighten/brighten.
  for (const ei of connectedEdges) {
    const vi = ei * 2;
    const hotness = edgeHandle.hotnessAttr?.array[vi] ?? 0;
    edgeHandle.alphaAttr.array[vi] = Math.min(0.72, edgeHandle.defaultAlphas[vi] * 1.1 + 0.06 + hotness * 0.03);
    edgeHandle.alphaAttr.array[vi + 1] = Math.min(0.72, edgeHandle.defaultAlphas[vi + 1] * 1.1 + 0.06 + hotness * 0.03);
    for (let v = vi; v <= vi + 1; v++) {
      setGlowColor(
        edgeHandle.colorAttr.array,
        v * 3,
        edgeHandle.defaultColors,
        0.98 + hotness * 0.06,
        mixColors(TRAVEL_EDGE_COLOR, TRAVEL_EDGE_CORE, 0.14 + hotness * 0.12),
        0.03 + hotness * 0.03,
        1.04,
      );
    }
  }

  edgeHandle.alphaAttr.needsUpdate = true;
  edgeHandle.colorAttr.needsUpdate = true;

  // Selected and neighbor nodes keep their folder hue and gain a cooler edge rather than a white blowout.
  for (let i = 0; i < nodeHandle.nodeCount; i++) {
    const nid = nodeHandle.nodeIdByIndex.get(i);
    const hotness = nodeHandle.hotnessAttr?.array[i] ?? 0;
    if (nid === nodeId) {
      setGlowColor(
        nodeHandle.colorAttr.array,
        i * 3,
        nodeHandle.defaultColors,
        1.0 + hotness * 0.06,
        TRAVEL_EDGE_COLOR,
        0.04 + hotness * 0.03,
        1.04,
      );
      nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i] * (1.62 + hotness * 0.1);
    } else if (neighbors.has(nid)) {
      setGlowColor(
        nodeHandle.colorAttr.array,
        i * 3,
        nodeHandle.defaultColors,
        0.96 + hotness * 0.05,
        TRAVEL_EDGE_COLOR,
        0.02 + hotness * 0.02,
        1.03,
      );
      nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i] * (1.22 + hotness * 0.06);
    }
  }
  nodeHandle.colorAttr.needsUpdate = true;
  nodeHandle.sizeAttr.needsUpdate = true;
}

// Clear selection, restore defaults
export function clearSelection(edgeHandle, nodeHandle) {
  setSelectionBackground(edgeHandle, nodeHandle);
  edgeHandle.colorAttr.needsUpdate = true;
  edgeHandle.alphaAttr.needsUpdate = true;

  nodeHandle.sizeAttr.needsUpdate = true;
  nodeHandle.colorAttr.needsUpdate = true;
}

// Selection pulse: amplifies base colors, not flat override
export function updateSelectionPulse(elapsed, edgeHandle, nodeHandle, nodeId, tesseract) {
  if (!nodeId) return;
  const connectedEdges = edgeHandle.edgeIndex.get(nodeId);
  if (!connectedEdges) return;
  const neighbors = new Set(tesseract.adjacency.get(nodeId) || []);

  const pulseSpeed = 0.92;
  const cycle = elapsed * pulseSpeed;
  const primaryRise = Math.max(0, Math.sin(cycle));
  const rebound = Math.max(0, Math.sin(cycle - 0.54));
  const crest = Math.max(0, Math.sin(cycle - 0.12));
  const beat = clamp01(
    (Math.pow(primaryRise, 2.6) * 0.52) +
    (Math.pow(rebound, 1.55) * 0.48) +
    (crest * 0.2),
  );
  const afterglow = Math.pow(Math.max(0, Math.sin(cycle - 1.14)), 2.3) * 0.22;
  const laserPulse = clamp01(beat + afterglow);
  const brightness = 0.98 + 0.12 * laserPulse;
  const edgeAlpha = 0.48 + 0.08 * laserPulse;

  // The pulse is restrained so the whole field stays dimensional during focus and travel.
  for (const ei of connectedEdges) {
    const vi = ei * 2;
    const hotness = edgeHandle.hotnessAttr?.array[vi] ?? 0;
    edgeHandle.alphaAttr.array[vi] = Math.min(0.82, edgeAlpha + hotness * 0.04);
    edgeHandle.alphaAttr.array[vi + 1] = Math.min(0.82, edgeAlpha + hotness * 0.04);
    for (let v = vi; v <= vi + 1; v++) {
      setGlowColor(
        edgeHandle.colorAttr.array,
        v * 3,
        edgeHandle.defaultColors,
        brightness + hotness * 0.03,
        mixColors(TRAVEL_EDGE_COLOR, TRAVEL_EDGE_CORE, 0.22 + 0.28 * laserPulse),
        0.04 + 0.05 * laserPulse + hotness * 0.03,
        1.04,
      );
    }
  }
  edgeHandle.alphaAttr.needsUpdate = true;
  edgeHandle.colorAttr.needsUpdate = true;

  // Pulse nodes: amplify their own base color
  const nodeBright = 1.0 + 0.12 * laserPulse;
  for (let i = 0; i < nodeHandle.nodeCount; i++) {
    const nid = nodeHandle.nodeIdByIndex.get(i);
    const hotness = nodeHandle.hotnessAttr?.array[i] ?? 0;
    if (nid === nodeId) {
      nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i] * (1.62 + 0.14 * laserPulse + hotness * 0.06);
      setGlowColor(
        nodeHandle.colorAttr.array,
        i * 3,
        nodeHandle.defaultColors,
        nodeBright + hotness * 0.03,
        mixColors(TRAVEL_EDGE_COLOR, ARRIVAL_NODE_COLOR, 0.18 + 0.24 * laserPulse),
        0.04 + 0.05 * laserPulse + hotness * 0.02,
        1.04,
      );
    } else if (neighbors.has(nid)) {
      const phase = i * 0.3;
      const neighborPulse = clamp01(
        Math.pow(Math.max(0, Math.sin(elapsed * 0.78 - phase)), 3.1) +
        Math.pow(Math.max(0, Math.sin(elapsed * 0.78 - phase - 0.58)), 1.8) * 0.34,
      );
      nodeHandle.sizeAttr.array[i] = nodeHandle.defaultSizes[i] * (1.14 + 0.12 * neighborPulse + hotness * 0.04);
      setGlowColor(
        nodeHandle.colorAttr.array,
        i * 3,
        nodeHandle.defaultColors,
        0.96 + 0.08 * neighborPulse + hotness * 0.03,
        TRAVEL_EDGE_COLOR,
        0.02 + 0.04 * neighborPulse + hotness * 0.018,
        1.03,
      );
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
        setGlowColor(nodeHandle.colorAttr.array, i * 3, nodeHandle.defaultColors, 1.72, TRAVEL_EDGE_COLOR, 0.24, 1.18);
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

export function setTravelOverlay(edgeHandle, nodeHandle, overlay = {}, tesseract = null) {
  const edgeState = edgeHandle.travelState || createTravelState();
  const nodeState = nodeHandle.travelState || createTravelState();
  edgeHandle.travelState = edgeState;
  nodeHandle.travelState = nodeState;

  if (overlay.reset !== false) {
    edgeState.activeEdgeIndices.clear();
  }

  if (overlay.resetRecent === true) {
    edgeState.recentEdgeDecay.clear();
  }

  if (overlay.pathEdgeIndices) {
    edgeState.pathEdgeIndices = [...overlay.pathEdgeIndices].filter(Number.isInteger);
  } else if (overlay.pathNodeIds) {
    edgeState.pathEdgeIndices = resolvePathEdgeIndices(overlay.pathNodeIds, tesseract);
  }

  if (overlay.pushPreviousActiveToRecent) {
    for (const edgeIndex of edgeState.activeEdgeIndices) {
      edgeState.recentEdgeDecay.set(edgeIndex, overlay.recentStrength ?? edgeState.recentIntensity);
    }
  }

  if (overlay.activeEdgeIndex != null) {
    edgeState.activeEdgeIndices = new Set([overlay.activeEdgeIndex]);
  } else if (Array.isArray(overlay.activeEdgeIndices)) {
    edgeState.activeEdgeIndices = new Set(overlay.activeEdgeIndices.filter(Number.isInteger));
  }

  if (Object.prototype.hasOwnProperty.call(overlay, 'beamEdgeIndex')) {
    edgeState.beamEdgeIndex = Number.isInteger(overlay.beamEdgeIndex) ? overlay.beamEdgeIndex : null;
  }
  if (Object.prototype.hasOwnProperty.call(overlay, 'beamOriginNodeId')) {
    edgeState.beamOriginNodeId = overlay.beamOriginNodeId || null;
  }
  if (Object.prototype.hasOwnProperty.call(overlay, 'beamProgress')) {
    edgeState.beamProgress = clamp01(overlay.beamProgress || 0);
  }
  if (Object.prototype.hasOwnProperty.call(overlay, 'beamStrength')) {
    edgeState.beamStrength = clamp01(overlay.beamStrength || 0);
  }

  if (Array.isArray(overlay.recentEdgeIndices)) {
    edgeState.recentEdgeDecay.clear();
    for (const edgeIndex of overlay.recentEdgeIndices) {
      if (Number.isInteger(edgeIndex)) {
        edgeState.recentEdgeDecay.set(edgeIndex, overlay.recentStrength ?? edgeState.recentIntensity);
      }
    }
  }

  if (Array.isArray(overlay.addRecentEdgeIndices)) {
    for (const edgeIndex of overlay.addRecentEdgeIndices) {
      if (Number.isInteger(edgeIndex)) {
        edgeState.recentEdgeDecay.set(edgeIndex, overlay.recentStrength ?? edgeState.recentIntensity);
      }
    }
  }

  if (overlay.activeIntensity != null) {
    edgeState.activeIntensity = clamp01(overlay.activeIntensity);
  }
  if (overlay.recentIntensity != null) {
    edgeState.recentIntensity = clamp01(overlay.recentIntensity);
  }
  if (overlay.decayPerSecond != null) {
    edgeState.decayPerSecond = Math.max(0.05, overlay.decayPerSecond);
  }
  if (overlay.waveEdgeIndices) {
    edgeState.waveEdgeIndices = [...overlay.waveEdgeIndices].filter(Number.isInteger);
    edgeState.waveOriginNodeId = overlay.waveOriginNodeId || null;
    edgeState.waveDuration = Math.max(0.08, overlay.waveDuration ?? edgeState.waveDuration ?? 0.8);
    edgeState.waveStrength = clamp01(overlay.waveStrength ?? 1);
    edgeState.waveStartedAt = overlay.elapsed ?? edgeState.lastTickAt ?? 0;
  } else if (overlay.waveOriginNodeId === null) {
    edgeState.waveEdgeIndices = [];
    edgeState.waveOriginNodeId = null;
    edgeState.waveStartedAt = null;
    edgeState.waveStrength = 0;
  }

  if (overlay.arrivalNodeId !== undefined) {
    nodeState.arrivalNodeId = overlay.arrivalNodeId || null;
    nodeState.arrivalDuration = Math.max(0.1, overlay.arrivalDuration ?? nodeState.arrivalDuration ?? 1.8);
    nodeState.arrivalStrength = clamp01(overlay.arrivalStrength ?? 1);
    nodeState.arrivalStartedAt = overlay.arrivalNodeId ? (overlay.elapsed ?? edgeState.lastTickAt ?? 0) : null;
  }

  if (overlay.pathNodeIds || overlay.pathEdgeIndices) {
    nodeState.pathEdgeIndices = [...edgeState.pathEdgeIndices];
  }

  return {
    activeEdgeIndices: [...edgeState.activeEdgeIndices],
    recentEdgeIndices: [...edgeState.recentEdgeDecay.keys()],
    pathEdgeIndices: [...edgeState.pathEdgeIndices],
    arrivalNodeId: nodeState.arrivalNodeId,
  };
}

export function tickTravelOverlay(elapsed, edgeHandle, nodeHandle) {
  const edgeState = edgeHandle.travelState;
  const nodeState = nodeHandle.travelState;
  if (!edgeState || !nodeState) return;

  let delta = 0.016;
  if (typeof edgeState.lastTickAt === 'number') {
    delta = Math.max(0, elapsed - edgeState.lastTickAt);
  }
  edgeState.lastTickAt = elapsed;

  edgeHandle.travelAttr.array.fill(0);
  edgeHandle.waveProgressAttr.array.fill(0);
  edgeHandle.waveStrengthAttr.array.fill(0);
  for (const edgeIndex of edgeState.activeEdgeIndices) {
    setEdgeTravelIntensity(edgeHandle.travelAttr, edgeIndex, edgeState.activeIntensity);
  }

  for (const [edgeIndex, intensity] of edgeState.recentEdgeDecay.entries()) {
    const nextIntensity = intensity - delta * edgeState.decayPerSecond;
    if (nextIntensity <= 0.01) {
      edgeState.recentEdgeDecay.delete(edgeIndex);
      continue;
    }
    edgeState.recentEdgeDecay.set(edgeIndex, nextIntensity);
    setEdgeTravelIntensity(edgeHandle.travelAttr, edgeIndex, nextIntensity);
  }
  edgeHandle.travelAttr.needsUpdate = true;
  if (edgeState.beamEdgeIndex != null && edgeState.beamOriginNodeId && edgeState.beamStrength > 0.01) {
    const edge = edgeHandle.edgeData[edgeState.beamEdgeIndex];
    const vi = edgeState.beamEdgeIndex * 2;
    const startsAtSource = edge?.source === edgeState.beamOriginNodeId;
    const startsAtTarget = edge?.target === edgeState.beamOriginNodeId;
    edgeHandle.waveCoordAttr.array[vi] = startsAtTarget ? 1 : 0;
    edgeHandle.waveCoordAttr.array[vi + 1] = startsAtSource ? 1 : 0;
    edgeHandle.waveProgressAttr.array[vi] = clamp01(edgeState.beamProgress);
    edgeHandle.waveProgressAttr.array[vi + 1] = clamp01(edgeState.beamProgress);
    edgeHandle.waveStrengthAttr.array[vi] = clamp01(edgeState.beamStrength);
    edgeHandle.waveStrengthAttr.array[vi + 1] = clamp01(edgeState.beamStrength);
  }
  if (edgeState.waveEdgeIndices.length > 0 && edgeState.waveOriginNodeId) {
    const start = edgeState.waveStartedAt ?? elapsed;
    const progress = clamp01((elapsed - start) / Math.max(0.08, edgeState.waveDuration || 0.8));
    for (const edgeIndex of edgeState.waveEdgeIndices) {
      const edge = edgeHandle.edgeData[edgeIndex];
      const vi = edgeIndex * 2;
      const startsAtSource = edge?.source === edgeState.waveOriginNodeId;
      const startsAtTarget = edge?.target === edgeState.waveOriginNodeId;
      edgeHandle.waveCoordAttr.array[vi] = startsAtTarget ? 1 : 0;
      edgeHandle.waveCoordAttr.array[vi + 1] = startsAtSource ? 1 : 0;
      edgeHandle.waveProgressAttr.array[vi] = progress;
      edgeHandle.waveProgressAttr.array[vi + 1] = progress;
      edgeHandle.waveStrengthAttr.array[vi] = edgeState.waveStrength;
      edgeHandle.waveStrengthAttr.array[vi + 1] = edgeState.waveStrength;
    }
    if (progress >= 1) {
      edgeState.waveEdgeIndices = [];
      edgeState.waveOriginNodeId = null;
      edgeState.waveStartedAt = null;
      edgeState.waveStrength = 0;
    }
  }
  edgeHandle.waveProgressAttr.needsUpdate = true;
  edgeHandle.waveCoordAttr.needsUpdate = true;
  edgeHandle.waveStrengthAttr.needsUpdate = true;

  nodeHandle.arrivalAttr.array.fill(0);
  if (nodeState.arrivalNodeId) {
    const nodeIndex = nodeHandle.indexByNodeId.get(nodeState.arrivalNodeId);
    if (nodeIndex != null) {
      const start = nodeState.arrivalStartedAt ?? elapsed;
      const progress = clamp01((elapsed - start) / Math.max(0.1, nodeState.arrivalDuration || 1.8));
      const beat = Math.pow(Math.max(0, Math.sin(progress * Math.PI * 4.8)), 3.6);
      const pulse = clamp01(((0.26 + 0.52 * beat) + 0.18 * (1 - progress)) * (1 - progress));
      const intensity = clamp01((nodeState.arrivalStrength ?? 1) * pulse);
      nodeHandle.arrivalAttr.array[nodeIndex] = intensity;
      if (progress >= 1) {
        nodeState.arrivalNodeId = null;
        nodeState.arrivalStartedAt = null;
      }
    }
  }
  nodeHandle.arrivalAttr.needsUpdate = true;
}

export function clearTravelOverlay(edgeHandle, nodeHandle) {
  if (edgeHandle.travelState) {
    edgeHandle.travelState.activeEdgeIndices.clear();
    edgeHandle.travelState.recentEdgeDecay.clear();
    edgeHandle.travelState.beamEdgeIndex = null;
    edgeHandle.travelState.beamOriginNodeId = null;
    edgeHandle.travelState.beamProgress = 0;
    edgeHandle.travelState.beamStrength = 0;
    edgeHandle.travelState.pathEdgeIndices = [];
    edgeHandle.travelState.lastTickAt = null;
  }
  if (nodeHandle.travelState) {
    nodeHandle.travelState.arrivalNodeId = null;
    nodeHandle.travelState.arrivalStartedAt = null;
    nodeHandle.travelState.pathEdgeIndices = [];
  }
  zeroAttribute(edgeHandle.travelAttr);
  zeroAttribute(nodeHandle.arrivalAttr);
}
