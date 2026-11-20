import { stopTooTight, type BacktestOptions, type ExitReason, type Trade } from './backtest';
import type { Candle, Side } from './types';

/**
 * Practice mode: decisions taken candle by candle, with the future hidden.
 * A step is what was decided on the close of candle `index`; an entry is
 * filled at the open of the next candle, as in the backtest, and from then on
 * the same rules apply: stop first when stop and target fall in one candle,
 * one position at a time, a timeout, a fee on each side.
 */
/**
 * `entry` on an entry step makes it a resting order at that price instead of
 * an entry at the next open. `amend` moves the stop and the target of the
 * position (or resting order) from the next candle on. `close` closes a
 * position at that candle's close, or cancels an order that has not filled.
 */
export type ReplayStep =
  | { index: number; action: 'wait' }
  | { index: number; action: 'close' }
  | { index: number; action: 'amend'; stop: number; target: number }
  | { index: number; action: Side; stop: number; target: number; entry?: number };

export interface ReplayOpen {
  side: Side;
  /** Candle on whose close the entry was decided. */
  decidedAt: number;
  /** Stop and target in force now, after any change. */
  stop: number;
  target: number;
  /** Price of a resting order; `null` for an entry at the next open. */
  limit: number | null;
  /** `null` while the entry has not been filled yet. */
  entryIndex: number | null;
  entryPrice: number | null;
  /** Result so far at the close of the last candle seen, before the exit fee, in R of the initial risk. */
  openR: number | null;
}

export interface ReplayState {
  /** Trades already closed by the last candle seen. */
  trades: Trade[];
  open: ReplayOpen | null;
  /** Candles of decision whose entry could not be opened: at the fill, the price was already beyond the stop or the target, or the stop was closer than the fees. */
  rejected: number[];
  /** Candles of decision whose resting order never filled: cancelled by hand, or expired after the timeout. */
  unfilled: number[];
}

/**
 * Play the steps over `candles[0..cursor]`. Nothing after `cursor` is read, so
 * a position that is still open stays open. Entries decided while a position
 * is open or an order is resting are ignored.
 *
 * A resting order fills on the first later candle whose range reaches its
 * price, at that price; if the candle opens already beyond it, at the open.
 */
export function replay(candles: Candle[], cursor: number, steps: ReplayStep[], options: BacktestOptions): ReplayState {
  const last = Math.min(cursor, candles.length - 1);
  const ordered = [...steps].sort((a, b) => a.index - b.index);
  const closes = new Set(ordered.filter((s) => s.action === 'close').map((s) => s.index));
  const amends = ordered.filter((s): s is Extract<ReplayStep, { action: 'amend' }> => s.action === 'amend');
  const trades: Trade[] = [];
  const rejected: number[] = [];
  const unfilled: number[] = [];
  let open: ReplayOpen | null = null;
  let freeFrom = 0;

  for (const step of ordered) {
    if (step.action === 'wait' || step.action === 'close' || step.action === 'amend' || step.index < freeFrom || step.index > last) continue;
    const { index, action: side } = step;
    const dir = side === 'long' ? 1 : -1;
    const limit = step.entry ?? null;
    // The levels in force on candle `i`: the latest change decided before it, else the ones the entry came with.
    const levels = (i: number) => {
      let now = { stop: step.stop, target: step.target };
      for (const a of amends) if (a.index >= index && a.index < i) now = { stop: a.stop, target: a.target };
      return now;
    };

    // Fill.
    let entryIndex: number | null = null;
    let entryPrice = 0;
    let dropped = false;
    if (limit === null) {
      if (index + 1 <= last) {
        entryIndex = index + 1;
        entryPrice = candles[entryIndex].open * (1 + dir * options.slippage);
      }
    } else {
      const toward = Math.sign(limit - candles[index].close) || -dir; // which way the price must travel to reach the order
      for (let i = index + 1; i <= last; i++) {
        if (closes.has(i - 1) || i - index > options.timeoutBars) {
          unfilled.push(index);
          freeFrom = i - 1;
          dropped = true;
          break;
        }
        const c = candles[i];
        if (toward * (c.open - limit) >= 0) entryPrice = c.open;
        else if (c.low <= limit && limit <= c.high) entryPrice = limit;
        else continue;
        entryIndex = i;
        break;
      }
      if (!dropped && entryIndex === null && closes.has(last)) {
        // Cancelled on the candle being shown: it takes effect now, so the user is free again.
        unfilled.push(index);
        freeFrom = last;
        dropped = true;
      }
    }
    if (dropped) continue;
    if (entryIndex === null) {
      open = { side, decidedAt: index, ...levels(last + 1), limit, entryIndex: null, entryPrice: null, openR: null };
      break;
    }
    const atFill = levels(entryIndex);
    if (dir * (atFill.target - entryPrice) <= 0 || dir * (entryPrice - atFill.stop) <= 0 || stopTooTight(entryPrice, atFill.stop, options)) {
      rejected.push(index);
      freeFrom = entryIndex;
      continue;
    }
    const risk = Math.abs(entryPrice - atFill.stop);
    let exit: { index: number; price: number; reason: ExitReason } | null = null;
    for (let i = entryIndex; i <= last && !exit; i++) {
      const c = candles[i];
      const { stop, target } = levels(i);
      const stopHit = side === 'long' ? c.low <= stop : c.high >= stop;
      const targetHit = side === 'long' ? c.high >= target : c.low <= target;
      const atClose = c.close * (1 - dir * options.slippage);
      if (stopHit) exit = { index: i, price: stop * (1 - dir * options.slippage), reason: 'stop' };
      else if (targetHit) exit = { index: i, price: target, reason: 'target' };
      else if (closes.has(i)) exit = { index: i, price: atClose, reason: 'manual' };
      else if (i - entryIndex + 1 >= options.timeoutBars) exit = { index: i, price: atClose, reason: 'timeout' };
    }
    if (!exit) {
      const mark = candles[last].close;
      open = { side, decidedAt: index, ...levels(last + 1), limit, entryIndex, entryPrice, openR: (dir * (mark - entryPrice) - options.feeEntry * entryPrice) / risk };
      break;
    }
    const grossPnl = dir * (exit.price - entryPrice);
    const fees = options.feeEntry * entryPrice + options.feeExit * exit.price;
    trades.push({
      signal: { index, time: candles[index].time, side, reference: candles[index].close, stop: step.stop, target: step.target, conditions: [] },
      side,
      entryIndex,
      entryTime: candles[entryIndex].time,
      entryPrice,
      exitIndex: exit.index,
      exitTime: candles[exit.index].time,
      exitPrice: exit.price,
      exitReason: exit.reason,
      risk,
      grossPnl,
      fees,
      netPnl: grossPnl - fees,
      grossR: grossPnl / risk,
      netR: (grossPnl - fees) / risk,
    });
    freeFrom = exit.index;
  }
  return { trades, open, rejected, unfilled };
}

/**
 * Where a practice stretch starts: a random candle that leaves `warmup`
 * candles before it, so the indicators are formed, and at least `ahead`
 * candles after it to play. `null` when there are not enough candles.
 */
export function replayStart(length: number, warmup: number, ahead: number, random: () => number = Math.random): number | null {
  const first = warmup;
  const lastStart = length - 1 - ahead;
  if (lastStart < first) return null;
  return first + Math.min(lastStart - first, Math.floor(random() * (lastStart - first + 1)));
}

/** How the user's entries line up with the rule's signals over the candles where the user was free to enter. */
export function compareWithRule(userEntries: { index: number; side: Side }[], ruleSignals: { index: number; side: Side }[], decided: Set<number>): { taken: number; missed: number; extra: number } {
  const rule = ruleSignals.filter((s) => decided.has(s.index));
  const same = (a: { index: number; side: Side }, b: { index: number; side: Side }) => a.index === b.index && a.side === b.side;
  const taken = rule.filter((r) => userEntries.some((u) => same(u, r))).length;
  return { taken, missed: rule.length - taken, extra: userEntries.filter((u) => !rule.some((r) => same(u, r))).length };
}
