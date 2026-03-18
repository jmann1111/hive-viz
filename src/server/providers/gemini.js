import { buildRetrievalIntentUserPrompt, getRetrievalIntentSystemPrompt } from '../prompts/retrieval-intent.js';
import { RETRIEVAL_INTENT_SCHEMA } from '../schemas.js';
import {
  ensureApiKey,
  normalizeIntentPayload,
  parseJsonText,
  parseProviderJson,
  ProviderError,
  safeJsonForLog,
} from './base.js';

function buildGeminiSchema(schema, model) {
  if (Array.isArray(schema)) {
    return schema.map((item) => buildGeminiSchema(item, model));
  }

  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const next = {};

  if (schema.type !== undefined) next.type = schema.type;
  if (schema.description !== undefined) next.description = schema.description;
  if (schema.title !== undefined) next.title = schema.title;
  if (schema.enum !== undefined) next.enum = schema.enum;
  if (schema.format !== undefined) next.format = schema.format;
  if (schema.minimum !== undefined) next.minimum = schema.minimum;
  if (schema.maximum !== undefined) next.maximum = schema.maximum;
  if (schema.additionalProperties !== undefined) {
    next.additionalProperties =
      typeof schema.additionalProperties === 'object'
        ? buildGeminiSchema(schema.additionalProperties, model)
        : schema.additionalProperties;
  }
  if (schema.minItems !== undefined) next.minItems = schema.minItems;
  if (schema.maxItems !== undefined) next.maxItems = schema.maxItems;
  if (schema.prefixItems !== undefined) {
    next.prefixItems = schema.prefixItems.map((item) => buildGeminiSchema(item, model));
  }
  if (schema.items !== undefined) next.items = buildGeminiSchema(schema.items, model);
  if (schema.required !== undefined) next.required = schema.required;

  if (schema.properties && typeof schema.properties === 'object') {
    next.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, buildGeminiSchema(value, model)]),
    );
  }

  if (String(model || '').startsWith('gemini-2.0') && next.properties && !next.propertyOrdering) {
    next.propertyOrdering = Object.keys(next.properties);
  }

  return next;
}

function buildGeminiRequestBody({ query, model }) {
  return {
    system_instruction: {
      parts: [{ text: getRetrievalIntentSystemPrompt() }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildRetrievalIntentUserPrompt(query) }],
      },
    ],
    generationConfig: {
      temperature: 0,
      candidateCount: 1,
      maxOutputTokens: 220,
      responseMimeType: 'application/json',
      responseJsonSchema: buildGeminiSchema(RETRIEVAL_INTENT_SCHEMA, model),
    },
  };
}

function extractGeminiText(payload, { logger, model, requestBody } = {}) {
  const candidate = payload?.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!text) {
    logger?.warn?.('provider.empty_response', {
      provider: 'gemini',
      model,
      reason: 'empty_response',
      stage: 'structured_output_text',
      requestBody: safeJsonForLog(requestBody),
      rawProviderPayload: safeJsonForLog(payload),
    });

    throw new ProviderError('Gemini response did not include output text', {
      status: 502,
      details: {
        provider: 'gemini',
        reason: 'empty_response',
        stage: 'structured_output_text',
      },
    });
  }

  return text;
}

export class GeminiProvider {
  constructor({ apiKey, timeoutMs, fetchImpl = fetch, logger = null }) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  async classifyRetrievalIntent({ query, model }) {
    ensureApiKey('gemini', this.apiKey);
    const requestBody = buildGeminiRequestBody({ query, model });

    const response = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify(requestBody),
      },
    );

    const payload = await parseProviderJson(response, {
      providerName: 'gemini',
      logger: this.logger,
      model,
      requestBody,
    });
    const text = extractGeminiText(payload, {
      logger: this.logger,
      model,
      requestBody,
    });
    return normalizeIntentPayload(
      parseJsonText(text, 'gemini', {
        logger: this.logger,
        model,
        requestBody,
        rawProviderPayload: payload,
      }),
      {
        providerName: 'gemini',
        logger: this.logger,
        model,
        requestBody,
        rawProviderPayload: payload,
      },
    );
  }
}

export {
  buildGeminiRequestBody,
  buildGeminiSchema,
  extractGeminiText,
};
