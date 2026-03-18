import fs from 'fs';
import path from 'path';

const DEFAULT_VAULT_ROOTS = [
  '/Users/jasonmann/Documents/The-Hive',
  '/Users/jasonmann/Documents/The-Hive-Sync',
];
const DEFAULT_GRAPH_PATH = './public/graph.json';
const DEFAULT_SERVER_PORT = 8787;
const DEFAULT_PROVIDER_TIMEOUT_MS = 6000;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  const cwd = process.cwd();
  const configuredVaultRoot = env.HIVE_VAULT_ROOT
    || DEFAULT_VAULT_ROOTS.find((candidate) => fs.existsSync(candidate))
    || '';
  const vaultRoot = path.resolve(configuredVaultRoot);
  const graphPath = path.resolve(cwd, env.ORB_GRAPH_PATH || DEFAULT_GRAPH_PATH);

  if (!vaultRoot || !fs.existsSync(vaultRoot)) {
    throw new Error('Vault root not found. Set HIVE_VAULT_ROOT before starting the orb server.');
  }

  if (!fs.existsSync(graphPath)) {
    throw new Error(`Graph file not found at ${graphPath}`);
  }

  return {
    cwd,
    vaultRoot,
    graphPath,
    serverPort: parsePositiveInt(env.ORB_SERVER_PORT, DEFAULT_SERVER_PORT),
    providerTimeoutMs: parsePositiveInt(
      env.ORB_PROVIDER_TIMEOUT_MS,
      DEFAULT_PROVIDER_TIMEOUT_MS,
    ),
    defaultModels: {
      openai: env.OPENAI_MODEL || 'gpt-4.1-mini',
      gemini: env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    apiKeys: {
      openai: env.OPENAI_API_KEY || '',
      gemini: env.GEMINI_API_KEY || '',
    },
  };
}
