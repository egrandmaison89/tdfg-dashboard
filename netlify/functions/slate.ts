import type { Config } from '@netlify/functions';
import { createCache } from '../../src/server/cache';
import { handleSlateRequest } from '../../src/server/handler';

export default async (req: Request): Promise<Response> => handleSlateRequest(req, { cache: createCache() });

export const config: Config = {
  path: '/api/slate',
};
