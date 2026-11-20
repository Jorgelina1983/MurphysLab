import { describe, expect, it } from 'vitest';
import { alignHigher } from '../src/core/indicators';
import { buildContext, compileRule, scanSignals } from '../src/core/rule/engine';
import type { Rule } from '../src/core/rule/types';
import { candles } from './helpers';

const MIN = 60_000;

describe('higher-timeframe indicators', () => {
  it('aligns without look-ahead: a candle only sees higher candles that have closed', () => {
    // Six 1-minute candles (0..5) under 3-minute candles opening at 0 and 3.
    const low = candles([[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]], MIN);
    const high = candles([[0, 0, 0, 10], [0, 0, 0, 20]], 3 * MIN);
    // The first 3-minute candle closes at minute 3, which is when the 1-minute candle of minute 2 closes.
    expect(alignHigher(low, MIN, high, 3 * MIN, [10, 20])).toEqual([null, null, 10, 10, 10, 20]);
  });

  it('evaluates a rule against an average computed on the higher timeframe', () => {
    const rule: Rule = {
      id: 'above-higher-average',
      name: 'Close above the higher-timeframe average',
      indicators: { trend: { type: 'sma', length: 2, timeframe: '3m' } },
      signals: { long: { when: { gt: ['close', 'trend'] }, stop: 'low', target: 'high' } },
    };
    const low = candles([5, 5, 5, 5, 5, 5, 30, 30, 5].map((c) => [c, c + 1, c - 1, c]), MIN);
    // 3-minute closes 10, 20, 40 -> SMA(2) is 15 after the second candle and 30 after the third.
    const high = candles([[0, 0, 0, 10], [0, 0, 0, 20], [0, 0, 0, 40]], 3 * MIN);
    const ctx = buildContext(rule, low, { ms: MIN, higher: { '3m': { candles: high, ms: 3 * MIN } } });
    expect(ctx.series.trend.value).toEqual([null, null, null, null, null, 15, 15, 15, 30]);
    // Minute 6 and 7 close at 30, above 15. Minute 8 closes at 5, below the new average of 30.
    expect(scanSignals(compileRule(rule), ctx).map((s) => s.index)).toEqual([6, 7]);
  });

  it('ignores a higher candle that is still forming, and signals nothing while the data is missing', () => {
    const rule: Rule = {
      id: 'x',
      name: 'x',
      indicators: { trend: { type: 'sma', length: 1, timeframe: '3m' } },
      signals: { long: { when: { gt: ['close', 'trend'] }, stop: 'low', target: 'high' } },
    };
    const low = candles([[9, 10, 8, 9], [9, 10, 8, 9], [9, 10, 8, 9], [9, 10, 8, 9]], MIN);
    const high = candles([[0, 0, 0, 1]], 3 * MIN);
    high[0].closed = false;
    const forming = buildContext(rule, low, { ms: MIN, higher: { '3m': { candles: high, ms: 3 * MIN } } });
    expect(forming.series.trend.value).toEqual([null, null, null, null]);
    const missing = buildContext(rule, low, { ms: MIN });
    expect(scanSignals(compileRule(rule), missing)).toEqual([]);
  });
});
