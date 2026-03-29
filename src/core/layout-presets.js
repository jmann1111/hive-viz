export const LAYOUT_PRESETS = Object.freeze([
  'cluster',
  'sphere',
  'halo-ring',
  'helix',
  'dna',
  'sacred',
  'diamond',
  'pyramid',
  'crown',
  'temporal-spiral',
]);

const PRESET_ALIASES = new Map([
  ['cluster', 'cluster'],
  ['organic', 'cluster'],
  ['basic', 'cluster'],
  ['sphere', 'sphere'],
  ['halo-ring', 'halo-ring'],
  ['halo_ring', 'halo-ring'],
  ['haloring', 'halo-ring'],
  ['ring', 'halo-ring'],
  ['halo', 'halo-ring'],
  ['helix', 'helix'],
  ['dna', 'dna'],
  ['sacred', 'sacred'],
  ['sacred-geometry', 'sacred'],
  ['sacred_geometry', 'sacred'],
  ['diamond', 'diamond'],
  ['diamond-shape', 'diamond'],
  ['diamond_shape', 'diamond'],
  ['pyramid', 'pyramid'],
  ['pyramid-shape', 'pyramid'],
  ['pyramid_shape', 'pyramid'],
  ['pyramidal', 'pyramid'],
  ['crown', 'crown'],
  ['corona', 'crown'],
  ['temporal-spiral', 'temporal-spiral'],
  ['temporal_spiral', 'temporal-spiral'],
  ['temporalspiral', 'temporal-spiral'],
  ['temporal', 'temporal-spiral'],
  ['spiral', 'temporal-spiral'],
]);

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hashFloat(input) {
  const value = String(input || '');
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function fibonacciPoint(index, count, radius = 1) {
  const safeCount = Math.max(1, count);
  const t = (index + 0.5) / safeCount;
  const y = 1 - (2 * t);
  const ringRadius = Math.sqrt(Math.max(0, 1 - (y * y)));
  const theta = GOLDEN_ANGLE * index;
  return {
    x: Math.cos(theta) * ringRadius * radius,
    y: y * radius,
    z: Math.sin(theta) * ringRadius * radius,
  };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function scale(vector, factor) {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
    z: vector.z * factor,
  };
}

function sphericalBasis(normal) {
  const up = Math.abs(normal.y) > 0.85
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  const right = normalizeVector(cross(normal, up));
  const forward = normalizeVector(cross(right, normal));
  return { right, forward };
}

function nodeNoise(record, seed, salt) {
  return hashFloat(`${seed}:${record.id}:${salt}`);
}

function withJitter(base, record, seed, amount = 0.04) {
  const jitter = {
    x: ((nodeNoise(record, seed, 'jx') * 2) - 1) * amount,
    y: ((nodeNoise(record, seed, 'jy') * 2) - 1) * amount,
    z: ((nodeNoise(record, seed, 'jz') * 2) - 1) * amount,
  };
  return add(base, jitter);
}

function compareRecords(a, b) {
  if (a.folderIndex !== b.folderIndex) return a.folderIndex - b.folderIndex;
  if (a.degree !== b.degree) return b.degree - a.degree;
  if (a.timeRank !== b.timeRank) return a.timeRank - b.timeRank;
  return a.hash - b.hash;
}

function groupByFolder(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.folder)) groups.set(record.folder, []);
    groups.get(record.folder).push(record);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, group]) => ({
      folder,
      records: group.sort(compareRecords),
    }));
}

function buildCluster(records, seed) {
  const groups = groupByFolder(records);
  const positions = new Map();
  const groupCount = Math.max(1, groups.length);

  groups.forEach((group, groupIndex) => {
    const anchor = fibonacciPoint(groupIndex, groupCount, 0.84);
    const normal = normalizeVector(anchor);
    const { right, forward } = sphericalBasis(normal);

    group.records.forEach((record, localIndex) => {
      const orbit = Math.sqrt(localIndex / Math.max(1, group.records.length - 1 || 1));
      const angle = (localIndex * GOLDEN_ANGLE) + (nodeNoise(record, seed, 'group-phase') * 0.6);
      const lane = 0.08 + (orbit * (0.25 + record.degreeWeight * 0.08));
      const vertical = ((nodeNoise(record, seed, 'group-lift') * 2) - 1) * 0.09;
      const radial = add(
        add(scale(right, Math.cos(angle) * lane), scale(forward, Math.sin(angle) * lane)),
        scale(normal, vertical),
      );
      positions.set(record.id, withJitter(add(scale(normal, 0.88), radial), record, seed, 0.018));
    });
  });

  return positions;
}

function buildSphere(records, seed) {
  const sorted = [...records].sort(compareRecords);
  const positions = new Map();
  const count = Math.max(1, sorted.length);

  sorted.forEach((record, index) => {
    const shell = 0.88 + (record.folderBand * 0.17) + (record.degreeWeight * 0.06);
    positions.set(record.id, withJitter(fibonacciPoint(index, count, shell), record, seed, 0.016));
  });

  return positions;
}

function buildHaloRing(records, seed) {
  const sorted = [...records].sort(compareRecords);
  const positions = new Map();
  const count = Math.max(1, sorted.length);

  sorted.forEach((record, index) => {
    const t = index / count;
    const angle = (t * TAU) + (record.folderBand * 0.38);
    const major = 1.02 + (record.folderBand * 0.12);
    const minor = 0.14 + (record.degreeWeight * 0.08);
    const tubeAngle = (record.hash * TAU) + (nodeNoise(record, seed, 'tube') * 0.4);
    const radius = major + (Math.cos(tubeAngle) * minor);
    const position = {
      x: Math.cos(angle) * radius,
      y: Math.sin(tubeAngle) * minor * 0.9,
      z: Math.sin(angle) * radius,
    };
    positions.set(record.id, withJitter(position, record, seed, 0.014));
  });

  return positions;
}

function buildHelix(records, seed) {
  const sorted = [...records].sort(compareRecords);
  const positions = new Map();
  const count = Math.max(1, sorted.length);
  const turns = 3.75;

  sorted.forEach((record, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const angle = (t * turns * TAU) + (record.folderBand * 0.26);
    const radius = 0.56 + (record.folderBand * 0.28) + (record.degreeWeight * 0.06);
    const y = -1.16 + (2.32 * t);
    const position = {
      x: Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
    };
    positions.set(record.id, withJitter(position, record, seed, 0.012));
  });

  return positions;
}

function buildDna(records, seed) {
  const sorted = [...records].sort(compareRecords);
  const positions = new Map();
  const count = Math.max(1, sorted.length);
  const turns = 4.3;

  sorted.forEach((record, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const strand = record.hash > 0.5 ? 1 : -1;
    const angle = (t * turns * TAU) + (strand > 0 ? 0 : Math.PI);
    const radius = 0.48 + (record.folderBand * 0.12);
    const y = -1.18 + (2.36 * t);
    const position = {
      x: Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
    };
    const rung = ((nodeNoise(record, seed, 'rung') * 2) - 1) * 0.05;
    positions.set(record.id, withJitter({
      x: position.x + (strand * rung),
      y: position.y,
      z: position.z - (strand * rung),
    }, record, seed, 0.012));
  });

  return positions;
}

function buildSacred(records, seed) {
  const anchors = [
    { x: 0, y: 0, z: 0 },
    ...Array.from({ length: 12 }, (_, index) => fibonacciPoint(index, 12, 0.98)),
  ];
  const groups = new Map();
  const positions = new Map();

  for (const record of records) {
    const anchorIndex = Math.floor(nodeNoise(record, seed, 'anchor') * anchors.length) % anchors.length;
    if (!groups.has(anchorIndex)) groups.set(anchorIndex, []);
    groups.get(anchorIndex).push(record);
  }

  for (const [anchorIndex, group] of groups.entries()) {
    const anchor = anchors[anchorIndex];
    const normal = normalizeVector(Math.hypot(anchor.x, anchor.y, anchor.z) < 0.01 ? { x: 0, y: 1, z: 0 } : anchor);
    const { right, forward } = sphericalBasis(normal);
    group.sort(compareRecords).forEach((record, localIndex) => {
      const ring = 0.06 + (Math.sqrt(localIndex) * 0.045);
      const angle = (localIndex * (TAU / 6)) + (nodeNoise(record, seed, 'petal') * 0.5);
      const position = add(
        scale(normal, anchorIndex === 0 ? 0 : 0.96),
        add(scale(right, Math.cos(angle) * ring), scale(forward, Math.sin(angle) * ring)),
      );
      positions.set(record.id, withJitter(position, record, seed, 0.012));
    });
  }

  return positions;
}

function buildDiamond(records, seed) {
  const sorted = [...records].sort(compareRecords);
  const positions = new Map();
  const count = Math.max(1, sorted.length);
  const apexAngles = [
    Math.PI / 4,
    (Math.PI * 3) / 4,
    (Math.PI * 5) / 4,
    (Math.PI * 7) / 4,
  ];

  sorted.forEach((record, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const vertical = 1 - (t * 2);
    const silhouette = Math.pow(Math.max(0, 1 - Math.abs(vertical)), 0.72);
    const baseRadius = 0.24 + (silhouette * (0.92 + (record.folderBand * 0.18) + (record.degreeWeight * 0.08)));
    const facet = Math.floor(nodeNoise(record, seed, 'diamond-facet') * apexAngles.length) % apexAngles.length;
    const phase = (nodeNoise(record, seed, 'diamond-phase') * 0.6) - 0.3;
    const angle = apexAngles[facet] + phase + ((index / Math.max(1, count - 1)) * 0.18);
    const radial = baseRadius * (0.88 + (silhouette * 0.18));
    const position = {
      x: Math.cos(angle) * radial,
      y: vertical * 1.2,
      z: Math.sin(angle) * radial,
    };
    positions.set(record.id, withJitter(position, record, seed, 0.014));
  });

  return positions;
}

function buildPyramid(records, seed) {
  const sorted = [...records].sort(compareRecords);
  const positions = new Map();
  const count = Math.max(1, sorted.length);
  const sides = [
    { x: 1, z: 0 },
    { x: 0, z: 1 },
    { x: -1, z: 0 },
    { x: 0, z: -1 },
  ];

  sorted.forEach((record, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const height = 1 - (t * 2);
    const baseProgress = clamp01(1 - Math.abs(height));
    const sideSeed = nodeNoise(record, seed, 'pyramid-side');
    const sideIndex = Math.floor(sideSeed * sides.length) % sides.length;
    const nextSide = sides[(sideIndex + 1) % sides.length];
    const sideBlend = nodeNoise(record, seed, 'pyramid-blend');
    const side = {
      x: (sides[sideIndex].x * (1 - sideBlend)) + (nextSide.x * sideBlend),
      z: (sides[sideIndex].z * (1 - sideBlend)) + (nextSide.z * sideBlend),
    };
    const width = 0.18 + (Math.pow(baseProgress, 0.85) * (1.04 + (record.folderBand * 0.16) + (record.degreeWeight * 0.08)));
    const inset = 0.72 + (nodeNoise(record, seed, 'pyramid-inset') * 0.2);
    const position = {
      x: side.x * width * inset,
      y: height * 1.18,
      z: side.z * width * inset,
    };
    positions.set(record.id, withJitter(position, record, seed, 0.013));
  });

  return positions;
}

function buildCrown(records, seed) {
  const sorted = [...records].sort(compareRecords);
  const positions = new Map();
  const count = Math.max(1, sorted.length);

  sorted.forEach((record, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const angle = (t * TAU) + (record.folderBand * 0.34) + (nodeNoise(record, seed, 'crown-angle') * 0.28);
    const crest = Math.pow(Math.sin((t * TAU * 2.5) + (nodeNoise(record, seed, 'crown-crest') * TAU)), 2);
    const ring = 0.66 + (record.folderBand * 0.24) + (record.degreeWeight * 0.08) + (crest * 0.24);
    const height = -0.42 + (crest * 0.92) + ((record.hash - 0.5) * 0.08);
    const position = {
      x: Math.cos(angle) * ring,
      y: height,
      z: Math.sin(angle) * ring,
    };
    positions.set(record.id, withJitter(position, record, seed, 0.012));
  });

  return positions;
}

function buildTemporalSpiral(records, seed) {
  const sorted = [...records].sort((a, b) => {
    if (a.timeValue !== b.timeValue) return a.timeValue - b.timeValue;
    return compareRecords(a, b);
  });
  const positions = new Map();
  const count = Math.max(1, sorted.length);

  sorted.forEach((record, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const timeBias = record.timeWeight;
    const angle = (t * 5.5 * TAU) + (record.folderBand * 0.32) + (nodeNoise(record, seed, 'temporal-phase') * 0.4);
    const radius = 0.22 + (t * 1.02) + (timeBias * 0.18) + (record.degreeWeight * 0.05);
    const y = -1.24 + (2.48 * t) + ((record.folderBand - 0.5) * 0.18);
    const position = {
      x: Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
    };
    positions.set(record.id, withJitter(position, record, seed, 0.014));
  });

  return positions;
}

export function normalizeLayoutPreset(preset = 'cluster') {
  const normalized = String(preset || 'cluster').trim().toLowerCase().replace(/\s+/g, '-');
  return PRESET_ALIASES.get(normalized) || 'cluster';
}

export function buildPresetCoordinates(records, options = {}) {
  const preset = normalizeLayoutPreset(options.preset);
  const seed = options.seed ?? 1;

  switch (preset) {
    case 'sphere':
      return buildSphere(records, seed);
    case 'halo-ring':
      return buildHaloRing(records, seed);
    case 'helix':
      return buildHelix(records, seed);
    case 'dna':
      return buildDna(records, seed);
    case 'sacred':
      return buildSacred(records, seed);
    case 'diamond':
      return buildDiamond(records, seed);
    case 'pyramid':
      return buildPyramid(records, seed);
    case 'crown':
      return buildCrown(records, seed);
    case 'temporal-spiral':
      return buildTemporalSpiral(records, seed);
    case 'cluster':
    default:
      return buildCluster(records, seed);
  }
}

export function enrichLayoutRecords(nodes, context = {}) {
  const {
    adjacency = new Map(),
    folderOrder = [],
  } = context;

  const folderLookup = new Map(folderOrder.map((folder, index) => [folder, index]));
  const records = nodes.map((node) => {
    const degree = adjacency.get(node.id)?.size || node.linkCount || 0;
    const title = node.title || node.id;
    const hash = hashFloat(`${node.id}|${title}|${node.folder}|${node.path}`);
    const createdTime = Number.isFinite(Date.parse(node.created)) ? Date.parse(node.created) : null;
    const pathDateMatch = String(node.path || '').match(/(\d{4}-\d{2}-\d{2})/);
    const pathTime = pathDateMatch ? Date.parse(`${pathDateMatch[1]}T00:00:00Z`) : null;
    const timeValue = createdTime ?? pathTime ?? Number.POSITIVE_INFINITY;
    const folderIndex = folderLookup.get(node.folder) ?? (folderOrder.length + Math.floor(hash * 24));
    return {
      id: node.id,
      node,
      title,
      folder: node.folder,
      folderIndex,
      degree,
      timeValue,
      hash,
    };
  });

  const dated = records.filter((record) => Number.isFinite(record.timeValue)).sort((a, b) => a.timeValue - b.timeValue);
  const minDate = dated[0]?.timeValue ?? 0;
  const maxDate = dated[dated.length - 1]?.timeValue ?? minDate;
  const dateSpan = Math.max(1, maxDate - minDate);
  const maxDegree = Math.max(1, ...records.map((record) => record.degree));

  const timeRank = new Map(dated.map((record, index) => [record.id, index]));
  return records.map((record) => ({
    ...record,
    degreeWeight: clamp01(record.degree / maxDegree),
    folderBand: ((record.folderIndex % 7) / 6),
    timeRank: timeRank.get(record.id) ?? Number.MAX_SAFE_INTEGER,
    timeWeight: Number.isFinite(record.timeValue)
      ? clamp01((record.timeValue - minDate) / dateSpan)
      : record.hash,
  }));
}
