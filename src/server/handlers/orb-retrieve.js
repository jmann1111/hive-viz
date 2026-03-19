import crypto from 'crypto';

import { hashQuery } from '../logger.js';
import { normalizeIntentPayload } from '../providers/base.js';
import { getProviderClient } from '../providers/index.js';
import {
  createHttpError,
  validateRetrieveRequest,
} from '../schemas.js';
import { resolveRetrieval } from '../retrieval/index.js';

function buildProviderQuery(request) {
  if (!request.clarification) {
    return request.query;
  }

  return [
    `Previous retrieval query: ${request.clarification.previousQuery}`,
    `Clarification question: ${request.clarification.question}`,
    `Follow-up answer: ${request.query}`,
  ].join('\n');
}

function buildFallbackQuery(request) {
  if (!request.clarification) {
    return request.query;
  }

  return `${request.clarification.previousQuery} ${request.query}`.trim();
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    throw createHttpError(400, 'Request body is required', {
      field: 'body',
      reason: 'missing_body',
    });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw createHttpError(400, 'Request body must be valid JSON', {
      field: 'body',
      reason: 'invalid_json',
      cause: error.message,
    });
  }
}

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

export function createOrbRetrieveHandler({ config, logger, providers, index }) {
  return async function handleOrbRetrieve(req, res) {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    try {
      const body = await readJsonBody(req);
      const request = validateRetrieveRequest(body);
      const providerName = 'openai';
      const model = request.model || config.defaultModels.openai;
      const provider = getProviderClient(providers);
      const providerQuery = buildProviderQuery(request);

      logger.info('orb.retrieve.request', {
        requestId,
        provider: providerName,
        model,
        queryHash: hashQuery(request.query),
        queryLength: request.query.length,
        hasClarification: Boolean(request.clarification),
      });

      const rawIntent = await provider.classifyRetrievalIntent({
        query: providerQuery,
        model,
      });
      const intent = normalizeIntentPayload(rawIntent, {
        providerName,
        logger,
        model,
      });

      const resolved = await resolveRetrieval({
        vaultRoot: config.vaultRoot,
        index,
        intent,
        query: buildFallbackQuery(request),
        maxCandidates: request.maxCandidates,
      });

      const payload = {
        requestId,
        provider: providerName,
        model,
        latencyMs: Date.now() - startedAt,
        intent: {
          normalizedQuery: intent.normalizedQuery,
          searchPhrases: intent.searchPhrases,
          folderHints: intent.folderHints,
          typeHints: intent.typeHints,
        },
        mode: resolved.mode,
        confidence: resolved.confidence,
        retrieval: resolved.retrieval,
      };

      if (resolved.note) payload.note = resolved.note;
      if (resolved.candidates) payload.candidates = resolved.candidates;
      if (resolved.question) payload.question = resolved.question;
      if (resolved.candidateHints) payload.candidateHints = resolved.candidateHints;

      logger.info('orb.retrieve.result', {
        requestId,
        provider: providerName,
        model,
        latencyMs: payload.latencyMs,
        mode: payload.mode,
        confidence: payload.confidence,
        candidateCount: payload.candidates?.length || 0,
        invalidPathCount: payload.retrieval.invalidPathCount,
      });

      sendJson(res, 200, payload);
    } catch (error) {
      const statusCode = error.status || 500;
      const latencyMs = Date.now() - startedAt;

      logger.error('orb.retrieve.error', {
        requestId,
        latencyMs,
        statusCode,
        message: error.message,
        details: error.details || null,
      });

      sendJson(res, statusCode, {
        requestId,
        error: {
          message: error.message,
          details: error.details || null,
        },
      });
    }
  };
}
