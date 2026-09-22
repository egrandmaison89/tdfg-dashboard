import type { Config } from '@netlify/functions';
import { createCache } from '../../src/server/cache';
import { handleOddsRequest } from '../../src/server/handler';

export default async (req: Request): Promise<Response> =>
  handleOddsRequest(req, { cache: createCache(), passphrase: process.env.TDFG_ODDS_KEY });

export const config: Config = {
  path: '/api/odds',
};
