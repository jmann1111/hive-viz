import { searchGraphIndex } from './graph-index.js';
import { validateVaultRelativePath } from './path-validator.js';

function confidenceRank(value) {
  return {
    low: 0,
    medium: 1,
    high: 2,
  }[value] ?? 0;
}

function pickConfidence(intent, candidates) {
  const top = candidates[0];
  const second = candidates[1];

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

  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
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
      score: candidate.score,
      tags: candidate.tags,
      excerpt: candidate.preview,
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
  const finalConfidence = pickConfidence(intent, rawCandidates);

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

  if (finalConfidence === 'medium' && candidates.length >= 3) {
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
    })),
    retrieval: {
      rankedCount: rawCandidates.length,
      returnedCount: candidates.length,
      invalidPathCount: validated.invalidPathCount,
    },
  };
}
