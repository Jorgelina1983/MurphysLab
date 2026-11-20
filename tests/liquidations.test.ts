import { describe, expect, it } from 'vitest';
import { liquidationClusters, liquidationsPerCandle, type Liquidation } from '../src/core/liquidations';
import { parseLiquidations } from '../src/feed/okx';
import { candles } from './helpers';

const MIN = 60_000;
// Four one-minute candles; `candles()` starts them at a time that is a whole number of minutes.
const cs = candles([[100, 101, 99, 100], [100, 102, 99, 101], [101, 103, 100, 102], [102, 104, 101, 103]]);
const t0 = cs[0].time;
const list: Liquidation[] = [
  { time: t0 + MIN + 5_000, price: 100.2, usd: 1000, side: 'long' },
  { time: t0 + MIN + 40_000, price: 100.3, usd: 500, side: 'long' },
  { time: t0 + 2 * MIN + 1_000, price: 102.9, usd: 700, side: 'short' },
  { time: t0 + 9 * MIN, price: 110, usd: 9999, side: 'short' }, // after the last candle
];

describe('liquidations', () => {
  it('adds them up per candle, longs downward and shorts upward, and leaves unknown history empty', () => {
    expect(cs[0].time % MIN).toBe(0);
    const { longs, shorts } = liquidationsPerCandle(cs, MIN, list);
    expect(longs).toEqual([null, -1500, 0, 0]);
    expect(shorts).toEqual([null, 0, 700, 0]);
  });

  it('finds the price bands where most money was liquidated', () => {
    const clusters = liquidationClusters(list.slice(0, 3), 1, 2);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ usd: 1500, side: 'long' });
    expect(clusters[0].price).toBeGreaterThan(100);
    expect(clusters[0].price).toBeLessThan(101.1);
    expect(clusters[1]).toMatchObject({ usd: 700, side: 'short' });
    expect(liquidationClusters([], 1, 3)).toEqual([]);
  });

  it('reads the exchange answer: contracts become USDT and the liquidated side is kept', () => {
    const body = { code: '0', data: [{ details: [{ bkPx: '64644.7', posSide: 'long', side: 'sell', sz: '13.81', ts: '1794789840136' }, { bkPx: '65000', posSide: 'short', side: 'buy', sz: '2', ts: '1794789850000' }, { bkPx: 'x', posSide: 'long', sz: '1', ts: '1' }] }] };
    const parsed = parseLiquidations(body, 0.01);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ time: 1794789840136, price: 64644.7, usd: 13.81 * 0.01 * 64644.7, side: 'long' });
    expect(parsed[1]).toMatchObject({ side: 'short', usd: 1300 });
    expect(parseLiquidations({ code: '0', data: [] }, 0.01)).toEqual([]);
  });
});
