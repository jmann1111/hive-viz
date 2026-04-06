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

  // Edge selection state: 0=normal, 1=connected to selected node
  const edgeSelectStates = new Float32Array(vertexCount);
  const edgeSelectAttr = new THREE.BufferAttribute(edgeSelectStates, 1);

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  const alphaAttr = new THREE.BufferAttribute(alphas, 1);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colorAttr);
  geometry.setAttribute('alpha', alphaAttr);
  geometry.setAttribute('edgeSelect', edgeSelectAttr);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uLightMode: { value: 0.0 },
      uLightSpeed: { value: 1.0 },
      uLightIntensity: { value: 1.0 },
    },
    vertexShader: `
      attribute float alpha;
      attribute vec3 color;
      attribute float edgeSelect;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vDist;
      varying float vSelected;
      varying vec3 vPos;
      void main() {
        vSelected = edgeSelect;
        vColor = color;
        vAlpha = alpha;
        vPos = position;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vDist = length(position) * 0.002;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uLightMode;
      uniform float uLightSpeed;
      uniform float uLightIntensity;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vDist;
      varying float vSelected;
      varying vec3 vPos;

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      void main() {
        float flow = sin(vDist * 8.0 - uTime * 1.5) * 0.5 + 0.5;
        float shimmer = 0.85 + 0.15 * flow;
        vec3 c = vColor;
        float a = vAlpha;
        if (vSelected > 0.5) {
          float wave = sin(uTime * 2.5);
          float bright = 1.5 + 0.5 * wave;
          c = min(vec3(1.0), vColor * bright + 0.15);
          a = 0.6 + 0.25 * wave;
        }

        // Edge lightshow - mirror the node lightshow on connections
        float mode = uLightMode;
        float spd = uLightSpeed;
        float inten = uLightIntensity;
        float t = uTime * spd;
        float dist = length(vPos);
        float normDist = dist / 400.0;

        if (mode > 0.5 && mode < 1.5) {
          float hue = fract(normDist * 0.5 - t * 0.3);
          c = mix(c, hsv2rgb(vec3(hue, 0.9, 1.0)), inten * 0.7);
          a = mix(a, 0.6, inten * 0.5);
        } else if (mode > 1.5 && mode < 2.5) {
          float breath = 0.5 + 0.5 * sin(t * 1.5);
          a *= (0.3 + breath * 0.7 * inten + (1.0 - inten));
        } else if (mode > 2.5 && mode < 3.5) {
          float ring = sin(normDist * 12.0 - t * 4.0);
          float pulse = smoothstep(0.0, 1.0, ring);
          c = mix(c * 0.3, c * 2.0, pulse * inten);
          a = mix(a * 0.3, a * 1.5, pulse * inten);
        } else if (mode > 3.5 && mode < 4.5) {
          float flicker = sin(vDist * 500.0 + t * 3.0) * sin(vDist * 1200.0 + t * 2.3);
          float bright = 0.4 + 0.6 * (0.5 + 0.5 * flicker);
          a *= mix(1.0, bright * 1.5, inten);
        } else if (mode > 5.5 && mode < 6.5) {
          float band = sin(vPos.x * 0.01 + t * 0.8) * cos(vPos.z * 0.01 + t * 0.5);
          float hue = fract(0.45 + band * 0.15 + vPos.y * 0.001);
          vec3 aurora = hsv2rgb(vec3(hue, 0.7, 0.9));
          c = mix(c, aurora, inten * 0.6);
          a = mix(a, 0.5, inten * 0.3);
        } else if (mode > 6.5 && mode < 7.5) {
          float col = floor(vPos.x * 0.05 + vPos.z * 0.05);
          float rain = fract(col * 0.37 - t * 0.35 + vPos.y * 0.003);
          float bright = smoothstep(0.0, 0.15, rain) * smoothstep(0.4, 0.15, rain);
          vec3 mGreen = mix(c, vec3(0.15, 0.8, 0.35), 0.5);
          c = mix(c * 0.4, mGreen * 1.3, bright * inten);
          a = mix(a * 0.4, 0.5, bright * inten);
        } else if (mode > 7.5 && mode < 8.5) {
          float beat = mod(t * 1.2, 2.0);
          float delay = normDist * 0.3;
          float dp1 = exp(-pow(beat - 0.3 - delay, 2.0) * 80.0);
          float dp2 = exp(-pow(beat - 0.55 - delay, 2.0) * 120.0);
          float dPulse = dp1 + dp2 * 0.7;
          c = mix(c * 0.3, vec3(1.0, 0.2, 0.3) * 1.5, dPulse * inten);
          a = mix(a * 0.2, 0.7, dPulse * inten);
        } else if (mode > 8.5 && mode < 9.5) {
          float wave1 = sin(vPos.x * 0.015 + t * 1.2) * cos(vPos.z * 0.012 + t * 0.8);
          float w = 0.5 + 0.5 * wave1;
          vec3 ocean = mix(vec3(0.0, 0.05, 0.2), vec3(0.1, 0.5, 0.9), w);
          c = mix(c, ocean, inten * 0.7);
          a = mix(a, 0.4, inten * 0.3);
        } else if (mode > 9.5 && mode < 10.5) {
          // Lightning: traveling bolts with branching
          float maxBolt = 0.0;
          for (int b = 0; b < 3; b++) {
            float bs = float(b) * 37.0;
            float bc = floor(t * 0.8 + bs);
            float ox = sin(bc * 91.3 + bs) * 300.0;
            float oy = 150.0 + cos(bc * 47.1 + bs) * 100.0;
            float oz = cos(bc * 73.7 + bs) * 300.0;
            float bp = fract(t * 0.8 + bs);
            float wy = oy - bp * 800.0;
            float cd = length(vPos.xz - vec2(ox, oz));
            float cf = exp(-cd * cd * 0.00008);
            float yd = vPos.y - wy;
            float wb = exp(-yd * yd * 0.0005) * step(0.0, yd + 80.0);
            float brSeed = sin(bc * 131.0 + bs) * 200.0;
            float brY = wy + brSeed * 0.3;
            float brD = length(vPos - vec3(ox + brSeed * 0.5, brY, oz + brSeed * 0.3));
            float brB = exp(-brD * brD * 0.00015);
            float bolt = max(wb * cf, brB * 0.6);
            float fd = 1.0 - bp * 0.7;
            maxBolt = max(maxBolt, bolt * fd);
          }
          c = mix(c, vec3(0.7, 0.8, 1.0) * 2.5, maxBolt * inten);
          a = mix(a, 0.9, maxBolt * inten);
        } else if (mode > 10.5 && mode < 11.5) {
          float blob = sin(vPos.x * 0.008 + t * 0.4) * sin(vPos.y * 0.008 + t * 0.3) * sin(vPos.z * 0.008 + t * 0.5);
          float heat = 0.5 + 0.5 * blob;
          vec3 lava = mix(vec3(0.6, 0.0, 0.0), vec3(1.0, 0.7, 0.0), heat);
          c = mix(c, lava, inten * heat * 0.7);
          a = mix(a, 0.5, inten * heat * 0.3);
        } else if (mode > 11.5 && mode < 12.5) {
          float sparkle = pow(0.5 + 0.5 * sin(vDist * 800.0 + t * 4.0), 8.0);
          vec3 ice = mix(vec3(0.4, 0.6, 0.9), vec3(0.9, 0.95, 1.0), sparkle);
          c = mix(c, ice, inten * 0.6);
          a = mix(a, 0.4, inten * 0.3);
        } else if (mode > 12.5 && mode < 13.5) {
          float wavefront = mod(t * 2.0, 3.0);
          float d2 = abs(normDist - wavefront * 0.5);
          float ring2 = exp(-d2 * d2 * 20.0);
          c = mix(c * 0.7, c * 2.0, ring2 * inten);
          a = mix(a * 0.5, 0.7, ring2 * inten);
        } else if (mode > 13.5 && mode < 14.5) {
          float flash2 = step(0.5, fract(t * 2.0));
          a *= mix(0.1, 1.0, flash2 * inten + (1.0 - inten));
        } else if (mode > 14.5 && mode < 15.5) {
          float angle = atan(vPos.z, vPos.x);
          float sweep = mod(t * 1.5, 6.28318);
          float diff = abs(mod(angle - sweep + 3.14159, 6.28318) - 3.14159);
          float tail = exp(-diff * 3.0);
          c = mix(c * 0.3, vec3(1.0, 0.95, 0.8) * 1.5, tail * inten);
          a = mix(a * 0.2, 0.6, tail * inten);
        } else if (mode > 15.5 && mode < 16.5) {
          float angle2 = atan(vPos.z, vPos.x);
          float hue2 = fract((angle2 + 3.14159) / 6.28318 + t * 0.2);
          c = mix(c, hsv2rgb(vec3(hue2, 0.8, 1.0)), inten * 0.6);
          a = mix(a, 0.5, inten * 0.3);
        }

        gl_FragColor = vec4(c * shimmer, a * shimmer);
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
    edgeSelectAttr,
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

  // selectState: 0=normal, 1=selected, 2=neighbor. Set once on click, pulse driven by uTime.
  const selectStates = new Float32Array(nodes.length);
  const selectAttr = new THREE.BufferAttribute(selectStates, 1);
  geometry.setAttribute('selectState', selectAttr);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: 1.0 },
      uTime: { value: 0.0 },
      uLightMode: { value: 0.0 },
      uLightSpeed: { value: 1.0 },
      uLightIntensity: { value: 1.0 },
    },
    vertexShader: `
      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uLightMode;
      uniform float uLightSpeed;
      uniform float uLightIntensity;
      attribute float size;
      attribute vec3 color;
      attribute float selectState;
      varying vec3 vColor;

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      void main() {
        vec3 c = color;
        float s = size;

        if (selectState > 0.5) {
          float wave = sin(uTime * 2.5);
          if (selectState > 1.5) {
            float phase = float(gl_VertexID) * 0.3;
            float nBright = 1.3 + 0.3 * sin(uTime * 2.0 + phase);
            c = min(vec3(1.0), c * nBright + 0.08);
            s *= 1.3 + 0.2 * sin(uTime * 2.0 + phase);
          } else {
            float bright = 1.6 + 0.6 * wave;
            c = min(vec3(1.0), c * bright + 0.25);
            s *= 2.0 + 0.5 * wave;
          }
        }

        // Lightshow modes (only when uLightMode > 0)
        float mode = uLightMode;
        float spd = uLightSpeed;
        float inten = uLightIntensity;
        float t = uTime * spd;
        float vid = float(gl_VertexID);
        vec3 pos = position;
        float dist = length(pos);
        float normDist = dist / 400.0;

        if (mode > 0.5 && mode < 1.5) {
          // 1: Spectrum Wave - rainbow wave radiating outward
          float hue = fract(normDist * 0.5 - t * 0.3);
          c = mix(c, hsv2rgb(vec3(hue, 0.9, 1.0)), inten);
        } else if (mode > 1.5 && mode < 2.5) {
          // 2: Breathe - all nodes pulse brightness together
          float breath = 0.5 + 0.5 * sin(t * 1.5);
          c = c * (0.3 + breath * 0.7 * inten + (1.0 - inten));
          s *= 0.8 + breath * 0.4;
        } else if (mode > 2.5 && mode < 3.5) {
          // 3: Ripple - concentric rings pulse outward from center
          float ring = sin(normDist * 12.0 - t * 4.0);
          float pulse = smoothstep(0.0, 1.0, ring);
          c = mix(c * 0.3, c * 2.0, pulse * inten);
          s *= 0.8 + pulse * 0.5;
        } else if (mode > 3.5 && mode < 4.5) {
          // 4: Starlight - random twinkle per node
          float flicker = sin(vid * 127.1 + t * 3.0) * sin(vid * 311.7 + t * 2.3);
          float bright = 0.4 + 0.6 * (0.5 + 0.5 * flicker);
          c = mix(c, c * bright * 2.0, inten);
          s *= 0.7 + bright * 0.6;
        } else if (mode > 5.5 && mode < 6.5) {
          // 6: Aurora - flowing vertical bands of green/teal/purple
          float band = sin(pos.x * 0.01 + t * 0.8) * cos(pos.z * 0.01 + t * 0.5);
          float hue = fract(0.45 + band * 0.15 + pos.y * 0.001);
          vec3 aurora = hsv2rgb(vec3(hue, 0.7, 0.9 + 0.1 * band));
          c = mix(c, aurora, inten * (0.5 + 0.5 * band));
        } else if (mode > 6.5 && mode < 7.5) {
          // 7: Matrix Rain - green cascade downward
          float col = floor(pos.x * 0.05 + pos.z * 0.05);
          float rain = fract(col * 0.37 - t * 0.35 + pos.y * 0.003);
          float bright = smoothstep(0.0, 0.15, rain) * smoothstep(0.4, 0.15, rain);
          vec3 mGreen = mix(c, vec3(0.15, 0.8, 0.35), 0.6);
          c = mix(c * 0.5, mGreen * 1.3, bright * inten);
          s *= 0.85 + bright * 0.3;
        } else if (mode > 7.5 && mode < 8.5) {
          // 8: Heartbeat - sharp double-pulse like a heartbeat monitor
          float beat = mod(t * 1.2, 2.0);
          float p1 = exp(-pow(beat - 0.3, 2.0) * 80.0);
          float p2 = exp(-pow(beat - 0.55, 2.0) * 120.0);
          float pulse = p1 + p2 * 0.7;
          float delay = normDist * 0.3;
          float dp1 = exp(-pow(beat - 0.3 - delay, 2.0) * 80.0);
          float dp2 = exp(-pow(beat - 0.55 - delay, 2.0) * 120.0);
          float dPulse = dp1 + dp2 * 0.7;
          c = mix(c * 0.3, vec3(1.0, 0.2, 0.3) * 1.8, dPulse * inten);
          s *= 0.7 + dPulse * 0.8;
        } else if (mode > 8.5 && mode < 9.5) {
          // 9: Ocean - deep blue waves
          float wave1 = sin(pos.x * 0.015 + t * 1.2) * cos(pos.z * 0.012 + t * 0.8);
          float wave2 = sin(pos.x * 0.008 - t * 0.6) * sin(pos.z * 0.01 + t * 1.0);
          float w = 0.5 + 0.5 * (wave1 + wave2 * 0.5);
          vec3 ocean = mix(vec3(0.0, 0.05, 0.2), vec3(0.1, 0.5, 0.9), w);
          c = mix(c, ocean, inten);
        } else if (mode > 9.5 && mode < 10.5) {
          // 10: Lightning - traveling bolts with branching
          float maxBolt = 0.0;
          for (int b = 0; b < 3; b++) {
            float bs = float(b) * 37.0;
            float bc = floor(t * 0.8 + bs);
            float ox = sin(bc * 91.3 + bs) * 300.0;
            float oy = 150.0 + cos(bc * 47.1 + bs) * 100.0;
            float oz = cos(bc * 73.7 + bs) * 300.0;
            float bp = fract(t * 0.8 + bs);
            float wy = oy - bp * 800.0;
            float cd = length(pos.xz - vec2(ox, oz));
            float cf = exp(-cd * cd * 0.00008);
            float yd = pos.y - wy;
            float wb = exp(-yd * yd * 0.0005) * step(0.0, yd + 80.0);
            float brSeed = sin(bc * 131.0 + bs) * 200.0;
            float brY = wy + brSeed * 0.3;
            float brD = length(pos - vec3(ox + brSeed * 0.5, brY, oz + brSeed * 0.3));
            float brB = exp(-brD * brD * 0.00015);
            float nd = length(pos - vec3(ox, wy, oz));
            float clB = exp(-nd * nd * 0.00005);
            float bolt = max(wb * cf, max(brB * 0.6, clB * 0.5));
            float fd = 1.0 - bp * 0.7;
            maxBolt = max(maxBolt, bolt * fd);
          }
          c = mix(c, vec3(0.7, 0.8, 1.0) * 2.5, maxBolt * inten);
          s *= 1.0 + maxBolt * 1.5;
        } else if (mode > 10.5 && mode < 11.5) {
          // 11: Lava - slow pulsing red/orange/yellow blobs
          float blob = sin(pos.x * 0.008 + t * 0.4) * sin(pos.y * 0.008 + t * 0.3) * sin(pos.z * 0.008 + t * 0.5);
          float heat = 0.5 + 0.5 * blob;
          vec3 lava = mix(vec3(0.6, 0.0, 0.0), vec3(1.0, 0.7, 0.0), heat);
          c = mix(c, lava, inten * heat);
        } else if (mode > 11.5 && mode < 12.5) {
          // 12: Frozen - icy blue sparkle
          float sparkle = pow(0.5 + 0.5 * sin(vid * 173.3 + t * 4.0), 8.0);
          vec3 ice = mix(vec3(0.4, 0.6, 0.9), vec3(0.9, 0.95, 1.0), sparkle);
          c = mix(c, ice, inten);
          s *= 0.8 + sparkle * 0.5;
        } else if (mode > 12.5 && mode < 13.5) {
          // 13: Reactive Pulse - nodes near origin pulse, ripple outward
          float wavefront = mod(t * 2.0, 3.0);
          float d = abs(normDist - wavefront * 0.5);
          float ring = exp(-d * d * 20.0);
          c = mix(c * 0.75, c * 2.0, ring * inten);
          s *= 0.85 + ring * 0.5;
        } else if (mode > 13.5 && mode < 14.5) {
          // 14: Strobe - sharp on/off flash
          float flash = step(0.5, fract(t * 2.0));
          c = mix(c * 0.1, c * 1.8, flash * inten + (1.0 - inten));
        } else if (mode > 14.5 && mode < 15.5) {
          // 15: Comet - bright point sweeps around the shape
          float angle = atan(pos.z, pos.x);
          float sweep = mod(t * 1.5, 6.28318);
          float diff = abs(mod(angle - sweep + 3.14159, 6.28318) - 3.14159);
          float tail = exp(-diff * 3.0);
          c = mix(c * 0.3, vec3(1.0, 0.95, 0.8) * 2.0, tail * inten);
          s *= 0.6 + tail * 1.0;
        } else if (mode > 15.5 && mode < 16.5) {
          // 16: Galaxy Spin - color rotates around center
          float angle = atan(pos.z, pos.x);
          float hue = fract((angle + 3.14159) / 6.28318 + t * 0.2);
          c = mix(c, hsv2rgb(vec3(hue, 0.8, 1.0)), inten * 0.8);
        }

        vColor = c;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = s * (300.0 / -mvPosition.z) * uPixelRatio;
        gl_PointSize = clamp(gl_PointSize, 1.0 * uPixelRatio, 18.0 * uPixelRatio);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        // Bright core, tight falloff - christmas light look
        float core = exp(-d * d * 28.0);
        float glow = exp(-d * d * 8.0) * 0.3;
        float a = core + glow;
        gl_FragColor = vec4(vColor * (1.0 + core * 0.5), a);
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
    selectAttr,
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
    uniforms: { uTime: { value: 0.0 }, uPixelRatio: { value: 1.0 } },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
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
        gl_PointSize = size * (200.0 / -mvPos.z) * uPixelRatio;
        gl_PointSize = clamp(gl_PointSize, 0.5 * uPixelRatio, 4.0 * uPixelRatio);
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

  // === Dust Particles (GPU-driven vortex, zero CPU per frame) ===
  const DUST_COUNT = 1500;
  const dustPositions = new Float32Array(DUST_COUNT * 3);
  const dustSeeds = new Float32Array(DUST_COUNT); // per-particle random seed

  for (let i = 0; i < DUST_COUNT; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 10000;
    dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 10000;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 10000;
    dustSeeds[i] = Math.random() * 100.0;
  }

  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  dustGeo.setAttribute('seed', new THREE.BufferAttribute(dustSeeds, 1));

  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: `
      uniform float uTime;
      attribute float seed;
      varying float vAlpha;
      void main() {
        // Vortex drift in the shader - no CPU needed
        float t = uTime * 0.3;
        vec3 p = position;
        p.x += sin(position.z * 0.0008 + t + seed) * uTime * 0.04;
        p.y += sin(position.x * 0.0006 + position.z * 0.0004 + t * 0.7 + seed) * uTime * 0.02;
        p.z += cos(position.x * 0.0008 + t + seed) * uTime * 0.04;
        // Wrap: use mod to keep in bounds (GPU-side)
        p = mod(p + 5000.0, 10000.0) - 5000.0;
        vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 2.0 * (300.0 / -mvPos.z);
        gl_PointSize = clamp(gl_PointSize, 0.5, 3.0);
        vAlpha = 0.15 + 0.05 * sin(t * 2.0 + seed);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float a = 1.0 - smoothstep(0.0, 0.5, d);
        gl_FragColor = vec4(0.2, 0.27, 0.4, a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const dustMesh = new THREE.Points(dustGeo, dustMat);
  scene.add(dustMesh);

  return { dustMesh, dustMat, starMat };
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

// Highlight selection: set selectState attributes once (GPU does the pulse)
export function highlightSelection(edgeHandle, nodeHandle, nodeId, tesseract) {
  const connectedEdges = edgeHandle.edgeIndex.get(nodeId);
  if (!connectedEdges) return;
  const neighbors = new Set(tesseract.adjacency.get(nodeId) || []);

  // Dim unselected edges, mark connected ones
  for (let i = 0; i < edgeHandle.vertexCount; i++) {
    edgeHandle.colorAttr.array[i * 3] = edgeHandle.defaultColors[i * 3] * 0.7;
    edgeHandle.colorAttr.array[i * 3 + 1] = edgeHandle.defaultColors[i * 3 + 1] * 0.7;
    edgeHandle.colorAttr.array[i * 3 + 2] = edgeHandle.defaultColors[i * 3 + 2] * 0.7;
    edgeHandle.alphaAttr.array[i] = edgeHandle.defaultAlphas[i] * 0.7;
    edgeHandle.edgeSelectAttr.array[i] = 0.0;
  }

  for (const ei of connectedEdges) {
    const vi = ei * 2;
    // Restore default colors for connected edges (shader will pulse them)
    for (let v = vi; v <= vi + 1; v++) {
      edgeHandle.colorAttr.array[v * 3] = Math.min(1, edgeHandle.defaultColors[v * 3] * 1.8 + 0.2);
      edgeHandle.colorAttr.array[v * 3 + 1] = Math.min(1, edgeHandle.defaultColors[v * 3 + 1] * 1.8 + 0.2);
      edgeHandle.colorAttr.array[v * 3 + 2] = Math.min(1, edgeHandle.defaultColors[v * 3 + 2] * 1.8 + 0.2);
      edgeHandle.edgeSelectAttr.array[v] = 1.0;
    }
    edgeHandle.alphaAttr.array[vi] = 0.85;
    edgeHandle.alphaAttr.array[vi + 1] = 0.85;
  }

  edgeHandle.colorAttr.needsUpdate = true;
  edgeHandle.alphaAttr.needsUpdate = true;
  edgeHandle.edgeSelectAttr.needsUpdate = true;

  // Set node select states (0=normal, 1=selected, 2=neighbor)
  for (let i = 0; i < nodeHandle.nodeCount; i++) {
    const nid = nodeHandle.nodeIdByIndex.get(i);
    if (nid === nodeId) {
      nodeHandle.selectAttr.array[i] = 1.0;
    } else if (neighbors.has(nid)) {
      nodeHandle.selectAttr.array[i] = 2.0;
    } else {
      nodeHandle.selectAttr.array[i] = 0.0;
    }
  }
  nodeHandle.selectAttr.needsUpdate = true;
}

// Clear selection
export function clearSelection(edgeHandle, nodeHandle) {
  edgeHandle.colorAttr.array.set(edgeHandle.defaultColors);
  edgeHandle.alphaAttr.array.set(edgeHandle.defaultAlphas);
  edgeHandle.edgeSelectAttr.array.fill(0);
  edgeHandle.colorAttr.needsUpdate = true;
  edgeHandle.alphaAttr.needsUpdate = true;
  edgeHandle.edgeSelectAttr.needsUpdate = true;

  nodeHandle.selectAttr.array.fill(0);
  nodeHandle.selectAttr.needsUpdate = true;
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
