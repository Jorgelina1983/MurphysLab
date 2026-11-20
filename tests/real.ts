import fixture from './fixtures/okx-btc-usdt-swap-15m.json';
import type { Candle } from '../src/core/types';

/**
 * 999 closed 15-minute candles of BTC-USDT-SWAP recorded from OKX's public API (5 to 16 Nov 2026), with
 * their real volume. Long enough for swing points, divergences and a 200-candle average.
 */
export const real15: Candle[] = (fixture.d as number[][]).map(([open, high, low, close, volume], i) => ({
  time: fixture.first + i * fixture.step,
  open: open / 10,
  high: high / 10,
  low: low / 10,
  close: close / 10,
  volume,
  closed: true,
}));
