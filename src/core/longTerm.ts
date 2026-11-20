import { sma } from './indicators';
import type { Candle } from './types';

/**
 * The long-term picture, read on daily candles. Murphy (1999), pp. 181-188:
 * start from the long-range chart and work down to the short one, because the
 * larger trend frames everything below it.
 *
 * The reading used here is a convention of this tool, not Murphy's rule: the
 * close against its 50-day average, and that average against the 200-day one.
 */
export interface LongTerm {
  /** `up`: close above the 50, which is above the 200. `down`: the mirror. `mixed`: anything else. `unknown`: too few days. */
  trend: 'up' | 'down' | 'mixed' | 'unknown';
  close: number;
  sma50: number | null;
  sma200: number | null;
  /** Change of the close over the days loaded (up to a year), as a fraction. */
  change: number;
  days: number;
}

export const LONG_FAST = 50;
export const LONG_SLOW = 200;

export function longTerm(daily: Candle[]): LongTerm | null {
  const closed = daily.filter((c) => c.closed);
  if (closed.length === 0) return null;
  const closes = closed.map((c) => c.close);
  const last = closes.length - 1;
  const [fast, slow] = [sma(closes, LONG_FAST)[last], sma(closes, LONG_SLOW)[last]];
  const close = closes[last];
  const from = closes[Math.max(0, last - 365)];
  const trend = fast === null || slow === null ? 'unknown' : close > fast && fast > slow ? 'up' : close < fast && fast < slow ? 'down' : 'mixed';
  return { trend, close, sma50: fast, sma200: slow, change: close / from - 1, days: Math.min(last, 365) };
}
