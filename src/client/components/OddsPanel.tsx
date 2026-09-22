import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { BetSummary } from '../../shared/bet';
import type { SeasonHistory } from '../../shared/history';
import { formatAmerican, profitFor, returnFor } from '../../shared/odds';
import { estimateSlate } from '../../shared/oddsEstimate';
import type { SlateResponse, WeekOdds } from '../../shared/types';
import { formatPct, plural } from '../format';

const money = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value % 1 === 0 ? 0 : 2 });

const ODDS_KEY_STORAGE = 'tdfg.oddsKey';

function rememberedKey(): string {
  try {
    return window.localStorage.getItem(ODDS_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function OddsForm({ slate, onSaved, onClose }: { slate: SlateResponse; onSaved: (odds: WeekOdds) => void; onClose: () => void }) {
  const [american, setAmerican] = useState(slate.odds ? String(slate.odds.american) : '');
  const [stake, setStake] = useState(slate.odds ? String(slate.odds.stake) : '');
  const [note, setNote] = useState(slate.odds?.note ?? '');
  const [key, setKey] = useState(rememberedKey);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return; // one request per click, however fast the clicks come
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/odds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ season: slate.season, seasonType: slate.seasonType, week: slate.week, american, stake, note, key }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Save failed (${res.status})`);
      try {
        window.localStorage.setItem(ODDS_KEY_STORAGE, key);
      } catch {
        // Private mode: the passphrase just won't be remembered.
      }
      onSaved((body as { odds: WeekOdds }).odds);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <form className="odds-form" onSubmit={submit} onKeyDown={onKeyDown} data-testid="odds-form">
      <div className="odds-fields">
        <label>
          <span>Odds</span>
          <input
            ref={firstField}
            value={american}
            onChange={(e) => setAmerican(e.target.value)}
            placeholder="+2500"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'odds-error-msg' : undefined}
            data-testid="odds-american"
          />
        </label>
        <label>
          <span>Stake</span>
          <input value={stake} onChange={(e) => setStake(e.target.value)} placeholder="20" inputMode="decimal" required data-testid="odds-stake" />
        </label>
        <label>
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" data-testid="odds-note" />
        </label>
        <label>
          <span>Passphrase</span>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            type="password"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'odds-error-msg' : undefined}
            data-testid="odds-key"
          />
        </label>
      </div>
      {error && (
        <p className="odds-error" id="odds-error-msg" role="alert" data-testid="odds-error">
          {error}
        </p>
      )}
      <div className="odds-actions">
        <button type="submit" className="btn" disabled={saving} data-testid="odds-save">
          {saving ? 'Saving…' : 'Save odds'}
        </button>
        <button type="button" className="link-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * This week's price: what was entered, plus our own estimate (SPEC F16).
 * Odds come from their own short-lived endpoint so a long-cached slate can't pin a stale price.
 */
export function OddsPanel({ slate, summary, seasons }: { slate: SlateResponse; summary: BetSummary; seasons: SeasonHistory[] }) {
  const [odds, setOdds] = useState<WeekOdds | null>(slate.odds);
  const [editable, setEditable] = useState(slate.oddsEditable);
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const { season, seasonType, week } = slate;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/odds?season=${season}&seasontype=${seasonType}&week=${week}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!res.ok) return;
        const body: unknown = await res.json();
        if (body !== null && typeof body === 'object') {
          setOdds(((body as { odds?: WeekOdds | null }).odds ?? null) as WeekOdds | null);
          setEditable(Boolean((body as { editable?: boolean }).editable));
        }
      } catch {
        // Keep whatever the slate carried.
      }
    })();
    return () => controller.abort();
  }, [season, seasonType, week]);

  const closeEditor = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };

  const estimate = estimateSlate(slate.games, seasons);
  const legsLeft = summary.totalLegs - summary.hitLegs;
  const settled = summary.status === 'BUSTED' || summary.status === 'WON';
  const noBet = summary.status === 'NO_BET';
  const payoutLabel = noBet ? 'Would have paid ' : summary.status === 'BUSTED' ? 'Would have paid ' : 'Pays ';

  return (
    <section className="panel odds" aria-labelledby="odds-title" data-testid="odds-panel">
      <div className="panel-head">
        <h2 id="odds-title">Payout</h2>
        {editable && !editing && (
          <button type="button" className="link-btn" ref={editButton} onClick={() => setEditing(true)} data-testid="odds-edit">
            {odds ? 'Edit' : 'Add odds'}
          </button>
        )}
      </div>

      {odds ? (
        <div className="odds-headline" data-testid="odds-headline">
          <span className="odds-price">{formatAmerican(odds.american)}</span>
          <span className="odds-payout">
            {payoutLabel}
            <strong>{money(profitFor(odds.american, odds.stake))}</strong>
          </span>
          <span className="odds-note">
            {money(odds.stake)} stake · returns {money(returnFor(odds.american, odds.stake))}
            {odds.note ? ` · ${odds.note}` : ''}
          </span>
          {noBet && (
            <span className="odds-warn" data-testid="odds-no-bet">
              No bet this week — a game was postponed.
            </span>
          )}
        </div>
      ) : (
        <p className="muted" data-testid="odds-empty">
          No odds saved for this week{editable ? ' yet.' : '.'}
        </p>
      )}

      {editing && <OddsForm slate={{ ...slate, odds }} onSaved={setOdds} onClose={closeEditor} />}

      <p className="odds-estimate" data-testid="odds-estimate">
        {estimate ? (
          <>
            Pre-kickoff estimate for {estimate.teams / 2} games: <strong>{formatAmerican(estimate.american)}</strong>
            {!settled && <> ({formatPct(estimate.probability, 1)} chance)</>} — from {estimate.basedOn.wins} wins in{' '}
            {plural(estimate.basedOn.weeks, 'week')} since 2021.
          </>
        ) : (
          'Estimate unavailable until the history loads.'
        )}
      </p>
      {summary.totalLegs > 0 && (
        <p className="muted" data-testid="odds-progress">
          {legsLeft === 0
            ? 'Every leg is in.'
            : summary.status === 'BUSTED'
              ? `${plural(legsLeft, 'leg')} short.`
              : `${plural(legsLeft, 'leg')} still needed.`}
        </p>
      )}
    </section>
  );
}
