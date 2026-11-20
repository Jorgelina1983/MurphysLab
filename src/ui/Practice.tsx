import { useEffect, useMemo, useState } from 'react';
import type { BacktestOptions, Trade } from '../core/backtest';
import { atr, type ComputeOptions } from '../core/indicators';
import { compareWithRule, replay, replayStart, type ReplayState, type ReplayStep } from '../core/replay';
import { buildContext, compileRule, evaluateAt, scanSignals } from '../core/rule/engine';
import type { Rule, Signal } from '../core/rule/types';
import type { Candle, IndicatorOutputs, Side } from '../core/types';
import { fmtNum, fmtPrice, fmtR, fmtTime, t, tn } from '../i18n';
import { Info, Num, Panel } from './panels';

/** Candles kept before the start so the indicators are formed, and candles a stretch needs at least. It runs to the end of the loaded history. */
export const PRACTICE_WARMUP = 210;
export const PRACTICE_MIN = 60;

export interface PracticeSession {
  id: number;
  /** The closed candles as they were when the stretch started: live ticks do not move a practice session. */
  candles: Candle[];
  start: number;
  end: number;
  /** The last candle shown. Decisions are taken on its close. */
  cursor: number;
  steps: ReplayStep[];
}

export interface Proposal {
  stop: number;
  target: number;
  /** Where the levels come from: the rule's own stop and target, or a fallback when the rule cannot place them here. */
  from: 'rule' | 'atr';
}

/** Entry, stop and target of an order about to be placed. */
export interface Ticket {
  entry: number;
  stop: number;
  target: number;
}

export interface Practice {
  session: PracticeSession | null;
  /** Too few candles loaded to cut a stretch from. */
  short: boolean;
  /** The candles shown so far, and the rule's indicator series cut at the same candle. */
  view: Candle[];
  series: Record<string, IndicatorOutputs>;
  /** Rule signals on candles already decided: the candle being decided never shows its own. */
  revealed: Signal[];
  mine: ReplayState;
  rule: ReplayState;
  proposals: Record<Side, Proposal> | null;
  /** What an entry on each side would use now: the suggestion, with the user's own numbers over it. `edited` says which sides have any. */
  tickets: Record<Side, Ticket> | null;
  edited: Record<Side, boolean>;
  setLevel: (side: Side, field: keyof Ticket, value: number) => void;
  resetLevels: (side: Side) => void;
  /** Move the stop and the target of the open position or resting order, from the next candle on. */
  amend: (stop: number, target: number) => void;
  /** Why the last order or change was not taken; empty when it was. */
  problem: string;
  agreement: { taken: number; missed: number; extra: number };
  /** What the rule said on the candle just decided, once there is one. */
  /** `free` is false when that candle was passed with a position open, so there was nothing to decide. */
  last: { index: number; action: Exclude<ReplayStep['action'], 'amend'>; rule: Side | null; free: boolean } | null;
  done: boolean;
  enter: (side: Side) => void;
  wait: () => void;
  close: () => void;
  restart: () => void;
  /** Stop deciding and show the rest of the stretch at once. */
  finish: () => void;
}

const EMPTY: ReplayState = { trades: [], open: null, rejected: [], unfilled: [] };

/**
 * Practice mode: a random stretch of the loaded history played candle by candle. The user decides on each
 * close with the future hidden; the rule's own signals are revealed one candle late, and both results are
 * measured the same way.
 */
export function usePractice({ active, closed, rule, context, options, resetKey }: { active: boolean; closed: Candle[]; rule: Rule; context: ComputeOptions; options: BacktestOptions; resetKey: string }): Practice {
  const [session, setSession] = useState<PracticeSession | null>(null);
  // Levels typed by the user for the next entry, per side. They stay until used or reset, while the suggestion follows the candles.
  const [edits, setEdits] = useState<Partial<Record<Side, Partial<Ticket>>>>({});
  const [problem, setProblem] = useState('');
  const start = () => {
    const at = replayStart(closed.length, PRACTICE_WARMUP, PRACTICE_MIN);
    setSession(at === null ? null : { id: Date.now(), candles: closed, start: at, end: closed.length - 1, cursor: at, steps: [] });
    setEdits({});
    setProblem('');
  };
  // A stretch belongs to one market and timeframe; entering the mode with none (or with a stale one) cuts a new one.
  useEffect(() => setSession(null), [resetKey]);
  useEffect(() => {
    if (active && !session && closed.length > 0) start();
  }, [active, session === null, closed.length > 0]);

  const compiled = useMemo(() => compileRule(rule), [rule]);
  const ctx = useMemo(() => (session ? buildContext(rule, session.candles, context) : null), [rule, session?.id, context]);
  const allSignals = useMemo(() => (ctx ? scanSignals(compiled, ctx) : []), [compiled, ctx]);
  const range = useMemo(() => (session ? atr(session.candles, 14) : []), [session?.id]);

  return useMemo<Practice>(() => {
    const noop = () => undefined;
    if (!session || !ctx) {
      return { session: null, short: active && closed.length > 0 && replayStart(closed.length, PRACTICE_WARMUP, PRACTICE_MIN) === null, view: [], series: {}, revealed: [], mine: EMPTY, rule: EMPTY, proposals: null, tickets: null, edited: { long: false, short: false }, setLevel: noop, resetLevels: noop, amend: noop, problem: '', agreement: { taken: 0, missed: 0, extra: 0 }, last: null, done: false, enter: noop, wait: noop, close: noop, restart: start, finish: noop };
    }
    const { candles, cursor, steps } = session;
    const done = cursor >= session.end;
    const view = candles.slice(0, cursor + 1);
    const series = Object.fromEntries(Object.entries(ctx.series).map(([id, outputs]) => [id, Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, v.slice(0, cursor + 1)]))]));
    const inStretch = allSignals.filter((s) => s.index >= session.start);
    const mine = replay(candles, cursor, steps, options);
    const ruleSteps: ReplayStep[] = inStretch.filter((s) => s.index < cursor || done).map((s) => ({ index: s.index, action: s.side, stop: s.stop, target: s.target }));
    const ruleState = replay(candles, cursor, ruleSteps, options);

    // Levels for an entry decided on this candle: the rule's own when they sit on the right sides of the close.
    const close = candles[cursor].close;
    const evals = evaluateAt(compiled, ctx, cursor);
    const propose = (side: Side): Proposal => {
      const dir = side === 'long' ? 1 : -1;
      const e = evals[side];
      if (e && e.stop !== null && e.target !== null && dir * (close - e.stop) > 0 && dir * (e.target - close) > 0) return { stop: e.stop, target: e.target, from: 'rule' };
      const risk = 1.5 * (range[cursor] ?? close * 0.005);
      return { stop: close - dir * risk, target: close + dir * 2 * risk, from: 'atr' };
    };
    const proposals = { long: propose('long'), short: propose('short') };
    const ticket = (side: Side): Ticket => ({ entry: close, stop: proposals[side].stop, target: proposals[side].target, ...edits[side] });
    const tickets = { long: ticket('long'), short: ticket('short') };
    /** The levels must describe a trade: the stop behind the entry and the target ahead of it. */
    const valid = (side: Side, entry: number, stop: number, target: number) => (side === 'long' ? stop < entry && entry < target : target < entry && entry < stop);

    const decidedSteps = steps.filter((s) => s.action !== 'close' && s.action !== 'amend');
    // The user is free to enter on a candle unless a position of theirs was running through it. A position runs from
    // the candle after its decision to the candle before its exit: on the exit candle a new decision is possible.
    const free = (i: number) => !mine.trades.some((tr) => tr.signal.index < i && i < tr.exitIndex) && !(mine.open && i > mine.open.decidedAt);
    const lastStep = [...steps].reverse().find((s): s is Exclude<ReplayStep, { action: 'amend' }> => s.action !== 'amend');
    const ruleAt = (i: number) => inStretch.find((s) => s.index === i)?.side ?? null;
    const add = (step: ReplayStep) => setSession((s) => (s && s.cursor < s.end ? { ...s, steps: [...s.steps, step], cursor: s.cursor + 1 } : s));
    const flat = !mine.open;
    return {
      session,
      short: false,
      view,
      series,
      revealed: allSignals.filter((s) => s.index < cursor || done),
      mine,
      rule: ruleState,
      proposals,
      agreement: compareWithRule(
        steps.flatMap((s) => (s.action === 'long' || s.action === 'short' ? [{ index: s.index, side: s.action }] : [])),
        inStretch,
        new Set(decidedSteps.filter((s) => free(s.index)).map((s) => s.index)),
      ),
      last: lastStep ? { index: lastStep.index, action: lastStep.action, rule: ruleAt(lastStep.index), free: free(lastStep.index) } : null,
      done,
      tickets,
      edited: { long: Object.keys(edits.long ?? {}).length > 0, short: Object.keys(edits.short ?? {}).length > 0 },
      setLevel: (side, field, value) => setEdits((e) => ({ ...e, [side]: { ...e[side], [field]: value } })),
      resetLevels: (side) => setEdits((e) => ({ ...e, [side]: undefined })),
      problem,
      enter: (side) => {
        if (!flat || done) return;
        const k = tickets[side];
        if (!valid(side, k.entry, k.stop, k.target)) return setProblem(t(`practice.bad.${side}`));
        setProblem('');
        // An entry price of the user's own is a resting order; the suggested one enters at the next open.
        add({ index: cursor, action: side, stop: k.stop, target: k.target, ...(edits[side]?.entry !== undefined && k.entry !== close ? { entry: k.entry } : {}) });
        setEdits({});
      },
      amend: (stop, target) => {
        const o = mine.open;
        if (!o || done) return;
        // Judged against the entry while the order rests, and against the last close once in the position.
        if (!valid(o.side, o.entryPrice === null ? (o.limit ?? close) : close, stop, target)) return setProblem(t(`practice.badMove.${o.side}`));
        setProblem('');
        setSession((s) => (s ? { ...s, steps: [...s.steps.filter((x) => !(x.action === 'amend' && x.index === s.cursor)), { index: s.cursor, action: 'amend', stop, target }] } : s));
      },
      wait: () => {
        setProblem('');
        if (!done) add({ index: cursor, action: 'wait' });
      },
      close: () => {
        setProblem('');
        if (!flat && !done) add({ index: cursor, action: 'close' });
      },
      restart: start,
      finish: () => setSession((s) => (s ? { ...s, cursor: s.end } : s)),
    };
  }, [session, ctx, allSignals, options, active, closed.length, edits, problem]);
}

const steps0 = (s: PracticeSession) => s.steps.filter((x) => x.action === 'long' || x.action === 'short');
/** The user's latest entry, when the simulator dropped it for the given reason. */
const lastEntryIn = (s: PracticeSession, list: number[]) => {
  const entries = steps0(s);
  const latest = entries[entries.length - 1];
  return latest !== undefined && list.includes(latest.index);
};
const lastEntryRejected = (s: PracticeSession, mine: ReplayState) => lastEntryIn(s, mine.rejected);
const lastEntryUnfilled = (s: PracticeSession, mine: ReplayState) => !mine.open && lastEntryIn(s, mine.unfilled) && !s.steps.some((x) => (x.action === 'long' || x.action === 'short') && x.index > Math.max(...mine.unfilled));

const total = (trades: Trade[]) => trades.reduce((sum, tr) => sum + tr.netR, 0);

/** The decision bar under the chart: where the stretch stands, what the last decision met, and the three choices. */
export function PracticeBar({ p }: { p: Practice }) {
  // Keys for playing without leaving the chart: C buys, V sells, E or the right arrow waits or moves on, X closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Typing in a field is never a decision. A focused button is fine: the last click leaves the focus on one.
      if (e.metaKey || e.ctrlKey || e.altKey || (el && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable))) return;
      const k = e.key.toLowerCase();
      if (k === 'c') p.enter('long');
      else if (k === 'v') p.enter('short');
      else if (k === 'e' || k === 'arrowright') p.wait();
      else if (k === 'x') p.close();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  if (!p.session) return <div className="practice-bar">{p.short ? <span className="notice">{t('practice.short', { n: PRACTICE_WARMUP + PRACTICE_MIN })}</span> : <span className="muted">{t('status.loading')}</span>}</div>;
  const { session, mine, last, done } = p;
  const open = mine.open;
  const step = session.cursor - session.start;
  const length = session.end - session.start;
  const lastTrade = mine.trades[mine.trades.length - 1];
  // Closed on the candle just shown (stop, target, time), or by hand on the one before it.
  const justClosed = lastTrade && (lastTrade.exitIndex === session.cursor || (lastTrade.exitReason === 'manual' && lastTrade.exitIndex === session.cursor - 1)) ? lastTrade : null;
  return (
    <div className="practice-bar" data-block="practice-bar" data-open={open ? open.side : 'flat'} data-done={done}>
      <div className="where">
        <strong>{t('practice.step', { i: step, n: length })}</strong>
        <span className="muted">{fmtTime(session.candles[session.cursor].time)}</span>
        <span className={open ? `badge ${open.side === 'long' ? 'good' : 'bad'}` : 'badge'}>
          {open ? (open.entryPrice === null ? t(open.limit === null ? 'practice.pending' : 'practice.resting', { side: t(`side.${open.side}`), price: fmtPrice(open.limit ?? 0) }) : t('practice.inPosition', { side: t(`side.${open.side}`), r: fmtR(open.openR ?? 0) })) : t('practice.flat')}
        </span>
      </div>
      {done ? (
        <div className="choices">
          <span>{t('practice.done')}</span>
          <button className="primary" data-action="practice-restart" onClick={p.restart}>{t('practice.again')}</button>
        </div>
      ) : open ? (
        <div className="choices">
          <button className="primary" data-action="practice-next" onClick={p.wait}>{t('practice.next')} <kbd>E</kbd></button>
          <button data-action="practice-close" onClick={p.close}>{t(open.entryPrice === null ? 'practice.cancel' : 'practice.closeNow')} <kbd>X</kbd></button>
        </div>
      ) : (
        <div className="choices">
          <button className="buy" data-action="practice-buy" onClick={() => p.enter('long')}>{t('practice.buy')} <kbd>C</kbd></button>
          <button className="sell" data-action="practice-sell" onClick={() => p.enter('short')}>{t('practice.sell')} <kbd>V</kbd></button>
          <button data-action="practice-wait" onClick={p.wait}>{t('practice.next')} <kbd>E</kbd></button>
        </div>
      )}
      <p className="feedback" role="status" data-block="practice-feedback">
        {justClosed && <span className={justClosed.netR > 0 ? 'good' : 'bad'}>{t('practice.closed', { reason: t(`exit.${justClosed.exitReason}`).toLowerCase(), r: fmtR(justClosed.netR) })} </span>}
        {p.problem && <span className="bad" data-block="practice-problem">{p.problem} </span>}
        {!mine.open && lastEntryRejected(session, mine) && <span className="bad">{t('practice.rejected')} </span>}
        {lastEntryUnfilled(session, mine) && <span>{t('practice.unfilled')} </span>}
        {last && last.action !== 'close' && last.free && (
          <span>
            {t('practice.ruleSaid', { time: fmtTime(session.candles[last.index].time) })}{' '}
            <strong>{last.rule ? t(`practice.rule.${last.rule}`) : t('practice.rule.none')}</strong>
            {'. '}
            {t(`practice.you.${last.action}`)}
          </span>
        )}
        {!last && t('practice.first')}
        {last && !last.free && open && !justClosed && t('practice.holding')}
      </p>
    </div>
  );
}

function TradeRows({ trades }: { trades: Trade[] }) {
  return (
    <>
      {trades.map((tr) => (
        <tr key={tr.entryTime}>
          <td>{fmtTime(tr.entryTime)}</td>
          <td className={tr.side === 'long' ? 'good' : 'bad'}>{t(`side.${tr.side}`)}</td>
          <td>{fmtPrice(tr.entryPrice)}</td>
          <td>{fmtPrice(tr.exitPrice)}</td>
          <td>{t(`exit.${tr.exitReason}`)}</td>
          <td className={tr.netR > 0 ? 'good' : 'bad'}>{fmtR(tr.netR)}</td>
        </tr>
      ))}
    </>
  );
}

/** Under the chart, in the backtest's place: the user's result next to the rule's over the same candles. */
export function PracticeResults({ p }: { p: Practice }) {
  if (!p.session) return null;
  const { mine, rule, agreement, done } = p;
  const [mineR, ruleR] = [total(mine.trades), total(rule.trades)];
  const lead =
    mine.trades.length === 0 && rule.trades.length === 0
      ? t('practice.leadNone')
      : t(mine.trades.length === 0 ? 'practice.leadOnlyRule' : rule.trades.length === 0 ? 'practice.leadOnlyMine' : mineR > ruleR ? 'practice.leadAhead' : mineR < ruleR ? 'practice.leadBehind' : 'practice.leadEven', {
          mine: fmtR(mineR),
          n: tn('count.trade', mine.trades.length),
          rule: fmtR(ruleR),
          m: tn('count.trade', rule.trades.length),
        });
  const head = (
    <thead>
      <tr>
        <th>{t('trades.time')}</th>
        <th>{t('trades.side')}</th>
        <th>{t('trades.entry')}</th>
        <th>{t('trades.exit')}</th>
        <th>{t('trades.reason')}</th>
        <th>{t('trades.netR')}</th>
      </tr>
    </thead>
  );
  return (
    <Panel title={t('practice.results')}>
      <p className="lead" data-block="practice-lead">
        {lead} {mine.trades.length + rule.trades.length > 0 && t('practice.leadCaveat')}
      </p>
      <div className="funnel">
        <span className="chip">{t('practice.taken', { n: agreement.taken, total: agreement.taken + agreement.missed })}</span>
        <span className="chip">{t('practice.extra', { n: agreement.extra })}</span>
        {mine.rejected.length > 0 && <span className="chip">{t('practice.rejectedN', { n: mine.rejected.length })}</span>}
      </div>
      <div className="versus">
        <div>
          <h3>{t('practice.mine')} <span className={mineR > 0 ? 'good' : mineR < 0 ? 'bad' : ''}>{fmtR(mineR)}</span></h3>
          {mine.trades.length === 0 ? <p className="muted small">{t('practice.noTrades')}</p> : (
            <div className="table-wrap static"><table>{head}<tbody><TradeRows trades={[...mine.trades].reverse()} /></tbody></table></div>
          )}
        </div>
        <div>
          <h3>{t('practice.ruleSide')} <span className={ruleR > 0 ? 'good' : ruleR < 0 ? 'bad' : ''}>{fmtR(ruleR)}</span></h3>
          {rule.trades.length === 0 ? <p className="muted small">{t(done ? 'practice.ruleNone' : 'practice.ruleNoneYet')}</p> : (
            <div className="table-wrap static"><table>{head}<tbody><TradeRows trades={[...rule.trades].reverse()} /></tbody></table></div>
          )}
        </div>
      </div>
      <p className="muted small">{t('practice.assumptions')}</p>
    </Panel>
  );
}

/** Two fields and a button to move the stop and the target of what is open; the change counts from the next candle. */
function MoveLevels({ stop, target, step, onMove }: { stop: number; target: number; step: number; onMove: (stop: number, target: number) => void }) {
  const [next, setNext] = useState({ stop, target });
  const same = next.stop === stop && next.target === target;
  return (
    <fieldset>
      <legend>{t('practice.move')}</legend>
      <Num label={t('practice.stop')} value={next.stop} step={step} onChange={(v) => setNext((n) => ({ ...n, stop: v }))} />
      <Num label={t('practice.target')} value={next.target} step={step} onChange={(v) => setNext((n) => ({ ...n, target: v }))} />
      <button data-action="practice-move" disabled={same} onClick={() => onMove(next.stop, next.target)}>{t('practice.apply')}</button>
    </fieldset>
  );
}

/** The side column in practice mode: what an entry on this candle would risk, and how the mode works. */
export function PracticePanel({ p, ruleName, rules, ruleKey, onRule }: { p: Practice; ruleName: string; rules: { key: string; label: string; group: string }[]; ruleKey: string; onRule: (key: string) => void }) {
  const s = p.session;
  const close = s ? s.candles[s.cursor].close : 0;
  // Prices are typed with the decimals the market is quoted in.
  const decimals = close >= 10_000 ? 1 : 2;
  const round = (v: number) => Number(v.toFixed(decimals));
  const step = decimals === 1 ? 10 : 1;
  return (
    <Panel title={t('practice.title')} actions={s ? <button data-action="practice-new" onClick={p.restart}>{t('practice.new')}</button> : undefined}>
      <p className="muted small">{t('practice.about', { rule: ruleName })}</p>
      <label className="field" data-block="practice-rule">
        <span>{t('practice.rule')}</span>
        <select value={ruleKey} onChange={(e) => e.target.value && onRule(e.target.value)}>
          {ruleKey === '' && <option value="">{t('practice.ruleCustom', { rule: ruleName })}</option>}
          {[...new Set(rules.map((r) => r.group))].map((g) => (
            <optgroup key={g} label={g}>
              {rules.filter((r) => r.group === g).map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {s && p.tickets && p.proposals && !p.done && !p.mine.open && (
        <div className="levels-edit" data-block="practice-levels">
          {(['long', 'short'] as const).map((side) => {
            const k = p.tickets![side];
            const ratio = Math.abs(k.target - k.entry) / Math.abs(k.entry - k.stop);
            return (
              <fieldset key={side} className={side} data-side={side}>
                <legend>
                  {t('practice.ifYou')} <strong>{t(`practice.${side === 'long' ? 'buy' : 'sell'}`)}</strong>
                  {p.edited[side] && <button className="link" data-action="practice-reset" onClick={() => p.resetLevels(side)}>{t('practice.reset')}</button>}
                </legend>
                <Num label={t('practice.entry')} value={round(k.entry)} step={step} onChange={(v) => p.setLevel(side, 'entry', v)} />
                <Num label={t('practice.stop')} value={round(k.stop)} step={step} onChange={(v) => p.setLevel(side, 'stop', v)} />
                <Num label={t('practice.target')} value={round(k.target)} step={step} onChange={(v) => p.setLevel(side, 'target', v)} />
                <span className="muted small">
                  {t('practice.ratio')}: {Number.isFinite(ratio) ? fmtNum(ratio, 1) : '–'} · {k.entry === close ? t('practice.atOpen') : t('practice.atPrice')}
                  {!p.edited[side] && p.proposals![side].from === 'atr' ? ' *' : ''}
                </span>
              </fieldset>
            );
          })}
        </div>
      )}
      {s && p.proposals && !p.done && !p.mine.open && (p.proposals.long.from === 'atr' || p.proposals.short.from === 'atr') && <p className="muted small">* {t('practice.atrLevels')}</p>}
      {s && p.mine.open && !p.done && (
        <div className="levels-edit" data-block="practice-open">
          <p>
            {t('practice.openLevels', { side: t(`side.${p.mine.open.side}`), entry: p.mine.open.entryPrice === null ? (p.mine.open.limit === null ? t('practice.nextOpen') : fmtPrice(p.mine.open.limit)) : fmtPrice(p.mine.open.entryPrice), stop: fmtPrice(p.mine.open.stop), target: fmtPrice(p.mine.open.target) })}
          </p>
          <MoveLevels key={`${s.id}|${p.mine.open.decidedAt}|${p.mine.open.stop}|${p.mine.open.target}`} stop={round(p.mine.open.stop)} target={round(p.mine.open.target)} step={step} onMove={p.amend} />
        </div>
      )}
      {s && !p.done && <p className="actions left"><button data-action="practice-finish" onClick={p.finish}>{t('practice.finish')}</button></p>}
      <Info>
        <p>{t('practice.how1')}</p>
        <p>{t('practice.how2')}</p>
        <p>{t('practice.how3')}</p>
      </Info>
    </Panel>
  );
}
