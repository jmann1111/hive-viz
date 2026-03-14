import * as THREE from 'three';

const PHI = 1.618033988749;
const BREATH_CYCLE = PHI + 1.0; // 2.618s

// Use built-in materials that work with InstancedMesh out of the box
export function createBioMaterial(coreColor, shellColor, brightness = 1.0) {
  const c = new THREE.Color(coreColor);
  return new THREE.MeshBasicMaterial({
    color: c,
    transparent: true,
    opacity: 0.7 * brightness,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createWireMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.4,
    wireframe: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// Breathing animation: modulate opacity on phi-ratio timing
export function updateShaderTime(material, time) {
  const t = time % BREATH_CYCLE;
  const breath = t < PHI
    ? t / PHI  // inhale
    : 1.0 - (t - PHI) / 1.0;  // exhale
  const smoothBreath = breath * breath * (3 - 2 * breath); // smoothstep
  if (material.wireframe) {
    material.opacity = 0.2 + smoothBreath * 0.4;
  } else {
    material.opacity = 0.4 + smoothBreath * 0.5;
  }
}
