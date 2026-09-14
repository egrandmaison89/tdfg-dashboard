/**
 * Generates the committed history bundle for completed seasons (ARCHITECTURE ADR-006).
 *
 *   npm run build:history              # 2021 through 2025
 *   npm run build:history -- 2026 2026 # a single season, once it has ended
 *
 * Runs the production pipeline (buildSlate → gradeWeek) against ESPN through a disk cache in
 * .cache/espn, so re-runs never re-fetch. Refuses to write a season that isn't fully final.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSlate } from '../src/server/buildSlate';
import { MemoryCache } from '../src/server/cache';
import { EspnSource, type DataSource, type SlateParams } from '../src/server/source';
import { parseRegularSeasonCalendar } from '../src/shared/calendar';
import { FINAL_WEEK_STATUSES, gradeWeek, REGULAR_SEASON_TYPE, type SeasonHistory, type WeekGrade } from '../src/shared/history';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'espn');
const OUT_DIR = path.join(ROOT, 'src', 'server', 'historyBundle', 'seasons');

class DiskCachedSource implements DataSource {
  readonly name = 'espn' as const;
  fetched = 0;
  fromCache = 0;
  private readonly upstream = new EspnSource(undefined, 15_000);

  scoreboard(p: SlateParams): Promise<unknown> {
    const file = path.join(CACHE_DIR, 'scoreboards', `${p.year}-${p.seasonType}-${p.week}.json`);
    return this.cached(file, () => this.upstream.scoreboard(p));
  }

  summary(eventId: string): Promise<unknown> {
    return this.cached(path.join(CACHE_DIR, 'summaries', `${eventId}.json`), () => this.upstream.summary(eventId));
  }

  private async cached(file: string, load: () => Promise<unknown>): Promise<unknown> {
    try {
      const data: unknown = JSON.parse(await readFile(file, 'utf8'));
      this.fromCache += 1;
      return data;
    } catch {
      const data = await load();
      this.fetched += 1;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(data));
      return data;
    }
  }
}

async function buildSeason(season: number, source: DiskCachedSource): Promise<SeasonHistory> {
  const calendar = parseRegularSeasonCalendar(await source.scoreboard({ year: season, seasonType: REGULAR_SEASON_TYPE, week: 1 }));
  const lastWeek = calendar.at(-1);
  if (!lastWeek) throw new Error(`No regular-season calendar for ${season}`);
  if (Date.parse(lastWeek.end) > Date.now()) throw new Error(`${season} hasn't ended; it is graded at runtime instead`);

  const weeks: WeekGrade[] = [];
  for (const { week } of calendar) {
    const slate = await buildSlate(
      { year: season, seasonType: REGULAR_SEASON_TYPE, week },
      { source, cache: new MemoryCache(), now: () => new Date(), log: (message, err) => console.warn(message, err) },
    );
    if (slate.season !== season || slate.week !== week) {
      throw new Error(`ESPN returned ${slate.season} week ${slate.week} when asked for ${season} week ${week}`);
    }
    const { grade, settled } = gradeWeek(season, week, slate.games, slate.slateDate);
    if (!settled || !FINAL_WEEK_STATUSES.has(grade.status)) {
      throw new Error(`${season} week ${week} is not final (status: ${grade.status})`);
    }
    weeks.push(grade);
  }
  return { season, complete: true, weeks };
}

async function main() {
  const [from = '2021', to = from === '2021' ? '2025' : from] = process.argv.slice(2);
  const source = new DiskCachedSource();
  await mkdir(OUT_DIR, { recursive: true });

  for (let season = Number(from); season <= Number(to); season++) {
    const history = await buildSeason(season, source);
    await writeFile(path.join(OUT_DIR, `${season}.json`), `${JSON.stringify(history, null, 2)}\n`);
    const won = history.weeks.filter((w) => w.status === 'won').map((w) => w.week);
    const graded = history.weeks.filter((w) => w.status === 'won' || w.status === 'lost').length;
    console.log(`${season}: ${won.length}-${graded - won.length}  won weeks: ${won.join(', ') || 'none'}`);
  }
  console.log(`ESPN requests: ${source.fetched} fetched, ${source.fromCache} served from .cache/espn`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
