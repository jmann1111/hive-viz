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
  await fs.mkdir(path.join(vaultRoot, '01-Daily'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '30-Projects', 'alpha'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '30-Projects', 'beta'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '50-Playbooks'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '60-Knowledge'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '60-Knowledge', 'values-psychology'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '10-Sessions'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, '70-Ops', 'health-reports'), { recursive: true });

  const files = {
    '20-Architecture/hive-conventions.md': '# Hive Conventions\n',
    '01-Daily/2026-03-06.md': '# 2026-03-06\n\nReviewed the hive conventions doc and tightened the rules.\n',
    '30-Projects/alpha/launch-plan.md': '# Launch Plan\n',
    '30-Projects/beta/launch-checklist.md': '# Launch Checklist\n',
    '50-Playbooks/playbook-launch.md': '# Launch Playbook\n',
    '60-Knowledge/memory-service.md': '# Memory Service\n',
    '60-Knowledge/values-psychology/psychological-profile.md': '# Psychological Profile\n',
    '10-Sessions/2026-03-15-session-log.md': '# Session Log 2026-03-15\n\nMost recent log notes for the Hive Viz retrieval sprint.\n',
    '70-Ops/health-reports/2026-03-12-reindex-report.md': '# Reindex Report 2026-03-12\n',
    '70-Ops/health-reports/2026-03-13-reindex-report.md': '# Reindex Report 2026-03-13\n',
    '70-Ops/health-reports/2026-03-13-morning-report.md': '# Morning Report 2026-03-13\n',
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
        id: 'daily-conventions-note',
        title: '2026-03-06',
        path: '01-Daily/2026-03-06.md',
        folder: '01-Daily',
        type: 'daily-note',
        date: '2026-03-06',
        tags: ['daily'],
        content: 'Reviewed the hive conventions doc and tightened the rules.',
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
      {
        id: 'session-log-2026-03-15',
        title: 'Session Log',
        path: '10-Sessions/2026-03-15-session-log.md',
        folder: '10-Sessions',
        type: 'session-log',
        date: '2026-03-15',
        tags: ['session-log', 'log'],
        content: 'Most recent log notes for the Hive Viz retrieval sprint.',
      },
      {
        id: 'reindex-report-2026-03-12',
        title: 'Reindex Report',
        path: '70-Ops/health-reports/2026-03-12-reindex-report.md',
        folder: '70-Ops',
        type: 'ops',
        date: '2026-03-12',
        tags: ['report', 'reindex'],
        content: 'Graph health reindex report for March 12.',
      },
      {
        id: 'reindex-report-2026-03-13',
        title: 'Reindex Report',
        path: '70-Ops/health-reports/2026-03-13-reindex-report.md',
        folder: '70-Ops',
        type: 'ops',
        date: '2026-03-13',
        tags: ['report', 'reindex'],
        content: 'Graph health reindex report for March 13.',
      },
      {
        id: 'morning-report-2026-03-13',
        title: 'Morning Report',
        path: '70-Ops/health-reports/2026-03-13-morning-report.md',
        folder: '70-Ops',
        type: 'ops',
        date: '2026-03-13',
        tags: ['report', 'morning'],
        content: 'Morning ops report for March 13.',
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
      },
      apiKeys: {
        openai: '',
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    providers: {
      openai: provider,
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

test('prefers the exact hive conventions doc over a nearby daily note', async () => {
  const server = await startTestServer({
    provider: {
      async classifyRetrievalIntent() {
        return {
          confidence: 'high',
          normalizedQuery: 'hive conventions doc',
          searchPhrases: ['open the hive conventions doc', 'hive conventions doc', 'hive conventions'],
          folderHints: ['20-Architecture'],
          typeHints: ['architecture', 'doc'],
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
        query: 'open the hive conventions doc',
        model: 'gpt-4.1-mini',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.mode, 'resolved_note');
    assert.equal(payload.note.title, 'Hive Conventions');
    assert.equal(payload.note.path.vaultRelativePath, '20-Architecture/hive-conventions.md');
    assert.equal(
      payload.note.path.absolutePath,
      path.join(server.fixture.vaultRoot, '20-Architecture/hive-conventions.md'),
    );
  } finally {
    await server.close();
  }
});

test('prefers exact doc-name queries over semantically nearby daily notes', async () => {
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
        query: 'find hive conventions',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.mode, 'resolved_note');
    assert.equal(payload.note.title, 'Hive Conventions');
    assert.equal(payload.note.path.vaultRelativePath, '20-Architecture/hive-conventions.md');
    assert.notEqual(payload.note.path.vaultRelativePath, '01-Daily/2026-03-06.md');
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
        maxCandidates: 3,
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.mode, 'candidate_notes');
    assert.equal(payload.candidates.length, 3);
    assert.match(payload.candidates[0].reason, /30-Projects|50-Playbooks/);
    assert.deepEqual(
      payload.candidates.map((candidate) => candidate.title),
      ['Launch Checklist', 'Launch Plan', 'Launch Playbook'],
    );
  } finally {
    await server.close();
  }
});

test('keeps the most recent log query conservative and returns candidates', async () => {
  const server = await startTestServer({
    provider: {
      async classifyRetrievalIntent() {
        return {
          confidence: 'high',
          normalizedQuery: 'most recent log',
          searchPhrases: ['pull up the most recent log', 'most recent log', 'latest log'],
          folderHints: ['10-Sessions', '70-Ops'],
          typeHints: ['session-log', 'morning-report', 'ops'],
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
        query: 'pull up the most recent log',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.mode, 'candidate_notes');
    assert.equal(payload.note, undefined);
    assert.ok(payload.candidates.length >= 1);
    assert.ok(
      payload.candidates.some((candidate) => candidate.path.vaultRelativePath === '10-Sessions/2026-03-15-session-log.md'),
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

test('rejects provider fields in the openai-only request contract', async () => {
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
    assert.equal(payload.error.details.reason, 'unexpected_field');
    assert.equal(payload.error.details.field, 'provider');
  } finally {
    await server.close();
  }
});

test('threads clarification context into provider parsing for immediate follow-up narrowing', async () => {
  let capturedQuery = '';
  const server = await startTestServer({
    provider: {
      async classifyRetrievalIntent({ query }) {
        capturedQuery = query;
        return {
          confidence: 'low',
          normalizedQuery: 'launch',
          searchPhrases: ['launch'],
          folderHints: ['30-Projects'],
          typeHints: ['project'],
          clarificationQuestion: 'Which launch note do you want',
        };
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/orb/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'the beta one',
        clarification: {
          previousQuery: 'launch',
          question: 'Which launch note do you want?',
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.match(capturedQuery, /Previous retrieval query: launch/);
    assert.match(capturedQuery, /Clarification question: Which launch note do you want\?/);
    assert.match(capturedQuery, /Follow-up answer: the beta one/);
  } finally {
    await server.close();
  }
});

test('resolves latest reindex report by recency instead of generic token score', async () => {
  const server = await startTestServer({
    provider: {
      async classifyRetrievalIntent() {
        return {
          confidence: 'high',
          normalizedQuery: 'reindex report',
          searchPhrases: ['latest reindex report', 'reindex report'],
          folderHints: ['70-Ops'],
          typeHints: ['ops'],
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
        query: 'latest reindex report',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.mode, 'resolved_note');
    assert.equal(
      payload.note.path.vaultRelativePath,
      '70-Ops/health-reports/2026-03-13-reindex-report.md',
    );
  } finally {
    await server.close();
  }
});

test('returns candidates for broad latest report queries instead of overconfident direct opens', async () => {
  const server = await startTestServer({
    provider: {
      async classifyRetrievalIntent() {
        return {
          confidence: 'high',
          normalizedQuery: 'report',
          searchPhrases: ['latest report', 'report'],
          folderHints: ['70-Ops'],
          typeHints: ['ops'],
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
        query: 'latest report',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.mode, 'candidate_notes');
    assert.equal(payload.candidates.length, 3);
    assert.equal(payload.candidates[0].path.vaultRelativePath, '70-Ops/health-reports/2026-03-13-reindex-report.md');
    assert.match(payload.candidates[0].reason, /2026-03-13/);
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
      },
      apiKeys: {
        openai: '',
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
      },
      apiKeys: {
        openai: '',
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
