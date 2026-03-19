import { createHttpError } from '../schemas.js';
import { OpenAIProvider } from './openai.js';

export function createProviderRegistry(config, { fetchImpl = fetch, logger = null } = {}) {
  return {
    openai: new OpenAIProvider({
      apiKey: config.apiKeys.openai,
      timeoutMs: config.providerTimeoutMs,
      fetchImpl,
      logger,
    }),
  };
}

export function getProviderClient(registry) {
  const client = registry?.openai;
  if (!client) {
    throw createHttpError(500, 'OpenAI provider is not configured', {
      field: 'provider',
      reason: 'missing_openai_provider',
    });
  }
  return client;
}
