import { validateRetrievalIntent } from '../schemas.js';

export class ProviderError extends Error {
  constructor(message, { status = 500, details = {} } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.details = details;
  }
}

export function truncateForLog(value, maxLength = 4000) {
  const text = String(value ?? '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

export function safeJsonForLog(value, maxLength = 4000) {
  try {
    return truncateForLog(JSON.stringify(value), maxLength);
  } catch {
    return truncateForLog(String(value), maxLength);
  }
}

function logProviderBoundaryWarning(logger, event, payload) {
  if (!logger?.warn) return;
  logger.warn(event, payload);
}

export function ensureApiKey(providerName, apiKey) {
  if (!apiKey) {
    throw new ProviderError(`Missing API key for provider ${providerName}`, {
      status: 500,
      details: {
        provider: providerName,
        reason: 'missing_api_key',
      },
    });
  }
}

export async function parseProviderJson(response, {
  providerName,
  logger,
  model,
  requestBody,
} = {}) {
  const rawResponseText = await response.text();

  if (!response.ok) {
    let providerBody = null;
    try {
      providerBody = rawResponseText ? JSON.parse(rawResponseText) : null;
    } catch {
      providerBody = rawResponseText || null;
    }

    logProviderBoundaryWarning(logger, 'provider.http_error', {
      provider: providerName,
      model,
      reason: 'provider_http_error',
      providerStatus: response.status,
      requestBody: safeJsonForLog(requestBody),
      rawProviderResponse: truncateForLog(rawResponseText),
    });

    throw new ProviderError('Provider request failed', {
      status: 502,
      details: {
        provider: providerName,
        reason: 'provider_http_error',
        providerStatus: response.status,
        providerBody: providerBody?.error || providerBody,
      },
    });
  }

  if (!rawResponseText.trim()) {
    logProviderBoundaryWarning(logger, 'provider.empty_response', {
      provider: providerName,
      model,
      reason: 'empty_response',
      stage: 'provider_http_body',
      requestBody: safeJsonForLog(requestBody),
    });

    throw new ProviderError('Provider returned empty response', {
      status: 502,
      details: {
        provider: providerName,
        reason: 'empty_response',
        stage: 'provider_http_body',
      },
    });
  }

  let payload;
  try {
    payload = JSON.parse(rawResponseText);
  } catch (error) {
    logProviderBoundaryWarning(logger, 'provider.invalid_json', {
      provider: providerName,
      model,
      reason: 'invalid_json',
      stage: 'provider_http_body',
      requestBody: safeJsonForLog(requestBody),
      rawProviderResponse: truncateForLog(rawResponseText),
      cause: error.message,
    });

    throw new ProviderError('Provider returned invalid JSON', {
      status: 502,
      details: {
        provider: providerName,
        reason: 'invalid_json',
        stage: 'provider_http_body',
        cause: error.message,
      },
    });
  }

  return payload;
}

export function sanitizeJsonText(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return '';

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const unfenced = fencedMatch?.[1]?.trim() || trimmed;

  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return unfenced.slice(firstBrace, lastBrace + 1).trim();
  }

  return unfenced;
}

export function parseJsonText(text, providerName, {
  logger,
  model,
  requestBody,
  rawProviderPayload,
} = {}) {
  const rawOutputText = String(text ?? '');
  if (!rawOutputText.trim()) {
    logProviderBoundaryWarning(logger, 'provider.empty_response', {
      provider: providerName,
      model,
      reason: 'empty_response',
      stage: 'structured_output_text',
      requestBody: safeJsonForLog(requestBody),
      rawProviderPayload: safeJsonForLog(rawProviderPayload),
    });

    throw new ProviderError(`Provider ${providerName} returned empty response`, {
      status: 502,
      details: {
        provider: providerName,
        reason: 'empty_response',
        stage: 'structured_output_text',
      },
    });
  }

  const sanitizedText = sanitizeJsonText(rawOutputText);

  try {
    return JSON.parse(sanitizedText);
  } catch (error) {
    logProviderBoundaryWarning(logger, 'provider.invalid_json', {
      provider: providerName,
      model,
      reason: 'invalid_json',
      stage: 'structured_output_text',
      requestBody: safeJsonForLog(requestBody),
      rawProviderPayload: safeJsonForLog(rawProviderPayload),
      rawProviderOutput: truncateForLog(rawOutputText),
      sanitizedProviderOutput: truncateForLog(sanitizedText),
      cause: error.message,
    });

    throw new ProviderError(`Provider ${providerName} returned invalid JSON`, {
      status: 502,
      details: {
        provider: providerName,
        reason: 'invalid_json',
        stage: 'structured_output_text',
        cause: error.message,
      },
    });
  }
}

export function normalizeIntentPayload(payload, {
  providerName,
  logger,
  model,
  requestBody,
  rawProviderPayload,
} = {}) {
  try {
    return validateRetrievalIntent(payload);
  } catch (error) {
    if (error?.status === 422) {
      logProviderBoundaryWarning(logger, 'provider.schema_mismatch', {
        provider: providerName,
        model,
        reason: 'schema_mismatch',
        requestBody: safeJsonForLog(requestBody),
        rawProviderPayload: safeJsonForLog(rawProviderPayload),
        validationError: error.message,
        validationDetails: error.details || null,
        parsedProviderOutput: safeJsonForLog(payload),
      });

      throw new ProviderError(`Provider ${providerName} returned schema-mismatched output`, {
        status: 422,
        details: {
          provider: providerName,
          reason: 'schema_mismatch',
          field: error.details?.field || null,
          validation: error.details || null,
        },
      });
    }

    throw new ProviderError(`Provider ${providerName} returned malformed retrieval intent`, {
      status: 422,
      details: {
        provider: providerName,
        reason: 'schema_mismatch',
        cause: error.message,
      },
    });
  }
}
