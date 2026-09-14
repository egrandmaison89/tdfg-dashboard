import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Serves /api/slate locally by running the exact same handler the Netlify Function uses,
 * so `npm run dev` and Playwright exercise real server code without the Netlify CLI.
 */
function slateApiDev(): Plugin {
  const mount = (server: Pick<ViteDevServer, 'ssrLoadModule'>) => {
    let cache: unknown;
    return async (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse) => {
      const { handleSlateRequest } = await server.ssrLoadModule('/src/server/handler.ts');
      const { MemoryCache } = await server.ssrLoadModule('/src/server/cache.ts');
      cache ??= new MemoryCache();
      const url = new URL(req.originalUrl ?? req.url ?? '/api/slate', 'http://localhost');
      const response: Response = await handleSlateRequest(new Request(url, { method: req.method }), { cache });
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await response.text());
    };
  };

  return {
    name: 'tdfg-slate-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/slate', mount(server));
    },
  };
}

export default defineConfig({
  plugins: [react(), slateApiDev()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
