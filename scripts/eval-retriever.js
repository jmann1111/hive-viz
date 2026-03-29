#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import process from 'process';

const DEFAULT_BENCHMARK = 'docs/evals/retriever-benchmark-pack.json';
const DEFAULT_GRAPH = 'public/graph.json';
const METRIC_WEIGHTS = {
  latency_score: 0.15,
  exact_hit_accuracy: 0.25,
  candidate_quality: 0.15,
  hallucination_resistance: 0.2,
  confidence_behavior: 0.15,
  telepathic_feel: 0.1
};
const CONFIDENCE_ORDER = ['low', 'medium', 'high'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function interpolateEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? '');
  }
  if (Array.isArray(value)) {
    return value.map(interpolateEnv);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, interpolateEnv(inner)])
    );
  }
  return value;
}

function makeGraphIndex(graph) {
  const byPath = new Map();
  for (const node of graph.nodes ?? []) {
    byPath.set(node.path, node);
  }
  return { byPath };
}

function validateBenchmark(benchmark, graphIndex) {
  const failures = [];
  for (const testCase of benchmark.cases ?? []) {
    const gold = testCase.gold ?? {};
    if (gold.resolved_path && !graphIndex.byPath.has(gold.resolved_path)) {
      failures.push(`${testCase.id}: missing gold resolved path ${gold.resolved_path}`);
    }
    for (const candidatePath of gold.candidate_paths ?? []) {
      if (!graphIndex.byPath.has(candidatePath)) {
        failures.push(`${testCase.id}: missing gold candidate path ${candidatePath}`);
      }
    }
    if (gold.action === 'candidates') {
      const count = gold.candidate_paths?.length ?? 0;
      if (count < 3 || count > 5) {
        failures.push(`${testCase.id}: candidate gold list must contain 3 to 5 paths`);
      }
    }
  }
  if (failures.length) {
    throw new Error(`Benchmark validation failed:\n- ${failures.join('\n- ')}`);
  }
}

function normalizeRetrieverApiResponse(payload) {
  const mode = payload?.intent?.mode;
  const confidence = payload?.intent?.confidence ?? null;
  if (mode === 'resolve') {
    return {
      action: 'resolve',
      confidence,
      resolved: payload?.result?.note
        ? {
            path: payload.result.note.path ?? null,
            title: payload.result.note.title ?? null
          }
        : null,
      candidates: [],
      question: ''
    };
  }
  if (mode === 'candidates') {
    return {
      action: 'candidates',
      confidence,
      resolved: null,
      candidates: Array.isArray(payload?.result?.candidates)
        ? payload.result.candidates.map((candidate) => ({
            path: candidate.path ?? null,
            title: candidate.title ?? null
          }))
        : [],
      question: ''
    };
  }
  if (mode === 'clarify') {
    return {
      action: 'clarify',
      confidence,
      resolved: null,
      candidates: [],
      question: payload?.result?.question ?? ''
    };
  }
  return null;
}

function normalizeResponse(rawResponse) {
  if (!rawResponse) {
    return {
      action: null,
      confidence: null,
      resolved: null,
      candidates: [],
      question: ''
    };
  }

  const fromRetrieverApi = normalizeRetrieverApiResponse(rawResponse);
  if (fromRetrieverApi) return fromRetrieverApi;

  const source = rawResponse.response ?? rawResponse;
  const resolved = source.resolved ?? (source.resolved_path
    ? { path: source.resolved_path, title: source.resolved_title ?? null }
    : null);
  const candidates = Array.isArray(source.candidates)
    ? source.candidates.map((candidate) => ({
        path: candidate.path ?? candidate.resolved_path ?? null,
        title: candidate.title ?? candidate.resolved_title ?? null
      }))
    : [];

  return {
    action: source.action ?? null,
    confidence: source.confidence ?? null,
    resolved,
    candidates,
    question: typeof source.question === 'string' ? source.question.trim() : ''
  };
}

function extractArtifacts(response) {
  const artifacts = [];
  if (response.action === 'resolve') {
    artifacts.push(response.resolved ?? {});
  }
  if (response.action === 'candidates') {
    artifacts.push(...response.candidates);
  }
  return artifacts;
}

function inspectArtifacts(response, graphIndex) {
  const artifacts = extractArtifacts(response);
  const invalid = [];

  for (const artifact of artifacts) {
    if (!artifact.path) {
      invalid.push({ reason: 'missing_path', artifact });
      continue;
    }
    const node = graphIndex.byPath.get(artifact.path);
    if (!node) {
      invalid.push({ reason: 'invalid_path', artifact });
      continue;
    }
    if (artifact.title && artifact.title !== node.title) {
      invalid.push({
        reason: 'title_mismatch',
        artifact,
        expected_title: node.title
      });
    }
  }

  return {
    totalArtifacts: artifacts.length,
    invalidArtifacts: invalid
  };
}

function scoreLatency(latencyMs) {
  if (latencyMs <= 1200) return 1;
  if (latencyMs <= 2500) return 0.8;
  if (latencyMs <= 4000) return 0.6;
  if (latencyMs <= 6000) return 0.4;
  return 0.2;
}

function scoreExactHit(testCase, response, inspection) {
  if (testCase.gold.action !== 'resolve') return null;
  if (response.action !== 'resolve') return 0;
  if (inspection.invalidArtifacts.length) return 0;
  return response.resolved?.path === testCase.gold.resolved_path ? 1 : 0;
}

function idealDcg(length) {
  let total = 0;
  for (let i = 0; i < length; i++) {
    total += 1 / Math.log2(i + 2);
  }
  return total;
}

function scoreCandidateQuality(testCase, response, inspection) {
  if (testCase.gold.action !== 'candidates') return null;
  if (response.action !== 'candidates' || inspection.invalidArtifacts.length) return 0;

  const actual = response.candidates.map((candidate) => candidate.path).filter(Boolean);
  const expected = testCase.gold.candidate_paths ?? [];
  const count = actual.length;

  const countScore = count >= 3 && count <= 5 ? 1 : count === 2 ? 0.5 : count === 1 ? 0.25 : 0;
  const overlap = actual.filter((item) => expected.includes(item));
  const overlapScore = expected.length ? overlap.length / expected.length : 0;

  const ideal = idealDcg(Math.min(expected.length, Math.max(actual.length, 1)));
  let dcg = 0;
  for (let i = 0; i < actual.length; i++) {
    if (expected.includes(actual[i])) {
      dcg += 1 / Math.log2(i + 2);
    }
  }
  const rankScore = ideal ? dcg / ideal : 0;

  return Number((0.25 * countScore + 0.5 * overlapScore + 0.25 * rankScore).toFixed(4));
}

function confidenceDistance(actual, expected) {
  const actualIndex = CONFIDENCE_ORDER.indexOf(actual);
  const expectedIndex = CONFIDENCE_ORDER.indexOf(expected);
  if (actualIndex === -1 || expectedIndex === -1) return Infinity;
  return Math.abs(actualIndex - expectedIndex);
}

function scoreConfidenceBehavior(testCase, response) {
  const gold = testCase.gold;
  if (response.action !== gold.action) return 0;

  if (gold.action === 'clarify') {
    const question = response.question ?? '';
    if (!question) return 0;
    if (response.confidence !== 'low') {
      return confidenceDistance(response.confidence, 'low') === 1 ? 0.5 : 0;
    }
    return question.length <= 160 ? 1 : 0.75;
  }

  if (response.confidence === gold.confidence) return 1;
  return confidenceDistance(response.confidence, gold.confidence) === 1 ? 0.5 : 0;
}

function average(values) {
  const filtered = values.filter((value) => typeof value === 'number');
  if (!filtered.length) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

async function callJsonEndpoint({ url, method = 'POST', headers = {}, body, timeoutMs = 10000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(interpolateEnv(url), {
      method,
      headers: interpolateEnv({
        'content-type': 'application/json',
        ...headers
      }),
      body: JSON.stringify(interpolateEnv(body)),
      signal: controller.signal
    });

    const raw = await response.json();
    return {
      latencyMs: Date.now() - started,
      raw
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadFixtureProvider(provider) {
  return readJson(interpolateEnv(provider.fixture));
}

async function executeProviderCase(provider, testCase) {
  if (provider.mode === 'fixture') {
    return null;
  }

  if (provider.mode === 'retriever-api' || provider.mode === 'orb-api') {
    return callJsonEndpoint({
      url: provider.url ?? 'http://localhost:8787/api/retriever/retrieve',
      headers: provider.headers ?? {},
      timeoutMs: provider.timeout_ms ?? 10000,
      body: {
        query: testCase.query,
        provider: provider.provider,
        model: provider.model ?? null,
        maxCandidates: provider.maxCandidates ?? 5
      }
    });
  }

  if (provider.mode === 'http') {
    return callJsonEndpoint({
      url: provider.url,
      method: provider.method ?? 'POST',
      headers: provider.headers ?? {},
      timeoutMs: provider.timeout_ms ?? 10000,
      body: provider.body
        ? provider.body
        : {
            query: testCase.query,
            case_id: testCase.id,
            contract_version: 'retriever-response-v1'
          }
    });
  }

  throw new Error(`Unsupported provider mode: ${provider.mode}`);
}

async function runProvider(provider, benchmark, graphIndex) {
  let fixture = null;
  if (provider.mode === 'fixture') {
    fixture = await loadFixtureProvider(provider);
  }

  const caseResults = [];

  for (const testCase of benchmark.cases ?? []) {
    let raw;
    let latencyMs;

    if (provider.mode === 'fixture') {
      const entry = fixture[testCase.id];
      raw = entry?.response ?? null;
      latencyMs = entry?.latency_ms ?? null;
    } else {
      const result = await executeProviderCase(provider, testCase);
      raw = result.raw;
      latencyMs = result.latencyMs;
    }

    const normalized = normalizeResponse(raw);
    const inspection = inspectArtifacts(normalized, graphIndex);
    const latencyScore = latencyMs == null ? null : scoreLatency(latencyMs);
    const exactHit = scoreExactHit(testCase, normalized, inspection);
    const candidateQuality = scoreCandidateQuality(testCase, normalized, inspection);
    const hallucinationRate = inspection.totalArtifacts
      ? inspection.invalidArtifacts.length / inspection.totalArtifacts
      : 0;
    const confidenceBehavior = scoreConfidenceBehavior(testCase, normalized);

    caseResults.push({
      id: testCase.id,
      query: testCase.query,
      expected_action: testCase.gold.action,
      actual_action: normalized.action ?? null,
      latency_ms: latencyMs,
      latency_score: latencyScore,
      exact_hit: exactHit,
      candidate_quality: candidateQuality,
      hallucination_rate: Number(hallucinationRate.toFixed(4)),
      hallucination_events: inspection.invalidArtifacts,
      confidence_behavior: confidenceBehavior,
      response: normalized
    });
  }

  return caseResults;
}

function summarizeProvider(providerId, caseResults, manualRatings) {
  const latencyMsAvg = average(caseResults.map((item) => item.latency_ms));
  const latencyScore = average(caseResults.map((item) => item.latency_score));
  const exactHitAccuracy = average(caseResults.map((item) => item.exact_hit));
  const candidateQuality = average(caseResults.map((item) => item.candidate_quality));
  const hallucinationRate = average(caseResults.map((item) => item.hallucination_rate));
  const hallucinationResistance = hallucinationRate == null ? null : 1 - hallucinationRate;
  const confidenceBehavior = average(caseResults.map((item) => item.confidence_behavior));
  const rating = manualRatings?.[providerId] ?? null;
  const telepathicFeel = typeof rating === 'number' ? rating / 5 : null;

  const metrics = {
    latency_ms_avg: latencyMsAvg == null ? null : Number(latencyMsAvg.toFixed(1)),
    latency_score: latencyScore == null ? null : Number(latencyScore.toFixed(4)),
    exact_hit_accuracy: exactHitAccuracy == null ? null : Number(exactHitAccuracy.toFixed(4)),
    candidate_quality: candidateQuality == null ? null : Number(candidateQuality.toFixed(4)),
    hallucination_rate: hallucinationRate == null ? null : Number(hallucinationRate.toFixed(4)),
    hallucination_resistance: hallucinationResistance == null ? null : Number(hallucinationResistance.toFixed(4)),
    confidence_behavior: confidenceBehavior == null ? null : Number(confidenceBehavior.toFixed(4)),
    telepathic_feel: telepathicFeel == null ? null : Number(telepathicFeel.toFixed(4))
  };

  let weightedNumerator = 0;
  let weightedDenominator = 0;
  for (const [metric, weight] of Object.entries(METRIC_WEIGHTS)) {
    const value = metrics[metric];
    if (typeof value === 'number') {
      weightedNumerator += value * weight;
      weightedDenominator += weight;
    }
  }
  metrics.weighted_score = weightedDenominator
    ? Number(((weightedNumerator / weightedDenominator) * 100).toFixed(2))
    : null;

  const hallucinationCases = caseResults
    .filter((item) => item.hallucination_events.length)
    .map((item) => ({
      id: item.id,
      invalid_count: item.hallucination_events.length,
      events: item.hallucination_events
    }));

  return {
    provider: providerId,
    metrics,
    hallucination_cases: hallucinationCases,
    cases: caseResults
  };
}

function fmt(value) {
  if (value == null) return 'n/a';
  return String(value);
}

function renderMarkdown(benchmark, summaries) {
  const lines = [];
  lines.push('# Retriever Evaluation Report');
  lines.push('');
  lines.push(`Benchmark: ${benchmark.version}`);
  lines.push(`Cases: ${(benchmark.cases ?? []).length}`);
  lines.push('');
  lines.push('| Provider | Weighted | Avg ms | Exact hit | Candidate | Hallucination | Confidence | Telepathic |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const summary of summaries) {
    const m = summary.metrics;
    lines.push(
      `| ${summary.provider} | ${fmt(m.weighted_score)} | ${fmt(m.latency_ms_avg)} | ${fmt(m.exact_hit_accuracy)} | ${fmt(m.candidate_quality)} | ${fmt(m.hallucination_rate)} | ${fmt(m.confidence_behavior)} | ${fmt(m.telepathic_feel)} |`
    );
  }
  lines.push('');
  for (const summary of summaries) {
    lines.push(`## ${summary.provider}`);
    lines.push('');
    if (!summary.hallucination_cases.length) {
      lines.push('- No hallucination events detected.');
    } else {
      for (const item of summary.hallucination_cases) {
        const reasons = item.events.map((event) => event.reason).join(', ');
        lines.push(`- ${item.id}: ${item.invalid_count} invalid artifact(s), reasons: ${reasons}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const benchmarkPath = args.benchmark ?? DEFAULT_BENCHMARK;
  const graphPath = args.graph ?? DEFAULT_GRAPH;
  const providersPath = args.providers;
  const outDir = args['out-dir'] ?? null;
  const manualRatings = args.telepathy ? await readJson(args.telepathy) : null;

  if (!providersPath) {
    throw new Error('Missing required --providers path');
  }

  const benchmark = await readJson(benchmarkPath);
  const graph = await readJson(graphPath);
  const providers = await readJson(providersPath);
  const graphIndex = makeGraphIndex(graph);

  validateBenchmark(benchmark, graphIndex);

  const summaries = [];
  for (const provider of providers) {
    const caseResults = await runProvider(provider, benchmark, graphIndex);
    summaries.push(summarizeProvider(provider.id, caseResults, manualRatings));
  }

  summaries.sort((a, b) => (b.metrics.weighted_score ?? -Infinity) - (a.metrics.weighted_score ?? -Infinity));

  const report = {
    benchmark: benchmark.version,
    graph: graphPath,
    generated_at: new Date().toISOString(),
    summaries
  };
  const markdown = renderMarkdown(benchmark, summaries);

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'retriever-eval-report.json'), JSON.stringify(report, null, 2));
    await writeFile(path.join(outDir, 'retriever-eval-report.md'), `${markdown}\n`);
  }

  console.log(markdown);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
