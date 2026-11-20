import type { Candle, Series } from './types';

/** One forced closing of a position, as the exchange reports it. */
export interface Liquidation {
  time: number;
  price: number;
  /** Size of the liquidated position in USDT. */
  usd: number;
  /** The position that was liquidated: longs are sold out as the price falls, shorts bought back as it rises. */
  side: 'long' | 'short';
}

/**
 * Liquidated USDT per candle. Longs are returned as negative numbers so a
 * histogram draws them downward and shorts upward. Candles older than the
 * first liquidation loaded are left empty: nothing is known about them, which
 * is different from knowing there were none.
 */
export function liquidationsPerCandle(candles: Candle[], ms: number, list: Liquidation[]): { longs: Series; shorts: Series } {
  const longs: Series = new Array(candles.length).fill(null);
  const shorts: Series = new Array(candles.length).fill(null);
  if (list.length === 0 || candles.length === 0) return { longs, shorts };
  const since = Math.min(...list.map((l) => l.time));
  const index = new Map(candles.map((c, i) => [c.time, i]));
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].time + ms > since) {
      longs[i] = 0;
      shorts[i] = 0;
    }
  }
  for (const l of list) {
    const i = index.get(Math.floor(l.time / ms) * ms);
    if (i === undefined) continue;
    if (l.side === 'long') longs[i] = (longs[i] ?? 0) - l.usd;
    else shorts[i] = (shorts[i] ?? 0) + l.usd;
  }
  return { longs, shorts };
}

export interface LiquidationCluster {
  price: number;
  usd: number;
  /** Which side lost most of that money at this price. */
  side: 'long' | 'short';
}

/**
 * Price zones where most money was liquidated: liquidations are grouped in
 * bands `bandPct` percent wide and the `top` largest are returned, largest
 * first. These are liquidations that already happened, not a forecast.
 */
export function liquidationClusters(list: Liquidation[], bandPct: number, top: number): LiquidationCluster[] {
  if (list.length === 0) return [];
  const reference = list[0].price;
  const width = (reference * bandPct) / 100;
  const bands = new Map<number, { long: number; short: number }>();
  for (const l of list) {
    const key = Math.floor(l.price / width);
    const band = bands.get(key) ?? { long: 0, short: 0 };
    band[l.side] += l.usd;
    bands.set(key, band);
  }
  return [...bands.entries()]
    .map(([key, b]) => ({ price: (key + 0.5) * width, usd: b.long + b.short, side: b.long >= b.short ? ('long' as const) : ('short' as const) }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, top);
}
