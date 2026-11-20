import { describe, expect, it } from 'vitest';
import { findDivergences } from '../src/core/divergence';
import { obv, rsi, stochastic } from '../src/core/indicators';
import { buildContext, compileRule, scanSignals } from '../src/core/rule/engine';
import { relate } from '../src/core/rules/relations';
import { BUILTIN_STRATEGIES, DEFAULT_STRATEGY, ENTRY_BLOCKS, activeBlocks, classifyStrategy, makeStrategyRule, normalizeStrategy, type StrategyConfig } from '../src/core/rules/strategy';
import type { Series } from '../src/core/types';
import { candles } from './helpers';
import { real15 } from './real';

const real = real15;
const scan = (s: StrategyConfig, confirmOnly = false) => {
  const rule = makeStrategyRule(s, undefined, confirmOnly);
  return scanSignals(compileRule(rule), buildContext(rule, real));
};
const none = normalizeStrategy({ bollinger: { on: false }, rsi: { on: false }, target: { kind: 'rr', rr: 2 }, stop: { kind: 'atr' } });

describe('stochastics', () => {
  it('places the close inside the recent range and smooths it twice', () => {
    // Range 10-20 throughout; closes at 20, 15, 10, 20 give raw %K 100, 50, 0, 100.
    const c = candles([[15, 20, 10, 20], [15, 20, 10, 15], [15, 20, 10, 10], [15, 20, 10, 20]]);
    expect(stochastic(c, 1, 1, 1).k).toEqual([100, 50, 0, 100]);
    const s = stochastic(c, 2, 2, 2);
    expect(s.k).toEqual([null, null, 25, 50]);
    expect(s.d).toEqual([null, null, null, 37.5]);
  });
  it('reads a flat range as the middle and stays between 0 and 100 on real prices', () => {
    expect(stochastic(candles([[5, 5, 5, 5], [5, 5, 5, 5]]), 2, 1, 1).k).toEqual([null, 50]);
    const { k, d } = stochastic(real, 14, 3, 3);
    for (const v of [...k, ...d]) if (v !== null) expect(v >= 0 && v <= 100).toBe(true);
    expect(k.findIndex((v) => v !== null)).toBe(15);
    expect(d.findIndex((v) => v !== null)).toBe(17);
  });
  it('signals a cross of %K and %D only from the extreme area', () => {
    const signals = scan({ ...none, stoch: { ...none.stoch, on: true, mode: 'cross' } });
    expect(signals.length).toBeGreaterThan(0);
    const { k, d } = stochastic(real, 14, 3, 3) as { k: number[]; d: number[] };
    for (const s of signals) {
      const i = s.index;
      if (s.side === 'short') expect(d[i - 1] > 80 && k[i - 1] >= d[i - 1] && k[i] < d[i]).toBe(true);
      else expect(d[i - 1] < 20 && k[i - 1] <= d[i - 1] && k[i] > d[i]).toBe(true);
    }
  });
});

describe('on balance volume', () => {
  it('adds the volume of rising closes and subtracts the volume of falling ones', () => {
    const c = candles([[1, 1, 1, 10], [1, 1, 1, 11], [1, 1, 1, 11], [1, 1, 1, 9], [1, 1, 1, 12]]).map((x, i) => ({ ...x, volume: [5, 7, 3, 4, 6][i] }));
    expect(obv(c)).toEqual([0, 7, 7, 3, 9]);
  });
});

describe('divergences', () => {
  // Two swing highs at candles 2 and 6 (the second higher), two swing lows at 4 and 8 (the second lower).
  const rows = [[10, 11, 9, 10], [10, 12, 10, 11], [11, 15, 11, 14], [14, 14, 11, 12], [12, 12, 8, 9], [9, 13, 9, 12], [12, 17, 12, 16], [16, 16, 9, 10], [10, 10, 6, 7], [7, 9, 7, 8], [8, 10, 8, 9]];
  const c = candles(rows);
  const osc = (highs: [number, number], lows: [number, number]): Series => rows.map((_, i) => (i === 2 ? highs[0] : i === 6 ? highs[1] : i === 4 ? lows[0] : i === 8 ? lows[1] : 50));

  it('finds a higher high with a lower oscillator, and a lower low with a higher oscillator', () => {
    const found = findDivergences(c, osc([80, 70], [20, 30]), 1, 10);
    expect(found).toEqual([
      { side: 'bear', from: 2, to: 6, priceFrom: 15, priceTo: 17, oscFrom: 80, oscTo: 70, confirmedAt: 7 },
      { side: 'bull', from: 4, to: 8, priceFrom: 8, priceTo: 6, oscFrom: 20, oscTo: 30, confirmedAt: 9 },
    ]);
  });
  it('reports nothing when the oscillator confirms the price', () => {
    expect(findDivergences(c, osc([70, 80], [30, 20]), 1, 10)).toEqual([]);
  });
  it('respects the maximum distance and the extreme area', () => {
    expect(findDivergences(c, osc([80, 70], [20, 30]), 1, 3)).toEqual([]);
    expect(findDivergences(c, osc([65, 60], [20, 30]), 1, 10, { upper: 70, lower: 30 }).map((d) => d.side)).toEqual(['bull']);
  });
  it('does not know a divergence before its second swing point is confirmed', () => {
    // With only the candles up to the second high, that high is not yet a swing point.
    expect(findDivergences(c.slice(0, 7), osc([80, 70], [20, 30]), 1, 10)).toEqual([]);
    expect(findDivergences(c.slice(0, 8), osc([80, 70], [20, 30]), 1, 10)).toHaveLength(1);
  });
  it('fires the rule on the confirmation candle, with the oscillator of its block', () => {
    const cfg: StrategyConfig = { ...none, div: { on: true, osc: 'rsi', strength: 5, lookback: 60, zone: false } };
    const signals = scan(cfg);
    const known = findDivergences(real, rsi(real.map((x) => x.close), 14), 5, 60);
    expect(known.length).toBeGreaterThan(0);
    expect(signals.map((s) => [s.index, s.side])).toEqual(known.map((d) => [d.confirmedAt, d.side === 'bear' ? 'short' : 'long']));
    // Asking for the extreme area can only remove divergences.
    const strict = scan({ ...cfg, div: { ...cfg.div, zone: true } });
    expect(strict.length).toBeLessThanOrEqual(signals.length);
    for (const s of strict) expect(signals.some((x) => x.index === s.index && x.side === s.side)).toBe(true);
  });
});

describe('volume as confirmation', () => {
  it('never fires by itself, and only removes signals from the block it confirms', () => {
    const volumeOnly: StrategyConfig = { ...none, volume: { ...none.volume, on: true } };
    expect(activeBlocks(volumeOnly)).toBe(0);
    expect(scan(volumeOnly)).toEqual([]);
    expect(scan(volumeOnly, true).length).toBeGreaterThan(0); // counted only when asked for
    const macdOnly: StrategyConfig = { ...none, macd: { ...none.macd, on: true } };
    const base = scan(macdOnly);
    for (const mode of ['above', 'obv'] as const) {
      const confirmed = scan({ ...macdOnly, volume: { ...none.volume, on: true, mode } });
      expect(confirmed.length).toBeGreaterThan(0);
      expect(confirmed.length).toBeLessThan(base.length);
      for (const s of confirmed) expect(base.some((x) => x.index === s.index && x.side === s.side)).toBe(true);
    }
  });
  it('compares the candle with the average of the candles before it', () => {
    const cfg: StrategyConfig = { ...none, macd: { ...none.macd, on: true, mode: 'side' }, volume: { on: true, mode: 'above', length: 20, mult: 1.5 } };
    for (const s of scan(cfg)) {
      const before = real.slice(s.index - 20, s.index).reduce((sum, x) => sum + x.volume, 0) / 20;
      expect(real[s.index].volume).toBeGreaterThan(before * 1.5);
    }
  });
});

describe('ready-made combinations and relations with the new blocks', () => {
  it('files every combination under the kind the rule is classified as', () => {
    for (const b of BUILTIN_STRATEGIES) expect([b.id, classifyStrategy(b.strategy)]).toEqual([b.id, b.kind]);
  });
  it('gives signals on real prices for each new combination', () => {
    for (const id of ['divRsi', 'divMacd', 'stochTrend', 'macdObv', 'srBreakVol']) {
      const b = BUILTIN_STRATEGIES.find((x) => x.id === id)!;
      // The higher-timeframe filter needs data this test does not load; measured on the chart's own timeframe.
      const s = b.strategy.trend.mode === 'higher' ? { ...b.strategy, trend: { ...b.strategy.trend, mode: 'same' as const } } : b.strategy;
      expect([id, scan(s).length > 0]).toEqual([id, true]);
    }
  });
  it('has a relation for every pair of indicators', () => {
    for (const a of ENTRY_BLOCKS) {
      for (const b of ENTRY_BLOCKS) {
        if (a === b) continue;
        const cfg = normalizeStrategy({ bollinger: { on: false }, rsi: { on: false } });
        (cfg[a] as { on: boolean }).on = true;
        (cfg[b] as { on: boolean }).on = true;
        const r = relate(cfg);
        expect(r.pairs).toHaveLength(1);
        expect(['ok', 'rare', 'conflict']).toContain(r.pairs[0].relation);
        expect(r.pairs[0].reason).toMatch(/^rel\./);
      }
    }
  });
  it('never makes volume the trigger, and reads the divergence on a chosen oscillator', () => {
    const only = relate({ ...none, volume: { ...none.volume, on: true } });
    expect(only.trigger).toBeNull();
    const withMacd = relate({ ...none, volume: { ...none.volume, on: true }, macd: { ...none.macd, on: true } });
    expect(withMacd.trigger).toBe('macd');
    expect(withMacd.arranged.volume.mode).toBe('obv');
    expect(withMacd.preset).toBe('macdObv');
    const div = relate({ ...none, div: { ...none.div, on: true }, stoch: { ...none.stoch, on: true } });
    expect(div.trigger).toBe('div');
    expect(div.arranged.div.osc).toBe('stoch');
    expect(div.arranged.stoch.mode).toBe('zone');
  });
  it('keeps settings saved before these blocks existed unchanged', () => {
    const old = { bollinger: DEFAULT_STRATEGY.bollinger, rsi: DEFAULT_STRATEGY.rsi };
    expect(normalizeStrategy(old)).toEqual(DEFAULT_STRATEGY);
    expect(normalizeStrategy({ stoch: { smooth: 0, overbought: 400 }, div: { osc: 'x' as never, lookback: 1 }, volume: { mult: -2 } })).toMatchObject({
      stoch: { smooth: 1, overbought: 100 },
      div: { osc: 'rsi', lookback: 5 },
      volume: { mult: 1.5 },
    });
  });
});
