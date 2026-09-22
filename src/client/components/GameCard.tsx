import { isOffTheBoard, isSettled } from '../../shared/bet';
import { assessTeam, gameRisk, RISK_SEVERITY } from '../../shared/risk';
import { DriveStrip } from './DriveStrip';
import type { Game, LegType, RiskLevel, TeamLine } from '../../shared/types';
import { gameStatusText, LEG_NAME, RISK_LABEL } from '../format';

export function TeamLogo({ team, size = 28 }: { team: TeamLine; size?: number }) {
  if (team.logo) {
    return <img className="logo" src={team.logo} alt="" width={size} height={size} loading="lazy" decoding="async" />;
  }
  return (
    <span
      className="logo logo-fallback"
      style={{ width: size, height: size, background: team.color ?? 'var(--surface-2)' }}
      aria-hidden="true"
    >
      {team.abbr.slice(0, 1)}
    </span>
  );
}

export type LegState = 'hit' | 'busted' | 'pending' | 'void';

const STATE_WORD: Record<LegState, string> = { hit: 'scored', busted: 'missed', pending: 'needed', void: 'void' };

export function LegIcon({ state, count = 0, label }: { state: LegState; count?: number; label: string }) {
  return (
    <span className={`leg leg-${state}`} role="img" aria-label={label} title={label} data-testid="leg" data-state={state}>
      {state === 'hit' && (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
      )}
      {state === 'busted' && (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      )}
      {count > 1 && (
        <span className="leg-count" aria-hidden="true">
          {count}
        </span>
      )}
    </span>
  );
}

function legState(game: Game, count: number): LegState {
  if (count > 0) return 'hit';
  if (isSettled(game)) return 'busted';
  if (game.state === 'void') return 'void';
  return 'pending';
}

function LegCell({ game, team, type }: { game: Game; team: TeamLine; type: LegType }) {
  const count = type === 'TD' ? team.tdCount : team.fgCount;
  const state = legState(game, count);
  const label = `${team.abbr} ${LEG_NAME[type]} ${STATE_WORD[state]}`;
  return <LegIcon state={state} count={count} label={label} />;
}

const BADGE_RISKS: RiskLevel[] = ['watch', 'danger', 'last_chance', 'busted', 'void'];

export function GameCard({ game }: { game: Game }) {
  const risk = gameRisk(game);
  const offBoard = isOffTheBoard(game);
  const [away, home] = game.teams;
  const live = game.state === 'in';
  const possessor = live ? game.teams.find((t) => t.id === game.possessionTeamId) : undefined;
  const showBadge = offBoard || BADGE_RISKS.includes(risk);
  // Why this game is flagged, from whichever side is in the most trouble (AC14.4).
  const worst = game.teams
    .map((team) => assessTeam(game, team))
    .sort((a, b) => RISK_SEVERITY[b.level] - RISK_SEVERITY[a.level])[0];
  const why = worst && (worst.level === 'danger' || worst.level === 'last_chance') ? worst.reasons : [];

  return (
    <article
      className={`card risk-${risk}${offBoard ? ' is-off' : ''}`}
      data-testid="game-card"
      data-game-id={game.id}
      data-risk={risk}
      aria-label={`${away.abbr} at ${home.abbr}`}
    >
      <header className="card-head">
        <span className={`game-status${live ? ' is-live' : ''}`}>
          {live && <span className="live-dot" aria-hidden="true" />}
          {gameStatusText(game)}
        </span>
        {showBadge && (
          <span className={`badge badge-${offBoard ? 'done' : risk}`}>{offBoard ? 'Off the board' : RISK_LABEL[risk]}</span>
        )}
      </header>

      <div className="team-grid grid-head" aria-hidden="true">
        <span />
        <span />
        <span>TD</span>
        <span>FG</span>
      </div>
      {game.teams.map((team) => (
        <div key={team.id} className="team-grid team-row" data-testid="team-row" data-team={team.abbr}>
          <span className="team-id">
            <TeamLogo team={team} />
            <span className="abbr">{team.abbr}</span>
            {possessor?.id === team.id && (
              <span
                className={`ball${game.isRedZone ? ' is-rz' : ''}`}
                role="img"
                aria-label={game.isRedZone ? `${team.abbr} has the ball in the red zone` : `${team.abbr} has the ball`}
              >
                🏈
              </span>
            )}
          </span>
          <span className="score">{game.state === 'pre' || game.state === 'void' ? '–' : team.score}</span>
          <LegCell game={game} team={team} type="TD" />
          <LegCell game={game} team={team} type="FG" />
        </div>
      ))}

      <DriveStrip game={game} />

      {(why.length > 0 || !game.legsVerified) && (
        <footer className="card-foot">
          {why.length > 0 && (
            <span className="why" data-testid="risk-why">
              {why.join(' · ')}
            </span>
          )}
          {!game.legsVerified && (
            <span className="verifying" data-testid="verifying" title="Scoring plays are catching up with the score">
              verifying…
            </span>
          )}
        </footer>
      )}
    </article>
  );
}
