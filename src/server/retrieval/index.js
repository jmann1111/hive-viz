import { searchGraphIndex } from './graph-index.js';
import { validateVaultRelativePath } from './path-validator.js';

const RECENCY_SPECIFICITY_NOISE = new Set([
  'a',
  'an',
  'doc',
  'document',
  'file',
  'find',
  'md',
  'me',
  'my',
  'most',
  'newest',
  'note',
  'open',
  'page',
  'pull',
  'recent',
  'show',
  'the',
  'today',
  'up',
  'yesterday',
]);

function confidenceRank(value) {
  return {
    low: 0,
    medium: 1,
    high: 2,
  }[value] ?? 0;
}

function hasRecencySignal(intent, query) {
  const values = [
    intent?.normalizedQuery,
    query,
    ...(Array.isArray(intent?.searchPhrases) ? intent.searchPhrases : []),
  ];

  return values.some((value) => /\b(latest|recent|newest|most recent|today|yesterday)\b/i.test(String(value || '')));
}

function recencySpecificity(intent) {
  const values = [
    intent?.normalizedQuery,
    ...(Array.isArray(intent?.searchPhrases) ? intent.searchPhrases : []),
  ];

  let best = 0;
  for (const value of values) {
    const tokens = String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .filter((token) => !RECENCY_SPECIFICITY_NOISE.has(token) && token !== 'latest');
    best = Math.max(best, new Set(tokens).size);
  }

  return best;
}

function hasStrongDocumentMatch(candidate) {
  const score = candidate?.docMatchScore ?? 0;
  const ratio = candidate?.docMatchRatio ?? 0;
  return score >= 260 || (score >= 180 && ratio >= 0.9);
}

function pickConfidence(intent, candidates, query) {
  const top = candidates[0];
  const second = candidates[1];
  const recencyRequested = hasRecencySignal(intent, query);
  const specificity = recencySpecificity(intent);

  if (!top || top.score < 90) {
    return 'low';
  }

  let score = 0;
  score += confidenceRank(intent.confidence);

  if (top.score >= 280) score += 3;
  else if (top.score >= 180) score += 2;
  else score += 1;

  if (!second || top.score - second.score >= 70) score += 2;
  else if (top.score - second.score >= 30) score += 1;

  if (recencyRequested) {
    if (!top.timestamp) return 'low';

    if (specificity < 2) {
      return 'medium';
    }
  }

  if (top.exactDocRequested) {
    if (!hasStrongDocumentMatch(top)) {
      return second ? 'medium' : 'low';
    }

    if (
      second
      && (second.docMatchScore ?? 0) >= (top.docMatchScore ?? 0)
      && top.score - second.score < 120
    ) {
      return 'medium';
    }
  }

  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function buildCandidateReason(candidate) {
  const details = [];
  if (candidate.dateLabel) details.push(candidate.dateLabel);
  if (candidate.folder) details.push(candidate.folder);
  if (candidate.type) details.push(candidate.type);

  const summary = details.join(' - ');
  if (summary && candidate.preview) {
    return `${summary}: ${candidate.preview}`;
  }
  if (summary) return summary;
  if (candidate.preview) return candidate.preview;
  return '';
}

function buildClarificationQuestion(intent, candidates) {
  if (intent.clarificationQuestion) {
    return intent.clarificationQuestion.endsWith('?')
      ? intent.clarificationQuestion
      : `${intent.clarificationQuestion}?`;
  }

  const titles = candidates.slice(0, 3).map((candidate) => candidate.title);
  if (titles.length >= 2) {
    const joined = `${titles.slice(0, -1).join(', ')}, or ${titles.at(-1)}`;
    return `Did you mean ${joined}?`;
  }

  return `Which note should I retrieve for "${intent.normalizedQuery}"?`;
}

async function validateCandidates(vaultRoot, candidates, maxCandidates) {
  const validated = [];
  let invalidPathCount = 0;

  for (const candidate of candidates) {
    const resolved = await validateVaultRelativePath(vaultRoot, candidate.path);
    if (!resolved) {
      invalidPathCount += 1;
      continue;
    }

    validated.push({
      title: candidate.title,
      id: candidate.id,
      folder: candidate.folder,
      type: candidate.type,
      dateLabel: candidate.dateLabel,
      score: candidate.score,
      tags: candidate.tags,
      excerpt: candidate.preview,
      reason: buildCandidateReason(candidate),
      path: {
        vaultRelativePath: resolved.relativePath,
        absolutePath: resolved.absolutePath,
      },
    });

    if (validated.length >= maxCandidates) break;
  }

  return {
    candidates: validated,
    invalidPathCount,
  };
}

export async function resolveRetrieval({
  vaultRoot,
  index,
  intent,
  query,
  maxCandidates,
}) {
  const rawCandidates = searchGraphIndex(index, intent, {
    limit: 20,
    fallbackQuery: query,
  });
  const validated = await validateCandidates(vaultRoot, rawCandidates, maxCandidates);
  const candidates = validated.candidates;
  const finalConfidence = pickConfidence(intent, rawCandidates, query);

  if (finalConfidence === 'high' && candidates.length > 0) {
    return {
      mode: 'resolved_note',
      confidence: 'high',
      note: candidates[0],
      retrieval: {
        rankedCount: rawCandidates.length,
        returnedCount: candidates.length,
        invalidPathCount: validated.invalidPathCount,
      },
    };
  }

  if (finalConfidence === 'medium' && candidates.length > 0) {
    return {
      mode: 'candidate_notes',
      confidence: 'medium',
      candidates: candidates.slice(0, maxCandidates),
      retrieval: {
        rankedCount: rawCandidates.length,
        returnedCount: candidates.length,
        invalidPathCount: validated.invalidPathCount,
      },
    };
  }

  return {
    mode: 'clarification_request',
    confidence: 'low',
    question: buildClarificationQuestion(intent, candidates),
    candidateHints: candidates.slice(0, Math.min(3, candidates.length)).map((candidate) => ({
      title: candidate.title,
      path: candidate.path.vaultRelativePath,
      reason: candidate.reason,
    })),
    retrieval: {
      rankedCount: rawCandidates.length,
      returnedCount: candidates.length,
      invalidPathCount: validated.invalidPathCount,
    },
  };
}
