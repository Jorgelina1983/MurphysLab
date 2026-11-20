import { describe, expect, it } from 'vitest';
import { DEMO_GAP_LIMIT, demoGap, parseLast, addOiSample, fundingPerYear, fundingTone, OI_EVERY, OI_KEEP, oiChange, parseFunding, parseOpenInterest } from '../src/feed/okxContext';

// Shapes copied from OKX's public API (16 Nov 2026), trimmed to the fields read.
const FUNDING = { code: '0', msg: '', data: [{ fundingRate: '0.0000579753496164', fundingTime: '1794873600000', nextFundingTime: '1794902400000', prevFundingTime: '1794844800000', instId: 'BTC-USDT-SWAP' }] };
const OI = { code: '0', msg: '', data: [{ instId: 'BTC-USDT-SWAP', oi: '3122705.12', oiCcy: '31227.0512', oiUsd: '2026841721.41', ts: '1794852522861' }] };

describe('funding rate', () => {
  it('reads the rate, the settlement of the period in course and the period length', () => {
    expect(parseFunding(FUNDING)).toEqual({ rate: 0.0000579753496164, settleTime: 1794873600000, periodHours: 8 });
  });
  it('assumes eight hours when the next settlement is missing, and rejects unusable answers', () => {
    expect(parseFunding({ code: '0', data: [{ fundingRate: '-0.0001', fundingTime: '1794873600000', nextFundingTime: '' }] })).toEqual({ rate: -0.0001, settleTime: 1794873600000, periodHours: 8 });
    expect(parseFunding({ code: '0', data: [{ fundingRate: '', fundingTime: '1794873600000' }] })).toBeNull();
    expect(parseFunding({ code: '0', data: [{ fundingRate: '0.0001' }] })).toBeNull();
    expect(parseFunding({ code: '51001', data: [] })).toBeNull();
    expect(parseFunding(null)).toBeNull();
  });
  it('turns the rate into a yearly figure', () => {
    expect(fundingPerYear({ rate: 0.0001, settleTime: 1, periodHours: 8 })).toBeCloseTo(0.1095);
    expect(fundingPerYear({ rate: 0.0001, settleTime: 1, periodHours: 4 })).toBeCloseTo(0.219);
  });
  it('says who pays and when one side is crowded', () => {
    expect(fundingTone(0.0001)).toBe('longsPay');
    expect(fundingTone(-0.0001)).toBe('shortsPay');
    expect(fundingTone(0.00001)).toBe('flat');
    expect(fundingTone(0.0005)).toBe('longsCrowded');
    expect(fundingTone(-0.0008)).toBe('shortsCrowded');
  });
});

describe('open interest', () => {
  it('reads the value in dollars and its time', () => {
    expect(parseOpenInterest(OI)).toEqual({ time: 1794852522861, usd: 2026841721.41 });
    expect(parseOpenInterest({ code: '0', data: [{ oiUsd: 'x', ts: '1' }] })).toBeNull();
    expect(parseOpenInterest({ code: '0', data: [] })).toBeNull();
  });
  it('keeps at most one sample per interval and drops the ones older than a day', () => {
    const t0 = 1_000_000_000_000;
    let list = addOiSample([], { time: t0, usd: 100 });
    list = addOiSample(list, { time: t0 + 60_000, usd: 101 });
    expect(list).toHaveLength(1);
    list = addOiSample(list, { time: t0 + OI_EVERY, usd: 102 });
    expect(list.map((s) => s.usd)).toEqual([100, 102]);
    list = addOiSample(list, { time: t0 + OI_KEEP + 1, usd: 110 });
    expect(list.map((s) => s.usd)).toEqual([102, 110]);
  });
  it('measures the change against the oldest sample kept, once there is one old enough', () => {
    const t0 = 1_000_000_000_000;
    const samples = [{ time: t0, usd: 200 }, { time: t0 + 3_600_000, usd: 210 }];
    expect(oiChange(samples, { time: t0 + 2 * 3_600_000, usd: 220 })).toEqual({ pct: expect.closeTo(0.1), hours: 2 });
    expect(oiChange(samples, { time: t0 + 60_000, usd: 220 })).toBeNull();
    expect(oiChange([], { time: t0, usd: 220 })).toBeNull();
    // A sample older than a day does not count as the base.
    expect(oiChange(samples, { time: t0 + OI_KEEP + 3_600_000 + 1, usd: 220 })).toBeNull();
  });
});

describe('price of the demo book against the real market', () => {
  it('reads the last price of a ticker and rejects unusable answers', () => {
    expect(parseLast({ code: '0', data: [{ instId: 'BTC-USDT-SWAP', last: '62996.03' }] })).toBe(62996.03);
    expect(parseLast({ code: '0', data: [{ last: '' }] })).toBeNull();
    expect(parseLast({ code: '0', data: [] })).toBeNull();
    expect(parseLast({ code: '51001', data: [{ last: '1' }] })).toBeNull();
    expect(parseLast(null)).toBeNull();
  });
  it('measures the gap on the real price, and has none without both prices', () => {
    // 19 Nov 2026, 20:12 UTC: demo at 62,996.03 with the real market at 62,083.8.
    expect(demoGap(62996.03, 62083.8)).toBeCloseTo(0.01469, 4);
    expect(Math.abs(demoGap(62996.03, 62083.8) as number)).toBeGreaterThan(DEMO_GAP_LIMIT);
    expect(Math.abs(demoGap(64110.6, 64103.2) as number)).toBeLessThan(DEMO_GAP_LIMIT);
    expect(demoGap(null, 62083.8)).toBeNull();
    expect(demoGap(62996.03, undefined)).toBeNull();
    expect(demoGap(62996.03, 0)).toBeNull();
  });
});
