import type { Candle } from '../src/core/types';

/** Build closed candles from [open, high, low, close] rows, one minute apart. */
export function candles(rows: number[][], step = 60_000, start = 0): Candle[] {
  return rows.map(([open, high, low, close], i) => ({ time: start + i * step, open, high, low, close, volume: 0, closed: true }));
}

/** Flat candles at one price: handy as filler. */
export function flat(price: number, n: number): number[][] {
  return Array.from({ length: n }, () => [price, price, price, price]);
}
