import * as THREE from 'three';
import { Tesseract } from './core/tesseract.js';

// ============ RENDERER + SCENE ============
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);
scene.fog = new THREE.Fog(0xf0f0f0, 300, 2500);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 35, -10);
camera.lookAt(0, 20, 40);

let tesseract = null;
let currentPanel = null;
let flightState = null;
let lastNavTimestamp = 0;
const clock = new THREE.Clock();
let accentPanels = [];

function addLine(pos, col, x1,y1,z1, x2,y2,z2, c) {
  pos.push(x1,y1,z1, x2,y2,z2);
  col.push(c.r,c.g,c.b, c.r,c.g,c.b);
}
function makeLines(pos, col) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
}
// ============ HUB: FLOATING PYRAMID NEXUS ============
function buildHub() {
  const pos = [], col = [];
  const w = new THREE.Color(0xcccccc);
  const d = new THREE.Color(0x888888);
  const dk = new THREE.Color(0x333333);
  // Inverted pyramid (ref: 044_hub)
  const top = 20, bot = 8, half = 8, depth = 5;
  // Top face (platform)
  addLine(pos,col, -half,top,-half, half,top,-half, dk);
  addLine(pos,col, half,top,-half, half,top,half, dk);
  addLine(pos,col, half,top,half, -half,top,half, dk);
  addLine(pos,col, -half,top,half, -half,top,-half, dk);
  // Grid on top surface
  for (let x = -half; x <= half; x += 2) {
    addLine(pos,col, x,top,-half, x,top,half, w);
    addLine(pos,col, -half,top,x, half,top,x, w);
  }
  // Pyramid edges down to point
  addLine(pos,col, -half,top,-half, 0,bot,0, d);
  addLine(pos,col, half,top,-half, 0,bot,0, d);
  addLine(pos,col, half,top,half, 0,bot,0, d);
  addLine(pos,col, -half,top,half, 0,bot,0, d);
  // Radiating lines from platform into the void (all directions)
  const rayCount = 24;
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2;
    const reach = 600 + Math.random() * 400;
    const rx = Math.cos(angle) * reach;
    const rz = Math.sin(angle) * reach;
    const ry = top + (Math.random() - 0.5) * 4;
    addLine(pos,col, 0,top,0, rx,ry,rz, new THREE.Color(0xdddddd));
  }  // Vertical shafts down into darkness below hub
  for (let i = 0; i < 4; i++) {
    const ox = (i < 2 ? -1 : 1) * 5;
    const oz = (i % 2 === 0 ? -1 : 1) * 5;
    for (let y = bot; y > -80; y -= 3) {
      addLine(pos,col, ox-1,y,oz-1, ox+1,y,oz-1, d);
      addLine(pos,col, ox+1,y,oz-1, ox+1,y,oz+1, d);
      addLine(pos,col, ox+1,y,oz+1, ox-1,y,oz+1, d);
      addLine(pos,col, ox-1,y,oz+1, ox-1,y,oz-1, d);
    }
    addLine(pos,col, ox,bot,oz, ox,-80,oz, dk);
  }
  scene.add(makeLines(pos, col));
}

// ============ BIOME CORRIDOR RENDERER ============
function buildBiomeCorridor(folder, corridor, t) {
  const pos = [], col = [];
  const { biome, yOffset, length } = corridor;
  const w2 = biome.width / 2;
  const h = biome.height;
  const y0 = yOffset, y1 = yOffset + h;
  const dk = new THREE.Color(biome.lineDark);
  const md = new THREE.Color(biome.lineColor);
  const lt = new THREE.Color(biome.lineColor).lerp(new THREE.Color(0xffffff), 0.4);
  const L = length * biome.sign;
  // Rail lines (always present, define the corridor edges)
  if (biome.axis === 'x') {
    addLine(pos,col, 0,y0,-w2, L,y0,-w2, dk);
    addLine(pos,col, 0,y0,w2, L,y0,w2, dk);
    addLine(pos,col, 0,y1,-w2, L,y1,-w2, dk);
    addLine(pos,col, 0,y1,w2, L,y1,w2, dk);
  } else {
    addLine(pos,col, -w2,y0,0, -w2,y0,L, dk);
    addLine(pos,col, w2,y0,0, w2,y0,L, dk);
    addLine(pos,col, -w2,y1,0, -w2,y1,L, dk);
    addLine(pos,col, w2,y1,0, w2,y1,L, dk);
  }

  // Cross-sections based on biome style
  const step = biome.gridStep;
  const steps = Math.ceil(length / step);
  for (let i = 0; i <= steps; i++) {
    const d = (i / steps) * L;
    const c = (i % 4 === 0) ? dk : md;
    if (biome.axis === 'x') {
      // Verticals
      addLine(pos,col, d,y0,-w2, d,y1,-w2, c);
      addLine(pos,col, d,y0,w2, d,y1,w2, c);
      // Floor + ceiling
      addLine(pos,col, d,y0,-w2, d,y0,w2, c);
      addLine(pos,col, d,y1,-w2, d,y1,w2, c);    } else {
      addLine(pos,col, -w2,y0,d, -w2,y1,d, c);
      addLine(pos,col, w2,y0,d, w2,y1,d, c);
      addLine(pos,col, -w2,y0,d, w2,y0,d, c);
      addLine(pos,col, -w2,y1,d, w2,y1,d, c);
    }
  }

  // Dense-grid style: extra internal subdivisions (ref: 011_antichamber)
  if (biome.style === 'dense-grid') {
    const subStep = step * 0.4;
    const subSteps = Math.ceil(length / subStep);
    const sub = new THREE.Color(biome.lineColor).lerp(new THREE.Color(0xffffff), 0.2);
    for (let i = 0; i <= subSteps; i++) {
      const d = (i / subSteps) * L;
      // Extra horizontal lines at varying heights
      const midY = y0 + h * (0.3 + Math.sin(i * 0.7) * 0.2);
      if (biome.axis === 'x') {
        addLine(pos,col, d,midY,-w2, d,midY,w2, sub);
      } else {
        addLine(pos,col, -w2,midY,d, w2,midY,d, sub);
      }
    }
  }
  // Dark runway style: floor grid is dark, ceiling fades to light (ref: 023_biome)
  if (biome.darkFloor) {
    const darkF = new THREE.Color(0x333333);
    const floorStep = 2;
    const floorSteps = Math.ceil(length / floorStep);
    for (let i = 0; i <= floorSteps; i++) {
      const d = (i / floorSteps) * L;
      if (biome.axis === 'x') {
        addLine(pos,col, d,y0,-w2, d,y0,w2, darkF);
      } else {
        addLine(pos,col, -w2,y0,d, w2,y0,d, darkF);
      }
    }
    // Side floor rails
    for (let z = -w2; z <= w2; z += floorStep) {
      if (biome.axis === 'x') {
        addLine(pos,col, 0,y0,z, L,y0,z, darkF);
      } else {
        addLine(pos,col, z,y0,0, z,y0,L, darkF);
      }
    }
  }

  scene.add(makeLines(pos, col));
}
// ============ BLOCK TOWERS (Knowledge block-city, Projects saturated) ============
function buildBlocks(t) {
  for (const block of t.blocks) {
    const { pos, width, depth, height, color } = block;
    const bpos = [], bcol = [];
    const c = new THREE.Color(color);
    const x = pos.x, y = pos.y, z = pos.z;
    const w2 = width/2, d2 = depth/2;
    // Vertical edges
    addLine(bpos,bcol, x-w2,y,z-d2, x-w2,y+height,z-d2, c);
    addLine(bpos,bcol, x+w2,y,z-d2, x+w2,y+height,z-d2, c);
    addLine(bpos,bcol, x+w2,y,z+d2, x+w2,y+height,z+d2, c);
    addLine(bpos,bcol, x-w2,y,z+d2, x-w2,y+height,z+d2, c);
    // Top face
    addLine(bpos,bcol, x-w2,y+height,z-d2, x+w2,y+height,z-d2, c);
    addLine(bpos,bcol, x+w2,y+height,z-d2, x+w2,y+height,z+d2, c);
    addLine(bpos,bcol, x+w2,y+height,z+d2, x-w2,y+height,z+d2, c);
    addLine(bpos,bcol, x-w2,y+height,z+d2, x-w2,y+height,z-d2, c);
    // Bottom face
    addLine(bpos,bcol, x-w2,y,z-d2, x+w2,y,z-d2, c);
    addLine(bpos,bcol, x+w2,y,z-d2, x+w2,y,z+d2, c);
    addLine(bpos,bcol, x+w2,y,z+d2, x-w2,y,z+d2, c);
    addLine(bpos,bcol, x-w2,y,z+d2, x-w2,y,z-d2, c);
    // Horizontal subdivisions (every 4 units up the block)
    for (let hy = 4; hy < height; hy += 4) {      const lc = c.clone().lerp(new THREE.Color(0xffffff), 0.3);
      addLine(bpos,bcol, x-w2,y+hy,z-d2, x+w2,y+hy,z-d2, lc);
      addLine(bpos,bcol, x+w2,y+hy,z-d2, x+w2,y+hy,z+d2, lc);
      addLine(bpos,bcol, x+w2,y+hy,z+d2, x-w2,y+hy,z+d2, lc);
      addLine(bpos,bcol, x-w2,y+hy,z+d2, x-w2,y+hy,z-d2, lc);
    }
    // For saturated blocks, add solid-looking face fills
    if (block.biome.style === 'saturated-blocks') {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.7,
        side: THREE.DoubleSide, depthWrite: false
      });
      const geo = new THREE.BoxGeometry(width, height, depth);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y + height/2, z);
      scene.add(mesh);
    }
    scene.add(makeLines(bpos, bcol));
  }
}

// ============ FILE PANELS ON WALLS ============
function buildPanels(t) {
  const pos = [], col = [];
  const PW = 1.5, PH = 2;  for (const [id, p] of t.panels) {
    const biome = p.biome;
    const c = p.linkCount > 5 ? new THREE.Color(biome.lineDark) : new THREE.Color(biome.lineColor);
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
  scene.add(makeLines(pos, col));
}

// ============ ACCENT PANELS (biome-aware, inside corridors) ============
function buildAccentPanels(t) {
  const ACCENTS = [0x6644aa, 0x4477cc, 0xcc8833, 0x44aa88, 0xcc4466, 0x88bbdd];
  for (const [folder, corridor] of t.corridors) {
    const { biome, yOffset, length } = corridor;
    const accent = biome.accent;
    const count = Math.floor(length * 0.15);    const w2 = biome.width / 2;
    for (let i = 0; i < count; i++) {
      const t2 = (i + 0.5) / count;
      const dist = 20 + t2 * length;
      const geo = new THREE.PlaneGeometry(1.5 + Math.random() * 3, 1.5 + Math.random() * 4);
      const mat = new THREE.MeshBasicMaterial({
        color: accent, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      const side = Math.random() > 0.5 ? 1 : -1;
      if (biome.axis === 'x') {
        mesh.position.set(biome.sign * dist, yOffset + Math.random() * biome.height, side * (w2 - 0.2));
        mesh.rotation.y = Math.PI / 2;
      } else {
        mesh.position.set(side * (w2 - 0.2), yOffset + Math.random() * biome.height, biome.sign * dist);
      }
      scene.add(mesh);
      accentPanels.push({
        mesh, mat,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.5,
        maxOpacity: 0.1 + Math.random() * 0.2
      });
    }
  }
}
// ============ INFINITE 3D LATTICE: Corridors at every Y level, colored zones, full skybox ============
function buildBackgroundGrid() {
  function hash(a, b) { return Math.abs(Math.sin(a * 127.1 + b * 311.7) * 43758.5453) % 1; }
  function hash3(a, b, c) { return Math.abs(Math.sin(a * 73.1 + b * 157.3 + c * 239.7) * 43758.5453) % 1; }

  const pos = [], col = [];
  const range = 500;
  const cellXZ = 20;
  const yLevels = [-40, -20, 0, 20, 40, 60, 80];
  const crossStep = 5;
  const ZONE_PALETTES = [
    [0xcc3333, 0xdd5533, 0xee7733],
    [0x3366cc, 0x4488dd, 0x55aaee],
    [0x33aa66, 0x44cc77, 0x55dd88],
    [0xcc33aa, 0xdd55bb, 0xee77cc],
    [0xddaa33, 0xeecc44, 0xffdd55],
    [0x33aacc, 0x44ccdd, 0x55ddee],
    [0x8844cc, 0x9966dd, 0xaa88ee],
  ];
  function ghostColor(dist) {
    const t = Math.min(dist / range, 1);
    return new THREE.Color(0.78 + t * 0.15, 0.78 + t * 0.15, 0.78 + t * 0.15);
  }
  for (const baseY of yLevels) {
    for (let gx = -range; gx <= range; gx += cellXZ) {
      for (let gz = -range; gz <= range; gz += cellXZ) {
        const h = hash(gx, gz + baseY);
        const h2 = hash(gx + baseY, gz);
        const dist = Math.sqrt(gx*gx + gz*gz);
        const gc = ghostColor(dist);
        if (hash3(gx, gz, baseY) < 0.3 && baseY !== 0) continue;
        const ceilH = 6 + h * 14;
        const w = 1.5 + h2 * 3;
        const y0 = baseY, y1 = baseY + ceilH;
        const isColorZone = hash3(gx * 0.1, gz * 0.1, baseY * 0.3) > 0.82;
        let lc = gc;
        if (isColorZone) {
          const palette = ZONE_PALETTES[Math.floor(hash3(gx, gz, baseY + 1) * ZONE_PALETTES.length)];
          lc = new THREE.Color(palette[Math.floor(h * palette.length)]);
          const bw = w * 2 + h * 4, bh = ceilH * (0.5 + h * 0.5), bd = w * 2 + h2 * 4;
          const mat = new THREE.MeshBasicMaterial({ color: lc, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
          mesh.position.set(gx, baseY + bh/2, gz);
          scene.add(mesh);
        }
        // Z corridor
        const zLen = 60 + h * 80, z0 = gz - zLen/2, z1 = gz + zLen/2;
        addLine(pos,col, gx-w,y0,z0, gx-w,y0,z1, lc); addLine(pos,col, gx+w,y0,z0, gx+w,y0,z1, lc);
        addLine(pos,col, gx-w,y1,z0, gx-w,y1,z1, lc); addLine(pos,col, gx+w,y1,z0, gx+w,y1,z1, lc);
        for (let z = z0; z <= z1; z += crossStep) {
          addLine(pos,col, gx-w,y0,z, gx-w,y1,z, lc); addLine(pos,col, gx+w,y0,z, gx+w,y1,z, lc);
          addLine(pos,col, gx-w,y0,z, gx+w,y0,z, lc); addLine(pos,col, gx-w,y1,z, gx+w,y1,z, lc);
        }
        // X corridor
        const xLen = 60 + h2 * 80, x0 = gx - xLen/2, x1 = gx + xLen/2;
        addLine(pos,col, x0,y0,gz-w, x1,y0,gz-w, lc); addLine(pos,col, x0,y0,gz+w, x1,y0,gz+w, lc);
        addLine(pos,col, x0,y1,gz-w, x1,y1,gz-w, lc); addLine(pos,col, x0,y1,gz+w, x1,y1,gz+w, lc);
        for (let x = x0; x <= x1; x += crossStep) {
          addLine(pos,col, x,y0,gz-w, x,y1,gz-w, lc); addLine(pos,col, x,y0,gz+w, x,y1,gz+w, lc);
          addLine(pos,col, x,y0,gz-w, x,y0,gz+w, lc); addLine(pos,col, x,y1,gz-w, x,y1,gz+w, lc);
        }
        // Corner columns
        addLine(pos,col, gx-w,y0,gz-w, gx-w,y1,gz-w, lc); addLine(pos,col, gx+w,y0,gz-w, gx+w,y1,gz-w, lc);
        addLine(pos,col, gx+w,y0,gz+w, gx+w,y1,gz+w, lc); addLine(pos,col, gx-w,y0,gz+w, gx-w,y1,gz+w, lc);
        // Vertical shafts to next level (~15%)
        if (h > 0.85 && baseY < 60) {
          const st = baseY + 30, sw = 1.5, sc = ghostColor(dist * 0.7);
          addLine(pos,col, gx-sw,y1,gz-sw, gx-sw,st,gz-sw, sc); addLine(pos,col, gx+sw,y1,gz-sw, gx+sw,st,gz-sw, sc);
          addLine(pos,col, gx+sw,y1,gz+sw, gx+sw,st,gz+sw, sc); addLine(pos,col, gx-sw,y1,gz+sw, gx-sw,st,gz+sw, sc);
          for (let sy = y1 + 5; sy < st; sy += 5) {
            addLine(pos,col, gx-sw,sy,gz-sw, gx+sw,sy,gz-sw, sc); addLine(pos,col, gx+sw,sy,gz-sw, gx+sw,sy,gz+sw, sc);
            addLine(pos,col, gx+sw,sy,gz+sw, gx-sw,sy,gz+sw, sc); addLine(pos,col, gx-sw,sy,gz+sw, gx-sw,sy,gz-sw, sc);
          }
        }
        // Floating platforms (~10%)
        if (h2 > 0.9) {
          const platY = baseY + ceilH + 5 + h * 20, pw = 3 + h * 5;
          const pc = isColorZone ? lc : ghostColor(dist * 0.6);
          addLine(pos,col, gx-pw,platY,gz-pw, gx+pw,platY,gz-pw, pc); addLine(pos,col, gx+pw,platY,gz-pw, gx+pw,platY,gz+pw, pc);
          addLine(pos,col, gx+pw,platY,gz+pw, gx-pw,platY,gz+pw, pc); addLine(pos,col, gx-pw,platY,gz+pw, gx-pw,platY,gz-pw, pc);
        }
      }
    }
  }
  // Floor grid
  const fg = new THREE.Color(0xdddddd);
  for (let x = -range; x <= range; x += 8) {
    addLine(pos,col, x,0,-range, x,0,range, fg); addLine(pos,col, -range,0,x, range,0,x, fg);
  }
  scene.add(makeLines(pos, col));
}
// ============ LANDING TERMINAL ============
function buildTerminal() {
  const terminal = document.createElement('div');
  terminal.id = 'terminal';
  terminal.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    z-index:200;font-family:'Courier New',monospace;pointer-events:auto;`;
  terminal.innerHTML = `
    <div style="text-align:center;margin-bottom:40px">
      <div style="font-size:11px;letter-spacing:8px;color:#888;margin-bottom:8px">THE</div>
      <div style="font-size:42px;letter-spacing:14px;color:#111;font-weight:200">TESSERACT</div>
      <div style="font-size:10px;letter-spacing:4px;color:#aaa;margin-top:12px">A NAVIGABLE DIMENSION</div>
    </div>
    <div style="position:relative;width:420px">
      <input id="search-input" type="text" placeholder="where do you want to go?"
        style="width:100%;padding:16px 24px;background:transparent;border:1px solid #bbb;
        color:#111;font-family:inherit;font-size:14px;letter-spacing:2px;outline:none;
        text-align:center;" autocomplete="off" />
      <div id="search-results" style="position:absolute;top:100%;left:0;right:0;
        max-height:300px;overflow-y:auto;border:1px solid #ddd;border-top:none;
        display:none;background:#f5f5f5;"></div>
    </div>
    <div style="font-size:9px;color:#ccc;margin-top:20px;letter-spacing:3px">
      TYPE A KEYWORD. CLICK TO FLY.
    </div>
  `;
  document.body.appendChild(terminal);  const input = document.getElementById('search-input');
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
      const hits = tesseract.search(input.value.trim());
      if (hits.length > 0) window._launchTo(hits[0].id);
    }
  });
  setTimeout(() => input.focus(), 100);
}
// ============ LAUNCH + NAVIGATION ============
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
  const from = camera.position.clone();
  const eyeY = panel.pos.y + 1.8;
  const standX = panel.pos.x + (panel.normal.x || 0) * 5;
  const standZ = panel.pos.z + (panel.normal.z || 0) * 5;
  const dest = new THREE.Vector3(standX, eyeY, standZ);
  const dx = dest.x - from.x, dy = dest.y - from.y, dz = dest.z - from.z;
  const flatDist = Math.sqrt(dx*dx + dz*dz);
  const totalDist = Math.sqrt(dx*dx + dy*dy + dz*dz);

  // TRUE 3D FLIGHT: S-curve through space with lateral offset for drama
  // Perpendicular offset so camera sweeps THROUGH corridors, not over them
  const perpX = -dz / (flatDist || 1); // perpendicular to travel direction
  const perpZ = dx / (flatDist || 1);
  const sweepDist = Math.min(flatDist * 0.2, 60); // how far to the side it sweeps

  // 5 waypoints: start, sweep-out, apex, sweep-in, destination
  const t1 = 0.25, t2 = 0.5, t3 = 0.75;
  const arcH = Math.min(totalDist * 0.12, 35);
  const wp1 = new THREE.Vector3(
    from.x + dx * t1 + perpX * sweepDist,
    from.y + dy * t1 + arcH * 0.7,
    from.z + dz * t1 + perpZ * sweepDist
  );
  const wp2 = new THREE.Vector3(
    from.x + dx * t2,
    Math.max(from.y, eyeY) + arcH,
    from.z + dz * t2
  );
  const wp3 = new THREE.Vector3(
    from.x + dx * t3 - perpX * sweepDist * 0.5,
    from.y + dy * t3 + arcH * 0.3,
    from.z + dz * t3 - perpZ * sweepDist * 0.5
  );

  const waypoints = [from.clone(), wp1, wp2, wp3, dest.clone()];
  const curve = new THREE.CatmullRomCurve3(waypoints, false, 'catmullrom', 0.4);
  const duration = 5 + Math.min(5, totalDist / 100);

  flightState = {
    curve, duration,
    lookTarget: new THREE.Vector3(panel.pos.x, panel.pos.y, panel.pos.z),
    startTime: clock.getElapsedTime(),
  };
  currentPanel = targetId;
}
// ============ FLIGHT UPDATE: Hawk soaring, wormhole phases ============
function updateFlight(elapsed) {
  if (!flightState) return;
  const rawT = (elapsed - flightState.startTime) / flightState.duration;

  if (rawT >= 1.0) {
    // Arrival: snap to final position, face the panel cleanly
    camera.position.copy(flightState.curve.getPoint(1.0));
    camera.lookAt(flightState.lookTarget);
    camera.rotation.z = 0;
    flightState = null;
    showContentPanel(currentPanel);
    return;
  }

  // Smooth S-curve easing (no jerks, no sudden changes)
  // Uses smoothstep: 3t^2 - 2t^3. Starts slow, accelerates, decelerates.
  const t = Math.max(0, Math.min(1, rawT));
  const ease = t * t * (3 - 2 * t);

  // Position along the curve
  camera.position.copy(flightState.curve.getPoint(ease));

  // LOOK DIRECTION: Three phases like a wormhole
  // Phase 1 (0-70%): Look ahead along the flight path (soaring)
  // Phase 2 (70-90%): Gradually blend from path-ahead to panel target
  // Phase 3 (90-100%): Lock onto panel target (smooth arrival)
  const lookAheadT = Math.min(ease + 0.06, 1.0);
  const pathLookPt = flightState.curve.getPoint(lookAheadT);

  if (t < 0.7) {
    // Phase 1: Pure soaring, look where you're going
    camera.lookAt(pathLookPt);
  } else if (t < 0.9) {
    // Phase 2: Blend from path direction to target panel
    const blend = (t - 0.7) / 0.2; // 0 to 1 over this range
    const smoothBlend = blend * blend * (3 - 2 * blend);
    const lx = pathLookPt.x + (flightState.lookTarget.x - pathLookPt.x) * smoothBlend;
    const ly = pathLookPt.y + (flightState.lookTarget.y - pathLookPt.y) * smoothBlend;
    const lz = pathLookPt.z + (flightState.lookTarget.z - pathLookPt.z) * smoothBlend;
    camera.lookAt(lx, ly, lz);
  } else {
    // Phase 3: Locked on target, smooth arrival
    camera.lookAt(flightState.lookTarget);
  }

  // Gentle camera roll: proportional to lateral velocity, very subtle
  if (t > 0.05 && t < 0.9) {
    const tangent = flightState.curve.getTangent(ease);
    // Roll based on how much we're turning (change in heading)
    const targetRoll = Math.atan2(tangent.x, tangent.z) * 0.12;
    // Smooth the roll with lerp toward target
    camera.rotation.z += (targetRoll - camera.rotation.z) * 0.03;
  } else {
    // Ease roll back to zero at start and end
    camera.rotation.z *= 0.9;
  }
}
// ============ CONTENT PANEL ============
const contentEl = document.createElement('div');
contentEl.id = 'content-panel';
contentEl.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
  width:500px;max-height:70vh;background:rgba(245,245,245,0.96);
  border:1px solid #111;padding:32px;font-family:'Courier New',monospace;
  color:#111;opacity:0;pointer-events:none;transition:opacity 0.4s;
  overflow-y:auto;z-index:100;`;
document.body.appendChild(contentEl);

function showContentPanel(nodeId) {
  const p = tesseract.getPanel(nodeId);
  if (!p) return;
  const neighbors = tesseract.getNeighbors(nodeId);
  const accentHex = '#' + p.biome.accent.toString(16).padStart(6, '0');
  contentEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div style="font-size:20px;font-weight:bold;letter-spacing:1px">${p.title}</div>
      <button onclick="hideContentPanel()" style="background:none;border:none;color:#888;
        font-size:18px;cursor:pointer;padding:0 4px">&times;</button>
    </div>
    <div style="font-size:10px;color:#999;margin:8px 0 16px;letter-spacing:2px">${p.path}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;font-size:11px">
      <span style="border:1px solid ${accentHex};color:${accentHex};padding:2px 8px">${p.type}</span>
      <span style="border:1px solid #aaa;padding:2px 8px">${p.folder}</span>
      <span style="border:1px solid #aaa;padding:2px 8px">${p.wordCount}w</span>
      <span style="border:1px solid #aaa;padding:2px 8px">${p.linkCount} links</span>
    </div>    ${p.tags.length ? '<div style="margin-bottom:12px">' + p.tags.map(t =>
      '<span style="font-size:10px;color:#666;margin-right:8px">#'+t+'</span>').join('') + '</div>' : ''}
    <div style="font-size:10px;color:#aaa;margin-bottom:12px">${p.created}</div>
    <div style="border-top:1px solid #ddd;padding-top:12px">
      <div style="font-size:11px;color:#888;letter-spacing:1px;margin-bottom:8px">CONNECTED</div>
      ${neighbors.slice(0,12).map(n =>
        '<div onclick="window._navigate(\''+n.id+'\')" style="padding:4px 0;font-size:11px;cursor:pointer;color:#444;border-bottom:1px solid #f0f0f0">'+n.title+'</div>'
      ).join('')}
      ${neighbors.length > 12 ? '<div style="color:#aaa;font-size:10px;margin-top:4px">+' + (neighbors.length-12) + ' more</div>' : ''}
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
// ============ NAV COMMAND POLLING ============
async function pollNavCommand() {
  try {
    const res = await fetch('/nav-command.json?t=' + Date.now());
    if (!res.ok) return;
    const cmd = await res.json();
    if (cmd.timestamp && cmd.timestamp !== lastNavTimestamp && cmd.target) {
      lastNavTimestamp = cmd.timestamp;
      const hits = tesseract.search(cmd.target);
      if (hits.length > 0) {
        const terminal = document.getElementById('terminal');
        if (terminal) { terminal.style.opacity='0'; setTimeout(()=>terminal.remove(),300); }
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
  console.log(`Loaded: ${tesseract.corridors.size} biome corridors, ${tesseract.panels.size} panels, ${tesseract.blocks.length} blocks`);

  buildBackgroundGrid();
  buildHub();  // Build each biome corridor
  for (const [folder, corridor] of tesseract.corridors) {
    buildBiomeCorridor(folder, corridor, tesseract);
  }
  buildBlocks(tesseract);
  buildPanels(tesseract);
  buildAccentPanels(tesseract);
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
    }    // Gentle camera bob when idle
    if (!flightState && !document.getElementById('terminal')) {
      camera.position.y += Math.sin(elapsed * 0.4) * 0.003;
    }
    renderer.render(scene, camera);
  }
  animate();
  console.log('The Tesseract v3 is alive. Biome worlds loaded.');
}

init().catch(e => console.error('Init failed:', e));