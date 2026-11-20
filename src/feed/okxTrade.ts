import type { Side } from '../core/types';
import type { MarketSymbol } from './okx';

/**
 * Sending orders to OKX **demo trading**, and nothing else.
 *
 * Every request made here carries the header `x-simulated-trading: 1`. It is a
 * constant, not a setting: there is no way to call this module against the live
 * exchange. OKX rejects a live API key sent with that header (error 50101), so
 * a key that passes `connectDemo` can only reach simulated funds.
 *
 * The page signs requests itself, so the API secret lives in the browser. That
 * is acceptable for a demo key on the user's own machine and is one more
 * reason this must never be pointed at a live account.
 */
const REST = 'https://www.okx.com';
const DEMO_HEADER = { 'x-simulated-trading': '1' } as const;
const WRONG_ENVIRONMENT = '50101';

export interface OkxCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export type MarginMode = 'cross' | 'isolated';
/** `net_mode`: one position per market. `long_short_mode`: longs and shorts kept apart, and orders must say which. */
export type PositionMode = 'net_mode' | 'long_short_mode';

export class OkxError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
  /** The key belongs to the live account: refused, by design. */
  get liveKey() {
    return this.code === WRONG_ENVIRONMENT;
  }
}

/** OKX's signature: Base64 of HMAC-SHA256 over timestamp + METHOD + path + body, keyed with the API secret. */
export async function sign(secret: string, timestamp: string, method: string, path: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(timestamp + method.toUpperCase() + path + body)));
  let binary = '';
  for (const byte of mac) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** OKX refuses requests whose timestamp is more than 30 seconds off its clock, so its clock is used, not the computer's. */
let clockOffset = 0;
export async function syncClock(): Promise<void> {
  try {
    const body = (await (await fetch(`${REST}/api/v5/public/time`)).json()) as { data?: { ts?: string }[] };
    const server = Number(body.data?.[0]?.ts);
    if (Number.isFinite(server)) clockOffset = server - Date.now();
  } catch {
    clockOffset = 0;
  }
}

async function request<T>(creds: OkxCredentials, method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T[]> {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const timestamp = new Date(Date.now() + clockOffset).toISOString();
  const res = await fetch(REST + path, {
    method,
    headers: {
      ...DEMO_HEADER,
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': creds.apiKey,
      'OK-ACCESS-SIGN': await sign(creds.secret, timestamp, method, path, body),
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': creds.passphrase,
    },
    body: body || undefined,
  });
  const answer = (await res.json().catch(() => null)) as { code?: string; msg?: string; data?: (T & { sCode?: string; sMsg?: string })[] } | null;
  if (!answer) throw new OkxError(String(res.status), `OKX HTTP ${res.status}`);
  if (answer.code !== '0') {
    // A rejected order carries the real reason inside the row, not at the top.
    const row = answer.data?.find((d) => d.sCode && d.sCode !== '0');
    throw new OkxError(row?.sCode ?? answer.code ?? String(res.status), row?.sMsg || answer.msg || `OKX HTTP ${res.status}`);
  }
  return answer.data ?? [];
}

export interface DemoAccount {
  positionMode: PositionMode;
}

/**
 * Check the key against the demo environment and read how the account is set up.
 * Throws an `OkxError` with `liveKey` true when the key is from the live account.
 */
export async function connectDemo(creds: OkxCredentials): Promise<DemoAccount> {
  await syncClock();
  const [config] = await request<{ posMode?: string }>(creds, 'GET', '/api/v5/account/config');
  return { positionMode: config?.posMode === 'long_short_mode' ? 'long_short_mode' : 'net_mode' };
}

/** The leverage set in OKX for this market, which the tool cannot change. `null` when it cannot be read. */
export async function fetchLeverage(creds: OkxCredentials, symbol: MarketSymbol, marginMode: MarginMode): Promise<number | null> {
  try {
    const rows = await request<{ lever?: string }>(creds, 'GET', `/api/v5/account/leverage-info?instId=${symbol.instId}&mgnMode=${marginMode}`);
    const lever = Number(rows[0]?.lever);
    return Number.isFinite(lever) && lever > 0 ? lever : null;
  } catch {
    return null;
  }
}

export interface OrderInput {
  symbol: MarketSymbol;
  side: Side;
  /** Entry price; used only for limit orders. */
  entry: number;
  stop: number;
  target: number;
  /** Size in the base asset (BTC, ETH). OKX wants whole contracts. */
  size: number;
  type: 'market' | 'limit';
  marginMode: MarginMode;
  positionMode: PositionMode;
}

export interface OrderBody {
  instId: string;
  tdMode: MarginMode;
  side: 'buy' | 'sell';
  posSide?: Side;
  ordType: 'market' | 'limit';
  sz: string;
  px?: string;
  attachAlgoOrds: [{ tpTriggerPx: string; tpOrdPx: '-1'; slTriggerPx: string; slOrdPx: '-1' }];
}

/** Whole contracts for a size in the base asset; zero when it is less than one contract. */
export const toContracts = (size: number, symbol: MarketSymbol) => Math.floor(size / symbol.contractSize + 1e-9);

/**
 * The order as OKX expects it: an entry with its take-profit and stop-loss
 * attached, both executed at market (`-1`) when their trigger price is reached.
 * Throws when the levels do not describe a valid trade, so a nonsense order is
 * never sent.
 */
export function buildOrder(o: OrderInput): OrderBody {
  const contracts = toContracts(o.size, o.symbol);
  if (contracts < 1) throw new Error('size');
  const long = o.side === 'long';
  if (!(o.entry > 0) || (long ? !(o.stop < o.entry && o.entry < o.target) : !(o.target < o.entry && o.entry < o.stop))) throw new Error('levels');
  const px = (v: number) => v.toFixed(o.symbol.decimals);
  return {
    instId: o.symbol.instId,
    tdMode: o.marginMode,
    side: long ? 'buy' : 'sell',
    ...(o.positionMode === 'long_short_mode' ? { posSide: o.side } : {}),
    ordType: o.type,
    sz: String(contracts),
    ...(o.type === 'limit' ? { px: px(o.entry) } : {}),
    attachAlgoOrds: [{ tpTriggerPx: px(o.target), tpOrdPx: '-1', slTriggerPx: px(o.stop), slOrdPx: '-1' }],
  };
}

/** Send the order to OKX demo trading. Resolves with the order id, or throws an `OkxError` with OKX's reason. */
export async function placeDemoOrder(creds: OkxCredentials, body: OrderBody): Promise<string> {
  const [row] = await request<{ ordId?: string }>(creds, 'POST', '/api/v5/trade/order', body);
  if (!row?.ordId) throw new OkxError('empty', 'OKX no devolvió un número de orden');
  return row.ordId;
}

// ---- Reading back what happened to an order. Read-only, and demo only like everything above. ----
//
// OKX answers browsers on some private endpoints and not on others. "Get positions history" is one it does not
// answer from a web page (the request fails before any reply), so a closed position is worked out from the
// account's filled orders instead: the entry order, and the orders on the other side that closed it.

/** How an order stands on OKX. Field names as in OKX's "Get order details". */
export interface OrderStatus {
  state: 'live' | 'partially_filled' | 'filled' | 'canceled' | 'mmp_canceled';
  /** Average fill price; `null` while nothing is filled. */
  fillPrice: number | null;
  fillTime: number | null;
  /** Contracts filled so far, and the fee charged for them (negative: paid). */
  contracts: number;
  fee: number;
}

/** An order that traded, from the account's order history. */
export interface FilledOrder {
  ordId: string;
  side: 'buy' | 'sell';
  contracts: number;
  price: number;
  time: number;
  /** Profit or loss booked by this order, before fees: 0 on an order that opens. */
  pnl: number;
  /** Negative: paid. */
  fee: number;
  /** Placed by OKX to liquidate or reduce the position, not by the account. */
  forced: boolean;
}

/** A position that is already closed, as far as one order's share of it goes. */
export interface ClosedPosition {
  side: Side;
  openTime: number;
  closeTime: number;
  openPrice: number;
  closePrice: number;
  /** Result in USDT after the fees of the entry and of the closing orders. Funding is not included. */
  realizedPnl: number;
  /** Closed by liquidation or ADL instead of by an order of the account. */
  forced: boolean;
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? NaN : Number(v));
const or0 = (v: unknown) => (Number.isFinite(num(v)) ? num(v) : 0);
const STATES: OrderStatus['state'][] = ['live', 'partially_filled', 'filled', 'canceled', 'mmp_canceled'];

export function parseOrderStatus(row: Record<string, string> | undefined): OrderStatus | null {
  if (!row || !STATES.includes(row.state as OrderStatus['state'])) return null;
  const [price, time] = [num(row.avgPx), num(row.fillTime)];
  return { state: row.state as OrderStatus['state'], fillPrice: price > 0 ? price : null, fillTime: time > 0 ? time : null, contracts: or0(row.accFillSz), fee: or0(row.fee) };
}

/** Orders that traded at least in part, oldest first. Rows that cannot be read are dropped. */
export function parseFilledOrders(rows: Record<string, string>[]): FilledOrder[] {
  return rows
    .flatMap((r) => {
      const o = { contracts: num(r.accFillSz), price: num(r.avgPx), time: num(r.fillTime) };
      if (!r.ordId || (r.side !== 'buy' && r.side !== 'sell') || !(o.contracts > 0) || !(o.price > 0) || !(o.time > 0)) return [];
      return [{ ordId: r.ordId, side: r.side as 'buy' | 'sell', ...o, pnl: or0(r.pnl), fee: or0(r.fee), forced: /liquidation|adl/.test(r.category ?? '') }];
    })
    .sort((a, b) => a.time - b.time);
}

/**
 * The close of the position an order opened, from the orders filled after it: orders on the other side are
 * added up until they cover the entry's size. `null` while they do not (the position is still open), and also
 * when another order on the entry's own side filled in between: the two then share one position and OKX does
 * not say which close belongs to which.
 */
export function closingOf(entry: { ordId: string; side: Side; price: number; time: number; contracts: number; fee: number }, orders: FilledOrder[]): ClosedPosition | null {
  const own = entry.side === 'long' ? 'buy' : 'sell';
  let closed = 0;
  let value = 0;
  let pnl = 0;
  let fees = entry.fee;
  let forced = false;
  for (const o of orders) {
    if (o.ordId === entry.ordId || o.time < entry.time) continue;
    if (o.side === own) return null;
    closed += o.contracts;
    value += o.contracts * o.price;
    pnl += o.pnl;
    fees += o.fee;
    forced = forced || o.forced;
    if (closed >= entry.contracts - 1e-9) return { side: entry.side, openTime: entry.time, closeTime: o.time, openPrice: entry.price, closePrice: value / closed, realizedPnl: pnl + fees, forced };
  }
  return null;
}

/** One retry when the request never got an answer: OKX now and then drops a browser request. An answer with an error is not retried. */
async function twice<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof OkxError) throw e;
    await new Promise((r) => setTimeout(r, 700));
    return run();
  }
}

export async function fetchOrderStatus(creds: OkxCredentials, instId: string, ordId: string): Promise<OrderStatus | null> {
  const rows = await twice(() => request<Record<string, string>>(creds, 'GET', `/api/v5/trade/order?instId=${instId}&ordId=${encodeURIComponent(ordId)}`));
  return parseOrderStatus(rows[0]);
}

/** The latest completed orders of a market that traded (up to 100, OKX's page size; the archive goes back three months). */
export async function fetchFilledOrders(creds: OkxCredentials, instId: string): Promise<FilledOrder[]> {
  return parseFilledOrders(await twice(() => request<Record<string, string>>(creds, 'GET', `/api/v5/trade/orders-history-archive?instType=SWAP&instId=${instId}&limit=100`)));
}
