import { buildRetrievalIntentUserPrompt, getRetrievalIntentSystemPrompt } from '../prompts/retrieval-intent.js';
import { RETRIEVAL_INTENT_SCHEMA } from '../schemas.js';
import {
  ensureApiKey,
  normalizeIntentPayload,
  parseJsonText,
  parseProviderJson,
  ProviderError,
} from './base.js';

function extractOpenAIText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }

  for (const outputItem of payload.output || []) {
    for (const contentItem of outputItem.content || []) {
      if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
        return contentItem.text;
      }
      if (contentItem.type === 'text' && typeof contentItem.text === 'string') {
        return contentItem.text;
      }
      if (typeof contentItem?.text?.value === 'string') {
        return contentItem.text.value;
      }
    }
  }

  throw new ProviderError('OpenAI response did not include output text', {
    status: 502,
    details: { provider: 'openai', reason: 'missing_output_text' },
  });
}

export class OpenAIProvider {
  constructor({ apiKey, timeoutMs, fetchImpl = fetch, logger = null }) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  async classifyRetrievalIntent({ query, model }) {
    ensureApiKey('openai', this.apiKey);

    const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_output_tokens: 220,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: getRetrievalIntentSystemPrompt() }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: buildRetrievalIntentUserPrompt(query) }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'retrieval_intent',
            strict: true,
            schema: RETRIEVAL_INTENT_SCHEMA,
          },
        },
      }),
    });

    const payload = await parseProviderJson(response, {
      providerName: 'openai',
      logger: this.logger,
      model,
    });
    const text = extractOpenAIText(payload);
    return normalizeIntentPayload(
      parseJsonText(text, 'openai', {
        logger: this.logger,
        model,
      }),
      {
        providerName: 'openai',
        logger: this.logger,
        model,
      },
    );
  }
}
