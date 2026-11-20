import { describe, expect, it } from 'vitest';
import { bollinger, ema, rsi, sma } from '../src/core/indicators';

describe('sma', () => {
  it('averages the last n values and is empty during warm-up', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe('ema', () => {
  it('is seeded with the SMA and then smooths', () => {
    // length 3: seed = mean(1,2,3) = 2, k = 0.5 -> 2*0.5 + 4*0.5 = 3, then 3*0.5 + 5*0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe('bollinger', () => {
  it('uses the population standard deviation', () => {
    // mean 5, population variance 4, sd 2 -> bands at 5 +/- 2*2
    const { basis, upper, lower } = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(basis[7]).toBe(5);
    expect(upper[7]).toBeCloseTo(9, 10);
    expect(lower[7]).toBeCloseTo(1, 10);
    expect(upper[6]).toBeNull();
  });
});

describe('rsi', () => {
  it('is 100 when every change is a gain and 0 when every change is a loss', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3)[5]).toBe(100);
    expect(rsi([6, 5, 4, 3, 2, 1], 3)[5]).toBe(0);
  });

  it('is 50 when gains and losses balance', () => {
    // changes +1, -1, +1, -1 over length 4: average gain = average loss
    expect(rsi([10, 11, 10, 11, 10], 4)[4]).toBeCloseTo(50, 10);
  });

  it("applies Wilder's smoothing after the first value", () => {
    // length 2. changes: +2, -1, +3. First: gain 1, loss 0.5 -> RS 2 -> 66.667
    // Next: gain (1*1 + 3)/2 = 2, loss (0.5*1 + 0)/2 = 0.25 -> RS 8 -> 88.889
    const out = rsi([10, 12, 11, 14], 2);
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(66.6667, 3);
    expect(out[3]).toBeCloseTo(88.8889, 3);
  });
});
