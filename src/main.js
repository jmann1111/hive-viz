import * as THREE from 'three';
import { Tesseract } from './core/tesseract.js';

// === ANTICHAMBER PALETTE ===
const BG = 0xf0f0f0;
const LINE_DARK = 0x111111;
const LINE_MED = 0x555555;
const LINE_LIGHT = 0xbbbbbb;
const LINE_GRID = 0xdddddd;

// === RENDERER ===
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);

const camera = new THREE.PerspectiveCamera(
  70, window.innerWidth / window.innerHeight, 0.1, 2000
);
camera.position.set(0, 4, -2);
camera.lookAt(0, 4, 10);

// State
let tesseract = null;
let currentPanel = null;
let flightState = null; // { curve, progress, duration, lookTarget }
let lastNavTimestamp = 0;
const clock = new THREE.Clock();

// === BUILD CORRIDOR LINES ===
function buildCorridors(tesseract) {
  const positions = [];
  const colors = [];
  const dark = new THREE.Color(LINE_MED);
  const grid = new THREE.Color(LINE_GRID);
  const light = new THREE.Color(LINE_LIGHT);

  for (const [folder, corridor] of tesseract.corridors) {
    const { dir, yOffset, length } = corridor;
    const w = corridor.width / 2;
    const h = corridor.height;
    const y0 = yOffset;
    const y1 = yOffset + h;

    // Generate cross-sections along corridor length
    const steps = Math.ceil(length / 3);
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * length * dir.sign;
      // 4 vertical corner lines of the cross-section
      if (dir.axis === 'x') {
        // Cross-section rectangle at this X position
        addLine(positions, colors, t, y0, -w, t, y1, -w, dark);
        addLine(positions, colors, t, y0, w, t, y1, w, dark);
        addLine(positions, colors, t, y0, -w, t, y0, w, grid);
        addLine(positions, colors, t, y1, -w, t, y1, w, grid);
      } else {
        addLine(positions, colors, -w, y0, t, -w, y1, t, dark);
        addLine(positions, colors, w, y0, t, w, y1, t, dark);
        addLine(positions, colors, -w, y0, t, w, y0, t, grid);
        addLine(positions, colors, -w, y1, t, w, y1, t, grid);
      }
    }

    // 4 long edge lines (the corridor rails)
    const L = length * dir.sign;
    if (dir.axis === 'x') {
      addLine(positions, colors, 0, y0, -w, L, y0, -w, dark);
      addLine(positions, colors, 0, y0, w, L, y0, w, dark);
      addLine(positions, colors, 0, y1, -w, L, y1, -w, dark);
      addLine(positions, colors, 0, y1, w, L, y1, w, dark);
    } else {
      addLine(positions, colors, -w, y0, 0, -w, y0, L, dark);
      addLine(positions, colors, w, y0, 0, w, y0, L, dark);
      addLine(positions, colors, -w, y1, 0, -w, y1, L, dark);
      addLine(positions, colors, w, y1, 0, w, y1, L, dark);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true });
  const lines = new THREE.LineSegments(geo, mat);
  scene.add(lines);
  return lines;
}

function addLine(positions, colors, x1,y1,z1, x2,y2,z2, color) {
  positions.push(x1,y1,z1, x2,y2,z2);
  colors.push(color.r,color.g,color.b, color.r,color.g,color.b);
}

// === BUILD PANEL OUTLINES ===
function buildPanels(tesseract) {
  const positions = [];
  const colors = [];
  const panelColor = new THREE.Color(LINE_DARK);
  const dimColor = new THREE.Color(LINE_LIGHT);

  for (const [id, panel] of tesseract.panels) {
    const { pos, normal } = panel;
    const pw = PANEL_WIDTH / 2;
    const ph = PANEL_HEIGHT / 2;
    const c = panel.linkCount > 5 ? panelColor : dimColor;

    // Panel rectangle on the wall
    // If wall faces Z: panel spans X and Y
    // If wall faces X: panel spans Z and Y
    if (normal.z !== 0) {
      addLine(positions,colors, pos.x-pw,pos.y-ph,pos.z, pos.x+pw,pos.y-ph,pos.z, c);
      addLine(positions,colors, pos.x+pw,pos.y-ph,pos.z, pos.x+pw,pos.y+ph,pos.z, c);
      addLine(positions,colors, pos.x+pw,pos.y+ph,pos.z, pos.x-pw,pos.y+ph,pos.z, c);
      addLine(positions,colors, pos.x-pw,pos.y+ph,pos.z, pos.x-pw,pos.y-ph,pos.z, c);
    } else {
      addLine(positions,colors, pos.x,pos.y-ph,pos.z-pw, pos.x,pos.y-ph,pos.z+pw, c);
      addLine(positions,colors, pos.x,pos.y-ph,pos.z+pw, pos.x,pos.y+ph,pos.z+pw, c);
      addLine(positions,colors, pos.x,pos.y+ph,pos.z+pw, pos.x,pos.y+ph,pos.z-pw, c);
      addLine(positions,colors, pos.x,pos.y+ph,pos.z-pw, pos.x,pos.y-ph,pos.z-pw, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true });
  const lines = new THREE.LineSegments(geo, mat);
  scene.add(lines);
  return lines;
}

const PANEL_WIDTH = 2;
const PANEL_HEIGHT = 2.5;

// === CAMERA FLIGHT SYSTEM ===
function startFlight(fromId, toId) {
  const path = tesseract.getFlightPath(fromId, toId);
  if (!path || path.waypoints.length < 2) return;

  const points = path.waypoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.3);

  // Calculate duration based on distance
  const totalDist = curve.getLength();
  const duration = Math.max(2.0, Math.min(6.0, totalDist / 30));

  flightState = {
    curve,
    progress: 0,
    duration,
    targetPanel: path.to,
    startTime: clock.getElapsedTime()
  };
  currentPanel = toId;
  hideContentPanel();
}

function updateFlight(elapsed) {
  if (!flightState) return;
  const t = (elapsed - flightState.startTime) / flightState.duration;
  if (t >= 1.0) {
    // Arrived
    const finalPos = flightState.curve.getPoint(1.0);
    camera.position.copy(finalPos);
    // Look at the panel
    const panel = flightState.targetPanel;
    const lookAt = new THREE.Vector3(
      panel.pos.x - panel.normal.x * 0.5,
      panel.pos.y,
      panel.pos.z - panel.normal.z * 0.5
    );
    camera.lookAt(lookAt);
    flightState = null;
    showContentPanel(currentPanel);
    return;
  }
  // Ease in-out cubic
  const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2;
  const pos = flightState.curve.getPoint(ease);
  camera.position.copy(pos);
  // Look ahead on the curve
  const lookAhead = Math.min(ease + 0.05, 1.0);
  const lookTarget = flightState.curve.getPoint(lookAhead);
  camera.lookAt(lookTarget);
}

// === CONTENT PANEL (wall transform) ===
const contentEl = document.createElement('div');
contentEl.id = 'content-panel';
contentEl.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
  width:500px;max-height:70vh;background:rgba(240,240,240,0.96);
  border:1px solid #111;padding:32px;font-family:'Courier New',monospace;
  color:#111;opacity:0;pointer-events:none;transition:opacity 0.5s;
  overflow-y:auto;z-index:100;`;
document.body.appendChild(contentEl);

function showContentPanel(nodeId) {
  const panel = tesseract.getPanel(nodeId);
  if (!panel) return;
  const neighbors = tesseract.getNeighbors(nodeId);
  contentEl.innerHTML = `
    <div style="font-size:22px;font-weight:bold;margin-bottom:12px;letter-spacing:1px">${panel.title}</div>
    <div style="font-size:11px;color:#888;margin-bottom:16px;letter-spacing:2px">${panel.path}</div>
    <div style="display:flex;gap:12px;margin-bottom:16px;font-size:12px">
      <span style="border:1px solid #888;padding:2px 8px">${panel.type}</span>
      <span style="border:1px solid #888;padding:2px 8px">${panel.folder}</span>
      <span style="border:1px solid #888;padding:2px 8px">${panel.wordCount}w</span>
      <span style="border:1px solid #888;padding:2px 8px">${panel.linkCount} links</span>
    </div>
    <div style="font-size:11px;color:#888;margin-bottom:8px">${panel.created}</div>
    ${panel.tags.length ? '<div style="margin-bottom:16px">' +
      panel.tags.map(t => `<span style="font-size:11px;color:#555;margin-right:8px">#${t}</span>`).join('') + '</div>' : ''}
    <div style="border-top:1px solid #ddd;padding-top:12px;margin-top:12px">
      <div style="font-size:12px;color:#888;margin-bottom:8px;letter-spacing:1px">CONNECTED</div>
      ${neighbors.slice(0,15).map(n =>
        `<div style="padding:3px 0;font-size:12px;cursor:pointer;color:#333"
          onclick="window._navigate('${n.id}')">${n.title}</div>`
      ).join('')}
      ${neighbors.length > 15 ? `<div style="color:#888;font-size:11px">+${neighbors.length-15} more</div>` : ''}
    </div>
    <a href="obsidian://open?vault=The-Hive&file=${encodeURIComponent(panel.path.replace('.md',''))}"
      style="display:block;margin-top:16px;text-align:center;padding:8px;border:1px solid #111;
      color:#111;text-decoration:none;font-size:12px;letter-spacing:1px">OPEN IN OBSIDIAN</a>
  `;
  contentEl.style.opacity = '1';
  contentEl.style.pointerEvents = 'auto';
}

function hideContentPanel() {
  contentEl.style.opacity = '0';
  contentEl.style.pointerEvents = 'none';
}

// Navigation handler (called from content panel links and from Walt)
window._navigate = function(targetId) {
  const fromId = currentPanel || tesseract.panels.keys().next().value;
  startFlight(fromId, targetId);
};

// === NAV COMMAND POLLING (Walt control channel) ===
async function pollNavCommand() {
  try {
    const res = await fetch('/nav-command.json?t=' + Date.now());
    if (!res.ok) return;
    const cmd = await res.json();
    if (cmd.timestamp && cmd.timestamp !== lastNavTimestamp && cmd.target) {
      lastNavTimestamp = cmd.timestamp;
      // Search for the target
      const results = tesseract.search(cmd.target);
      if (results.length > 0) {
        console.log(`Nav command: flying to "${results[0].title}"`);
        window._navigate(results[0].id);
      } else {
        console.warn(`Nav command: "${cmd.target}" not found`);
      }
    }
  } catch(e) { /* nav-command.json doesn't exist yet, that's fine */ }
}

// === INIT ===
async function init() {
  const res = await fetch('/graph.json');
  const data = await res.json();
  console.log(`Loaded ${data.nodes.length} nodes, ${data.edges.length} edges`);

  tesseract = new Tesseract(data);
  console.log(`Built ${tesseract.corridors.size} corridors, ${tesseract.panels.size} panels`);

  buildCorridors(tesseract);
  buildPanels(tesseract);

  // Start camera at the entrance to the first corridor
  const firstPanel = tesseract.panels.values().next().value;
  if (firstPanel) {
    camera.position.set(0, 4, -4);
    camera.lookAt(0, 4, 10);
    currentPanel = firstPanel.id;
  }

  // Poll nav commands every 500ms
  setInterval(pollNavCommand, 500);

  // Keyboard
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContentPanel();
  });

  // Click background to dismiss content
  renderer.domElement.addEventListener('click', () => {
    if (contentEl.style.opacity === '1') hideContentPanel();
  });

  // Resize
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
    renderer.render(scene, camera);
  }
  animate();
  console.log('The Tesseract is alive.');
}

init().catch(e => console.error('Init failed:', e));
