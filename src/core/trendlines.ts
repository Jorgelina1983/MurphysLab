import { swingPoints, type Pivot } from './levels';
import type { Candle, IndicatorOutputs, Series } from './types';

/**
 * Trendlines, channel lines and their breaks. Murphy (1999), pp. 65-85: an up
 * trendline joins successively higher reaction lows, a down trendline joins
 * successively lower rally highs; two points draw it, a third confirms it, and
 * a close beyond it counts for more than a penetration inside the candle. The
 * channel line is its parallel on the other side of the price.
 *
 * Everything is computed candle by candle with what was known then: a swing
 * point exists only once it is confirmed, and a line is valid only while no
 * close has gone beyond it.
 */
export interface Trendline {
  /** The two swing points that define the line. */
  from: number;
  to: number;
  /** Price change per candle. */
  slope: number;
  /** Line value at candle `from`. */
  base: number;
  /** Swing points lying on the line, the two anchors included. */
  touches: number;
  /** Distance from the line to its channel line: the farthest price on the other side between the anchors. */
  channel: number;
}

/** A swing point this close to the line, as a share of its price, counts as touching it. */
export const TOUCH_PCT = 0.0015;
const at = (l: Trendline, i: number) => l.base + l.slope * (i - l.from);

/**
 * The best line of one side on candle `i`: through two confirmed swing lows
 * (up) or highs (down) formed in the last `lookback` candles, never crossed by
 * a close since its first anchor. The line with most touches wins; between
 * equals, the one whose second anchor is most recent.
 */
function bestLine(candles: Candle[], pivots: Pivot[], i: number, side: 'up' | 'down', lookback: number): Trendline | null {
  const dir = side === 'up' ? 1 : -1;
  const pts = pivots.filter((p) => p.kind === (side === 'up' ? 'low' : 'high') && p.confirmedAt <= i && p.index >= i - lookback);
  let best: Trendline | null = null;
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      const [p, q] = [pts[a], pts[b]];
      if (dir * (q.price - p.price) <= 0) continue; // higher lows for an up line, lower highs for a down line
      const line: Trendline = { from: p.index, to: q.index, slope: (q.price - p.price) / (q.index - p.index), base: p.price, touches: 0, channel: 0 };
      let valid = true;
      for (let k = p.index; k <= i && valid; k++) if (dir * (candles[k].close - at(line, k)) < 0) valid = false;
      if (!valid) continue;
      line.touches = pts.filter((x) => x.index >= p.index && Math.abs(x.price - at(line, x.index)) <= x.price * TOUCH_PCT).length;
      for (let k = p.index; k <= q.index; k++) line.channel = Math.max(line.channel, dir * ((side === 'up' ? candles[k].high : candles[k].low) - at(line, k)));
      if (!best || line.touches > best.touches || (line.touches === best.touches && line.to > best.to)) best = line;
    }
  }
  return best;
}

/**
 * For each candle: the value of the up and down trendline in force, where its
 * first anchor is and its slope (so the whole line can be redrawn), its
 * touches, the distance to its channel line, and `upBreak` / `downBreak`: on
 * the candle whose close goes through the line that was in force on the
 * candle before, the number of touches that line had; 0 otherwise.
 */
export function trendlines(candles: Candle[], strength: number, lookback: number): IndicatorOutputs {
  const n = candles.length;
  const blank = (): Series => new Array(n).fill(null);
  const zero = (): Series => new Array(n).fill(0);
  const out: Record<string, Series> = { up: blank(), upFrom: blank(), upSlope: blank(), upTouches: blank(), upChannel: blank(), upBreak: zero(), down: blank(), downFrom: blank(), downSlope: blank(), downTouches: blank(), downChannel: blank(), downBreak: zero() };
  const pivots = swingPoints(candles, strength);
  const newPivotAt = new Set(pivots.map((p) => p.confirmedAt));
  for (const side of ['up', 'down'] as const) {
    const dir = side === 'up' ? 1 : -1;
    let line: Trendline | null = null;
    for (let i = 0; i < n; i++) {
      if (line && dir * (candles[i].close - at(line, i)) < 0) {
        out[`${side}Break`][i] = line.touches;
        line = null;
      }
      // A line is looked for again when there is none, or when a new swing point may give a better one.
      if (!line || newPivotAt.has(i)) line = bestLine(candles, pivots, i, side, lookback) ?? line;
      if (line && i - line.from > lookback) line = null; // its first anchor is too old to count as the same move
      if (!line) continue;
      out[side][i] = at(line, i);
      out[`${side}From`][i] = line.from;
      out[`${side}Slope`][i] = line.slope;
      out[`${side}Touches`][i] = line.touches;
      out[`${side}Channel`][i] = line.channel;
    }
  }
  return out;
}
