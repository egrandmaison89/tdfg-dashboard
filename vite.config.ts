import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vitest/config';

type Route = 'slate' | 'history' | 'odds';

/**
 * Serves /api/slate and /api/history locally by running the exact handlers the Netlify Functions use,
 * so `npm run dev` and Playwright exercise real server code without the Netlify CLI.
 * Both routes share one in-memory cache, like the shared Blobs store in production.
 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function apiDev(): Plugin {
  let cache: unknown;

  const mount = (server: Pick<ViteDevServer, 'ssrLoadModule'>, route: Route) => {
    return async (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse) => {
      const handlers = await server.ssrLoadModule('/src/server/handler.ts');
      const { MemoryCache } = await server.ssrLoadModule('/src/server/cache.ts');
      cache ??= new MemoryCache();
      const url = new URL(req.originalUrl ?? req.url ?? `/api/${route}`, 'http://localhost');
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : undefined;
      const request = new Request(url, { method: req.method, ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }) });

      let response: Response;
      if (route === 'odds') {
        // Dev only: a fixed passphrase so the editor is exercisable locally and in e2e.
        response = await handlers.handleOddsRequest(request, { cache, passphrase: process.env.TDFG_ODDS_KEY ?? 'dev-key' });
      } else if (route === 'history') {
        const { HISTORY_BUNDLE } = await server.ssrLoadModule('/src/server/historyBundle/index.ts');
        response = await handlers.handleHistoryRequest(request, { cache, bundle: HISTORY_BUNDLE });
      } else {
        response = await handlers.handleSlateRequest(request, { cache, oddsEditable: true });
      }

      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await response.text());
    };
  };

  return {
    name: 'tdfg-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/slate', mount(server, 'slate'));
      server.middlewares.use('/api/history', mount(server, 'history'));
      server.middlewares.use('/api/odds', mount(server, 'odds'));
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDev()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
