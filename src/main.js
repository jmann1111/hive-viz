import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HiveGraph } from './core/graph.js';

// Folder color palette
const FOLDER_COLORS = {
  '10-Sessions':    0x3b82f6,
  '20-Architecture': 0x8b5cf6,
  '30-Projects':    0xf59e0b,
  '50-Playbooks':   0x14b8a6,
  '60-Knowledge':   0x22c55e,
  '70-Ops':         0xf43f5e,
  '01-Daily':       0x06b6d4,
  '00-Inbox':       0xe2e8f0,
  '40-Decisions':   0x8b5cf6,
  '80-Secure':      0xf43f5e,
  '39-Archive':     0x374151,
  '99-Templates':   0x374151,
};
const DEFAULT_COLOR = 0xe2e8f0;

function getFolderColor(folder) {
  if (folder.startsWith('60-Knowledge/raw-data')) return 0x374151;
  return FOLDER_COLORS[folder] || DEFAULT_COLOR;
}

// Hub nodes that get rendered larger
const HUB_NODES = new Set([
  'SOUL', 'psychological-profile', 'command-center',
  'walt-boot', 'vault-conventions', 'open-loops'
]);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.FogExp2(0x050510, 0.0008);

// Camera
const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.1, 5000
);
camera.position.set(150, 300, 600);
camera.lookAt(0, 0, 500);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 500);

// Load graph data and build visualization
async function init() {
  const res = await fetch('/graph.json');
  const data = await res.json();
  console.log(`Loaded: ${data.nodes.length} nodes, ${data.edges.length} edges`);

  const graph = new HiveGraph(data);
  graph.initSimulation();
  console.log('Force simulation settled');

  // === NODES (InstancedMesh) ===
  const baseGeo = new THREE.SphereGeometry(1, 12, 12);
  const baseMat = new THREE.MeshBasicMaterial();
  const instanceCount = graph.nodes.length;
  const mesh = new THREE.InstancedMesh(baseGeo, baseMat, instanceCount);
  const dummy = new THREE.Object3D();
  const colorAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(instanceCount * 3), 3
  );

  graph.nodes.forEach((node, i) => {
    const scale = HUB_NODES.has(node.id)
      ? 4 : Math.max(1, Math.log2(node.wordCount / 100 + 1));
    dummy.position.set(node.x, node.y, node.z);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const c = new THREE.Color(getFolderColor(node.folder));
    colorAttr.setXYZ(i, c.r, c.g, c.b);
  });

  mesh.geometry.setAttribute('color', colorAttr);
  mesh.material = new THREE.MeshBasicMaterial({ vertexColors: true });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  console.log(`Rendered ${instanceCount} nodes`);

  // === EDGES (LineSegments) ===
  const edgePositions = [];
  const edgeColors = [];
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

  for (const edge of graph.edges) {
    const src = typeof edge.source === 'object' ? edge.source : nodeMap.get(edge.source);
    const tgt = typeof edge.target === 'object' ? edge.target : nodeMap.get(edge.target);
    if (!src || !tgt) continue;

    edgePositions.push(src.x, src.y, src.z, tgt.x, tgt.y, tgt.z);

    const sc = new THREE.Color(getFolderColor(src.folder));
    const tc = new THREE.Color(getFolderColor(tgt.folder));
    edgeColors.push(sc.r, sc.g, sc.b, tc.r, tc.g, tc.b);
  }

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3));
  const edgeMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.15,
    depthWrite: false
  });
  const lines = new THREE.LineSegments(edgeGeo, edgeMat);
  scene.add(lines);
  console.log(`Rendered ${graph.edges.length} edges`);

  // === BLOOM POST-PROCESSING ===
  const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
  const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
  const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
  const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.8,   // strength
    0.4,   // radius
    0.85   // threshold
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // === AMBIENT PARTICLES ===
  const starCount = 2000;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount * 3; i++) {
    starPos[i] = (Math.random() - 0.5) * 2000;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    size: 0.5, color: 0x444466, transparent: true, opacity: 0.6
  });
  scene.add(new THREE.Points(starGeo, starMat));

  // === KEYBOARD SHORTCUTS ===
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      camera.position.set(150, 300, 600);
      controls.target.set(0, 0, 500);
    } else if (e.key === 't' || e.key === 'T') {
      camera.position.set(0, 800, 500);
      controls.target.set(0, 0, 500);
    } else if (e.key === 's' || e.key === 'S') {
      camera.position.set(600, 0, 500);
      controls.target.set(0, 0, 500);
    }
  });

  // === RESIZE ===
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // === ANIMATION LOOP ===
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    composer.render();
  }
  animate();
  console.log('Hive Viz Phase 1 MVP running.');
}

init().catch(e => console.error('Init failed:', e));
