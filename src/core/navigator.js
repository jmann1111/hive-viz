// Pre-baked frame array. Two overlapping smoothsteps = curved corner.
// Every position computed from continuous functions. Zero jumps possible.
// Player just reads frames[i]. Look direction = frames[i+5] - frames[i].

export function generateFlight(fromPos, destPos, destLook) {
  const FPS = 60;
  const dx = destPos.x - fromPos.x;
  const dz = destPos.z - fromPos.z;
  const dy = destPos.y - fromPos.y;
  const dist = Math.sqrt(dx*dx + dz*dz + dy*dy);

  // Duration: 4-10 seconds based on distance
  const totalTime = Math.max(4, Math.min(10, dist / 50 + 3));
  const totalFrames = Math.ceil(totalTime * FPS);

  // Smoothstep
  function ss(t) { const c = Math.max(0, Math.min(1, t)); return c*c*(3-2*c); }

  // Which axis is primary (longer travel)?
  const primaryIsX = Math.abs(dx) >= Math.abs(dz);

  // Two overlapping smoothsteps:
  // Primary axis: 0% to 60% of total time
  // Secondary axis: 40% to 100% of total time
  // Overlap (40-60%) = the natural curved corner
  const frames = [];
  for (let i = 0; i <= totalFrames; i++) {
    const tNorm = i / totalFrames; // 0 to 1

    // Primary: done by 60% mark
    const priT = ss(Math.min(1, tNorm / 0.6));
    // Secondary: starts at 40%, done by 100%
    const secT = ss(Math.max(0, (tNorm - 0.4) / 0.6));
    // Y: smooth arc with overall travel
    const yT = ss(tNorm);
    const yArc = Math.sin(tNorm * Math.PI) * Math.min(8, dist * 0.04);

    let x, z;
    if (primaryIsX) {
      x = fromPos.x + dx * priT;
      z = fromPos.z + dz * secT;
    } else {
      x = fromPos.x + dx * secT;
      z = fromPos.z + dz * priT;
    }
    const y = fromPos.y + dy * yT + yArc;

    frames.push({ x, y, z });
  }

  // Last frame is exactly at destination (no floating point drift)
  frames[frames.length - 1] = {
    x: destPos.x, y: destPos.y, z: destPos.z
  };

  return {
    frames,
    destLook, // player uses this for final ~30 frames
    totalFrames: frames.length,
  };
}
