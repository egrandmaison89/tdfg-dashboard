import type { Config } from '@netlify/functions';
import { createCache } from '../../src/server/cache';
import { handleHistoryRequest } from '../../src/server/handler';
import { HISTORY_BUNDLE } from '../../src/server/historyBundle';

export default async (req: Request): Promise<Response> =>
  handleHistoryRequest(req, { cache: createCache(), bundle: HISTORY_BUNDLE });

export const config: Config = {
  path: '/api/history',
};
