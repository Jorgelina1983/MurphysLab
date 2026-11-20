import { describe, expect, it } from 'vitest';
import { tradeCheck } from '../src/core/tradeCheck';

const base = { capital: 5000, leverage: 3, feeEntry: 0.0005, feeExit: 0.0005 };

describe('trade check', () => {
  it('shows the 1-minute short loses money even at its target (spec example)', () => {
    const r = tradeCheck({ ...base, entry: 64950, stop: 65010, target: 64890, size: 0.05 });
    expect(r.side).toBe('short');
    expect(r.grossGain).toBeCloseTo(3, 10);
    expect(r.feesOnWin).toBeCloseTo(3.246, 3);
    expect(r.netGain).toBeCloseTo(-0.246, 3);
    expect(r.netLoss).toBeCloseTo(6.249, 3);
    expect(r.breakEvenWinRate).toBeNull();
    expect(r.feeShare).toBeGreaterThan(1);
    expect(r.verdict).toBe('feesDominate');
  });

  it('rates the daily short below the 3 to 1 guideline (spec example)', () => {
    const r = tradeCheck({ ...base, entry: 67900, stop: 70300, target: 62200, size: 0.02 });
    expect(r.grossGain).toBeCloseTo(114, 10);
    expect(r.grossLoss).toBeCloseTo(48, 10);
    expect(r.netGain).toBeCloseTo(112.699, 3);
    expect(r.netLoss).toBeCloseTo(49.382, 3);
    expect(r.rewardRisk).toBeCloseTo(2.282, 3);
    expect(r.breakEvenWinRate).toBeCloseTo(0.3047, 4);
    expect(r.riskOnCapital).toBeCloseTo(0.00988, 5);
    expect(r.marginOnCapital).toBeCloseTo(0.0905, 4);
    expect(r.verdict).toBe('below');
  });

  it('meets the guideline at 3 to 1 or better within the limits', () => {
    const r = tradeCheck({ ...base, entry: 67900, stop: 70300, target: 59600, size: 0.02 });
    expect(r.rewardRisk).toBeGreaterThan(3);
    expect(r.verdict).toBe('meets');
  });

  it('flags a position that breaks the risk or margin limit', () => {
    expect(tradeCheck({ ...base, entry: 67900, stop: 70300, target: 59600, size: 0.2 }).verdict).toBe('breaksLimit'); // margin 90%
    expect(tradeCheck({ ...base, leverage: 100, entry: 67900, stop: 70300, target: 59600, size: 0.11 }).verdict).toBe('breaksLimit'); // risk > 5%
  });

  it('rejects levels that do not bracket the entry', () => {
    expect(tradeCheck({ ...base, entry: 100, stop: 105, target: 110, size: 1 }).verdict).toBe('invalid');
  });
});

import { suggestSize } from '../src/core/tradeCheck';

describe('suggested size', () => {
  const base = { capital: 5000, riskPct: 1, leverage: 3, sizeStep: 0.01 };
  it('sizes by the money at risk when the stop is far', () => {
    // 50 USDT of risk over a 2,500 distance is 0.02 BTC; margin 0.02 * 50,000 / 3 = 333, under the 750 cap.
    expect(suggestSize({ ...base, entry: 50_000, stop: 47_500 })).toEqual({ size: 0.02, byRisk: 0.02, capped: false });
  });
  it('is capped by margin when the stop is tight', () => {
    // Risk alone: 50 / 250 = 0.2 BTC. Margin cap: 15% of 5,000 * 3 / 50,000 = 0.045, rounded down to 0.04.
    expect(suggestSize({ ...base, entry: 50_000, stop: 50_250 })).toEqual({ size: 0.04, byRisk: 0.2, capped: true });
  });
  it('gives zero when one step already risks too much, or the levels are not usable', () => {
    expect(suggestSize({ ...base, entry: 50_000, stop: 40_000 }).size).toBe(0);
    expect(suggestSize({ ...base, entry: 50_000, stop: 50_000 }).size).toBe(0);
  });
});
