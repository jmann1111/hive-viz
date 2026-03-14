import * as THREE from 'three';
import { Tesseract } from './core/tesseract.js';

const BG = 0xf0f0f0;
const LINE_DARK = 0x111111;
const LINE_MED = 0x555555;
const LINE_LIGHT = 0xbbbbbb;
const LINE_GRID = 0xdddddd;
// Accent colors (Squidward dimension palette)
const ACCENTS = [0x6644aa, 0x4477cc, 0xcc8833, 0x44aa88, 0xcc4466, 0x88bbdd];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 4, 0);
camera.lookAt(0, 4, 20);

let tesseract = null;
let currentPanel = null;
let flightState = null;
let lastNavTimestamp = 0;
const clock = new THREE.Clock();
let accentPanels = [];

// === INFINITE GRID (fills all white space) ===
function buildInfiniteGrid() {
  const pos = [], col = [];
  const g = new THREE.Color(LINE_GRID);
  const d = new THREE.Color(0xcccccc);
  const range = 600;
  const step = 4;
  // Floor grid
  for (let x = -range; x <= range; x += step) {
    addLine(pos,col, x,0,-range, x,0,range, g);
    addLine(pos,col, -range,0,x, range,0,x, g);
  }
  // Ceiling grid (high up, creates the enclosed feeling)
  for (let x = -range; x <= range; x += step * 3) {
    addLine(pos,col, x,20,-range, x,20,range, d);
    addLine(pos,col, -range,20,x, range,20,x, d);
  }
  // Vertical pillars at intersections (every 24 units)
  for (let x = -range; x <= range; x += 24) {
    for (let z = -range; z <= range; z += 24) {
      addLine(pos,col, x,0,z, x,20,z, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })));
}

// === CORRIDORS (dense cross-sections) ===
function buildCorridors(t) {
  const pos = [], col = [];
  const dk = new THREE.Color(LINE_DARK);
  const md = new THREE.Color(LINE_MED);
  for (const [folder, c] of t.corridors) {
    const { dir, yOffset, length } = c;
    const w = c.width / 2, h = c.height;
    const y0 = yOffset, y1 = yOffset + h;
    const L = length * dir.sign;
    const steps = Math.ceil(length / 2); // Dense: every 2 units
    for (let i = 0; i <= steps; i++) {
      const d = (i / steps) * L;
      if (dir.axis === 'x') {
        addLine(pos,col, d,y0,-w, d,y1,-w, md);
        addLine(pos,col, d,y0,w, d,y1,w, md);
        addLine(pos,col, d,y0,-w, d,y0,w, md);
        addLine(pos,col, d,y1,-w, d,y1,w, md);
      } else {
        addLine(pos,col, -w,y0,d, -w,y1,d, md);
        addLine(pos,col, w,y0,d, w,y1,d, md);
        addLine(pos,col, -w,y0,d, w,y0,d, md);
        addLine(pos,col, -w,y1,d, w,y1,d, md);
      }
    }

    // Rail lines
    if (dir.axis === 'x') {
      addLine(pos,col, 0,y0,-w, L,y0,-w, dk);
      addLine(pos,col, 0,y0,w, L,y0,w, dk);
      addLine(pos,col, 0,y1,-w, L,y1,-w, dk);
      addLine(pos,col, 0,y1,w, L,y1,w, dk);
    } else {
      addLine(pos,col, -w,y0,0, -w,y0,L, dk);
      addLine(pos,col, w,y0,0, w,y0,L, dk);
      addLine(pos,col, -w,y1,0, -w,y1,L, dk);
      addLine(pos,col, w,y1,0, w,y1,L, dk);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })));
}

// === FILE PANELS on walls ===
function buildPanels(t) {
  const pos = [], col = [];
  const dk = new THREE.Color(LINE_DARK);
  const lt = new THREE.Color(LINE_LIGHT);
  const PW = 1, PH = 1.5;
  for (const [id, p] of t.panels) {
    const c = p.linkCount > 5 ? dk : lt;
    if (p.normal.z !== 0) {
      addLine(pos,col, p.pos.x-PW,p.pos.y-PH,p.pos.z, p.pos.x+PW,p.pos.y-PH,p.pos.z, c);
      addLine(pos,col, p.pos.x+PW,p.pos.y-PH,p.pos.z, p.pos.x+PW,p.pos.y+PH,p.pos.z, c);
      addLine(pos,col, p.pos.x+PW,p.pos.y+PH,p.pos.z, p.pos.x-PW,p.pos.y+PH,p.pos.z, c);
      addLine(pos,col, p.pos.x-PW,p.pos.y+PH,p.pos.z, p.pos.x-PW,p.pos.y-PH,p.pos.z, c);
    } else {
      addLine(pos,col, p.pos.x,p.pos.y-PH,p.pos.z-PW, p.pos.x,p.pos.y-PH,p.pos.z+PW, c);
      addLine(pos,col, p.pos.x,p.pos.y-PH,p.pos.z+PW, p.pos.x,p.pos.y+PH,p.pos.z+PW, c);
      addLine(pos,col, p.pos.x,p.pos.y+PH,p.pos.z+PW, p.pos.x,p.pos.y+PH,p.pos.z-PW, c);
      addLine(pos,col, p.pos.x,p.pos.y+PH,p.pos.z-PW, p.pos.x,p.pos.y-PH,p.pos.z-PW, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })));
}

// === ACCENT PANELS (colored, dissolving, alive) ===
function buildAccentPanels() {
  const count = 60;
  for (let i = 0; i < count; i++) {
    const color = ACCENTS[Math.floor(Math.random() * ACCENTS.length)];
    const geo = new THREE.PlaneGeometry(
      2 + Math.random() * 6,
      2 + Math.random() * 6
    );
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      (Math.random()-0.5) * 300,
      Math.random() * 18 + 1,
      (Math.random()-0.5) * 300
    );
    // Random rotation (axis-aligned for clean look)
    const axis = Math.floor(Math.random() * 3);
    if (axis === 0) mesh.rotation.y = Math.PI / 2;
    else if (axis === 1) mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    accentPanels.push({
      mesh, mat,
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.7,
      maxOpacity: 0.08 + Math.random() * 0.15
    });
  }
}

function addLine(pos,col, x1,y1,z1, x2,y2,z2, c) {
  pos.push(x1,y1,z1, x2,y2,z2);
  col.push(c.r,c.g,c.b, c.r,c.g,c.b);
}

// === LANDING TERMINAL (search UI) ===
function buildTerminal() {
  const terminal = document.createElement('div');
  terminal.id = 'terminal';
  terminal.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    z-index:200;font-family:'Courier New',monospace;pointer-events:auto;`;
  terminal.innerHTML = `
    <div style="text-align:center;margin-bottom:40px">
      <div style="font-size:11px;letter-spacing:8px;color:#888;margin-bottom:8px">THE</div>
      <div style="font-size:36px;letter-spacing:12px;color:#111;font-weight:300">TESSERACT</div>
      <div style="font-size:10px;letter-spacing:4px;color:#aaa;margin-top:8px">1,424 FILES / 2,507 CONNECTIONS</div>
    </div>
    <div style="position:relative;width:400px">
      <input id="search-input" type="text" placeholder="where do you want to go?"
        style="width:100%;padding:14px 20px;background:transparent;border:1px solid #ccc;
        color:#111;font-family:inherit;font-size:14px;letter-spacing:2px;outline:none;
        text-align:center;" autocomplete="off" />
      <div id="search-results" style="position:absolute;top:100%;left:0;right:0;
        max-height:300px;overflow-y:auto;border:1px solid #ddd;border-top:none;
        display:none;background:#f5f5f5;"></div>
    </div>
    <div style="font-size:10px;color:#ccc;margin-top:24px;letter-spacing:2px">
      TYPE A KEYWORD. CLICK TO TRAVEL.
    </div>
  `;
  document.body.appendChild(terminal);

  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 2) { results.style.display = 'none'; return; }
    const hits = tesseract.search(q).slice(0, 8);
    if (hits.length === 0) { results.style.display = 'none'; return; }
    results.style.display = 'block';
    results.innerHTML = hits.map(h => `
      <div onclick="window._launchTo('${h.id}')" style="padding:10px 16px;cursor:pointer;
        border-bottom:1px solid #eee;font-size:12px;letter-spacing:1px;color:#333;
        transition:background 0.15s"
        onmouseover="this.style.background='#eaeaea'"
        onmouseout="this.style.background='transparent'">
        <div style="font-weight:bold">${h.title}</div>
        <div style="font-size:10px;color:#999;margin-top:2px">${h.folder} / ${h.type}</div>
      </div>
    `).join('');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      const hits = tesseract.search(q);
      if (hits.length > 0) window._launchTo(hits[0].id);
    }
  });

  setTimeout(() => input.focus(), 100);
}

// === LAUNCH (dismiss terminal, start flight) ===
window._launchTo = function(targetId) {
  const terminal = document.getElementById('terminal');
  if (terminal) {
    terminal.style.transition = 'opacity 0.6s';
    terminal.style.opacity = '0';
    setTimeout(() => terminal.remove(), 600);
  }
  setTimeout(() => navigateTo(targetId), 300);
};

window._navigate = function(targetId) { navigateTo(targetId); };

function navigateTo(targetId) {
  const panel = tesseract.getPanel(targetId);
  if (!panel) return;
  hideContentPanel();
  const fromPos = camera.position.clone();
  // Build waypoints from current position to target
  const waypoints = [
    { x: fromPos.x, y: fromPos.y, z: fromPos.z },
    { x: 0, y: 4, z: 0 }, // through intersection
  ];

  // Add intermediate corridor waypoint
  const midX = panel.corridorDir === 'x' ? panel.pos.x * 0.5 : 0;
  const midZ = panel.corridorDir === 'z' ? panel.pos.z * 0.5 : 0;
  waypoints.push({ x: midX, y: panel.pos.y + 1, z: midZ });
  // Corridor center near target
  const nearX = panel.corridorDir === 'x' ? panel.pos.x : 0;
  const nearZ = panel.corridorDir === 'z' ? panel.pos.z : 0;
  waypoints.push({ x: nearX, y: panel.pos.y + 1, z: nearZ });
  // Face the panel
  const appX = panel.pos.x + (panel.normal.x || 0) * 3;
  const appZ = panel.pos.z + (panel.normal.z || 0) * 3;
  waypoints.push({ x: appX, y: panel.pos.y + 0.5, z: appZ });

  const points = waypoints.map(w => new THREE.Vector3(w.x, w.y, w.z));
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.3);
  const dist = curve.getLength();
  flightState = {
    curve, progress: 0,
    duration: Math.max(2.5, Math.min(7, dist / 25)),
    targetPanel: panel,
    startTime: clock.getElapsedTime()
  };
  currentPanel = targetId;
}

// === FLIGHT UPDATE ===
function updateFlight(elapsed) {
  if (!flightState) return;
  const t = (elapsed - flightState.startTime) / flightState.duration;
  if (t >= 1.0) {
    const fp = flightState.curve.getPoint(1.0);
    camera.position.copy(fp);
    const p = flightState.targetPanel;
    camera.lookAt(p.pos.x, p.pos.y, p.pos.z);
    flightState = null;
    showContentPanel(currentPanel);
    return;
  }
  const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2;
  camera.position.copy(flightState.curve.getPoint(ease));
  const lookT = Math.min(ease + 0.04, 1.0);
  camera.lookAt(flightState.curve.getPoint(lookT));
}

// === CONTENT PANEL ===
const contentEl = document.createElement('div');
contentEl.id = 'content-panel';
contentEl.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
  width:480px;max-height:70vh;background:rgba(245,245,245,0.96);
  border:1px solid #111;padding:32px;font-family:'Courier New',monospace;
  color:#111;opacity:0;pointer-events:none;transition:opacity 0.4s;
  overflow-y:auto;z-index:100;`;
document.body.appendChild(contentEl);

function showContentPanel(nodeId) {
  const p = tesseract.getPanel(nodeId);
  if (!p) return;
  const neighbors = tesseract.getNeighbors(nodeId);
  contentEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div style="font-size:20px;font-weight:bold;letter-spacing:1px">${p.title}</div>
      <button onclick="hideContentPanel()" style="background:none;border:none;color:#888;
        font-size:18px;cursor:pointer;padding:0 4px">&times;</button>
    </div>
    <div style="font-size:10px;color:#999;margin:8px 0 16px;letter-spacing:2px">${p.path}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;font-size:11px">
      <span style="border:1px solid #aaa;padding:2px 8px">${p.type}</span>
      <span style="border:1px solid #aaa;padding:2px 8px">${p.folder}</span>
      <span style="border:1px solid #aaa;padding:2px 8px">${p.wordCount}w</span>
      <span style="border:1px solid #aaa;padding:2px 8px">${p.linkCount} links</span>
    </div>

    ${p.tags.length ? '<div style="margin-bottom:12px">' + p.tags.map(t =>
      '<span style="font-size:10px;color:#666;margin-right:8px">#'+t+'</span>').join('') + '</div>' : ''}
    <div style="font-size:10px;color:#aaa;margin-bottom:12px">${p.created}</div>
    <div style="border-top:1px solid #ddd;padding-top:12px">
      <div style="font-size:11px;color:#888;letter-spacing:1px;margin-bottom:8px">CONNECTED</div>
      ${neighbors.slice(0,12).map(n =>
        '<div onclick="window._navigate(\''+n.id+'\')" style="padding:3px 0;font-size:11px;cursor:pointer;color:#444">'+n.title+'</div>'
      ).join('')}
      ${neighbors.length > 12 ? '<div style="color:#aaa;font-size:10px">+' + (neighbors.length-12) + ' more</div>' : ''}
    </div>
    <a href="obsidian://open?vault=The-Hive&file=${encodeURIComponent(p.path.replace('.md',''))}"
      style="display:block;margin-top:16px;text-align:center;padding:8px;border:1px solid #111;
      color:#111;text-decoration:none;font-size:11px;letter-spacing:2px">OPEN IN OBSIDIAN</a>
  `;
  contentEl.style.opacity = '1';
  contentEl.style.pointerEvents = 'auto';
}

window.hideContentPanel = function() {
  contentEl.style.opacity = '0';
  contentEl.style.pointerEvents = 'none';
};

// === NAV COMMAND POLLING (Walt control channel) ===
async function pollNavCommand() {
  try {
    const res = await fetch('/nav-command.json?t=' + Date.now());
    if (!res.ok) return;
    const cmd = await res.json();
    if (cmd.timestamp && cmd.timestamp !== lastNavTimestamp && cmd.target) {
      lastNavTimestamp = cmd.timestamp;
      const hits = tesseract.search(cmd.target);
      if (hits.length > 0) {
        // Dismiss terminal if still showing
        const terminal = document.getElementById('terminal');
        if (terminal) { terminal.style.opacity='0'; setTimeout(()=>terminal.remove(),300); }
        navigateTo(hits[0].id);
      }
    }
  } catch(e) {}
}

// === INIT ===
async function init() {
  const res = await fetch('/graph.json');
  const data = await res.json();
  tesseract = new Tesseract(data);
  console.log(`Tesseract built: ${tesseract.corridors.size} corridors, ${tesseract.panels.size} panels`);

  buildInfiniteGrid();
  buildCorridors(tesseract);
  buildPanels(tesseract);
  buildAccentPanels();
  buildTerminal();

  setInterval(pollNavCommand, 500);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.hideContentPanel();
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // === ANIMATION LOOP ===
  function animate() {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    updateFlight(elapsed);
    // Breathe accent panels
    for (const ap of accentPanels) {
      const breath = Math.sin(elapsed * ap.speed + ap.phase);
      ap.mat.opacity = Math.max(0, breath * ap.maxOpacity);
    }
    // Gentle camera bob when idle (not flying)
    if (!flightState && !document.getElementById('terminal')) {
      camera.position.y += Math.sin(elapsed * 0.5) * 0.002;
    }
    renderer.render(scene, camera);
  }
  animate();
  console.log('The Tesseract is alive.');
}

init().catch(e => console.error('Init failed:', e));
