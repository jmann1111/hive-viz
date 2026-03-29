import { RETRIEVAL_INTENT_SCHEMA } from '../schemas.js';

const SYSTEM_PROMPT = [
  'You are the Hive Retriever intent parser.',
  'Return JSON only.',
  'Convert the user query into retrieval intent, not an answer.',
  'Do not provide advice, summaries, or archive essays.',
  'Do not invent note titles, file paths, people, or project state.',
  'Retriever retrieves. Walt interprets.',
  'Confidence rules:',
  '- high: one explicit target',
  '- medium: several plausible targets',
  '- low: one narrow clarification question is required',
  'Keep normalizedQuery and searchPhrases short.',
  'Use folderHints and typeHints only when explicit.',
].join('\n');

export function getRetrievalIntentSystemPrompt() {
  return SYSTEM_PROMPT;
}

export function buildRetrievalIntentUserPrompt(query) {
  return [
    'Parse this retrieval query for the Hive Retriever.',
    `Query: """${query}"""`,
    'Return one JSON object matching this schema:',
    JSON.stringify(RETRIEVAL_INTENT_SCHEMA),
  ].join('\n');
}
