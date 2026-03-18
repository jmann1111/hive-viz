import fs from 'fs/promises';
import path from 'path';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.md$/g, '')
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function trimPreview(value, maxLength = 180) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 3)}...`;
}

function buildNoteRecord(node) {
  const basename = path.basename(node.path || '', '.md');
  const fields = [
    node.title,
    node.id,
    node.path,
    basename,
    node.folder,
    node.type,
    ...(Array.isArray(node.tags) ? node.tags : []),
    String(node.content || '').slice(0, 1200),
  ];

  return {
    id: node.id,
    title: node.title || basename,
    path: node.path,
    folder: node.folder || '',
    type: node.type || 'unknown',
    tags: Array.isArray(node.tags) ? node.tags : [],
    basename,
    preview: trimPreview(node.content),
    normalized: {
      title: normalizeText(node.title),
      id: normalizeText(node.id),
      path: normalizeText(node.path),
      basename: normalizeText(basename),
      folder: normalizeText(node.folder),
      type: normalizeText(node.type),
      fields: normalizeText(fields.join(' ')),
      tokens: new Set(fields.flatMap((field) => tokenize(field))),
    },
  };
}

function scoreNeedle(note, needle, tokens) {
  if (!needle) return 0;

  let score = 0;
  const { normalized } = note;

  if (normalized.path === needle) score += 320;
  if (normalized.title === needle) score += 290;
  if (normalized.basename === needle) score += 280;
  if (normalized.id === needle) score += 260;

  if (normalized.path.startsWith(needle)) score += 110;
  if (normalized.title.startsWith(needle)) score += 95;
  if (normalized.basename.startsWith(needle)) score += 90;

  if (normalized.path.includes(needle)) score += 80;
  if (normalized.title.includes(needle)) score += 75;
  if (normalized.basename.includes(needle)) score += 65;
  if (normalized.fields.includes(needle)) score += 40;

  let overlap = 0;
  for (const token of tokens) {
    if (normalized.tokens.has(token)) overlap += 1;
  }

  if (tokens.length > 0) {
    score += Math.round((overlap / tokens.length) * 120);
  }

  return score;
}

export async function loadGraphIndex(graphPath) {
  const raw = await fs.readFile(graphPath, 'utf8');
  const graph = JSON.parse(raw);
  const notes = Array.isArray(graph.nodes) ? graph.nodes.map(buildNoteRecord) : [];

  return {
    notes,
    meta: graph.meta || {},
  };
}

export function searchGraphIndex(index, intent, { limit = 20, fallbackQuery = '' } = {}) {
  const primaryNeedle = normalizeText(intent.normalizedQuery);
  const primaryTokens = tokenize(intent.normalizedQuery);
  const searchPhrases = Array.isArray(intent.searchPhrases) ? intent.searchPhrases : [];
  const fallbackNeedle = normalizeText(fallbackQuery);
  const fallbackTokens = tokenize(fallbackQuery);
  const folderHints = Array.isArray(intent.folderHints) ? intent.folderHints.map((value) => normalizeText(value)) : [];
  const typeHints = Array.isArray(intent.typeHints) ? intent.typeHints.map((value) => normalizeText(value)) : [];

  const ranked = index.notes
    .map((note) => {
      let score =
        scoreNeedle(note, primaryNeedle, primaryTokens) +
        Math.round(scoreNeedle(note, fallbackNeedle, fallbackTokens) * 0.35);

      for (const phrase of searchPhrases) {
        score += Math.round(scoreNeedle(note, normalizeText(phrase), tokenize(phrase)) * 0.8);
      }

      if (folderHints.some((hint) => note.normalized.folder.includes(hint) || note.normalized.path.includes(hint))) {
        score += 60;
      }

      if (typeHints.some((hint) => note.normalized.type.includes(hint))) {
        score += 40;
      }

      return {
        ...note,
        score,
      };
    })
    .filter((note) => note.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);

  return ranked;
}
