// Track-based flight. Dead simple. A track = array of keyframes.
// Camera lerps between them. Smooth look filter handles the rest.
// Keyframe: { t, x, y, z, lx, ly, lz }

export function buildTrack(fromPos, destPos, destLook, targetId) {
  const h = targetId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const DIR = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }];
  let heading = h % 4;
  let cx = fromPos.x, cy = fromPos.y, cz = fromPos.z;
  let time = 0;
  const kf = [];

  function look() {
    const d = DIR[heading];
    return { lx: cx + d.x * 60, ly: cy, lz: cz + d.z * 60 };
  }

  function addKF() {
    const l = look();
    kf.push({ t: time, x: cx, y: cy, z: cz, lx: l.lx, ly: l.ly, lz: l.lz });
  }

  function forward(dist, sec) {
    const d = DIR[heading];
    cx += d.x * dist; cz += d.z * dist;
    time += sec;
    addKF();
  }

  function turnRight(sec) {
    // Advance 5 units in old direction, turn, advance 5 in new
    const dOld = DIR[heading];
    cx += dOld.x * 5; cz += dOld.z * 5;
    time += sec * 0.3;
    heading = (heading + 1) % 4;
    const dNew = DIR[heading];
    cx += dNew.x * 5; cz += dNew.z * 5;
    time += sec * 0.7;
    addKF();
  }

  function turnLeft(sec) {
    const dOld = DIR[heading];
    cx += dOld.x * 5; cz += dOld.z * 5;
    time += sec * 0.3;
    heading = (heading + 3) % 4;
    const dNew = DIR[heading];
    cx += dNew.x * 5; cz += dNew.z * 5;
    time += sec * 0.7;
    addKF();
  }

  function drop(dist, sec) {
    cy -= dist; time += sec; addKF();
  }
  function climb(dist, sec) {
    cy += dist; time += sec; addKF();
  }

  // === START KEYFRAME ===
  addKF();

  // === BUILD TRACK VARIANT ===
  const variant = h % 4;

  if (variant === 0) {
    // The Classic: straight, turn right, straight, drop, straight
    forward(80, 1.5);
    turnRight(0.7);
    forward(100, 1.8);
    drop(20, 0.6);
    forward(60, 1.2);
  } else if (variant === 1) {
    // The Snake: short straights with alternating turns
    forward(50, 1.0);
    turnLeft(0.6);
    forward(60, 1.2);
    turnRight(0.6);
    forward(80, 1.5);
    climb(20, 0.6);
    forward(40, 0.8);
  } else if (variant === 2) {
    // The Dive: long straight, drop, turn, long straight
    forward(120, 2.0);
    drop(24, 0.7);
    turnRight(0.6);
    forward(100, 1.8);
    turnLeft(0.6);
    forward(50, 1.0);
  } else {
    // The Elevator: straight, climb, turn, straight, drop, straight
    forward(60, 1.2);
    climb(24, 0.7);
    turnRight(0.6);
    forward(80, 1.5);
    drop(24, 0.7);
    forward(60, 1.2);
  }

  // === FINAL APPROACH: lerp to actual destination over 2 seconds ===
  cx = destPos.x; cy = destPos.y; cz = destPos.z;
  time += 2.0;
  kf.push({
    t: time, x: cx, y: cy, z: cz,
    lx: destLook.x, ly: destLook.y, lz: destLook.z
  });

  return kf;
}
