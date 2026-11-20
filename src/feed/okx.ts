import type { Liquidation } from '../core/liquidations';
import type { Candle } from '../core/types';

/** OKX public market data for USDT perpetuals. No account or key is needed. */
export interface MarketSymbol {
  /** Short id used in the page address, e.g. `?symbol=ETH`. */
  id: string;
  /** OKX instrument id. */
  instId: string;
  label: string;
  /** Decimals shown and used when rounding price levels. */
  decimals: number;
  /** Default position size and input step for the trade check, in the base asset. */
  defaultSize: number;
  /** Smallest size step OKX accepts: one contract (0.01 BTC, 0.1 ETH). */
  sizeStep: number;
  /** Base asset per contract; OKX reports volume and liquidations in contracts. */
  contractSize: number;
}

/** To add a market, add a line here. It then works at `?symbol=<id>`. */
export const SYMBOLS: MarketSymbol[] = [
  { id: 'BTC', instId: 'BTC-USDT-SWAP', label: 'BTC-USDT', decimals: 1, defaultSize: 0.02, sizeStep: 0.01, contractSize: 0.01 },
  { id: 'ETH', instId: 'ETH-USDT-SWAP', label: 'ETH-USDT', decimals: 2, defaultSize: 0.8, sizeStep: 0.1, contractSize: 0.1 },
];
const REST = 'https://www.okx.com';
const WS = 'wss://ws.okx.com/ws/v5/business';
const PAGE = 300;

export interface Timeframe {
  id: string;
  /** Bar name in OKX's REST API. */
  bar: string;
  /** Candle channel name on the WebSocket. */
  channel: string;
  ms: number;
}

export const TIMEFRAMES: Timeframe[] = [
  { id: '1m', bar: '1m', channel: 'candle1m', ms: 60_000 },
  { id: '5m', bar: '5m', channel: 'candle5m', ms: 300_000 },
  { id: '15m', bar: '15m', channel: 'candle15m', ms: 900_000 },
  { id: '1h', bar: '1H', channel: 'candle1H', ms: 3_600_000 },
  { id: '4h', bar: '4H', channel: 'candle4H', ms: 14_400_000 },
  { id: '1d', bar: '1Dutc', channel: 'candle1Dutc', ms: 86_400_000 },
];

/**
 * The higher timeframe that defines the trend for each chart timeframe.
 * The weekly timeframe exists only for this purpose.
 */
const WEEK: Timeframe = { id: '1w', bar: '1Wutc', channel: 'candle1Wutc', ms: 604_800_000 };
const byId = (id: string) => TIMEFRAMES.find((x) => x.id === id) ?? WEEK;
export const TREND_TIMEFRAME: Record<string, Timeframe> = {
  '1m': byId('15m'),
  '5m': byId('1h'),
  '15m': byId('4h'),
  '1h': byId('1d'),
  '4h': byId('1d'),
  '1d': WEEK,
};

/** OKX rows are [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]; confirm is "1" once closed. */
export function parseRow(row: string[]): Candle {
  return {
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[6] ?? row[5]),
    closed: row[8] === '1',
  };
}

async function getRows(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<string[][]> {
  const res = await fetch(`${REST}${path}?${new URLSearchParams(params)}`, { signal });
  if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
  const body = (await res.json()) as { code: string; msg: string; data: string[][] };
  if (body.code !== '0') throw new Error(`OKX ${body.code}: ${body.msg}`);
  return body.data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch the most recent `count` candles, oldest first. The first page comes
 * from the recent-candles endpoint (it includes the forming candle); older
 * pages come from the history endpoint, paged backwards with `after`.
 * `onProgress` receives the number of candles loaded so far, after each page.
 */
export async function fetchCandles(symbol: MarketSymbol, tf: Timeframe, count: number, signal?: AbortSignal, onProgress?: (loaded: number) => void): Promise<Candle[]> {
  const byTime = new Map<number, Candle>();
  let rows = await getRows('/api/v5/market/candles', { instId: symbol.instId, bar: tf.bar, limit: String(PAGE) }, signal);
  while (rows.length > 0) {
    for (const r of rows) byTime.set(Number(r[0]), parseRow(r));
    onProgress?.(Math.min(byTime.size, count));
    if (byTime.size >= count) break;
    const oldest = Math.min(...rows.map((r) => Number(r[0])));
    await sleep(120); // stay well inside OKX's public rate limit
    rows = await getRows('/api/v5/market/history-candles', { instId: symbol.instId, bar: tf.bar, limit: String(PAGE), after: String(oldest) }, signal);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-count);
}

/** Liquidations in OKX's answer, with sizes turned from contracts into USDT. Rows that cannot be read are dropped. */
export function parseLiquidations(body: unknown, contractSize: number): Liquidation[] {
  const groups = (body as { data?: { details?: { bkPx?: string; posSide?: string; sz?: string; ts?: string }[] }[] } | null)?.data ?? [];
  const out: Liquidation[] = [];
  for (const d of groups.flatMap((g) => g.details ?? [])) {
    const [price, size, time] = [Number(d.bkPx), Number(d.sz), Number(d.ts)];
    if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(time) || (d.posSide !== 'long' && d.posSide !== 'short')) continue;
    out.push({ time, price, usd: size * contractSize * price, side: d.posSide });
  }
  return out;
}

/**
 * Liquidation orders already executed on OKX for this market, newest first,
 * paged backwards until `since` or `maxPages`. OKX keeps only recent days, and
 * a page holds 100 orders, so on a busy day this covers hours, not weeks.
 * `onPage` receives everything loaded so far after each page.
 */
export async function fetchLiquidations(symbol: MarketSymbol, since: number, maxPages: number, signal?: AbortSignal, onPage?: (all: Liquidation[]) => void): Promise<Liquidation[]> {
  const all: Liquidation[] = [];
  let after = '';
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { instType: 'SWAP', uly: symbol.instId.replace('-SWAP', ''), state: 'filled', limit: '100' };
    if (after) params.after = after;
    const res = await fetch(`${REST}/api/v5/public/liquidation-orders?${new URLSearchParams(params)}`, { signal });
    if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
    const rows = parseLiquidations(await res.json(), symbol.contractSize);
    if (rows.length === 0) break;
    all.push(...rows);
    onPage?.([...all]);
    const oldest = Math.min(...rows.map((r) => r.time));
    if (oldest <= since) break;
    after = String(oldest);
    await sleep(150);
  }
  return all;
}

export type FeedStatus = 'connecting' | 'live' | 'reconnecting';

/**
 * Subscribe to live candles. Reconnects with a growing delay; `onStatus('live')`
 * after a reconnect is the cue to refetch history and fill any gap.
 * Returns a function that closes the connection.
 */
export function subscribeCandles(symbol: MarketSymbol, tf: Timeframe, onCandle: (c: Candle) => void, onStatus: (s: FeedStatus, reconnected: boolean) => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let ping: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (stopped) return;
    onStatus(attempts === 0 ? 'connecting' : 'reconnecting', false);
    const socket = new WebSocket(WS);
    ws = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ op: 'subscribe', args: [{ channel: tf.channel, instId: symbol.instId }] }));
      ping = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('ping'), 20_000);
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data === 'pong') return;
      let msg: { event?: string; arg?: { channel: string; instId?: string }; data?: string[][] };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.event === 'subscribe') {
        onStatus('live', attempts > 0);
        attempts = 0;
      }
      if (msg.arg?.channel === tf.channel && msg.arg.instId === symbol.instId && msg.data) for (const row of msg.data) onCandle(parseRow(row));
    };
    socket.onclose = () => {
      clearInterval(ping);
      if (stopped) return;
      attempts++;
      onStatus('reconnecting', false);
      retry = setTimeout(connect, Math.min(1000 * 2 ** (attempts - 1), 30_000));
    };
    socket.onerror = () => socket.close();
  };
  connect();

  return () => {
    stopped = true;
    clearInterval(ping);
    clearTimeout(retry);
    ws?.close();
  };
}

/** Insert or replace one candle in an ascending list, returning a new list. */
export function mergeCandle(list: Candle[], c: Candle): Candle[] {
  const last = list[list.length - 1];
  if (!last || c.time > last.time) return [...list, c];
  if (c.time === last.time) return [...list.slice(0, -1), c];
  const i = list.findIndex((x) => x.time === c.time);
  if (i === -1) return list;
  const copy = list.slice();
  copy[i] = c;
  return copy;
}
