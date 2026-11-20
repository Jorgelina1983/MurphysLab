import { describe, expect, it } from 'vitest';
import { computeMetrics, type Trade } from '../src/core/backtest';
import { equityCurve, histogram } from '../src/core/stats';

/** Trades that only carry what the statistics read: the net result and the closing time. */
const trades = (rs: number[]): Trade[] => rs.map((netR, i) => ({ netR, exitTime: (i + 1) * 1000 }) as Trade);

describe('equity curve', () => {
  it('adds the results up and measures the fall from the highest point', () => {
    const s = equityCurve(trades([1, 2, -1, -1, -1, 4, -1]));
    expect(s.points.map((p) => p.cumR)).toEqual([1, 3, 2, 1, 0, 4, 3]);
    expect(s.points.map((p) => p.drawdown)).toEqual([0, 0, 1, 2, 3, 0, 1]);
    expect(s.finalR).toBe(3);
    expect(s.peakR).toBe(4);
    expect(s.maxDrawdownR).toBe(3);
    expect(s.worst).toEqual({ from: 1, to: 4, recoveredAt: 5 });
    expect(s.longestLosingStreak).toBe(3);
    expect(s.longestWinningStreak).toBe(2);
    expect(s.underwaterShare).toBeCloseTo(4 / 7);
  });
  it('agrees with the drawdown and the total of the backtest metrics', () => {
    const list = trades([0.5, -1, -1, 2, -1, 1.5, -1, -1, -1, 3]);
    const s = equityCurve(list);
    const m = computeMetrics(list);
    expect(s.maxDrawdownR).toBeCloseTo(m.maxDrawdownR);
    expect(s.finalR).toBeCloseTo(m.totalNetR);
  });
  it('marks a fall that starts at the first trade and is never recovered', () => {
    const s = equityCurve(trades([-1, -1, 0.5]));
    expect(s.worst).toEqual({ from: -1, to: 1, recoveredAt: null });
    expect(s.peakR).toBe(0);
  });
  it('keeps the worst fall unrecovered when only a later, smaller one has ended', () => {
    // Falls 1 and recovers, then falls 3 and stays down.
    const s = equityCurve(trades([2, -1, 1, -3, 1]));
    expect(s.worst).toEqual({ from: 2, to: 3, recoveredAt: null });
  });
  it('counts a trade that ends at zero as a loss, as the win rate does', () => {
    const s = equityCurve(trades([1, 0, -1, 1]));
    expect(s.longestLosingStreak).toBe(2);
    expect(s.longestWinningStreak).toBe(1);
  });
  it('gives the median, the extremes and the total without the best trade', () => {
    const s = equityCurve(trades([-1, -1, -1, 5]));
    expect(s.medianR).toBe(-1);
    expect(s.bestR).toBe(5);
    expect(s.worstR).toBe(-1);
    expect(s.withoutBestR).toBe(-3);
    expect(equityCurve(trades([-1, 1, 3])).medianR).toBe(1);
  });
  it('is empty and flat without trades', () => {
    const s = equityCurve([]);
    expect(s).toMatchObject({ points: [], finalR: 0, peakR: 0, maxDrawdownR: 0, worst: null, longestLosingStreak: 0, medianR: 0, withoutBestR: 0 });
  });
});

describe('histogram', () => {
  it('puts zero with the losses and keeps empty bins inside the range', () => {
    const bins = histogram([-1, -1, 0, 0.2, 1.9], 0.5);
    expect(bins.map((b) => [b.from, b.to, b.count])).toEqual([
      [-1.5, -1, 2],
      [-1, -0.5, 0],
      [-0.5, 0, 1],
      [0, 0.5, 1],
      [0.5, 1, 0],
      [1, 1.5, 0],
      [1.5, 2, 1],
    ]);
    expect(bins.every((b) => b.open === null)).toBe(true);
  });
  it('is not thrown off by rounding at a bin edge', () => {
    const bins = histogram([0.1 + 0.2 + 0.2, 1.0000000001 - 1.0000000001 + 0.5], 0.5);
    expect(bins).toHaveLength(1);
    expect(bins[0]).toMatchObject({ from: 0, to: 0.5, count: 2 });
  });
  it('gathers values beyond the range in the end bins and marks them as open', () => {
    const bins = histogram([-7, -1, 1, 12], 1, { min: -2, max: 3 });
    expect(bins[0]).toMatchObject({ from: -2, to: -1, count: 2, open: 'below' });
    expect(bins[bins.length - 1]).toMatchObject({ from: 2, to: 3, count: 1, open: 'above' });
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(4);
  });
  it('returns nothing without values or with a width that makes no sense', () => {
    expect(histogram([], 0.5)).toEqual([]);
    expect(histogram([1], 0)).toEqual([]);
  });
});
