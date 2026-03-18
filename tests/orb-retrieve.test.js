import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrbServer } from '../src/server/index.js';
import { GeminiProvider } from '../src/server/providers/gemini.js';
import { OpenAIProvider } from '../src/server/providers/openai.js';

async function makeFixture() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'orb-retrieve-'));
  const vaultRoot = path.join(tempRoot, 'vault');
  const graphPath = path.join(tempRoot, 'graph.json');

  await fs.mkdir(path.join(vaultRoot, '20-Architecture'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '30-Projects', 'alpha'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '30-Projects', 'beta'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '50-Playbooks'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '60-Knowledge'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '60-Knowledge', 'values-psychology'), { recursive: true });

  const files = {
    '20-Architecture/hive-conventions.md': '# Hive Conventions\n',
    '30-Projects/alpha/launch-plan.md': '# Launch Plan\n',
    '30-Projects/beta/launch-checklist.md': '# Launch Checklist\n',
    '50-Playbooks/playbook-launch.md': '# Launch Playbook\n',
    '60-Knowledge/memory-service.md': '# Memory Service\n',
    '60-Knowledge/values-psychology/psychological-profile.md': '# Psychological Profile\n',
  };

  await Promise.all(
    Object.entries(files).map(([relativePath, contents]) =>
      fs.writeFile(path.join(vaultRoot, relativePath), contents),
    ),
  );

  const graph = {
    nodes: [
      {
        id: 'hive-conventions',
        title: 'Hive Conventions',
        path: '20-Architecture/hive-conventions.md',
        folder: '20-Architecture',
        type: 'architecture',
        tags: ['architecture'],
        content: 'Naming rules for the Hive.',
      },
      {
        id: 'launch-plan',
        title: 'Launch Plan',
        path: '30-Projects/alpha/launch-plan.md',
        folder: '30-Projects',
        type: 'project',
        tags: ['launch'],
        content: 'Alpha launch plan.',
      },
      {
        id: 'launch-checklist',
        title: 'Launch Checklist',
        path: '30-Projects/beta/launch-checklist.md',
        folder: '30-Projects',
        type: 'project',
        tags: ['launch'],
        content: 'Beta launch checklist.',
      },
      {
        id: 'playbook-launch',
        title: 'Launch Playbook',
        path: '50-Playbooks/playbook-launch.md',
        folder: '50-Playbooks',
        type: 'playbook',
        tags: ['launch'],
        content: 'Standard launch playbook.',
      },
      {
        id: 'memory-service',
        title: 'Memory Service',
        path: '60-Knowledge/memory-service.md',
        folder: '60-Knowledge',
        type: 'knowledge',
        tags: ['memory'],
        content: 'Memory service details.',
      },
      {
        id: 'psychological-profile',
        title: 'Psychological Profile',
        path: '60-Knowledge/values-psychology/psychological-profile.md',
        folder: '60-Knowledge',
        type: 'knowledge',
        tags: ['psychology'],
        content: 'Jason psychological profile.',
      },
    ],
    edges: [],
    meta: {},
  };

  await fs.writeFile(graphPath, JSON.stringify(graph));

  return { tempRoot, vaultRoot, graphPath };
}

function makeJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function startTestServer({ provider }) {
  const fixture = await makeFixture();
  const app = await createOrbServer({
    config: {
      vaultRoot: fixture.vaultRoot,
      graphPath: fixture.graphPath,
      serverPort: 0,
      providerTimeoutMs: 1000,
      defaultModels: {
        openai: 'gpt-4.1-mini',
        gemini: 'gemini-2.5-flash',
      },
      apiKeys: {
        openai: '',
        gemini: '',
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    providers: {
      openai: provider,
      gemini: provider,
    },
  });

  await new Promise((resolve) => app.server.listen(0, resolve));
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    fixture,
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => {
        app.server.close((error) => (error ? reject(error) : resolve()));
      });
      await fs.rm(fixture.tempRoot, { recursive: true, force: true });
    },
  };
}

test('resolves a high-confidence note with a validated absolute path', async () => {
  const server = await startTestServer({
    provider: {
      async classifyRetrievalIntent() {
        return {
          confidence: 'high',
          normalizedQuery: 'hive conventions',
          searchPhrases: ['hive conventions', 'conventions'],
          folderHints: ['20-Architecture'],
          typeHints: ['architecture'],
          clarificationQuestion: null,
        };
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/orb/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'open hive conventions',
        provider: 'openai',
        model: 'gpt-4.1-mini',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.mode, 'resolved_note');
    assert.equal(payload.note.title, 'Hive Conventions');
    assert.equal(
      payload.note.path.absolutePath,
      path.join(server.fixture.vaultRoot, '20-Architecture/hive-conventions.md'),
    );
  } finally {
    await server.close();
  }
});

test('returns 3 candidates for medium confidence ambiguity', async () => {
  const server = await startTestServer({
    provider: {
      async classifyRetrievalIntent() {
        return {
          confidence: 'medium',
          normalizedQuery: 'launch',
          searchPhrases: ['launch', 'launch plan', 'launch checklist'],
          folderHints: ['30-Projects', '50-Playbooks'],
          typeHints: ['project', 'playbook'],
          clarificationQuestion: null,
        };
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/orb/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'launch',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        maxCandidates: 3,
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.mode, 'candidate_notes');
    assert.equal(payload.candidates.length, 3);
    assert.deepEqual(
      payload.candidates.map((candidate) => candidate.title),
      ['Launch Checklist', 'Launch Plan', 'Launch Playbook'],
    );
  } finally {
    await server.close();
  }
});

test('asks one narrow clarification question for low confidence', async () => {
  const server = await startTestServer({
    provider: {
      async classifyRetrievalIntent() {
        return {
          confidence: 'low',
          normalizedQuery: 'that note',
          searchPhrases: ['that note'],
          folderHints: [],
          typeHints: [],
          clarificationQuestion: 'Which note do you want',
        };
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/orb/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'open that note',
        provider: 'openai',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.mode, 'clarification_request');
    assert.match(payload.question, /\?$/);
  } finally {
    await server.close();
  }
});

test('rejects invalid provider names', async () => {
  const server = await startTestServer({
    provider: {
      async classifyRetrievalIntent() {
        throw new Error('should not be called');
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/orb/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'open hive conventions',
        provider: 'anthropic',
      }),
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error.details.reason, 'unsupported_provider');
  } finally {
    await server.close();
  }
});

test('rejects malformed provider intent payloads', async () => {
  const server = await startTestServer({
    provider: {
      async classifyRetrievalIntent() {
        return {
          confidence: 'high',
          normalizedQuery: '',
          searchPhrases: [],
          folderHints: [],
          typeHints: [],
          clarificationQuestion: null,
        };
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/orb/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'open hive conventions',
        provider: 'openai',
      }),
    });

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.error.details.reason, 'schema_mismatch');
    assert.equal(payload.error.details.field, 'normalizedQuery');
  } finally {
    await server.close();
  }
});

test('parses fenced provider JSON for the exact psychological profile query', async () => {
  const logs = [];
  const fixture = await makeFixture();
  const provider = new OpenAIProvider({
    apiKey: 'test-key',
    timeoutMs: 1000,
    logger: {
      info() {},
      warn(event, payload) {
        logs.push({ event, payload });
      },
      error() {},
    },
    fetchImpl: async () => makeJsonResponse({
      output_text: [
        'Here is the JSON:',
        '```json',
        JSON.stringify({
          confidence: 'high',
          normalizedQuery: 'psychological profile',
          searchPhrases: ['psychological profile', 'profile'],
          folderHints: ['60-Knowledge'],
          typeHints: ['knowledge'],
          clarificationQuestion: null,
        }),
        '```',
      ].join('\n'),
    }),
  });

  const app = await createOrbServer({
    config: {
      vaultRoot: fixture.vaultRoot,
      graphPath: fixture.graphPath,
      serverPort: 0,
      providerTimeoutMs: 1000,
      defaultModels: {
        openai: 'gpt-4.1-mini',
        gemini: 'gemini-2.5-flash',
      },
      apiKeys: {
        openai: '',
        gemini: '',
      },
    },
    logger: {
      info() {},
      warn(event, payload) {
        logs.push({ event, payload });
      },
      error() {},
    },
    providers: {
      openai: provider,
      gemini: provider,
    },
  });

  try {
    await new Promise((resolve) => app.server.listen(0, resolve));
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/orb/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'find my psychological profile',
        provider: 'openai',
        model: 'gpt-4.1-mini',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.mode, 'resolved_note');
    assert.equal(payload.note.title, 'Psychological Profile');
    assert.equal(payload.note.path.vaultRelativePath, '60-Knowledge/values-psychology/psychological-profile.md');
    assert.equal(logs.length, 0);
  } finally {
    await new Promise((resolve, reject) => {
      app.server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('returns invalid_json diagnostics and logs raw provider output on parse failure', async () => {
  const logs = [];
  const fixture = await makeFixture();
  const provider = new OpenAIProvider({
    apiKey: 'test-key',
    timeoutMs: 1000,
    logger: {
      info() {},
      warn(event, payload) {
        logs.push({ event, payload });
      },
      error() {},
    },
    fetchImpl: async () => makeJsonResponse({
      output_text: '```json\n{"confidence":"high","normalizedQuery":"psychological profile"\n```',
    }),
  });

  const app = await createOrbServer({
    config: {
      vaultRoot: fixture.vaultRoot,
      graphPath: fixture.graphPath,
      serverPort: 0,
      providerTimeoutMs: 1000,
      defaultModels: {
        openai: 'gpt-4.1-mini',
        gemini: 'gemini-2.5-flash',
      },
      apiKeys: {
        openai: '',
        gemini: '',
      },
    },
    logger: {
      info() {},
      warn(event, payload) {
        logs.push({ event, payload });
      },
      error() {},
    },
    providers: {
      openai: provider,
      gemini: provider,
    },
  });

  try {
    await new Promise((resolve) => app.server.listen(0, resolve));
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/orb/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'find my psychological profile',
        provider: 'openai',
        model: 'gpt-4.1-mini',
      }),
    });

    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.error.details.reason, 'invalid_json');
    assert.equal(logs.some((entry) => entry.event === 'provider.invalid_json'), true);
    assert.equal(
      logs.some((entry) => String(entry.payload.rawProviderOutput || '').includes('psychological profile')),
      true,
    );
  } finally {
    await new Promise((resolve, reject) => {
      app.server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('gemini logs raw failure details and sends a Gemini-safe structured-output request', async () => {
  const logs = [];
  let capturedUrl = '';
  let capturedBody = null;

  const provider = new GeminiProvider({
    apiKey: 'test-key',
    timeoutMs: 1000,
    logger: {
      info() {},
      warn(event, payload) {
        logs.push({ event, payload });
      },
      error() {},
    },
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedBody = JSON.parse(options.body);

      return makeJsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '```json\n{"confidence":"high","normalizedQuery":"psychological profile"\n```',
                },
              ],
            },
          },
        ],
      });
    },
  });

  await assert.rejects(
    () => provider.classifyRetrievalIntent({
      query: 'find my psychological profile',
      model: 'gemini-2.5-flash',
    }),
    (error) => {
      assert.equal(error.details.reason, 'invalid_json');
      return true;
    },
  );

  assert.match(capturedUrl, /\/models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(capturedBody.system_instruction.parts[0].text.includes('Hive orb retrieval intent parser'), true);
  assert.equal(capturedBody.generationConfig.responseMimeType, 'application/json');
  assert.equal(typeof capturedBody.generationConfig.responseJsonSchema, 'object');
  assert.equal('propertyOrdering' in capturedBody.generationConfig.responseJsonSchema, false);
  assert.equal(
    capturedBody.generationConfig.responseJsonSchema.properties.normalizedQuery.type,
    'string',
  );
  assert.equal(logs.some((entry) => entry.event === 'provider.invalid_json'), true);
  assert.equal(
    logs.some((entry) => String(entry.payload.requestBody || '').includes('responseMimeType')),
    true,
  );
  assert.equal(
    logs.some((entry) => String(entry.payload.rawProviderPayload || '').includes('psychological profile')),
    true,
  );
});
