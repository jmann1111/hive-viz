import { createHttpError } from '../schemas.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';

export function createProviderRegistry(config, { fetchImpl = fetch, logger = null } = {}) {
  return {
    openai: new OpenAIProvider({
      apiKey: config.apiKeys.openai,
      timeoutMs: config.providerTimeoutMs,
      fetchImpl,
      logger,
    }),
    gemini: new GeminiProvider({
      apiKey: config.apiKeys.gemini,
      timeoutMs: config.providerTimeoutMs,
      fetchImpl,
      logger,
    }),
  };
}

export function getProviderClient(registry, providerName) {
  const client = registry?.[providerName];
  if (!client) {
    throw createHttpError(400, 'Unsupported provider', {
      field: 'provider',
      reason: 'unknown_provider',
    });
  }
  return client;
}
