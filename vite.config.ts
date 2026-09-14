import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vitest/config';

type Route = 'slate' | 'history';

/**
 * Serves /api/slate and /api/history locally by running the exact handlers the Netlify Functions use,
 * so `npm run dev` and Playwright exercise real server code without the Netlify CLI.
 * Both routes share one in-memory cache, like the shared Blobs store in production.
 */
function apiDev(): Plugin {
  let cache: unknown;

  const mount = (server: Pick<ViteDevServer, 'ssrLoadModule'>, route: Route) => {
    return async (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse) => {
      const handlers = await server.ssrLoadModule('/src/server/handler.ts');
      const { MemoryCache } = await server.ssrLoadModule('/src/server/cache.ts');
      cache ??= new MemoryCache();
      const url = new URL(req.originalUrl ?? req.url ?? `/api/${route}`, 'http://localhost');
      const request = new Request(url, { method: req.method });

      let response: Response;
      if (route === 'history') {
        const { HISTORY_BUNDLE } = await server.ssrLoadModule('/src/server/historyBundle/index.ts');
        response = await handlers.handleHistoryRequest(request, { cache, bundle: HISTORY_BUNDLE });
      } else {
        response = await handlers.handleSlateRequest(request, { cache });
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
