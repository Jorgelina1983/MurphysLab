import { describe, expect, it } from 'vitest';
import fixture from './fixtures/okx-btc-usdt-swap-5m.json';
import { atr, ema, extreme, macd } from '../src/core/indicators';
import { buildContext, compileRule, scanSignals } from '../src/core/rule/engine';
import type { Rule } from '../src/core/rule/types';
import { makeBbRsiRule } from '../src/core/rules/bbRsiReversal';
import { DEFAULT_STRATEGY, makeStrategyRule, type StrategyConfig } from '../src/core/rules/strategy';
import type { Candle } from '../src/core/types';
import { candles } from './helpers';

const real: Candle[] = fixture.d.split(';').map((row, i) => {
  const [open, high, low, close] = row.split(',').map((v) => Number(v) / 10);
  return { time: fixture.first + i * fixture.step, open, high, low, close, volume: 0, closed: true };
});
const scan = (rule: Rule) => scanSignals(compileRule(rule), buildContext(rule, real));
const off: StrategyConfig = { ...DEFAULT_STRATEGY, bollinger: { ...DEFAULT_STRATEGY.bollinger, on: false }, rsi: { ...DEFAULT_STRATEGY.rsi, on: false }, target: { kind: 'rr', rr: 2 } };

describe('new indicators', () => {
  it('computes MACD as fast EMA minus slow EMA, with a signal line and histogram', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = macd(v, 2, 4, 2);
    const fast = ema(v, 2);
    const slow = ema(v, 4);
    expect(out.macd.slice(0, 3)).toEqual([null, null, null]);
    expect(out.macd[5]).toBeCloseTo((fast[5] as number) - (slow[5] as number), 10);
    // On a straight line both EMAs settle at a constant gap: fast lags by 0.5, slow by 1.5.
    expect(out.macd[7]).toBeCloseTo(1, 6);
    expect(out.signal[3]).toBeNull();
    expect(out.signal[4]).toBeCloseTo(((out.macd[3] as number) + (out.macd[4] as number)) / 2, 10);
    expect(out.hist[7]).toBeCloseTo((out.macd[7] as number) - (out.signal[7] as number), 10);
  });

  it("computes ATR with Wilder's smoothing, counting gaps", () => {
    // True ranges: 2 (first candle), then max(2, |12-9|, |10-9|) = 3, then max(1, |9-11|, |8-11|) = 3.
    const cs = candles([[9, 10, 8, 9], [11, 12, 10, 11], [9, 9, 8, 8.5]]);
    const out = atr(cs, 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeCloseTo(2.5, 10);
    expect(out[2]).toBeCloseTo((2.5 + 3) / 2, 10);
  });

  it('finds the highest and lowest value of a window', () => {
    expect(extreme([3, 1, 4, 1, 5], 3, 'max')).toEqual([null, null, 4, 4, 5]);
    expect(extreme([3, 1, 4, 1, 5], 3, 'min')).toEqual([null, null, 1, 1, 1]);
  });
});

describe('strategy builder', () => {
  it('reproduces the Bollinger + RSI rule by default', () => {
    const a = scan(makeStrategyRule(DEFAULT_STRATEGY));
    const b = scan(makeBbRsiRule());
    expect(a.map((s) => [s.index, s.side, s.stop, s.target])).toEqual(b.map((s) => [s.index, s.side, s.stop, s.target]));
    expect(a).toHaveLength(9);
  });

  it('signals MACD crossovers exactly where the lines cross', () => {
    const out = macd(real.map((c) => c.close), 12, 26, 9);
    const expected: [number, string][] = [];
    for (let i = 1; i < real.length; i++) {
      const [m, s, pm, ps] = [out.macd[i], out.signal[i], out.macd[i - 1], out.signal[i - 1]];
      if (m === null || s === null || pm === null || ps === null) continue;
      if (pm >= ps && m < s) expected.push([i, 'short']);
      if (pm <= ps && m > s) expected.push([i, 'long']);
    }
    const signals = scan(makeStrategyRule({ ...off, macd: { ...off.macd, on: true } }));
    expect(signals.map((s) => [s.index, s.side])).toEqual(expected);
    expect(signals.length).toBeGreaterThan(3);
  });

  it('combines blocks with AND: adding a block can only remove signals', () => {
    const macdOnly = scan(makeStrategyRule({ ...off, macd: { ...off.macd, on: true, mode: 'side' } }));
    const both = scan(makeStrategyRule({ ...off, macd: { ...off.macd, on: true, mode: 'side' }, ma: { ...off.ma, on: true, mode: 'price', slow: 30 } }));
    const keys = new Set(macdOnly.map((s) => `${s.index}${s.side}`));
    expect(both.length).toBeLessThan(macdOnly.length);
    expect(both.every((s) => keys.has(`${s.index}${s.side}`))).toBe(true);
    expect(both[0].conditions).toHaveLength(2);
  });

  it('places a fixed reward-to-risk target and the chosen stop', () => {
    const cfg: StrategyConfig = { ...off, macd: { ...off.macd, on: true }, stop: { ...off.stop, kind: 'swing', lookback: 5 }, target: { kind: 'rr', rr: 2 } };
    for (const s of scan(makeStrategyRule(cfg))) {
      const window = real.slice(s.index - 4, s.index + 1);
      const stop = s.side === 'short' ? Math.max(...window.map((c) => c.high)) : Math.min(...window.map((c) => c.low));
      expect(s.stop).toBeCloseTo(stop, 6);
      expect(Math.abs(s.target - s.reference)).toBeCloseTo(2 * Math.abs(s.stop - s.reference), 6);
      expect(Math.sign(s.target - s.reference)).toBe(s.side === 'long' ? 1 : -1);
    }
    const atrStops = scan(makeStrategyRule({ ...cfg, stop: { ...cfg.stop, kind: 'atr', atrLength: 14, atrMult: 2 } }));
    const range = atr(real, 14);
    for (const s of atrStops) expect(Math.abs(s.stop - s.reference)).toBeCloseTo(2 * (range[s.index] as number), 6);
  });

  it('never signals when no entry block is on', () => {
    expect(scan(makeStrategyRule(off))).toEqual([]);
  });
});

import { normalizeStrategy } from '../src/core/rules/strategy';
import { migrateSettings } from '../src/ui/settings';

describe('stored settings', () => {
  it('fills defaults and repairs values the indicators cannot compute', () => {
    expect(normalizeStrategy()).toEqual(DEFAULT_STRATEGY);
    const s = normalizeStrategy({ macd: { fast: 30, slow: 10 }, ma: { fast: 0, slow: 1 }, rsi: { overbought: 140 }, target: { rr: -1 } });
    expect(s.macd.slow).toBeGreaterThan(s.macd.fast);
    expect(s.ma).toMatchObject({ fast: 2, slow: 3 });
    expect(s.rsi.overbought).toBe(100);
    expect(s.target.rr).toBe(DEFAULT_STRATEGY.target.rr);
  });

  it('turns settings saved before the blocks existed into the same rule', () => {
    const old = { timeframe: '15m', params: { bbLength: 30, bbMult: 2.5, rsiLength: 9, rsiOverbought: 60, rsiOversold: 40, trendFilter: true, trendLength: 100 } };
    const s = migrateSettings(old as never);
    expect(s.timeframe).toBe('15m');
    expect(s.riskPct).toBe(1);
    expect(s.strategy.bollinger).toMatchObject({ on: true, length: 30, mult: 2.5 });
    expect(s.strategy.rsi).toMatchObject({ length: 9, overbought: 60, oversold: 40 });
    expect(s.strategy.trend).toEqual({ mode: 'same', length: 100 });
    expect('params' in s).toBe(false);
  });
});
