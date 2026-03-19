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

const GENERIC_DOC_QUERY_TOKENS = new Set([
  'a',
  'an',
  'doc',
  'docs',
  'document',
  'documents',
  'file',
  'files',
  'find',
  'log',
  'logs',
  'md',
  'me',
  'my',
  'note',
  'notes',
  'open',
  'page',
  'pages',
  'pull',
  'report',
  'reports',
  'show',
  'the',
  'up',
]);

const RECENCY_QUERY_TOKENS = new Set([
  'latest',
  'most',
  'newest',
  'recent',
  'today',
  'yesterday',
]);

function normalizeMatchToken(token) {
  if (!token) return '';
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith('s') && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenizeDocMatch(value) {
  return tokenize(value).map(normalizeMatchToken).filter(Boolean);
}

function filterDocumentQueryTokens(tokens) {
  return tokens.filter((token) => (
    !GENERIC_DOC_QUERY_TOKENS.has(token)
    && !RECENCY_QUERY_TOKENS.has(token)
  ));
}

function hasDocumentCue(value) {
  return /\b(doc|docs|document|documents|note|notes|file|files|page|pages|md)\b/i.test(String(value || ''));
}

function buildDocumentNeedles(intent, fallbackQuery) {
  const values = [
    intent.normalizedQuery,
    fallbackQuery,
    ...(Array.isArray(intent.searchPhrases) ? intent.searchPhrases : []),
  ];

  const needles = new Set();
  let exactDocRequested = false;

  for (const value of values) {
    const tokens = Array.from(new Set(filterDocumentQueryTokens(tokenizeDocMatch(value))));
    if (tokens.length === 0) continue;

    if (tokens.length >= 2 || hasDocumentCue(value)) {
      exactDocRequested = true;
      needles.add(tokens.join(' '));
    }
  }

  return {
    exactDocRequested,
    needles: Array.from(needles),
  };
}

function trimPreview(value, maxLength = 180) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 3)}...`;
}

function extractDateLabel(node) {
  const explicit = typeof node.date === 'string' ? node.date.trim() : '';
  if (explicit) return explicit;

  const sources = [node.path, node.title, node.id];
  for (const source of sources) {
    const match = String(source || '').match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (match) return match[1];
  }

  return '';
}

function toTimestamp(dateLabel) {
  if (!dateLabel) return null;
  const timestamp = Date.parse(`${dateLabel}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasRecencySignal(values) {
  return values.some((value) => /\b(latest|recent|newest|most recent|today|yesterday)\b/i.test(String(value || '')));
}

function buildNoteRecord(node) {
  const basename = path.basename(node.path || '', '.md');
  const dateLabel = extractDateLabel(node);
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
    dateLabel,
    timestamp: toTimestamp(dateLabel),
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
      docTokens: new Set([
        ...tokenizeDocMatch(node.title),
        ...tokenizeDocMatch(node.id),
        ...tokenizeDocMatch(node.path),
        ...tokenizeDocMatch(basename),
      ]),
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

function scoreDocumentNeedles(note, needles) {
  if (!Array.isArray(needles) || needles.length === 0) {
    return {
      score: 0,
      ratio: 0,
    };
  }

  let bestScore = 0;
  let bestRatio = 0;

  for (const needle of needles) {
    if (!needle) continue;

    const tokens = needle.split(' ').filter(Boolean);
    if (tokens.length === 0) continue;

    let score = 0;

    if (note.normalized.title === needle) score += 260;
    if (note.normalized.basename === needle) score += 250;
    if (note.normalized.id === needle) score += 230;

    if (note.normalized.title.startsWith(needle)) score += 130;
    if (note.normalized.basename.startsWith(needle)) score += 120;
    if (note.normalized.path.includes(needle)) score += 90;
    if (note.normalized.title.includes(needle)) score += 80;
    if (note.normalized.basename.includes(needle)) score += 70;

    let overlap = 0;
    for (const token of tokens) {
      if (note.normalized.docTokens.has(token)) overlap += 1;
    }

    const ratio = overlap / tokens.length;
    score += Math.round(ratio * 180);

    if (overlap === tokens.length && tokens.length >= 2) {
      score += 140;
    } else if (ratio >= 0.75 && tokens.length >= 2) {
      score += 70;
    }

    if (score > bestScore) bestScore = score;
    if (ratio > bestRatio) bestRatio = ratio;
  }

  return {
    score: bestScore,
    ratio: bestRatio,
  };
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
  const recencyRequested = hasRecencySignal([
    intent.normalizedQuery,
    fallbackQuery,
    ...searchPhrases,
  ]);
  const documentNeedles = buildDocumentNeedles(intent, fallbackQuery);

  const ranked = index.notes
    .map((note) => {
      const docMatch = scoreDocumentNeedles(note, documentNeedles.needles);
      let score =
        scoreNeedle(note, primaryNeedle, primaryTokens) +
        Math.round(scoreNeedle(note, fallbackNeedle, fallbackTokens) * 0.35);

      for (const phrase of searchPhrases) {
        score += Math.round(scoreNeedle(note, normalizeText(phrase), tokenize(phrase)) * 0.8);
      }

      score += docMatch.score;

      if (folderHints.some((hint) => note.normalized.folder.includes(hint) || note.normalized.path.includes(hint))) {
        score += 60;
      }

      if (typeHints.some((hint) => note.normalized.type.includes(hint))) {
        score += 40;
      }

      return {
        ...note,
        docMatchRatio: docMatch.ratio,
        docMatchScore: docMatch.score,
        exactDocRequested: documentNeedles.exactDocRequested,
        score,
      };
    })
    .filter((note) => note.score > 0);

  if (recencyRequested) {
    const dated = ranked
      .filter((note) => note.timestamp != null)
      .sort((a, b) => b.timestamp - a.timestamp);

    dated.forEach((note, index) => {
      note.score += Math.max(0, 110 - (index * 18));
    });
  }

  return ranked
    .sort((a, b) => b.score - a.score || (b.timestamp || 0) - (a.timestamp || 0) || a.title.localeCompare(b.title))
    .slice(0, limit);
}
