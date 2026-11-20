import { describe, expect, it } from 'vitest';
import fixture from './fixtures/okx-btc-usdt-swap-5m.json';
import expected from './fixtures/okx-btc-usdt-swap-5m.expected.json';
import { buildContext, compileRule, scanSignals } from '../src/core/rule/engine';
import { DEFAULT_BB_RSI_PARAMS, makeBbRsiRule } from '../src/core/rules/bbRsiReversal';
import { sma } from '../src/core/indicators';
import type { Candle } from '../src/core/types';

const candles: Candle[] = fixture.d.split(';').map((row, i) => {
  const [open, high, low, close] = row.split(',').map((v) => Number(v) / 10);
  return { time: fixture.first + i * fixture.step, open, high, low, close, volume: 0, closed: true };
});

type Ref = { basis: (number | null)[]; upper: (number | null)[]; lower: (number | null)[]; rsi: (number | null)[]; signals: { index: number; side: string; stop: number; target: number }[] };

function check(name: 'default' | 'loose', overbought: number, oversold: number) {
  const ref = (expected as Record<string, Ref>)[name];
  const rule = makeBbRsiRule({ ...DEFAULT_BB_RSI_PARAMS, rsiOverbought: overbought, rsiOversold: oversold });
  const ctx = buildContext(rule, candles);

  const close = (a: number | null, b: number | null) => (a === null || b === null ? expect(a).toBe(b) : expect(a).toBeCloseTo(b, 4));
  candles.forEach((_, i) => {
    close(ctx.series.bb.basis[i], ref.basis[i]);
    close(ctx.series.bb.upper[i], ref.upper[i]);
    close(ctx.series.bb.lower[i], ref.lower[i]);
    close(ctx.series.rsi.value[i], ref.rsi[i]);
  });

  const signals = scanSignals(compileRule(rule), ctx);
  expect(signals.map((s) => [s.index, s.side])).toEqual(ref.signals.map((s) => [s.index, s.side]));
  signals.forEach((s, k) => {
    expect(s.stop).toBeCloseTo(ref.signals[k].stop, 6);
    expect(s.target).toBeCloseTo(ref.signals[k].target, 6);
  });
  return signals.length;
}

describe('recorded OKX candles (BTC-USDT perpetual, 5m)', () => {
  it('matches the independent reference with the default 70/30 thresholds', () => {
    expect(check('default', 70, 30)).toBe(9);
  });

  it('matches the independent reference with looser 60/40 thresholds', () => {
    expect(check('loose', 60, 40)).toBe(24);
  });
});

describe('trend filter', () => {
  it('keeps only shorts below the trend average and longs above it', () => {
    const trendLength = 100;
    const base = { ...DEFAULT_BB_RSI_PARAMS, rsiOverbought: 60, rsiOversold: 40, trendLength };
    const scan = (trendFilter: boolean) => {
      const rule = makeBbRsiRule({ ...base, trendMode: trendFilter ? 'same' : 'off' });
      return scanSignals(compileRule(rule), buildContext(rule, candles));
    };
    const average = sma(candles.map((c) => c.close), trendLength);
    const expected = scan(false).filter((s) => {
      const a = average[s.index];
      return a !== null && (s.side === 'short' ? candles[s.index].close < a : candles[s.index].close > a);
    });
    const filtered = scan(true);
    expect(filtered.map((s) => [s.index, s.side])).toEqual(expected.map((s) => [s.index, s.side]));
    // On this sample only one of the 24 unfiltered signals is with the trend: a long at candle 131.
    expect(filtered.map((s) => [s.index, s.side])).toEqual([[131, 'long']]);
    expect(scan(false)).toHaveLength(24);
    expect(filtered[0].conditions).toHaveLength(5);
  });

  it('adds no indicator or condition when it is off', () => {
    const rule = makeBbRsiRule(DEFAULT_BB_RSI_PARAMS);
    expect(Object.keys(rule.indicators)).toEqual(['bb', 'rsi']);
  });
});
