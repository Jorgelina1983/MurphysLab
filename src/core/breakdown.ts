import type { Trade } from './backtest';
import { atr, sma } from './indicators';
import type { Candle } from './types';

/**
 * The backtest's trades split by the conditions they were taken in, to see
 * where a rule works and where it does not. Every reading uses only what was
 * known on the signal candle.
 */
export interface Bucket {
  id: string;
  trades: number;
  winRate: number;
  avgNetR: number;
  totalNetR: number;
}
export interface Breakdown {
  id: 'side' | 'exit' | 'trend' | 'volatility' | 'session' | 'volume';
  buckets: Bucket[];
}

/** Fewer trades than this in a group say nothing about the group. */
export const MIN_GROUP = 10;
const TREND_LENGTH = 200;
const VOLUME_LENGTH = 20;

function bucket(id: string, trades: Trade[]): Bucket {
  const n = trades.length;
  const total = trades.reduce((sum, t) => sum + t.netR, 0);
  return { id, trades: n, winRate: n ? trades.filter((t) => t.netR > 0).length / n : 0, avgNetR: n ? total / n : 0, totalNetR: total };
}

export function breakdowns(trades: Trade[], candles: Candle[]): Breakdown[] {
  const closes = candles.map((c) => c.close);
  const trend = sma(closes, TREND_LENGTH);
  const range = atr(candles, 14);
  const volumeAvg = sma(candles.map((c) => c.volume), VOLUME_LENGTH);
  // Volatility is ranked against the whole period: the thirds of the candle range as a share of price.
  const rel = (i: number) => (range[i] == null ? null : (range[i] as number) / closes[i]);
  const ranked = candles.map((_, i) => rel(i)).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const [low, high] = [ranked[Math.floor(ranked.length / 3)], ranked[Math.floor((2 * ranked.length) / 3)]];

  const split = (id: Breakdown['id'], ids: string[], of: (t: Trade) => string | null): Breakdown => ({ id, buckets: ids.map((b) => bucket(b, trades.filter((t) => of(t) === b))) });
  return [
    split('side', ['long', 'short'], (t) => t.side),
    split('exit', ['target', 'stop', 'timeout'], (t) => t.exitReason),
    split('trend', ['with', 'against'], (t) => {
      const avg = trend[t.signal.index];
      if (avg == null) return null;
      return (t.side === 'long') === t.signal.reference > avg ? 'with' : 'against';
    }),
    split('volatility', ['low', 'mid', 'high'], (t) => {
      const v = rel(t.signal.index);
      return v === null || low === undefined ? null : v < low ? 'low' : v < high ? 'mid' : 'high';
    }),
    split('session', ['asia', 'europe', 'america'], (t) => {
      const hour = new Date(t.signal.time).getUTCHours();
      return hour < 8 ? 'asia' : hour < 16 ? 'europe' : 'america';
    }),
    split('volume', ['above', 'below'], (t) => {
      // Against the average of the candles before the signal candle, as the volume block does.
      const avg = volumeAvg[t.signal.index - 1];
      return avg == null || avg === 0 ? null : candles[t.signal.index].volume > avg ? 'above' : 'below';
    }),
  ];
}

/** The split with the widest gap between two groups that both have enough trades; `null` when no split has two such groups. */
export function widestGap(list: Breakdown[]): { id: Breakdown['id']; best: Bucket; worst: Bucket } | null {
  let out: { id: Breakdown['id']; best: Bucket; worst: Bucket } | null = null;
  for (const b of list) {
    // How a trade ended is a result, not a condition one could have chosen beforehand.
    if (b.id === 'exit') continue;
    const enough = b.buckets.filter((x) => x.trades >= MIN_GROUP).sort((x, y) => y.avgNetR - x.avgNetR);
    if (enough.length < 2) continue;
    const [best, worst] = [enough[0], enough[enough.length - 1]];
    if (!out || best.avgNetR - worst.avgNetR > out.best.avgNetR - out.worst.avgNetR) out = { id: b.id, best, worst };
  }
  return out;
}
