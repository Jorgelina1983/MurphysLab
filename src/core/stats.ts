import type { Trade } from './backtest';

/**
 * Reading a backtest beyond its averages: the path the result took (equity
 * curve, drawdown, streaks) and how the single results are spread (histogram).
 * Everything is in R, the initial risk of each trade, after fees.
 */
export interface EquityPoint {
  /** Position of the trade in the list, from 0. */
  index: number;
  /** When the trade closed. */
  time: number;
  /** Net result of this trade. */
  netR: number;
  /** Cumulative net result after this trade. */
  cumR: number;
  /** Distance below the highest cumulative result reached so far; 0 at a new high. */
  drawdown: number;
}

export interface EquityStats {
  points: EquityPoint[];
  finalR: number;
  /** Highest cumulative result reached. Never below 0: the curve starts at 0. */
  peakR: number;
  maxDrawdownR: number;
  /**
   * The worst drawdown as a range of trades: it starts after trade `from`
   * (-1 when it starts at the very beginning) and reaches its bottom at trade `to`.
   * `null` when the curve never fell.
   */
  worst: { from: number; to: number; recoveredAt: number | null } | null;
  longestLosingStreak: number;
  longestWinningStreak: number;
  /** Share of trades that closed with the curve below an earlier high. */
  underwaterShare: number;
  medianR: number;
  bestR: number;
  worstR: number;
  /** The total without the single best trade: how much the result leans on one trade. */
  withoutBestR: number;
}

export function equityCurve(trades: Trade[]): EquityStats {
  const points: EquityPoint[] = [];
  let cum = 0;
  let peak = 0;
  let peakIndex = -1;
  let maxDrawdownR = 0;
  let worst: EquityStats['worst'] = null;
  let losing = 0;
  let winning = 0;
  let longestLosingStreak = 0;
  let longestWinningStreak = 0;
  let underwater = 0;

  trades.forEach((tr, index) => {
    cum += tr.netR;
    if (cum >= peak) {
      // A new high (or a return to the old one) ends whatever drawdown was running. It ends the worst one
      // only if that is the one running: `from` still names the high the curve has now regained.
      if (worst && worst.recoveredAt === null && worst.from === peakIndex) worst = { ...worst, recoveredAt: index };
      peak = cum;
      peakIndex = index;
    }
    const drawdown = peak - cum;
    if (drawdown > 0) underwater += 1;
    if (drawdown > maxDrawdownR) {
      maxDrawdownR = drawdown;
      worst = { from: peakIndex, to: index, recoveredAt: null };
    }
    // Same convention as the win rate: a trade that ends at exactly 0 after fees is not a win.
    if (tr.netR > 0) {
      winning += 1;
      losing = 0;
    } else {
      losing += 1;
      winning = 0;
    }
    longestLosingStreak = Math.max(longestLosingStreak, losing);
    longestWinningStreak = Math.max(longestWinningStreak, winning);
    points.push({ index, time: tr.exitTime, netR: tr.netR, cumR: cum, drawdown });
  });

  const sorted = trades.map((t) => t.netR).sort((a, b) => a - b);
  const n = sorted.length;
  const medianR = n === 0 ? 0 : n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const bestR = n ? sorted[n - 1] : 0;
  return {
    points,
    finalR: cum,
    peakR: peak,
    maxDrawdownR,
    worst,
    longestLosingStreak,
    longestWinningStreak,
    underwaterShare: n ? underwater / n : 0,
    medianR,
    bestR,
    worstR: n ? sorted[0] : 0,
    withoutBestR: n ? cum - bestR : 0,
  };
}

export interface Bin {
  /** The bin holds values above `from` and up to `to`, so 0 counts with the losses, as in the win rate. */
  from: number;
  to: number;
  count: number;
  /** The first and last bins also hold everything beyond the range. */
  open: 'below' | 'above' | null;
}

/**
 * Count values in bins of equal width with an edge at 0. Values beyond
 * `min`/`max` are added to the end bins, which are then marked as open.
 * Empty bins inside the range are kept, so the shape reads correctly.
 */
export function histogram(values: number[], width: number, range: { min: number; max: number } = { min: -Infinity, max: Infinity }): Bin[] {
  if (values.length === 0 || !(width > 0)) return [];
  const EPS = 1e-9;
  const slot = (v: number) => Math.ceil(v / width - EPS) - 1; // (k·w, (k+1)·w]
  const lowest = Number.isFinite(range.min) ? Math.round(range.min / width) : -Infinity;
  const highest = Number.isFinite(range.max) ? Math.round(range.max / width) - 1 : Infinity;
  const slots = values.map((v) => Math.min(highest, Math.max(lowest, slot(v))));
  const first = Math.min(...slots);
  const last = Math.max(...slots);
  const bins: Bin[] = [];
  for (let k = first; k <= last; k += 1) bins.push({ from: k * width, to: (k + 1) * width, count: 0, open: null });
  values.forEach((v, i) => {
    const bin = bins[slots[i] - first];
    bin.count += 1;
    if (slot(v) < lowest) bin.open = 'below';
    if (slot(v) > highest) bin.open = 'above';
  });
  return bins;
}
