import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HiveGraph } from './core/graph.js';
import { createBioMaterial, createWireMaterial, updateShaderTime } from './rendering/shaders.js';

// === SACRED GEOMETRY CONFIG ===
const FOLDER_THEME = {
  '10-Sessions':     { core: '#1a6bff', shell: '#0a2a66', geo: 'icosahedron' },
  '20-Architecture': { core: '#9b4dff', shell: '#3a1866', geo: 'octahedron' },
  '30-Projects':     { core: '#ffaa00', shell: '#664400', geo: 'tetrahedron' },
  '50-Playbooks':    { core: '#00e6b0', shell: '#004d3a', geo: 'box' },
  '60-Knowledge':    { core: '#00ff66', shell: '#003d1a', geo: 'dodecahedron' },
  '70-Ops':          { core: '#ff3366', shell: '#661428', geo: 'box' },
  '01-Daily':        { core: '#00ccff', shell: '#003344', geo: 'icosahedron' },
  '40-Decisions':    { core: '#9b4dff', shell: '#3a1866', geo: 'octahedron' },
  '80-Secure':       { core: '#ff3366', shell: '#661428', geo: 'box' },
};
const DEFAULT_THEME = { core: '#e2e8f0', shell: '#334155', geo: 'icosahedron' };

const HUB_NODES = new Set([
  'SOUL', 'psychological-profile', 'command-center',
  'walt-boot', 'vault-conventions', 'open-loops'
]);

function getTheme(folder) {
  if (folder.startsWith('60-Knowledge/raw-data')) return { ...DEFAULT_THEME, core: '#374151', shell: '#1a1a2e' };
  return FOLDER_THEME[folder] || DEFAULT_THEME;
}

const GEOMETRIES = {
  icosahedron: new THREE.IcosahedronGeometry(1, 0),
  octahedron:  new THREE.OctahedronGeometry(1, 0),
  dodecahedron: new THREE.DodecahedronGeometry(1, 0),
  tetrahedron: new THREE.TetrahedronGeometry(1, 0),
  box:         new THREE.BoxGeometry(1.4, 1.4, 1.4),
};

// === RENDERER + SCENE ===
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.FogExp2(0x050510, 0.0006);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(150, 300, 600);
camera.lookAt(0, 0, 500);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 500);

// Track all materials for time updates
const allMaterials = [];
const dummy = new THREE.Object3D();

// Store node-to-instance mapping for updates
let graph = null;
let nodeMeshes = [];     // { mesh, wireMesh, indices: Map<nodeId, instanceIdx> }
let edgeLineSegments = null;
let triangleMesh = null;

async function init() {
  const res = await fetch('/graph.json');
  const data = await res.json();
  console.log(`Loaded: ${data.nodes.length} nodes, ${data.edges.length} edges`);

  graph = new HiveGraph(data);
  graph.initSimulation();
  graph.findTriangles();
  const hubs = graph.getHubs(5);
  console.log(`Simulation settled. ${graph.triangles.length} triangles, ${hubs.length} hubs`);

  // === GROUP NODES BY GEOMETRY TYPE ===
  const groups = {};  // geoType -> { theme, nodeIndices[] }
  graph.nodes.forEach((node, i) => {
    const theme = getTheme(node.folder);
    const key = `${theme.geo}__${theme.core}`;
    if (!groups[key]) groups[key] = { theme, geo: theme.geo, nodes: [] };
    groups[key].nodes.push({ node, graphIdx: i });
  });

  // === CREATE INSTANCED MESHES PER GROUP ===
  nodeMeshes = [];
  for (const [key, group] of Object.entries(groups)) {
    const geo = GEOMETRIES[group.geo];
    const count = group.nodes.length;
    const { core, shell } = group.theme;

    // Core glow mesh
    const bioMat = createBioMaterial(core, shell);
    const mesh = new THREE.InstancedMesh(geo, bioMat, count);
    mesh.frustumCulled = false;
    allMaterials.push(bioMat);

    // Wireframe overlay
    const wireMat = createWireMaterial(core);
    const wireMesh = new THREE.InstancedMesh(geo, wireMat, count);
    wireMesh.frustumCulled = false;
    allMaterials.push(wireMat);

    // Map node IDs to instance indices
    const indices = new Map();
    group.nodes.forEach(({ node, graphIdx }, instanceIdx) => {
      indices.set(node.id, { instanceIdx, graphIdx });
      const isHub = HUB_NODES.has(node.id);
      const scale = isHub ? 5 : Math.max(1.2, Math.log2(node.wordCount / 100 + 1) * 0.8);
      dummy.position.set(node.x, node.y, node.z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(instanceIdx, dummy.matrix);
      wireMesh.setMatrixAt(instanceIdx, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    wireMesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    scene.add(wireMesh);
    nodeMeshes.push({ mesh, wireMesh, indices, nodes: group.nodes });
  }
  console.log(`Created ${nodeMeshes.length} geometry groups`);

  // === EDGES (curved bezier tendrils) ===
  buildEdges();

  // === TRIANGLE MESH (emergent sacred geometry) ===
  buildTriangleMesh();

  // === ENVIRONMENT ===
  buildEnvironment();

  // === BLOOM POST-PROCESSING ===
  const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
  const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
  const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
  const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.2, 0.4, 0.7
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // === KEYBOARD ===
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') { camera.position.set(150, 300, 600); controls.target.set(0, 0, 500); }
    else if (e.key === 't' || e.key === 'T') { camera.position.set(0, 800, 500); controls.target.set(0, 0, 500); }
    else if (e.key === 's' || e.key === 'S') { camera.position.set(600, 0, 500); controls.target.set(0, 0, 500); }
  });

  // === RESIZE ===
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // === RENDER LOOP (live simulation) ===
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();

    // Tick the live simulation
    graph.tick();

    // Update all instance matrices from simulation positions
    for (const group of nodeMeshes) {
      let changed = false;
      for (const [nodeId, { instanceIdx, graphIdx }] of group.indices) {
        const node = graph.nodes[graphIdx];
        const isHub = HUB_NODES.has(node.id);
        const scale = isHub ? 5 : Math.max(1.2, Math.log2(node.wordCount / 100 + 1) * 0.8);
        dummy.position.set(node.x, node.y, node.z);
        dummy.scale.setScalar(scale);
        if (isHub) dummy.rotation.y = elapsed * 0.15;
        else dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        group.mesh.setMatrixAt(instanceIdx, dummy.matrix);
        group.wireMesh.setMatrixAt(instanceIdx, dummy.matrix);
        changed = true;
      }
      if (changed) {
        group.mesh.instanceMatrix.needsUpdate = true;
        group.wireMesh.instanceMatrix.needsUpdate = true;
      }
    }

    // Update edge positions from simulation
    if (edgeLineSegments) {
      const pos = edgeLineSegments.geometry.attributes.position.array;
      let idx = 0;
      for (const edge of graph.edges) {
        const src = typeof edge.source === 'object' ? edge.source : graph.nodeMap.get(edge.source);
        const tgt = typeof edge.target === 'object' ? edge.target : graph.nodeMap.get(edge.target);
        if (!src || !tgt) { idx += 6; continue; }
        pos[idx++] = src.x; pos[idx++] = src.y; pos[idx++] = src.z;
        pos[idx++] = tgt.x; pos[idx++] = tgt.y; pos[idx++] = tgt.z;
      }
      edgeLineSegments.geometry.attributes.position.needsUpdate = true;
    }

    // Update triangle mesh positions
    if (triangleMesh) {
      const tPos = triangleMesh.geometry.attributes.position.array;
      let ti = 0;
      for (const [a, b, c] of graph.triangles) {
        const na = graph.nodeMap.get(a), nb = graph.nodeMap.get(b), nc = graph.nodeMap.get(c);
        if (!na || !nb || !nc) { ti += 9; continue; }
        tPos[ti++]=na.x; tPos[ti++]=na.y; tPos[ti++]=na.z;
        tPos[ti++]=nb.x; tPos[ti++]=nb.y; tPos[ti++]=nb.z;
        tPos[ti++]=nc.x; tPos[ti++]=nc.y; tPos[ti++]=nc.z;
      }
      triangleMesh.geometry.attributes.position.needsUpdate = true;
    }

    // Update shader uniforms (breathing)
    for (const mat of allMaterials) {
      updateShaderTime(mat, elapsed);
    }

    controls.update();
    composer.render();
  }
  animate();
  console.log('Hive Viz Phase 2: Sacred Bioluminescence running.');
}

// === HELPER: Build edges as curved tendrils ===
function buildEdges() {
  const positions = [];
  const colors = [];

  for (const edge of graph.edges) {
    const src = typeof edge.source === 'object' ? edge.source : graph.nodeMap.get(edge.source);
    const tgt = typeof edge.target === 'object' ? edge.target : graph.nodeMap.get(edge.target);
    if (!src || !tgt) continue;
    positions.push(src.x, src.y, src.z, tgt.x, tgt.y, tgt.z);

    const sTheme = getTheme(src.folder);
    const tTheme = getTheme(tgt.folder);
    const sc = new THREE.Color(sTheme.core);
    const tc = new THREE.Color(tTheme.core);
    colors.push(sc.r, sc.g, sc.b, tc.r, tc.g, tc.b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true,
    opacity: 0.12, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  edgeLineSegments = new THREE.LineSegments(geo, mat);
  scene.add(edgeLineSegments);
  console.log(`Rendered ${graph.edges.length} sacred tendrils`);
}

// === HELPER: Build emergent sacred geometry triangles ===
function buildTriangleMesh() {
  if (graph.triangles.length === 0) return;

  const positions = new Float32Array(graph.triangles.length * 9);
  const colors = new Float32Array(graph.triangles.length * 9);
  let idx = 0, cidx = 0;

  for (const [a, b, c] of graph.triangles) {
    const na = graph.nodeMap.get(a), nb = graph.nodeMap.get(b), nc = graph.nodeMap.get(c);
    if (!na || !nb || !nc) { idx += 9; cidx += 9; continue; }
    positions[idx++]=na.x; positions[idx++]=na.y; positions[idx++]=na.z;
    positions[idx++]=nb.x; positions[idx++]=nb.y; positions[idx++]=nb.z;
    positions[idx++]=nc.x; positions[idx++]=nc.y; positions[idx++]=nc.z;

    // Average color from three nodes' folder themes
    const ca = new THREE.Color(getTheme(na.folder).core);
    const cb = new THREE.Color(getTheme(nb.folder).core);
    const cc = new THREE.Color(getTheme(nc.folder).core);
    const avg = new THREE.Color().addColors(ca, cb).add(cc).multiplyScalar(1/3);
    for (let v = 0; v < 3; v++) {
      colors[cidx++] = avg.r; colors[cidx++] = avg.g; colors[cidx++] = avg.b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true,
    opacity: 0.06, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  triangleMesh = new THREE.Mesh(geo, mat);
  scene.add(triangleMesh);
  console.log(`Rendered ${graph.triangles.length} sacred geometry triangles`);
}

// === HELPER: Sacred environment (hex particles + Flower of Life grid) ===
function buildEnvironment() {
  // Hexagonal pollen particles
  const particleCount = 3000;
  const pPos = new Float32Array(particleCount * 3);
  const pColors = new Float32Array(particleCount * 3);
  const biolumHues = [
    new THREE.Color('#1a6bff'), new THREE.Color('#9b4dff'),
    new THREE.Color('#00e6b0'), new THREE.Color('#00ff66'),
    new THREE.Color('#00ccff'), new THREE.Color('#ffaa00'),
  ];

  for (let i = 0; i < particleCount; i++) {
    pPos[i*3]   = (Math.random() - 0.5) * 2500;
    pPos[i*3+1] = (Math.random() - 0.5) * 2500;
    pPos[i*3+2] = Math.random() * 1200 - 100;
    const c = biolumHues[Math.floor(Math.random() * biolumHues.length)];
    pColors[i*3] = c.r * 0.3;
    pColors[i*3+1] = c.g * 0.3;
    pColors[i*3+2] = c.b * 0.3;
  }

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3));
  const pMat = new THREE.PointsMaterial({
    size: 0.8, vertexColors: true, transparent: true,
    opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  scene.add(new THREE.Points(pGeo, pMat));

  // Flower of Life background grid (subtle, vast, slowly rotating)
  const flowerGroup = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(48, 50, 6); // hexagonal ring
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x9b4dff, transparent: true, opacity: 0.025,
    side: THREE.DoubleSide, depthWrite: false,
  });

  // Create a grid of hexagonal rings
  const gridSize = 6;
  const spacing = 90;
  for (let gx = -gridSize; gx <= gridSize; gx++) {
    for (let gy = -gridSize; gy <= gridSize; gy++) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(
        gx * spacing + (gy % 2 ? spacing / 2 : 0),
        gy * spacing * 0.866,
        500 // center of the Z-time axis
      );
      ring.rotation.z = Math.PI / 6;
      flowerGroup.add(ring);
    }
  }

  flowerGroup.position.z = -200;
  flowerGroup.scale.setScalar(3);
  scene.add(flowerGroup);
  console.log('Sacred environment loaded');
}

init().catch(e => console.error('Init failed:', e));
