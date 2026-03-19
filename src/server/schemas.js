export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
export const RESULT_TYPES = [
  'resolved_note',
  'candidate_notes',
  'clarification_request',
];
export const HIVE_FOLDERS = [
  '00-Inbox',
  '01-Daily',
  '10-Sessions',
  '20-Architecture',
  '30-Projects',
  '39-Archive',
  '40-Decisions',
  '50-Playbooks',
  '60-Knowledge',
  '70-Ops',
  '80-Secure',
  '99-Templates',
  '99-Assets',
];

export const ORB_REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 500 },
    model: { type: 'string', minLength: 1, maxLength: 128 },
    maxCandidates: { type: 'integer', minimum: 3, maximum: 5 },
    clarification: {
      type: 'object',
      additionalProperties: false,
      required: ['previousQuery', 'question'],
      properties: {
        previousQuery: { type: 'string', minLength: 1, maxLength: 500 },
        question: { type: 'string', minLength: 1, maxLength: 160 },
      },
    },
  },
};

export const RETRIEVAL_INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  propertyOrdering: [
    'confidence',
    'normalizedQuery',
    'searchPhrases',
    'folderHints',
    'typeHints',
    'clarificationQuestion',
  ],
  required: [
    'confidence',
    'normalizedQuery',
    'searchPhrases',
    'folderHints',
    'typeHints',
    'clarificationQuestion',
  ],
  properties: {
    confidence: {
      type: 'string',
      enum: CONFIDENCE_LEVELS,
      description: 'Confidence in the retrieval intent classification.',
    },
    normalizedQuery: {
      type: 'string',
      minLength: 1,
      maxLength: 240,
      description: 'Shortest useful retrieval string from the user query.',
    },
    searchPhrases: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 120,
      },
      description: 'Short search phrases derived from user wording.',
    },
    folderHints: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'string',
        enum: HIVE_FOLDERS,
      },
      description: 'Only top-level Hive folders explicitly implied by the query.',
    },
    typeHints: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
      },
      description: 'Only note types explicitly implied by the query.',
    },
    clarificationQuestion: {
      type: ['string', 'null'],
      maxLength: 160,
      description: 'One narrow question when confidence is low, otherwise null.',
    },
  },
};

export function createHttpError(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values, { max = Infinity } = {}) {
  const deduped = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || deduped.includes(trimmed)) continue;
    deduped.push(trimmed);
    if (deduped.length >= max) break;
  }
  return deduped;
}

function ensureString(value, field, { min = 0, max = Infinity, status = 400 } = {}) {
  if (typeof value !== 'string') {
    throw createHttpError(status, `Invalid ${field}`, {
      field,
      reason: 'expected_string',
    });
  }

  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw createHttpError(status, `Invalid ${field}`, {
      field,
      reason: 'string_length_out_of_range',
    });
  }

  return trimmed;
}

export function validateRetrieveRequest(body) {
  if (!isPlainObject(body)) {
    throw createHttpError(400, 'Request body must be a JSON object', {
      field: 'body',
      reason: 'expected_object',
    });
  }

  const allowedFields = new Set(['query', 'model', 'maxCandidates', 'clarification']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      throw createHttpError(400, 'Unexpected request field', {
        field: key,
        reason: 'unexpected_field',
      });
    }
  }

  const query = ensureString(body.query, 'query', { min: 1, max: 500 });

  let model = null;
  if (body.model != null) {
    model = ensureString(body.model, 'model', { min: 1, max: 128 });
  }

  let maxCandidates = 5;
  if (body.maxCandidates != null) {
    if (!Number.isInteger(body.maxCandidates)) {
      throw createHttpError(400, 'Invalid maxCandidates', {
        field: 'maxCandidates',
        reason: 'expected_integer',
      });
    }

    if (body.maxCandidates < 3 || body.maxCandidates > 5) {
      throw createHttpError(400, 'Invalid maxCandidates', {
        field: 'maxCandidates',
        reason: 'out_of_range',
      });
    }

    maxCandidates = body.maxCandidates;
  }

  let clarification = null;
  if (body.clarification != null) {
    if (!isPlainObject(body.clarification)) {
      throw createHttpError(400, 'Invalid clarification', {
        field: 'clarification',
        reason: 'expected_object',
      });
    }

    const clarificationFields = new Set(['previousQuery', 'question']);
    for (const key of Object.keys(body.clarification)) {
      if (!clarificationFields.has(key)) {
        throw createHttpError(400, 'Invalid clarification', {
          field: `clarification.${key}`,
          reason: 'unexpected_field',
        });
      }
    }

    clarification = {
      previousQuery: ensureString(body.clarification.previousQuery, 'clarification.previousQuery', {
        min: 1,
        max: 500,
      }),
      question: ensureString(body.clarification.question, 'clarification.question', {
        min: 1,
        max: 160,
      }),
    };
  }

  return { query, model, maxCandidates, clarification };
}

function ensureEnum(value, field, choices) {
  if (typeof value !== 'string' || !choices.includes(value)) {
    throw createHttpError(422, `Provider returned invalid ${field}`, {
      field,
      reason: 'invalid_enum',
      choices,
    });
  }
  return value;
}

export function validateRetrievalIntent(value) {
  if (!isPlainObject(value)) {
    throw createHttpError(422, 'Provider returned invalid intent payload', {
      field: 'intent',
      reason: 'expected_object',
    });
  }

  const confidence = ensureEnum(value.confidence, 'confidence', CONFIDENCE_LEVELS);
  const normalizedQuery = ensureString(value.normalizedQuery, 'normalizedQuery', {
    min: 1,
    max: 240,
    status: 422,
  });
  const searchPhrases = uniqueStrings(Array.isArray(value.searchPhrases) ? value.searchPhrases : [], {
    max: 5,
  });
  if (searchPhrases.length === 0) {
    throw createHttpError(422, 'Provider returned invalid searchPhrases', {
      field: 'searchPhrases',
      reason: 'missing_search_phrases',
    });
  }

  const folderHints = uniqueStrings(Array.isArray(value.folderHints) ? value.folderHints : [], {
    max: 3,
  }).filter((folder) => HIVE_FOLDERS.includes(folder));
  const typeHints = uniqueStrings(Array.isArray(value.typeHints) ? value.typeHints : [], {
    max: 3,
  });

  let clarificationQuestion = null;
  if (value.clarificationQuestion !== null && value.clarificationQuestion !== undefined) {
    clarificationQuestion = ensureString(value.clarificationQuestion, 'clarificationQuestion', {
      min: 1,
      max: 160,
      status: 422,
    });
  }

  if (confidence === 'low' && !clarificationQuestion) {
    clarificationQuestion = `What exact note should I retrieve for "${normalizedQuery}"?`;
  }

  if (confidence !== 'low') {
    clarificationQuestion = null;
  }

  return {
    confidence,
    normalizedQuery,
    searchPhrases,
    folderHints,
    typeHints,
    clarificationQuestion,
  };
}
