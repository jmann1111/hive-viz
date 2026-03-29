import http from 'http';

import { loadConfig } from './config.js';
import { createRetrieveHandler, sendJson } from './handlers/retrieve.js';
import { createLogger } from './logger.js';
import { createProviderRegistry } from './providers/index.js';
import { loadGraphIndex } from './retrieval/graph-index.js';

export async function createRetrieverServer({
  config = loadConfig(),
  logger = createLogger(),
  providers = null,
  index = null,
} = {}) {
  const graphIndex = index || (await loadGraphIndex(config.graphPath));
  const providerRegistry = providers || createProviderRegistry(config, { logger });
  const handleRetrieve = createRetrieveHandler({
    config,
    logger,
    providers: providerRegistry,
    index: graphIndex,
  });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && (req.url === '/api/retriever/retrieve' || req.url === '/api/orb/retrieve')) {
      await handleRetrieve(req, res);
      return;
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        graphPath: config.graphPath,
        vaultRoot: config.vaultRoot,
      });
      return;
    }

    sendJson(res, 404, {
      error: {
        message: 'Not found',
      },
    });
  });

  return {
    server,
    config,
    logger,
    index: graphIndex,
    providers: providerRegistry,
  };
}

async function start() {
  const app = await createRetrieverServer();
  app.server.listen(app.config.serverPort, () => {
    app.logger.info('retriever.server.started', {
      port: app.config.serverPort,
      graphPath: app.config.graphPath,
      vaultRoot: app.config.vaultRoot,
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export const createOrbServer = createRetrieverServer;
