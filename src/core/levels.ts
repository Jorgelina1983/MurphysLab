import type { Candle, IndicatorOutputs, Series } from './types';

/** A swing point: a high (or low) that no candle within `strength` candles on either side exceeds. */
export interface Pivot {
  index: number;
  kind: 'high' | 'low';
  price: number;
  /** First candle at which the pivot is known: `strength` candles after it formed. */
  confirmedAt: number;
}

/**
 * Reaction highs and lows. Murphy (1999), p. 55: a previous reaction low is
 * support and a previous peak is resistance.
 */
export function swingPoints(candles: Candle[], strength: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = strength; i < candles.length - strength; i++) {
    let high = true;
    let low = true;
    for (let j = i - strength; j <= i + strength && (high || low); j++) {
      if (j === i) continue;
      // Of two equal extremes in one window, the earlier one is the pivot.
      if (j < i ? candles[j].high >= candles[i].high : candles[j].high > candles[i].high) high = false;
      if (j < i ? candles[j].low <= candles[i].low : candles[j].low < candles[i].low) low = false;
    }
    if (high) out.push({ index: i, kind: 'high', price: candles[i].high, confirmedAt: i + strength });
    if (low) out.push({ index: i, kind: 'low', price: candles[i].low, confirmedAt: i + strength });
  }
  return out;
}

/** Swing points this close to a level, in percent of its price, count as further tests of it, not as new levels. */
export const LEVEL_MERGE_PCT = 0.15;

/**
 * For each candle, the nearest swing level above its close (resistance) and
 * below it (support), among pivots formed in the last `lookback` candles.
 *
 * Two things follow Murphy: a level is only used once it is confirmed, so no
 * candle sees a pivot that needed later candles to exist; and any pivot price
 * above the close counts as resistance and any below as support, whichever
 * kind it was, because a broken level reverses its role.
 *
 * `supportTests` and `resistanceTests` say how many swing points sit at each of
 * the two levels.
 */
export function swingLevels(candles: Candle[], strength: number, lookback: number): IndicatorOutputs {
  const pivots = swingPoints(candles, strength);
  const support: Series = new Array(candles.length).fill(null);
  const resistance: Series = new Array(candles.length).fill(null);
  // How many swing points sit at each of those two levels: 1 for a level seen once, more for one tested again.
  const supportTests: Series = new Array(candles.length).fill(null);
  const resistanceTests: Series = new Array(candles.length).fill(null);
  let first = 0;
  for (let i = 0; i < candles.length; i++) {
    while (first < pivots.length && pivots[first].index < i - lookback) first++;
    const close = candles[i].close;
    for (let k = first; k < pivots.length && pivots[k].index <= i - strength; k++) {
      const p = pivots[k].price;
      if (p > close && (resistance[i] === null || p < (resistance[i] as number))) resistance[i] = p;
      if (p < close && (support[i] === null || p > (support[i] as number))) support[i] = p;
    }
    const [res, sup] = [resistance[i], support[i]];
    if (res === null && sup === null) continue;
    let resCount = 0;
    let supCount = 0;
    for (let k = first; k < pivots.length && pivots[k].index <= i - strength; k++) {
      const p = pivots[k].price;
      if (res !== null && p > close && Math.abs(p - res) <= (res * LEVEL_MERGE_PCT) / 100) resCount++;
      if (sup !== null && p < close && Math.abs(p - sup) <= (sup * LEVEL_MERGE_PCT) / 100) supCount++;
    }
    if (res !== null) resistanceTests[i] = resCount;
    if (sup !== null) supportTests[i] = supCount;
  }
  return { support, resistance, supportTests, resistanceTests };
}

export const FIB_RATIOS = [0.382, 0.5, 0.618] as const;

/**
 * Fibonacci retracements of the latest swing. Murphy (1999), pp. 334-338: after
 * a move, prices often retrace 38%, 50% or 62% of it before resuming.
 *
 * The swing is the leg between the most recent confirmed pivot and the nearest
 * pivot of the opposite kind before it. After an up leg (low to high) the three
 * levels sit below the high and act as support for a pullback; after a down
 * leg they sit above the low and act as resistance for a rally.
 *
 * Outputs, per candle: `r382`, `r500`, `r618` (the three prices), `start` and
 * `end` (the leg's prices), `startAt` and `endAt` (the candles where it starts and ends), `dir` (1 up leg, -1 down leg), `support` (up leg: the
 * highest of the three levels below the close; missing once the close is under
 * the 61.8% level) and `resistance` (down leg: the lowest level above the close).
 * Like the swing levels, a leg is only used once its last pivot is confirmed.
 */
export function fibRetracements(candles: Candle[], strength: number, lookback: number): IndicatorOutputs {
  const n = candles.length;
  const make = (): Series => new Array(n).fill(null);
  const out = { r382: make(), r500: make(), r618: make(), start: make(), end: make(), startAt: make(), endAt: make(), dir: make(), support: make(), resistance: make() };
  const pivots = swingPoints(candles, strength).sort((a, b) => a.confirmedAt - b.confirmedAt || a.index - b.index);
  let known = 0; // pivots[0..known) are confirmed at the current candle
  for (let i = 0; i < n; i++) {
    while (known < pivots.length && pivots[known].confirmedAt <= i) known++;
    let last: Pivot | undefined;
    let prev: Pivot | undefined;
    for (let k = known - 1; k >= 0 && !prev; k--) {
      const p = pivots[k];
      if (p.index < i - lookback) break;
      if (!last) last = p;
      else if (p.kind !== last.kind && p.index < last.index) prev = p;
    }
    if (!last || !prev) continue;
    const up = last.kind === 'high';
    const range = Math.abs(last.price - prev.price);
    if (!(range > 0) || (up ? last.price <= prev.price : last.price >= prev.price)) continue;
    const level = (r: number) => (up ? last.price - r * range : last.price + r * range);
    const [a, b, c] = FIB_RATIOS.map(level);
    out.r382[i] = a;
    out.r500[i] = b;
    out.r618[i] = c;
    out.start[i] = prev.price;
    out.end[i] = last.price;
    out.startAt[i] = prev.index;
    out.endAt[i] = last.index;
    out.dir[i] = up ? 1 : -1;
    const close = candles[i].close;
    // Levels run from the shallowest retracement to the deepest, so the first one beyond the close is the nearest.
    if (up) out.support[i] = [a, b, c].find((v) => v < close) ?? null;
    else out.resistance[i] = [a, b, c].find((v) => v > close) ?? null;
  }
  return out;
}

export interface SwingLevel {
  price: number;
  side: 'support' | 'resistance';
  /** How many swing points sit at this level. More tests make a level more visible to traders. */
  touches: number;
  /** Candle of the earliest swing point at this level. */
  from: number;
}

/**
 * The support and resistance levels in force at candle `at`: up to `perSide`
 * on each side of its close, nearest first. Swing points within `tolerancePct`
 * percent of a level are counted as further tests of that level, not as
 * separate levels. The nearest level on each side is exactly the one
 * `swingLevels` reports, so the chart and the rule never disagree.
 */
export function levelMap(candles: Candle[], strength: number, lookback: number, at: number, tolerancePct: number, perSide: number): SwingLevel[] {
  if (at < 0 || at >= candles.length) return [];
  const close = candles[at].close;
  const pivots = swingPoints(candles.slice(0, at + 1), strength).filter((p) => p.index >= at - lookback && p.price !== close);
  const out: SwingLevel[] = [];
  for (const side of ['resistance', 'support'] as const) {
    const pool = pivots.filter((p) => (side === 'resistance' ? p.price > close : p.price < close)).sort((a, b) => Math.abs(a.price - close) - Math.abs(b.price - close));
    const used = new Set<number>();
    let count = 0;
    for (let i = 0; i < pool.length && count < perSide; i++) {
      if (used.has(i)) continue;
      const level: SwingLevel = { price: pool[i].price, side, touches: 0, from: pool[i].index };
      for (let j = i; j < pool.length; j++) {
        if (used.has(j) || Math.abs(pool[j].price - level.price) > (level.price * tolerancePct) / 100) continue;
        used.add(j);
        level.touches++;
        level.from = Math.min(level.from, pool[j].index);
      }
      out.push(level);
      count++;
    }
  }
  return out;
}
