import { describe, expect, it } from 'vitest';
import { backtest, type BacktestOptions } from '../src/core/backtest';
import { compareWithRule, replay, replayStart, type ReplayStep } from '../src/core/replay';
import { buildContext, compileRule, scanSignals } from '../src/core/rule/engine';
import { BUILTIN_STRATEGIES, makeStrategyRule } from '../src/core/rules/strategy';
import { candles } from './helpers';
import { real15 } from './real';

const opts: BacktestOptions = { feeEntry: 0.0005, feeExit: 0.0005, slippage: 0, timeoutBars: 20 };
const free: BacktestOptions = { feeEntry: 0, feeExit: 0, slippage: 0, timeoutBars: 20 };
// Decision on candle 0; entry at the open of candle 1 (100); then the price climbs.
const up = candles([[100, 101, 99, 100], [100, 102, 99.5, 101], [101, 104, 100.5, 103], [103, 111, 102, 110], [110, 112, 108, 109]]);
const buy: ReplayStep = { index: 0, action: 'long', stop: 98, target: 110 };

describe('practice replay', () => {
  it('keeps an entry pending until the next candle exists, and never reads past the cursor', () => {
    expect(replay(up, 0, [buy], free)).toEqual({ trades: [], rejected: [], unfilled: [], open: { side: 'long', decidedAt: 0, stop: 98, target: 110, limit: null, entryIndex: null, entryPrice: null, openR: null } });
    const one = replay(up, 1, [buy], free);
    expect(one.trades).toEqual([]);
    expect(one.open).toMatchObject({ entryIndex: 1, entryPrice: 100, openR: 0.5 });
    // The target is reached on candle 3, which the cursor has not shown yet.
    expect(replay(up, 2, [buy], free).open?.openR).toBe(1.5);
  });
  it('closes at the target, at the stop first, by hand or by time, like the backtest', () => {
    const target = replay(up, 4, [buy], free);
    expect(target.open).toBeNull();
    expect(target.trades[0]).toMatchObject({ entryIndex: 1, exitIndex: 3, exitPrice: 110, exitReason: 'target', netR: 5 });
    // Stop and target inside the same candle: the stop is assumed first.
    const both = replay(up, 4, [{ index: 0, action: 'long', stop: 99.6, target: 101.5 }], free);
    expect(both.trades[0]).toMatchObject({ exitIndex: 1, exitReason: 'stop' });
    const manual = replay(up, 4, [buy, { index: 2, action: 'close' }], free);
    expect(manual.trades[0]).toMatchObject({ exitIndex: 2, exitPrice: 103, exitReason: 'manual', netR: 1.5 });
    const timeout = replay(up, 4, [buy], { ...free, timeoutBars: 2 });
    expect(timeout.trades[0]).toMatchObject({ exitIndex: 2, exitReason: 'timeout' });
  });
  it('charges a fee on each side and reports the open result net of the entry fee', () => {
    const t = replay(up, 4, [buy], opts).trades[0];
    expect(t.fees).toBeCloseTo(0.0005 * 100 + 0.0005 * 110);
    expect(t.netR).toBeCloseTo((10 - t.fees) / 2);
    expect(replay(up, 1, [buy], opts).open?.openR).toBeCloseTo((1 - 0.05) / 2);
  });
  it('rejects an entry whose next open is already beyond its levels, and ignores entries while in a position', () => {
    const gap = replay(up, 4, [{ index: 0, action: 'long', stop: 100.5, target: 110 }], free);
    expect(gap).toEqual({ trades: [], open: null, rejected: [0], unfilled: [] });
    const two = replay(up, 4, [buy, { index: 1, action: 'short', stop: 120, target: 90 }], free);
    expect(two.trades).toHaveLength(1);
    expect(two.trades[0].side).toBe('long');
    // Once flat again, a new entry is taken: decided on the exit candle, filled on the next.
    const again = replay(up, 4, [buy, { index: 3, action: 'short', stop: 115, target: 100 }], free);
    expect(again.trades).toHaveLength(1);
    expect(again.open).toMatchObject({ side: 'short', entryIndex: 4, entryPrice: 110 });
  });
  it('gives the same trades as the backtest when it plays the rule to the end', () => {
    for (const id of ['bbRsi', 'macdTrend', 'srBreakMa']) {
      const b = BUILTIN_STRATEGIES.find((x) => x.id === id)!;
      const rule = makeStrategyRule(b.strategy);
      const signals = scanSignals(compileRule(rule), buildContext(rule, real15));
      const o = { ...opts, timeoutBars: b.timeoutBars };
      const expected = backtest(real15, signals, o).trades;
      const state = replay(real15, real15.length - 1, signals.map((s) => ({ index: s.index, action: s.side, stop: s.stop, target: s.target })), o);
      // The backtest closes whatever is open on the last candle; the replay leaves it open.
      const finished = expected.filter((t) => t.exitReason !== 'timeout' || t.exitIndex - t.entryIndex + 1 >= o.timeoutBars);
      expect(state.trades.map((t) => [t.entryIndex, t.exitIndex, t.exitReason, t.netR])).toEqual(finished.map((t) => [t.entryIndex, t.exitIndex, t.exitReason, t.netR]));
      expect(state.trades.length + (state.open ? 1 : 0)).toBe(expected.length);
    }
  });
  it('shows on every earlier cursor only what was known by then', () => {
    const b = BUILTIN_STRATEGIES.find((x) => x.id === 'macdTrend')!;
    const rule = makeStrategyRule(b.strategy);
    const steps: ReplayStep[] = scanSignals(compileRule(rule), buildContext(rule, real15)).map((s) => ({ index: s.index, action: s.side, stop: s.stop, target: s.target }));
    const full = replay(real15, real15.length - 1, steps, opts).trades;
    for (const cursor of [300, 500, 700]) {
      const part = replay(real15, cursor, steps, opts);
      expect(part.trades).toEqual(full.filter((t) => t.exitIndex <= cursor));
      expect(part.trades.every((t) => t.exitIndex <= cursor)).toBe(true);
    }
  });
});

describe('resting orders and moved levels', () => {
  // Closes 100, 101, 103, 110, 109; lows 99, 99.5, 100.5, 102, 108; highs 101, 102, 104, 111, 112.
  it('fills a resting order when a later candle reaches its price, at that price', () => {
    const order: ReplayStep = { index: 0, action: 'long', entry: 100.8, stop: 99, target: 108 };
    expect(replay(up, 0, [order], free).open).toMatchObject({ limit: 100.8, entryIndex: null });
    // A buy below the market fills when a candle dips to it: candle 1 goes down to 99.5.
    expect(replay(up, 1, [{ ...order, entry: 99.7 }], free).open).toMatchObject({ entryIndex: 1, entryPrice: 99.7 });
    // If the candle opens already beyond the order, it fills at the open, which is the better price.
    expect(replay(up, 3, [{ index: 1, action: 'long', entry: 103.5, stop: 100, target: 120 }], free).open).toMatchObject({ entryIndex: 2, entryPrice: 103.5 });
    expect(replay(up, 4, [{ index: 2, action: 'short', entry: 102.5, stop: 115, target: 90 }], free).open).toMatchObject({ entryIndex: 3, entryPrice: 102.5 });
    // A buy above the market (waiting for confirmation) fills when the price climbs to it.
    const stopEntry: ReplayStep = { index: 0, action: 'long', entry: 103.5, stop: 100.2, target: 110.1 };
    expect(replay(up, 1, [stopEntry], free).open).toMatchObject({ entryIndex: null });
    expect(replay(up, 2, [stopEntry], free).open).toMatchObject({ entryIndex: 2, entryPrice: 103.5 });
    expect(replay(up, 4, [stopEntry], free).trades[0]).toMatchObject({ entryIndex: 2, entryPrice: 103.5, exitIndex: 3, exitReason: 'target' });
    expect(replay(up, 4, [stopEntry], free).trades[0].netR).toBeCloseTo(2);
    // A sell above the market fills when the price rises to it.
    expect(replay(up, 4, [{ index: 0, action: 'short', entry: 111.5, stop: 113, target: 105 }], free).open).toMatchObject({ entryIndex: 4, entryPrice: 111.5 });
  });
  it('cancels an order that has not filled, by hand or after the timeout, and frees the user', () => {
    const far: ReplayStep = { index: 0, action: 'long', entry: 90, stop: 88, target: 100 };
    const cancelled = replay(up, 4, [far, { index: 1, action: 'close' }, { index: 2, action: 'long', stop: 100, target: 110 }], free);
    expect(cancelled.unfilled).toEqual([0]);
    expect(cancelled.trades[0]).toMatchObject({ entryIndex: 3, entryPrice: 103 });
    expect(replay(up, 1, [far, { index: 1, action: 'close' }], free)).toMatchObject({ open: null, unfilled: [0] });
    expect(replay(up, 4, [far], { ...free, timeoutBars: 2 })).toMatchObject({ open: null, unfilled: [0], trades: [] });
    expect(replay(up, 2, [far], { ...free, timeoutBars: 2 }).open).not.toBeNull();
  });
  it('moves the stop and the target from the next candle on, and measures R on the risk taken at the entry', () => {
    // Stop raised to 100.4 on candle 1: candle 2 (low 100.5) holds, and the target moved to 104 is reached there.
    const moved = replay(up, 4, [buy, { index: 1, action: 'amend', stop: 100.4, target: 104 }], free);
    expect(moved.trades[0]).toMatchObject({ exitIndex: 2, exitPrice: 104, exitReason: 'target', risk: 2, netR: 2 });
    // The change does not reach back into the candle it was decided on.
    const late = replay(up, 4, [buy, { index: 1, action: 'amend', stop: 99.8, target: 110 }], free);
    expect(late.trades[0]).toMatchObject({ exitIndex: 3, exitReason: 'target' });
    expect(replay(up, 2, [buy, { index: 1, action: 'amend', stop: 99.9, target: 120 }], free).open).toMatchObject({ stop: 99.9, target: 120 });
    // A stop moved above the price is hit on the next candle.
    expect(replay(up, 4, [buy, { index: 1, action: 'amend', stop: 101.5, target: 110 }], free).trades[0]).toMatchObject({ exitIndex: 2, exitReason: 'stop', exitPrice: 101.5 });
  });
});

describe('practice session helpers', () => {
  it('starts where the indicators are formed and enough candles remain', () => {
    expect(replayStart(1000, 200, 100, () => 0)).toBe(200);
    expect(replayStart(1000, 200, 100, () => 0.999999)).toBe(899);
    expect(replayStart(301, 200, 100, () => 0.7)).toBe(200);
    expect(replayStart(300, 200, 100)).toBeNull();
  });
  it('counts the rule signals the user took, missed, and the entries of their own', () => {
    const rule = [{ index: 5, side: 'long' as const }, { index: 9, side: 'short' as const }, { index: 30, side: 'long' as const }];
    const mine = [{ index: 5, side: 'long' as const }, { index: 7, side: 'short' as const }, { index: 9, side: 'long' as const }];
    // Candle 30 was never offered to the user (a position was open), so it does not count as missed.
    expect(compareWithRule(mine, rule, new Set([5, 6, 7, 8, 9]))).toEqual({ taken: 1, missed: 1, extra: 2 });
  });
});

describe('stops closer than the fees', () => {
  // Entry at 100 with 0.05% a side: the fees are 0.10, so a stop less than 0.10 away is not tradable.
  it('are left out of the backtest and counted, and rejected in practice', () => {
    const signal = (stop: number) => ({ index: 0, time: up[0].time, side: 'long' as const, reference: 100, stop, target: 110, conditions: [] });
    const tight = backtest(up, [signal(99.95)], opts);
    expect(tight).toMatchObject({ trades: [], skipped: 1, tooTight: 1 });
    const ok = backtest(up, [signal(99.6)], opts);
    expect(ok.tooTight).toBe(0);
    expect(ok.trades).toHaveLength(1);
    // Without fees there is no such limit.
    expect(backtest(up, [signal(99.95)], free).trades).toHaveLength(1);
    expect(replay(up, 4, [{ index: 0, action: 'long', stop: 99.95, target: 110 }], opts)).toMatchObject({ trades: [], rejected: [0] });
    expect(replay(up, 4, [{ index: 0, action: 'long', stop: 99.6, target: 110 }], opts).trades).toHaveLength(1);
  });
  it('keeps every trade of the real recording at a result the fees cannot blow up', () => {
    for (const b of BUILTIN_STRATEGIES) {
      const rule = makeStrategyRule(b.strategy.trend.mode === 'higher' ? { ...b.strategy, trend: { ...b.strategy.trend, mode: 'same' } } : b.strategy);
      const { trades } = backtest(real15, scanSignals(compileRule(rule), buildContext(rule, real15)), { ...opts, timeoutBars: b.timeoutBars });
      // A stopped trade loses 1 R plus fees, and the fees are at most the risk: never much below −2 R.
      for (const t of trades.filter((x) => x.exitReason === 'stop')) expect(t.netR).toBeGreaterThan(-2.01);
    }
  });
});
