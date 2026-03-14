import * as THREE from 'three';
import { Tesseract } from './core/tesseract.js';
import { Navigator } from './core/navigator.js';

// ============ RENDERER ============
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);
scene.fog = new THREE.FogExp2(0xf0f0f0, 0.0018);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 6, -5);
camera.lookAt(0, 6, 20);

let tesseract = null;
let nav = null;
let currentPanel = null;
let flightState = null;
let lastNavTimestamp = 0;
const clock = new THREE.Clock();
let accentPanels = [];

function addLine(p, c, x1,y1,z1, x2,y2,z2, col) {
  p.push(x1,y1,z1, x2,y2,z2);
  c.push(col.r,col.g,col.b, col.r,col.g,col.b);
}
// ============ WORLD BUILDER: Solid-first, performance-first ============
function buildWorld() {
  const hash = (a,b) => Math.abs(Math.sin(a*127.1+b*311.7)*43758.5453)%1;
  const hash3 = (a,b,c) => Math.abs(Math.sin(a*73.1+b*157.3+c*239.7)*43758.5453)%1;

  const range = 400, cell = 24;
  const yLevels = [0, 24, 50];
  const PALETTES = [
    0xcc3333, 0xdd5533, 0xee7733, // warm
    0x3366cc, 0x4488dd,           // blue
    0x33aa66, 0x44cc77,           // green
    0xcc33aa, 0xdd55bb,           // magenta
    0xddaa33, 0xeecc44,           // gold
    0x33aacc, 0x8844cc,           // cyan/purple
  ];

  // === INSTANCED SOLID BLOCKS (one draw call per color) ===
  const blockData = []; // {x,y,z,w,h,d,color}
  // === INSTANCED FLOOR TILES ===
  const floorWhitePositions = [], floorDarkPositions = [];
  // === INSTANCED WALL PANELS ===
  const wallData = []; // {x,y,z,rx,ry,w,h}
  // === SPARSE LINE GEOMETRY ===
  const pos = [], col = [];
  const railColor = new THREE.Color(0xcccccc);
  const darkRail = new THREE.Color(0x999999);

  for (const baseY of yLevels) {
    for (let gx = -range; gx <= range; gx += cell) {
      for (let gz = -range; gz <= range; gz += cell) {
        const h = hash(gx, gz+baseY), h2 = hash(gx+baseY, gz);
        if (hash3(gx,gz,baseY) < 0.25 && baseY > 0) continue;

        const ceilH = 8 + h * 16;
        const w = cell * 0.45;

        // Floor tile (checkerboard)
        const isWhite = ((Math.floor(gx/cell)+Math.floor(gz/cell)+Math.floor(baseY/24))%2===0);
        (isWhite ? floorWhitePositions : floorDarkPositions).push(gx, baseY, gz);

        // Colored zone? (~20% of cells)
        const isColor = hash3(gx*0.07, gz*0.07, baseY*0.2) > 0.8;
        if (isColor) {
          const cidx = Math.floor(hash3(gx,gz,baseY+1) * PALETTES.length);
          const bw = 3+h*8, bh = 4+h*ceilH*0.7, bd = 3+h2*8;
          blockData.push({ x:gx, y:baseY+bh/2, z:gz, w:bw, h:bh, d:bd, color:PALETTES[cidx] });
          // Second smaller block nearby for variety
          if (h > 0.5) {
            const cidx2 = (cidx+1) % PALETTES.length;
            blockData.push({ x:gx+(h-0.5)*12, y:baseY+bh*0.3, z:gz+(h2-0.5)*12,
              w:bw*0.5, h:bh*0.6, d:bd*0.5, color:PALETTES[cidx2] });
          }
        }
        // Wall panel (~30% of cells)
        if (h > 0.7) {
          const side = h2 > 0.5 ? 1 : -1;
          wallData.push({ x:gx, y:baseY+ceilH/2, z:gz+side*w, rx:0, ry:0, w:cell*0.8, h:ceilH });
        }
        // Perpendicular wall (~15%)
        if (h2 > 0.85) {
          wallData.push({ x:gx+(h>0.5?1:-1)*w, y:baseY+ceilH/2, z:gz, rx:0, ry:Math.PI/2, w:cell*0.8, h:ceilH });
        }
        // Ceiling panel (~20%)
        if (h > 0.8) {
          wallData.push({ x:gx, y:baseY+ceilH, z:gz, rx:-Math.PI/2, ry:0, w:cell*0.8, h:cell*0.8 });
        }

        // Sparse corridor rails (just 4 lines per cell, no cross-sections)
        const y0 = baseY, y1 = baseY + ceilH;
        addLine(pos,col, gx-w,y0,gz-w, gx-w,y0,gz+w, railColor);
        addLine(pos,col, gx+w,y0,gz-w, gx+w,y0,gz+w, railColor);
        addLine(pos,col, gx-w,y0,gz-w, gx-w,y1,gz-w, railColor);
        addLine(pos,col, gx+w,y0,gz+w, gx+w,y1,gz+w, railColor);

        // Vertical shaft to next level (~10%)
        if (h > 0.9 && baseY < 50) {
          addLine(pos,col, gx,y1,gz, gx,baseY+30,gz, darkRail);
        }
      }
    }
  }
  // === BUILD INSTANCED FLOOR TILES ===
  const tileSize = cell * 0.9;
  const tileGeo = new THREE.PlaneGeometry(tileSize, tileSize);
  tileGeo.rotateX(-Math.PI / 2);
  for (const [positions, hex] of [[floorWhitePositions, 0xf0f0f0],[floorDarkPositions, 0xd4d4d4]]) {
    const count = positions.length / 3;
    if (count === 0) continue;
    const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    const im = new THREE.InstancedMesh(tileGeo, mat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m.makeTranslation(positions[i*3], positions[i*3+1]+0.01, positions[i*3+2]);
      im.setMatrixAt(i, m);
    }
    scene.add(im);
  }

  // === BUILD INSTANCED COLORED BLOCKS ===
  // Group by color for batching
  const colorGroups = new Map();
  for (const b of blockData) {
    if (!colorGroups.has(b.color)) colorGroups.set(b.color, []);
    colorGroups.get(b.color).push(b);
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [hex, blocks] of colorGroups) {
    const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.55, depthWrite: false });
    const im = new THREE.InstancedMesh(boxGeo, mat, blocks.length);
    const m = new THREE.Matrix4(), s = new THREE.Matrix4();    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      s.makeScale(b.w, b.h, b.d);
      m.makeTranslation(b.x, b.y, b.z);
      m.multiply(s);
      im.setMatrixAt(i, m);
    }
    scene.add(im);
  }

  // === BUILD INSTANCED WALL PANELS ===
  if (wallData.length > 0) {
    const wallGeo = new THREE.PlaneGeometry(1, 1);
    const wallMat = new THREE.MeshBasicMaterial({ color: 0xe0e0e0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const wim = new THREE.InstancedMesh(wallGeo, wallMat, wallData.length);
    const m4 = new THREE.Matrix4();
    const euler = new THREE.Euler();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const trs = new THREE.Vector3();
    for (let i = 0; i < wallData.length; i++) {
      const wd = wallData[i];
      trs.set(wd.x, wd.y, wd.z);
      euler.set(wd.rx, wd.ry, 0);
      quat.setFromEuler(euler);
      scl.set(wd.w, wd.h, 1);
      m4.compose(trs, quat, scl);
      wim.setMatrixAt(i, m4);
    }
    scene.add(wim);
  }
  // === SPARSE LINE RAILS ===
  if (pos.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })));
  }

  // === FLOOR GRID (just ground plane, very sparse) ===
  const gpos = [], gcol = [];
  const gc = new THREE.Color(0xdddddd);
  for (let x = -range; x <= range; x += 12) {
    addLine(gpos,gcol, x,0,-range, x,0,range, gc);
    addLine(gpos,gcol, -range,0,x, range,0,x, gc);
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
  gg.setAttribute('color', new THREE.Float32BufferAttribute(gcol, 3));
  scene.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ vertexColors: true })));
}
// ============ HUB PYRAMID ============
function buildHub() {
  const p = [], c = [];
  const dk = new THREE.Color(0x444444), md = new THREE.Color(0x999999);
  const top = 20, half = 8;
  addLine(p,c, -half,top,-half, half,top,-half, dk);
  addLine(p,c, half,top,-half, half,top,half, dk);
  addLine(p,c, half,top,half, -half,top,half, dk);
  addLine(p,c, -half,top,half, -half,top,-half, dk);
  addLine(p,c, -half,top,-half, 0,8,0, md);
  addLine(p,c, half,top,-half, 0,8,0, md);
  addLine(p,c, half,top,half, 0,8,0, md);
  addLine(p,c, -half,top,half, 0,8,0, md);
  for (let i = 0; i < 16; i++) {
    const a = (i/16)*Math.PI*2, r = 300+Math.random()*300;
    addLine(p,c, 0,top,0, Math.cos(a)*r,top+(Math.random()-0.5)*4,Math.sin(a)*r, new THREE.Color(0xdddddd));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true })));
}
// ============ BIOME CORRIDORS (simplified, rails only) ============
function buildBiomeCorridors(t) {
  const p = [], c = [];
  for (const [folder, corridor] of t.corridors) {
    const { biome, yOffset, length } = corridor;
    const w2 = biome.width/2, h = biome.height;
    const dk = new THREE.Color(biome.lineDark), md = new THREE.Color(biome.lineColor);
    const L = length * biome.sign;
    const y0 = yOffset, y1 = yOffset + h;
    if (biome.axis === 'x') {
      addLine(p,c,0,y0,-w2,L,y0,-w2,dk); addLine(p,c,0,y0,w2,L,y0,w2,dk);
      addLine(p,c,0,y1,-w2,L,y1,-w2,dk); addLine(p,c,0,y1,w2,L,y1,w2,dk);
      for (let d = 0; d <= Math.abs(L); d += 16) {
        const dd = d * Math.sign(L);
        addLine(p,c,dd,y0,-w2,dd,y1,-w2,md); addLine(p,c,dd,y0,w2,dd,y1,w2,md);
      }
    } else {
      addLine(p,c,-w2,y0,0,-w2,y0,L,dk); addLine(p,c,w2,y0,0,w2,y0,L,dk);
      addLine(p,c,-w2,y1,0,-w2,y1,L,dk); addLine(p,c,w2,y1,0,w2,y1,L,dk);
      for (let d = 0; d <= Math.abs(L); d += 16) {
        const dd = d * Math.sign(L);
        addLine(p,c,-w2,y0,dd,-w2,y1,dd,md); addLine(p,c,w2,y0,dd,w2,y1,dd,md);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true })));
}
// ============ BLOCK TOWERS (instanced for performance) ============
function buildBlocks(t) {
  if (t.blocks.length === 0) return;
  const colorGroups = new Map();
  for (const b of t.blocks) {
    const key = b.color;
    if (!colorGroups.has(key)) colorGroups.set(key, []);
    colorGroups.get(key).push(b);
  }
  const geo = new THREE.BoxGeometry(1,1,1);
  for (const [hex, blocks] of colorGroups) {
    const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.6, depthWrite: false });
    const im = new THREE.InstancedMesh(geo, mat, blocks.length);
    const m = new THREE.Matrix4(), s = new THREE.Matrix4();
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      s.makeScale(b.width, b.height, b.depth);
      m.makeTranslation(b.pos.x, b.pos.y + b.height/2, b.pos.z);
      m.multiply(s);
      im.setMatrixAt(i, m);
    }
    scene.add(im);
  }
}

// ============ FILE PANELS (simplified, instanced) ============
function buildPanels(t) {
  const p = [], c = [];
  for (const [id, panel] of t.panels) {    const cl = panel.linkCount > 5 ? new THREE.Color(panel.biome.lineDark) : new THREE.Color(panel.biome.lineColor);
    const PW = 1.5, PH = 2;
    const px = panel.pos.x, py = panel.pos.y, pz = panel.pos.z;
    if (panel.normal.z !== 0) {
      addLine(p,c, px-PW,py-PH,pz, px+PW,py-PH,pz, cl);
      addLine(p,c, px+PW,py-PH,pz, px+PW,py+PH,pz, cl);
      addLine(p,c, px+PW,py+PH,pz, px-PW,py+PH,pz, cl);
      addLine(p,c, px-PW,py+PH,pz, px-PW,py-PH,pz, cl);
    } else {
      addLine(p,c, px,py-PH,pz-PW, px,py-PH,pz+PW, cl);
      addLine(p,c, px,py-PH,pz+PW, px,py+PH,pz+PW, cl);
      addLine(p,c, px,py+PH,pz+PW, px,py+PH,pz-PW, cl);
      addLine(p,c, px,py+PH,pz-PW, px,py-PH,pz-PW, cl);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true })));
}

// ============ ACCENT PANELS ============
function buildAccentPanels(t) {
  for (const [folder, corridor] of t.corridors) {
    const { biome, yOffset, length } = corridor;
    const count = Math.min(Math.floor(length * 0.08), 15);
    const w2 = biome.width / 2;    for (let i = 0; i < count; i++) {
      const t2 = (i+0.5)/count;
      const dist = 20 + t2 * length;
      const geo = new THREE.PlaneGeometry(2+Math.random()*4, 2+Math.random()*5);
      const mat = new THREE.MeshBasicMaterial({ color: biome.accent, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      const side = Math.random()>0.5?1:-1;
      if (biome.axis==='x') { mesh.position.set(biome.sign*dist, yOffset+Math.random()*biome.height, side*(w2-0.2)); mesh.rotation.y=Math.PI/2; }
      else { mesh.position.set(side*(w2-0.2), yOffset+Math.random()*biome.height, biome.sign*dist); }
      scene.add(mesh);
      accentPanels.push({ mesh, mat, phase: Math.random()*Math.PI*2, speed: 0.2+Math.random()*0.5, maxOpacity: 0.12+Math.random()*0.2 });
    }
  }
}
// ============ TERMINAL ============
function buildTerminal() {
  const el = document.createElement('div');
  el.id = 'terminal';
  el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:200;font-family:"Courier New",monospace;pointer-events:auto;';
  el.innerHTML = '<div style="text-align:center;margin-bottom:40px"><div style="font-size:11px;letter-spacing:8px;color:#888;margin-bottom:8px">THE</div><div style="font-size:42px;letter-spacing:14px;color:#111;font-weight:200">TESSERACT</div><div style="font-size:10px;letter-spacing:4px;color:#aaa;margin-top:12px">A NAVIGABLE DIMENSION</div></div><div style="position:relative;width:420px"><input id="search-input" type="text" placeholder="where do you want to go?" style="width:100%;padding:16px 24px;background:transparent;border:1px solid #bbb;color:#111;font-family:inherit;font-size:14px;letter-spacing:2px;outline:none;text-align:center;" autocomplete="off"/><div id="search-results" style="position:absolute;top:100%;left:0;right:0;max-height:300px;overflow-y:auto;border:1px solid #ddd;border-top:none;display:none;background:#f5f5f5;"></div></div>';
  document.body.appendChild(el);
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 2) { results.style.display='none'; return; }
    const hits = tesseract.search(q).slice(0,8);
    if (!hits.length) { results.style.display='none'; return; }
    results.style.display = 'block';
    results.innerHTML = hits.map(h => `<div onclick="window._launchTo('${h.id}')" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid #eee;font-size:12px;letter-spacing:1px;color:#333" onmouseover="this.style.background='#eaeaea'" onmouseout="this.style.background='transparent'"><b>${h.title}</b><div style="font-size:10px;color:#999;margin-top:2px">${h.folder}</div></div>`).join('');
  });
  input.addEventListener('keydown', e => { if (e.key==='Enter') { const h=tesseract.search(input.value.trim()); if(h.length)window._launchTo(h[0].id); }});
  setTimeout(() => input.focus(), 100);
}
// ============ LAUNCH + FLIGHT ============
window._launchTo = function(id) {
  const t = document.getElementById('terminal');
  if (t) { t.style.transition='opacity 0.6s'; t.style.opacity='0'; setTimeout(()=>t.remove(),600); }
  setTimeout(() => navigateTo(id), 300);
};
window._navigate = function(id) { navigateTo(id); };

function navigateTo(targetId) {
  const panel = tesseract.getPanel(targetId);
  if (!panel) return;
  window.hideContentPanel();
  currentPanel = targetId;

  // Use Navigator to plan axis-aligned corridor route
  const plan = nav.plan(camera.position, targetId);
  if (!plan || !plan.segments.length) {
    console.warn('No plan, teleporting');
    camera.position.set(panel.pos.x, panel.pos.y + 2, panel.pos.z);
    camera.lookAt(panel.pos.x, panel.pos.y, panel.pos.z);
    showContentPanel(targetId);
    return;
  }

  flightState = {
    plan,
    elapsed: 0,
    lookTarget: { x: panel.pos.x, y: panel.pos.y, z: panel.pos.z },
    done: false,
  };
  // Init smooth look to current camera direction
  const fwd = new THREE.Vector3(0,0,1).applyQuaternion(camera.quaternion);
  smoothLookX = camera.position.x + fwd.x * 20;
  smoothLookY = camera.position.y + fwd.y * 20;
  smoothLookZ = camera.position.z + fwd.z * 20;
}

// Segment easing: accel in first 20%, cruise, decel in last 20%
function segEase(t) {
  if (t < 0.2) return 2.5 * t * t;                    // quadratic accel
  if (t > 0.8) { const r = (1-t)/0.2; return 1 - 0.5*r*r; } // quadratic decel
  return 0.1 + (t - 0.2) * (0.8 / 0.6);              // linear cruise
}

// Frame-rate independent smooth look target
let smoothLookX = 0, smoothLookY = 6, smoothLookZ = 20;

function updateFlight(dt) {
  if (!flightState || flightState.done) return;
  flightState.elapsed += dt;

  const { plan, lookTarget } = flightState;
  const t = flightState.elapsed;

  // Find which segment we're in
  let seg = null, segT = 0;
  for (const s of plan.segments) {
    if (t < s.startTime + s.duration) {
      seg = s;
      segT = (t - s.startTime) / s.duration;
      break;
    }
  }

  if (!seg) {
    // All segments complete
    flightState.done = true;
    camera.lookAt(lookTarget.x, lookTarget.y, lookTarget.z);
    camera.rotation.z = 0;
    showContentPanel(currentPanel);
    return;
  }

  const e = Math.max(0, Math.min(1, segT));
  let px, py, pz, idealLookX, idealLookY, idealLookZ, roll = 0;

  if (seg.type === 'straight') {
    const ease = segEase(e);
    px = seg.from.x + (seg.to.x - seg.from.x) * ease;
    py = seg.from.y + (seg.to.y - seg.from.y) * ease;
    pz = seg.from.z + (seg.to.z - seg.from.z) * ease;
    // Look down the corridor (well ahead)
    idealLookX = seg.to.x; idealLookY = seg.to.y; idealLookZ = seg.to.z;
  } else if (seg.type === 'turn') {
    px = seg.pos.x; py = seg.pos.y; pz = seg.pos.z;
    // Smooth heading interpolation
    let dH = seg.toHeading - seg.fromHeading;
    while (dH > Math.PI) dH -= Math.PI * 2;
    while (dH < -Math.PI) dH += Math.PI * 2;
    const smoothE = e * e * (3 - 2 * e); // smoothstep
    const heading = seg.fromHeading + dH * smoothE;
    idealLookX = px + Math.sin(heading) * 30;
    idealLookY = py;
    idealLookZ = pz + Math.cos(heading) * 30;
    // Bank into the turn
    roll = -dH * 0.2 * Math.sin(e * Math.PI);
  } else if (seg.type === 'vertical') {
    px = seg.pos.x; pz = seg.pos.z;
    const smoothE = e * e * (3 - 2 * e);
    py = seg.fromY + (seg.toY - seg.fromY) * smoothE;
    // Look up or down during vertical travel
    const lookAheadY = py + (seg.toY > seg.fromY ? 15 : -15);
    idealLookX = px; idealLookY = lookAheadY; idealLookZ = pz;
  } else if (seg.type === 'arrive') {
    const smoothE = e * e * (3 - 2 * e);
    px = seg.from.x + (seg.to.x - seg.from.x) * smoothE;
    py = seg.from.y + (seg.to.y - seg.from.y) * smoothE;
    pz = seg.from.z + (seg.to.z - seg.from.z) * smoothE;
    // Lock onto panel
    idealLookX = seg.lookTarget.x;
    idealLookY = seg.lookTarget.y;
    idealLookZ = seg.lookTarget.z;
  }

  camera.position.set(px, py, pz);

  // Frame-rate independent smooth look (no jerks ever)
  const lf = 1 - Math.exp(-6 * Math.min(dt, 0.05));
  smoothLookX += (idealLookX - smoothLookX) * lf;
  smoothLookY += (idealLookY - smoothLookY) * lf;
  smoothLookZ += (idealLookZ - smoothLookZ) * lf;
  camera.lookAt(smoothLookX, smoothLookY, smoothLookZ);

  // Frame-rate independent smooth roll
  const rlf = 1 - Math.exp(-4 * Math.min(dt, 0.05));
  camera.rotation.z += (roll - camera.rotation.z) * rlf;
}
// ============ CONTENT PANEL ============
const contentEl = document.createElement('div');
contentEl.id = 'content-panel';
contentEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:500px;max-height:70vh;background:rgba(245,245,245,0.96);border:1px solid #111;padding:32px;font-family:"Courier New",monospace;color:#111;opacity:0;pointer-events:none;transition:opacity 0.4s;overflow-y:auto;z-index:100;';
document.body.appendChild(contentEl);

function showContentPanel(nodeId) {
  const p = tesseract.getPanel(nodeId);
  if (!p) return;
  const neighbors = tesseract.getNeighbors(nodeId);
  const ah = '#' + p.biome.accent.toString(16).padStart(6,'0');
  contentEl.innerHTML = `<div style="display:flex;justify-content:space-between"><div style="font-size:20px;font-weight:bold;letter-spacing:1px">${p.title}</div><button onclick="hideContentPanel()" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer">&times;</button></div><div style="font-size:10px;color:#999;margin:8px 0 16px;letter-spacing:2px">${p.path}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;font-size:11px"><span style="border:1px solid ${ah};color:${ah};padding:2px 8px">${p.type}</span><span style="border:1px solid #aaa;padding:2px 8px">${p.folder}</span><span style="border:1px solid #aaa;padding:2px 8px">${p.linkCount} links</span></div>${p.tags.length?'<div style="margin-bottom:12px">'+p.tags.map(t=>'<span style="font-size:10px;color:#666;margin-right:8px">#'+t+'</span>').join('')+'</div>':''}<div style="border-top:1px solid #ddd;padding-top:12px"><div style="font-size:11px;color:#888;letter-spacing:1px;margin-bottom:8px">CONNECTED</div>${neighbors.slice(0,12).map(n=>'<div onclick="window._navigate(\''+n.id+'\')" style="padding:4px 0;font-size:11px;cursor:pointer;color:#444;border-bottom:1px solid #f0f0f0">'+n.title+'</div>').join('')}</div><a href="obsidian://open?vault=The-Hive&file=${encodeURIComponent(p.path.replace('.md',''))}" style="display:block;margin-top:16px;text-align:center;padding:8px;border:1px solid #111;color:#111;text-decoration:none;font-size:11px;letter-spacing:2px">OPEN IN OBSIDIAN</a>`;
  contentEl.style.opacity='1'; contentEl.style.pointerEvents='auto';
}
window.hideContentPanel = function() { contentEl.style.opacity='0'; contentEl.style.pointerEvents='none'; };
// ============ NAV POLLING ============
async function pollNavCommand() {
  try {
    const res = await fetch('/nav-command.json?t='+Date.now());
    if (!res.ok) return;
    const cmd = await res.json();
    if (cmd.timestamp && cmd.timestamp !== lastNavTimestamp && cmd.target) {
      lastNavTimestamp = cmd.timestamp;
      const hits = tesseract.search(cmd.target);
      if (hits.length > 0) {
        const t = document.getElementById('terminal');
        if (t) { t.style.opacity='0'; setTimeout(()=>t.remove(),300); }
        navigateTo(hits[0].id);
      }
    }
  } catch(e) {}
}

// ============ INIT ============
async function init() {
  const res = await fetch('/graph.json');
  const data = await res.json();
  tesseract = new Tesseract(data);
  nav = new Navigator(tesseract);
  console.log('Tesseract:', tesseract.corridors.size, 'corridors,', tesseract.panels.size, 'panels');

  buildWorld();
  buildHub();
  buildBiomeCorridors(tesseract);
  buildBlocks(tesseract);
  buildPanels(tesseract);
  buildAccentPanels(tesseract);
  buildTerminal();
  setInterval(pollNavCommand, 500);
  window.addEventListener('keydown', e => { if(e.key==='Escape') window.hideContentPanel(); });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let lastTime = performance.now();
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = (now - lastTime) / 1000; // seconds, frame-rate independent
    lastTime = now;
    const elapsed = clock.getElapsedTime();
    updateFlight(dt);
    for (const ap of accentPanels) {
      ap.mat.opacity = Math.max(0, Math.sin(elapsed*ap.speed+ap.phase)*ap.maxOpacity);
    }
    if ((!flightState || flightState.done) && !document.getElementById('terminal')) {
      camera.position.y += Math.sin(elapsed*0.4)*0.002;
    }
    renderer.render(scene, camera);
  }
  animate();
  console.log('Tesseract v5 alive.');
}

init().catch(e => console.error('Init failed:', e));