import { describe, expect, it } from 'vitest';
import { backtest, splitMetrics, type BacktestOptions } from '../src/core/backtest';
import type { Signal } from '../src/core/rule/types';
import { candles, flat } from './helpers';

const noCost: BacktestOptions = { feeEntry: 0, feeExit: 0, slippage: 0, timeoutBars: 20 };
const sig = (index: number, side: 'long' | 'short', stop: number, target: number): Signal => ({
  index,
  time: index * 60_000,
  side,
  reference: 100,
  stop,
  target,
  conditions: [],
});

describe('backtest', () => {
  it('enters at the next open and exits at the target', () => {
    const cs = candles([...flat(100, 1), [100, 100.5, 99.5, 100.2], [100.2, 102.1, 100, 102]]);
    const { trades } = backtest(cs, [sig(0, 'long', 98, 102)], noCost);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ entryIndex: 1, entryPrice: 100, exitIndex: 2, exitPrice: 102, exitReason: 'target', risk: 2, grossR: 1 });
  });

  it('assumes the stop is hit first when stop and target fall in the same candle', () => {
    const cs = candles([...flat(100, 1), [100, 103, 97, 101]]);
    const { trades } = backtest(cs, [sig(0, 'long', 98, 102)], noCost);
    expect(trades[0].exitReason).toBe('stop');
    expect(trades[0].grossR).toBe(-1);
  });

  it('handles shorts symmetrically', () => {
    const cs = candles([...flat(100, 1), [100, 100.5, 97.9, 98]]);
    const { trades } = backtest(cs, [sig(0, 'short', 101, 98)], noCost);
    expect(trades[0]).toMatchObject({ exitReason: 'target', exitPrice: 98, risk: 1, grossR: 2 });
  });

  it('times out at the close when neither level is reached', () => {
    const cs = candles([...flat(100, 1), [100, 100.5, 99.5, 100.1], [100.1, 100.6, 99.6, 100.3], [100.3, 100.7, 99.7, 100.4]]);
    const { trades } = backtest(cs, [sig(0, 'long', 98, 105)], { ...noCost, timeoutBars: 2 });
    expect(trades[0]).toMatchObject({ exitReason: 'timeout', exitIndex: 2, exitPrice: 100.3 });
  });

  it('skips signals that fire while a trade is open, and ones whose levels are already passed', () => {
    const cs = candles([...flat(100, 1), [100, 100.5, 99.5, 100.2], [100.2, 100.6, 99.6, 100.3], [100.3, 102.5, 100, 102], ...flat(102, 2)]);
    const res = backtest(cs, [sig(0, 'long', 98, 102), sig(1, 'long', 98, 102), sig(3, 'long', 98, 101)], noCost);
    expect(res.trades).toHaveLength(1);
    expect(res.skipped).toBe(2); // index 1: position open; index 3: entry at 102 is already past the 101 target
  });

  it('charges fees on both sides and reports the result in R', () => {
    const cs = candles([...flat(100, 1), [100, 100.5, 99.5, 100.2], [100.2, 102.1, 100, 102]]);
    const { trades, metrics } = backtest(cs, [sig(0, 'long', 98, 102)], { ...noCost, feeEntry: 0.001, feeExit: 0.001 });
    // fees = 0.001*100 + 0.001*102 = 0.202 ; net = 2 - 0.202 = 1.798 ; R = 1.798 / 2
    expect(trades[0].fees).toBeCloseTo(0.202, 10);
    expect(trades[0].netR).toBeCloseTo(0.899, 10);
    expect(metrics.feeShare).toBeCloseTo(0.101, 10);
    expect(metrics.smallSample).toBe(true);
  });

  it('computes win rate, profit factor and drawdown', () => {
    // Three trades in R: +1, -1, -1 (no costs) -> win rate 1/3, PF 0.5, drawdown 2
    const cs = candles([
      ...flat(100, 1),
      [100, 102.1, 100, 102], // t1 target
      ...flat(100, 1),
      [100, 100.2, 97.9, 98], // t2 stop
      ...flat(100, 1),
      [100, 100.2, 97.9, 98], // t3 stop
    ]);
    const { metrics } = backtest(cs, [sig(0, 'long', 98, 102), sig(2, 'long', 98, 102), sig(4, 'long', 98, 102)], noCost);
    expect(metrics.trades).toBe(3);
    expect(metrics.winRate).toBeCloseTo(1 / 3, 10);
    expect(metrics.targetRate).toBeCloseTo(1 / 3, 10);
    expect(metrics.profitFactor).toBeCloseTo(0.5, 10);
    expect(metrics.maxDrawdownR).toBeCloseTo(2, 10);
    expect(metrics.breakEvenWinRate).toBeCloseTo(0.5, 10);
  });

  it('counts a profitable timeout as a win, so win rate and break-even rate stay comparable', () => {
    // t1 times out in profit (+0.5 R), t2 is stopped (-1 R). Neither reaches its target.
    const cs = candles([...flat(100, 1), [100, 101.2, 100, 101], ...flat(100, 1), [100, 100.2, 97.9, 98]]);
    const { metrics } = backtest(cs, [sig(0, 'long', 98, 105), sig(2, 'long', 98, 105)], { ...noCost, timeoutBars: 1 });
    expect(metrics.targetRate).toBe(0);
    expect(metrics.winRate).toBeCloseTo(0.5, 10);
    // Break-even = avg loss / (avg win + avg loss) = 1 / 1.5. Win rate is below it and the average is negative.
    expect(metrics.breakEvenWinRate).toBeCloseTo(2 / 3, 10);
    expect(metrics.avgNetR).toBeCloseTo(-0.25, 10);
  });

  it('splits the trades into a tuning part and an out-of-sample part by signal time', () => {
    const cs = candles([
      ...flat(100, 1),
      [100, 102.1, 100, 102], // t1 target (signal at minute 0)
      ...flat(100, 1),
      [100, 100.2, 97.9, 98], // t2 stop (signal at minute 2)
      ...flat(100, 1),
      [100, 100.2, 97.9, 98], // t3 stop (signal at minute 4)
    ]);
    const { trades } = backtest(cs, [sig(0, 'long', 98, 102), sig(2, 'long', 98, 102), sig(4, 'long', 98, 102)], noCost);
    const { inSample, outOfSample } = splitMetrics(trades, 3 * 60_000);
    expect([inSample.trades, outOfSample.trades]).toEqual([2, 1]);
    expect(inSample.totalNetR).toBeCloseTo(0, 10);
    expect(outOfSample.totalNetR).toBeCloseTo(-1, 10);
  });
});
