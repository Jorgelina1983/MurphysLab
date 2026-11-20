import { describe, expect, it } from 'vitest';
import { longTerm } from '../src/core/longTerm';
import { findDoubles, doubleSeries, DEFAULT_PATTERN } from '../src/core/patterns';
import { buildContext, compileRule, scanSignals } from '../src/core/rule/engine';
import { BUILTIN_STRATEGIES, makeStrategyRule } from '../src/core/rules/strategy';
import { trendlines } from '../src/core/trendlines';
import type { Candle } from '../src/core/types';
import { real15 } from './real';

/** Candles from a list of closes: each opens at the previous close, with a small wick on both sides. */
const path = (closes: number[]): Candle[] =>
  closes.map((close, i) => {
    const open = i ? closes[i - 1] : close;
    return { time: i * 60_000, open, high: Math.max(open, close) + 0.2, low: Math.min(open, close) - 0.2, close, volume: 1, closed: true };
  });
/** A zigzag through the given turning points, `step` candles from one to the next. */
const zigzag = (points: number[], step: number): number[] => points.flatMap((p, k) => (k === 0 ? [p] : Array.from({ length: step }, (_, j) => points[k - 1] + ((p - points[k - 1]) * (j + 1)) / step)));

describe('trendlines', () => {
  // Higher lows at 100, 104, 108, eight candles apart (a line rising half a point per candle), then a fall through it.
  const closes = zigzag([106, 100, 110, 104, 114, 108, 118, 100], 4);
  const c = path(closes);
  const t = trendlines(c, 2, 100);

  it('draws the up line through higher lows once the second low is confirmed, and counts the third touch', () => {
    const second = closes.indexOf(104);
    expect(t.up.slice(0, second + 2).every((v) => v === null)).toBe(true); // not before the low is confirmed
    expect(t.up[second + 2]).not.toBeNull();
    const third = closes.lastIndexOf(108);
    const i = third + 2;
    expect(t.upSlope[i]).toBeCloseTo((104 - 100) / 8, 6);
    expect(t.upTouches[i]).toBe(3);
    expect(t.up[i]).toBeCloseTo(c[4].low + ((104 - 100) / 8) * (i - 4), 6);
    expect(t.upFrom[i]).toBe(4);
    expect(t.upChannel[i]).toBeGreaterThan(5);
  });
  it('marks the break on the first close below the line, with the touches the line had, and then drops the line', () => {
    const at = t.upBreak.findIndex((v) => (v as number) > 0);
    expect(at).toBeGreaterThan(closes.lastIndexOf(118));
    expect(t.upBreak[at]).toBe(3);
    expect(c[at].close).toBeLessThan((t.up[at - 1] as number) + (t.upSlope[at - 1] as number));
    expect(c[at - 1].close).toBeGreaterThanOrEqual(t.up[at - 1] as number);
    expect(t.up[at]).toBeNull();
    expect(t.upBreak.filter((v) => (v as number) > 0)).toHaveLength(1);
  });
  it('mirrors for a down line', () => {
    const down = trendlines(path(zigzag([194, 200, 190, 196, 186, 192, 182, 200], 4)), 2, 100);
    const at = down.downBreak.findIndex((v) => (v as number) > 0);
    expect(down.downBreak[at]).toBe(3);
    expect(down.downSlope[at - 1]).toBeLessThan(0);
    expect(down.upBreak.every((v) => v === 0)).toBe(true);
  });
  it('never lets a close stand beyond a line in force, and uses nothing from later candles', () => {
    const full = trendlines(real15, 5, 150);
    real15.forEach((x, i) => {
      if (full.up[i] !== null) expect(x.close).toBeGreaterThanOrEqual(full.up[i] as number);
      if (full.down[i] !== null) expect(x.close).toBeLessThanOrEqual(full.down[i] as number);
    });
    expect(full.upBreak.filter((v) => (v as number) > 0).length).toBeGreaterThan(3);
    expect(full.downBreak.filter((v) => (v as number) > 0).length).toBeGreaterThan(3);
    const part = trendlines(real15.slice(0, 600), 5, 150);
    for (const key of ['up', 'down', 'upBreak', 'downBreak', 'upTouches']) expect(part[key]).toEqual(full[key].slice(0, 600));
  });
});

describe('double tops and bottoms', () => {
  const opts = { ...DEFAULT_PATTERN, strength: 2, lookback: 40, minHeight: 1 };
  // An advance to 120, back to 110, a second peak at 120, then a fall through 110.
  const top = path(zigzag([100, 120, 110, 120, 100], 5));

  it('completes a double top on the close below the trough, with the measured objective', () => {
    const found = findDoubles(top, opts);
    expect(found).toHaveLength(1);
    const d = found[0];
    expect(d).toMatchObject({ kind: 'top', first: 5, second: 15, middle: 10 });
    expect(d.level).toBeCloseTo(120.2);
    expect(d.neckline).toBeCloseTo(109.8);
    expect(top[d.completedAt].close).toBeLessThan(d.neckline);
    expect(top[d.completedAt - 1].close).toBeGreaterThanOrEqual(d.neckline);
    expect(d.objective).toBeCloseTo(109.8 - (120.2 - 109.8));
    const s = doubleSeries(top, opts);
    expect(s.top.filter((v) => v === 1)).toHaveLength(1);
    expect(s.top[d.completedAt]).toBe(1);
    expect(s.objective[d.completedAt - 1]).toBeNull();
    expect(s.objective[d.completedAt]).toBeCloseTo(d.objective);
  });
  it('mirrors for a double bottom', () => {
    const found = findDoubles(path(zigzag([120, 100, 110, 100, 120], 5)), opts);
    expect(found.map((d) => d.kind)).toEqual(['bottom']);
    expect(found[0].objective).toBeGreaterThan(found[0].neckline);
  });
  it('needs two peaks at about the same level, a break of the trough, and an advance before it', () => {
    expect(findDoubles(path(zigzag([100, 120, 110, 126, 100], 5)), opts)).toEqual([]); // second peak clearly higher
    expect(findDoubles(path(zigzag([100, 120, 110, 120, 112], 5)), opts)).toEqual([]); // the trough holds
    expect(findDoubles(path(zigzag([130, 100, 120, 110, 120, 100], 5)), opts)).toEqual([]); // the peaks do not end an advance
    expect(findDoubles(top, { ...opts, minHeight: 50 })).toEqual([]); // too shallow to count
  });
  it('finds some on real prices and knows each one only from its completion candle', () => {
    const o = { ...DEFAULT_PATTERN, strength: 3 };
    const full = findDoubles(real15, o);
    expect(full.length).toBeGreaterThan(0);
    for (const d of full) {
      expect(d.completedAt).toBeGreaterThanOrEqual(d.second + o.strength);
      expect(findDoubles(real15.slice(0, d.completedAt), o).some((x) => x.second === d.second && x.kind === d.kind)).toBe(false);
      expect(findDoubles(real15.slice(0, d.completedAt + 1), o).some((x) => x.second === d.second && x.kind === d.kind)).toBe(true);
    }
  });
});

describe('long-term reading', () => {
  const days = (closes: number[]): Candle[] => closes.map((close, i) => ({ time: i * 86_400_000, open: close, high: close, low: close, close, volume: 1, closed: true }));
  it('reads the trend from the order of the close and its 50 and 200-day averages', () => {
    const rising = longTerm(days(Array.from({ length: 260 }, (_, i) => 100 + i)))!;
    expect(rising).toMatchObject({ trend: 'up', close: 359, days: 259 });
    expect(rising.sma50).toBeCloseTo(334.5);
    expect(rising.sma200).toBeCloseTo(259.5);
    expect(rising.change).toBeCloseTo(2.59);
    expect(longTerm(days(Array.from({ length: 260 }, (_, i) => 500 - i)))!.trend).toBe('down');
    // A sharp bounce inside a decline: the close is above the 50, which is still below the 200.
    expect(longTerm(days([...Array.from({ length: 259 }, (_, i) => 500 - i), 400]))!.trend).toBe('mixed');
  });
  it('says so when there are too few days, ignores the day still forming, and measures the change over a year at most', () => {
    expect(longTerm(days(Array.from({ length: 120 }, (_, i) => 100 + i)))).toMatchObject({ trend: 'unknown', sma200: null });
    expect(longTerm([])).toBeNull();
    const forming = days(Array.from({ length: 260 }, (_, i) => 100 + i));
    forming.push({ ...forming[259], time: 260 * 86_400_000, close: 1, closed: false });
    expect(longTerm(forming)!.close).toBe(359);
    const long = longTerm(days(Array.from({ length: 500 }, (_, i) => 100 + i)))!;
    expect(long.days).toBe(365);
    expect(long.change).toBeCloseTo(599 / 234 - 1);
  });
});

describe('rules built on trendlines and patterns', () => {
  const scan = (id: string) => {
    const b = BUILTIN_STRATEGIES.find((x) => x.id === id)!;
    const rule = makeStrategyRule(b.strategy);
    return { b, signals: scanSignals(compileRule(rule), buildContext(rule, real15)) };
  };
  it('signals a trendline break on the candle the line is crossed, on the side of the break', () => {
    const { signals } = scan('tlBreakMacd');
    const t = trendlines(real15, 5, 150);
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) expect((s.side === 'short' ? t.upBreak : t.downBreak)[s.index]).toBeGreaterThanOrEqual(2);
    // Asking for a third touch can only leave fewer breaks.
    const all = t.upBreak.filter((v) => (v as number) >= 2).length + t.downBreak.filter((v) => (v as number) >= 2).length;
    const confirmed = scan('tlBreak').signals.length;
    expect(confirmed).toBeGreaterThan(0);
    expect(confirmed).toBeLessThan(all);
  });
  it('trades a completed double top or bottom towards its measured objective', () => {
    const { b, signals } = scan('doubleTop');
    const found = findDoubles(real15, { strength: b.strategy.pattern.strength, lookback: b.strategy.pattern.lookback, tolerance: b.strategy.pattern.tolerance, minHeight: b.strategy.pattern.minHeight });
    expect(signals.map((s) => [s.index, s.side, s.target])).toEqual(found.map((d) => [d.completedAt, d.kind === 'top' ? 'short' : 'long', d.objective]));
  });
});
