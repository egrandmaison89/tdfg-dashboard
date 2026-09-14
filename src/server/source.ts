/** Upstream data sources (ADR-001). */

export interface SlateParams {
  year?: number;
  seasonType?: number;
  week?: number;
}

export interface DataSource {
  readonly name: 'espn' | 'demo';
  scoreboard(params: SlateParams): Promise<unknown>;
  summary(eventId: string): Promise<unknown>;
}

export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const DEFAULT_TIMEOUT_MS = 6_000;

export function scoreboardUrl(params: SlateParams): string {
  const query = new URLSearchParams();
  if (params.week !== undefined) query.set('week', String(params.week));
  if (params.seasonType !== undefined) query.set('seasontype', String(params.seasonType));
  if (params.year !== undefined) query.set('dates', String(params.year));
  const qs = query.toString();
  return `${ESPN_BASE}/scoreboard${qs ? `?${qs}` : ''}`;
}

export class EspnSource implements DataSource {
  readonly name = 'espn' as const;

  constructor(
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  scoreboard(params: SlateParams): Promise<unknown> {
    return this.getJson(scoreboardUrl(params));
  }

  summary(eventId: string): Promise<unknown> {
    return this.getJson(`${ESPN_BASE}/summary?event=${encodeURIComponent(eventId)}`);
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await this.fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`ESPN responded ${res.status} for ${url}`);
    return res.json();
  }
}
