import { swingPoints } from './levels';
import type { Candle, IndicatorOutputs, Series } from './types';

/**
 * A divergence between price and an oscillator: price makes a higher high
 * while the oscillator makes a lower one (bearish), or price makes a lower low
 * while the oscillator makes a higher one (bullish). Murphy (1999), pp. 226-228
 * and, for the RSI, pp. 239-246: it warns that the move is losing force, and
 * it matters most when the oscillator is in an extreme area.
 */
export interface Divergence {
  side: 'bear' | 'bull';
  /** The two swing points compared: candle indexes, with the price and oscillator values there. */
  from: number;
  to: number;
  priceFrom: number;
  priceTo: number;
  oscFrom: number;
  oscTo: number;
  /** First candle at which it is known: when the second swing point is confirmed. */
  confirmedAt: number;
}

/**
 * Compare each confirmed swing high with the swing high before it, and each
 * swing low with the swing low before it, when they are at most `lookback`
 * candles apart. Nothing is reported before `confirmedAt`, so no candle uses a
 * swing point that needed later candles to exist.
 *
 * With `zone`, the first of the two points must have the oscillator in the
 * extreme area: at or above `upper` for a bearish divergence, at or below
 * `lower` for a bullish one.
 */
export function findDivergences(candles: Candle[], osc: Series, strength: number, lookback: number, zone?: { upper: number; lower: number }): Divergence[] {
  const out: Divergence[] = [];
  const last: Record<'high' | 'low', number | null> = { high: null, low: null };
  for (const p of swingPoints(candles, strength)) {
    const prev = last[p.kind];
    last[p.kind] = p.index;
    if (prev === null || p.index - prev > lookback) continue;
    const a = osc[prev];
    const b = osc[p.index];
    if (a == null || b == null) continue;
    const priceFrom = p.kind === 'high' ? candles[prev].high : candles[prev].low;
    const bear = p.kind === 'high' && p.price > priceFrom && b < a && (!zone || a >= zone.upper);
    const bull = p.kind === 'low' && p.price < priceFrom && b > a && (!zone || a <= zone.lower);
    if (bear || bull) out.push({ side: bear ? 'bear' : 'bull', from: prev, to: p.index, priceFrom, priceTo: p.price, oscFrom: a, oscTo: b, confirmedAt: p.confirmedAt });
  }
  return out;
}

/** The divergences as series a rule can read: 1 on the candle where one becomes known, 0 otherwise. */
export function divergenceSeries(length: number, list: Divergence[]): IndicatorOutputs {
  const bear: Series = new Array(length).fill(0);
  const bull: Series = new Array(length).fill(0);
  for (const d of list) if (d.confirmedAt < length) (d.side === 'bear' ? bear : bull)[d.confirmedAt] = 1;
  return { bear, bull };
}
