/**
 * Production API server for Render.
 *
 * Render provides PORT and keeps provider secrets in its environment. This
 * entrypoint intentionally does not depend on a local .env file.
 */

import './lib/loadEnv.ts';

import { serve } from '@hono/node-server';
import app from './index.ts';
import { log } from './lib/logger.ts';

const port = Number.parseInt(process.env.PORT ?? '10000', 10);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT: ${process.env.PORT ?? '(empty)'}`);
}

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  log.info('EpiFlora Render API listening', {
    port: info.port,
    configured: {
      gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
      ollama: process.env.OLLAMA_ENABLED === 'true',
    },
  });
});
