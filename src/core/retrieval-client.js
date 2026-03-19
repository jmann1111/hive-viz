const DEFAULT_ENDPOINT = '/api/orb/retrieve';

function toScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
}

function normalizeText(value) {
  return String(value || '').trim();
}

export function normalizeRetrievalResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Orb returned an empty response.');
  }

  if (raw.intent === 'resolved') {
    return {
      intent: 'resolved',
      confidence: raw.confidence || 'high',
      resolved: {
        nodeId: String(raw?.resolved?.nodeId || ''),
        title: String(raw?.resolved?.title || ''),
        path: String(raw?.resolved?.path || ''),
        folder: String(raw?.resolved?.folder || ''),
        score: toScore(raw?.resolved?.score),
      },
      validation: {
        nodeExists: Boolean(raw?.validation?.nodeExists),
        pathExists: Boolean(raw?.validation?.pathExists),
      },
    };
  }

  if (raw.intent === 'candidates') {
    return {
      intent: 'candidates',
      confidence: raw.confidence || 'medium',
      candidates: (Array.isArray(raw?.candidates) ? raw.candidates : []).slice(0, 5).map((candidate) => ({
        nodeId: String(candidate?.nodeId || ''),
        title: String(candidate?.title || ''),
        path: String(candidate?.path || ''),
        folder: String(candidate?.folder || ''),
        score: toScore(candidate?.score),
        reason: String(candidate?.reason || ''),
      })),
    };
  }

  if (raw.intent === 'clarification') {
    return {
      intent: 'clarification',
      confidence: raw.confidence || 'low',
      question: String(raw?.question || '').trim() || 'Which note did you mean?',
    };
  }

  if (raw.mode === 'resolved_note' && raw.note) {
    return {
      intent: 'resolved',
      confidence: raw.confidence || 'high',
      resolved: {
        nodeId: String(raw.note.nodeId || ''),
        title: String(raw.note.title || ''),
        path: String(raw.note.path?.vaultRelativePath || ''),
        folder: String(raw.note.folder || ''),
        score: toScore(raw.note.score),
      },
      validation: {
        nodeExists: Boolean(raw.note.nodeId || raw.note.path?.vaultRelativePath),
        pathExists: Boolean(raw.note.path?.vaultRelativePath),
      },
    };
  }

  if (raw.mode === 'candidate_notes') {
    return {
      intent: 'candidates',
      confidence: raw.confidence || 'medium',
      candidates: (Array.isArray(raw.candidates) ? raw.candidates : []).slice(0, 5).map((candidate) => ({
        nodeId: String(candidate?.nodeId || ''),
        title: normalizeText(candidate?.title),
        path: normalizeText(candidate?.path?.vaultRelativePath),
        folder: normalizeText(candidate?.folder),
        dateLabel: normalizeText(candidate?.dateLabel),
        score: toScore(candidate?.score),
        excerpt: normalizeText(candidate?.excerpt),
        reason: normalizeText(candidate?.reason),
      })),
    };
  }

  if (raw.mode === 'clarification_request') {
    return {
      intent: 'clarification',
      confidence: raw.confidence || 'low',
      question: normalizeText(raw.question) || 'Which note did you mean?',
      candidateHints: (Array.isArray(raw.candidateHints) ? raw.candidateHints : []).slice(0, 3).map((candidate) => ({
        title: normalizeText(candidate?.title),
        path: normalizeText(candidate?.path),
        reason: normalizeText(candidate?.reason),
      })),
    };
  }

  throw new Error('Orb returned an unknown intent.');
}

export function createRetrievalClient(options = {}) {
  const endpoint = options.endpoint || import.meta.env.VITE_ORB_RETRIEVAL_URL || DEFAULT_ENDPOINT;

  return {
    endpoint,
    async retrieve(query, context = null, requestOptions = {}) {
      const payload = {
        query: normalizeText(query),
        maxCandidates: requestOptions.maxCandidates || 5,
      };

      if (requestOptions.model) {
        payload.model = normalizeText(requestOptions.model);
      }

      if (
        context
        && typeof context === 'object'
        && normalizeText(context.previousQuery)
        && normalizeText(context.question)
      ) {
        payload.clarification = {
          previousQuery: normalizeText(context.previousQuery),
          question: normalizeText(context.question),
        };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      let body = null;
      try {
        body = await response.json();
      } catch {
        throw new Error('Orb returned invalid JSON.');
      }

      if (!response.ok) {
        const message = body?.error?.message || `Orb request failed (${response.status}).`;
        throw new Error(message);
      }

      return normalizeRetrievalResponse(body);
    },
  };
}
