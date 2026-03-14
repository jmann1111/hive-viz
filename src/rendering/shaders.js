import * as THREE from 'three';

const PHI = 1.618033988749;

// Bioluminescent vertex shader - passes normal and position to fragment
const bioVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vViewPosition = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

// Fragment shader with fresnel glow + breathing
const bioFragmentShader = `
  uniform vec3 uCoreColor;
  uniform vec3 uShellColor;
  uniform float uTime;
  uniform float uBreathPhase;
  uniform float uBrightness;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.0);
    // Phi-ratio breathing: 1.618s inhale, 1.0s exhale (2.618s cycle)
    float cycle = 2.618;
    float t = mod(uTime + uBreathPhase, cycle);
    float breath = t < 1.618
      ? smoothstep(0.0, 1.618, t)
      : 1.0 - smoothstep(1.618, 2.618, t);
    float glow = mix(0.4, 1.0, breath) * uBrightness;
    vec3 core = uCoreColor * glow;
    vec3 edge = uShellColor * fresnel * 1.5;
    vec3 color = core + edge;
    float alpha = mix(0.6, 0.9, fresnel) * glow;
    gl_FragColor = vec4(color, alpha);
  }
`;

// Wireframe shader - simpler, just glowing edges
const wireVertexShader = `
  void main() {
    vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const wireFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uBreathPhase;

  void main() {
    float cycle = 2.618;
    float t = mod(uTime + uBreathPhase, cycle);
    float breath = t < 1.618
      ? smoothstep(0.0, 1.618, t)
      : 1.0 - smoothstep(1.618, 2.618, t);
    float glow = mix(0.3, 0.8, breath);
    gl_FragColor = vec4(uColor * glow, glow * 0.7);
  }
`;

export function createBioMaterial(coreColor, shellColor, brightness = 1.0) {
  return new THREE.ShaderMaterial({
    vertexShader: bioVertexShader,
    fragmentShader: bioFragmentShader,
    uniforms: {
      uCoreColor: { value: new THREE.Color(coreColor) },
      uShellColor: { value: new THREE.Color(shellColor) },
      uTime: { value: 0 },
      uBreathPhase: { value: Math.random() * 2.618 },
      uBrightness: { value: brightness },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createWireMaterial(color) {
  return new THREE.ShaderMaterial({
    vertexShader: wireVertexShader,
    fragmentShader: wireFragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uBreathPhase: { value: Math.random() * 2.618 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    wireframe: true,
  });
}

export function updateShaderTime(material, time) {
  if (material.uniforms?.uTime) {
    material.uniforms.uTime.value = time;
  }
}
