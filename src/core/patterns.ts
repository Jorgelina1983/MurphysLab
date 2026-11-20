import { atr } from './indicators';
import { swingPoints } from './levels';
import type { Candle, IndicatorOutputs, Series } from './types';

/**
 * Double tops and double bottoms. Murphy (1999), pp. 117-121: two peaks at
 * about the same level with a trough between them, after an advance; the
 * pattern is complete only when a close breaks the trough, and the height of
 * the pattern projected from that break gives a minimum objective. A double
 * bottom is the mirror image.
 */
export interface DoublePattern {
  kind: 'top' | 'bottom';
  /** The two peaks (or troughs) and the trough (or peak) between them, as candle indexes. */
  first: number;
  second: number;
  middle: number;
  /** Price of the two extremes (their average) and of the middle point, whose break completes the pattern. */
  level: number;
  neckline: number;
  /** Candle whose close broke the middle point. */
  completedAt: number;
  /** The measured objective: the pattern's height beyond the break. */
  objective: number;
}

export interface PatternOptions {
  /** Candles on each side of a swing point. */
  strength: number;
  /** The two extremes are at most this many candles apart, and the break must come within as many after the second. */
  lookback: number;
  /** How far apart the two extremes may be, in percent of their price. */
  tolerance: number;
  /** The pattern must be at least this many average ranges (ATR 14) tall. */
  minHeight: number;
}
export const DEFAULT_PATTERN: PatternOptions = { strength: 5, lookback: 80, tolerance: 0.4, minHeight: 2 };

export function findDoubles(candles: Candle[], o: PatternOptions = DEFAULT_PATTERN): DoublePattern[] {
  const out: DoublePattern[] = [];
  const range = atr(candles, 14);
  const pivots = swingPoints(candles, o.strength);
  for (const kind of ['top', 'bottom'] as const) {
    const dir = kind === 'top' ? 1 : -1;
    const price = (i: number) => (kind === 'top' ? candles[i].high : candles[i].low);
    const pts = pivots.filter((p) => p.kind === (kind === 'top' ? 'high' : 'low'));
    let usedUntil = -1;
    for (let b = 1; b < pts.length; b++) {
      const [p, q] = [pts[b - 1], pts[b]];
      if (p.index <= usedUntil || q.index - p.index > o.lookback) continue;
      const level = (p.price + q.price) / 2;
      if (Math.abs(q.price - p.price) > (level * o.tolerance) / 100) continue;
      // The middle point: the lowest low between two tops, the highest high between two bottoms.
      let middle = p.index + 1;
      for (let k = p.index + 1; k < q.index; k++) if (dir * (price2(candles, k, kind) - price2(candles, middle, kind)) < 0) middle = k;
      const neckline = price2(candles, middle, kind);
      const height = dir * (level - neckline);
      if (!(height >= o.minHeight * (range[q.index] ?? Infinity))) continue;
      // It must end a move: the first extreme is the highest high (lowest low) of the candles before it.
      let leads = true;
      for (let k = Math.max(0, p.index - o.lookback); k < p.index && leads; k++) if (dir * (price(k) - p.price) > 0) leads = false;
      if (!leads) continue;
      // Complete on the first close beyond the middle point, once the second extreme is confirmed and before
      // the price goes beyond the extremes, which would cancel the pattern.
      for (let i = q.confirmedAt; i < candles.length && i <= q.index + o.lookback; i++) {
        if (dir * (price(i) - Math.max(dir * p.price, dir * q.price) * dir) > 0) break;
        if (dir * (candles[i].close - neckline) < 0) {
          out.push({ kind, first: p.index, second: q.index, middle, level, neckline, completedAt: i, objective: neckline - dir * height });
          usedUntil = q.index;
          break;
        }
      }
    }
  }
  return out.sort((a, b) => a.completedAt - b.completedAt);
}
/** The opposite extreme of a candle: lows inside a double top, highs inside a double bottom. */
const price2 = (candles: Candle[], i: number, kind: 'top' | 'bottom') => (kind === 'top' ? candles[i].low : candles[i].high);

/**
 * The patterns as series a rule can read. On the completion candle `top` (or
 * `bottom`) is 1; `stop` holds the level of the two extremes and `objective`
 * the measured objective, both kept from then on until the next pattern.
 */
export function doubleSeries(candles: Candle[], o: PatternOptions = DEFAULT_PATTERN): IndicatorOutputs {
  const n = candles.length;
  const top: Series = new Array(n).fill(0);
  const bottom: Series = new Array(n).fill(0);
  const stop: Series = new Array(n).fill(null);
  const objective: Series = new Array(n).fill(null);
  for (const d of findDoubles(candles, o)) {
    (d.kind === 'top' ? top : bottom)[d.completedAt] = 1;
    for (let i = d.completedAt; i < n; i++) {
      stop[i] = d.level;
      objective[i] = d.objective;
    }
  }
  return { top, bottom, stop, objective };
}
