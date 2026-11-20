import type { FundingEvent } from '../core/funding';
import type { MarketSymbol } from './okx';

/**
 * Market context for a perpetual, from OKX's public API: the funding rate and
 * the open interest. Neither is one of Murphy's indicators and no rule uses
 * them; open interest is the futures reading Murphy pairs with volume (ch. 7).
 */
export interface Funding {
  /** Rate of the period in course, as a fraction: 0.0001 is 0.01%. Positive: buyers pay sellers. */
  rate: number;
  /** When the period in course settles, in milliseconds. */
  settleTime: number;
  /** Length of a funding period in hours (8 on OKX's main perpetuals). */
  periodHours: number;
}

export interface OiSample {
  time: number;
  usd: number;
}

const REST = 'https://www.okx.com';
const first = (body: unknown): Record<string, string> | null => {
  const b = body as { code?: string; data?: Record<string, string>[] } | null;
  return b && b.code === '0' && Array.isArray(b.data) && b.data[0] ? b.data[0] : null;
};

/** `null` when the answer does not have the expected shape. */
export function parseFunding(body: unknown): Funding | null {
  const row = first(body);
  const rate = Number(row?.fundingRate);
  const settleTime = Number(row?.fundingTime);
  if (!row || row.fundingRate === undefined || row.fundingRate === '' || !Number.isFinite(rate) || !(settleTime > 0)) return null;
  // OKX names the settlement of the period in course `fundingTime`, and the one after it `nextFundingTime`.
  const span = (Number(row.nextFundingTime) - settleTime) / 3_600_000;
  return { rate, settleTime, periodHours: span > 0 && span <= 24 ? span : 8 };
}

/** Open interest in US dollars; `null` when the answer does not have the expected shape. */
export function parseOpenInterest(body: unknown): OiSample | null {
  const row = first(body);
  const usd = Number(row?.oiUsd);
  const time = Number(row?.ts);
  return row && row.oiUsd !== undefined && Number.isFinite(usd) && usd > 0 && time > 0 ? { time, usd } : null;
}

/** The rate as a yearly figure, for scale: a small number every few hours adds up. */
export const fundingPerYear = (f: Funding) => f.rate * (24 / f.periodHours) * 365;

/** What a funding rate says about positioning. The thresholds are a convention of this app, not an OKX rule. */
export type FundingTone = 'longsCrowded' | 'longsPay' | 'flat' | 'shortsPay' | 'shortsCrowded';
export const FUNDING_CROWDED = 0.0005;
export const FUNDING_FLAT = 0.00002;
export function fundingTone(rate: number): FundingTone {
  if (rate >= FUNDING_CROWDED) return 'longsCrowded';
  if (rate <= -FUNDING_CROWDED) return 'shortsCrowded';
  if (Math.abs(rate) < FUNDING_FLAT) return 'flat';
  return rate > 0 ? 'longsPay' : 'shortsPay';
}

/**
 * OKX gives the open interest of this moment only, so its change comes from
 * samples this browser keeps: at most one every `OI_EVERY`, for `OI_KEEP`.
 */
export const OI_EVERY = 5 * 60_000;
export const OI_KEEP = 24 * 3_600_000;
export function addOiSample(samples: OiSample[], next: OiSample): OiSample[] {
  const kept = samples.filter((s) => s.time > next.time - OI_KEEP && s.time < next.time);
  const last = kept[kept.length - 1];
  return last && next.time - last.time < OI_EVERY ? kept : [...kept, next];
}

/** Change against the oldest sample kept, and how long ago that was. `null` until there is something to compare with. */
export function oiChange(samples: OiSample[], now: OiSample): { pct: number; hours: number } | null {
  const base = samples.find((s) => s.time > now.time - OI_KEEP && s.time < now.time);
  if (!base || now.time - base.time < OI_EVERY) return null;
  return { pct: now.usd / base.usd - 1, hours: (now.time - base.time) / 3_600_000 };
}

async function get(path: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(`${REST}${path}`, { signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Never throws: context is an extra, and the page must work without it. */
export async function fetchContext(symbol: MarketSymbol, signal?: AbortSignal): Promise<{ funding: Funding | null; oi: OiSample | null }> {
  const [funding, oi] = await Promise.all([
    get(`/api/v5/public/funding-rate?instId=${symbol.instId}`, signal),
    get(`/api/v5/public/open-interest?instType=SWAP&instId=${symbol.instId}`, signal),
  ]);
  return { funding: parseFunding(funding), oi: parseOpenInterest(oi) };
}

/** Funding rates already settled, oldest first. Rows that cannot be read are dropped. */
export function parseFundingHistory(body: unknown): FundingEvent[] {
  const b = body as { code?: string; data?: { fundingRate?: string; realizedRate?: string; fundingTime?: string }[] } | null;
  if (!b || b.code !== '0' || !Array.isArray(b.data)) return [];
  return b.data
    .map((row) => ({ time: Number(row.fundingTime), rate: Number(row.realizedRate ?? row.fundingRate) }))
    .filter((e) => e.time > 1e11 && Number.isFinite(e.rate))
    .sort((a, b2) => a.time - b2.time);
}

const FUNDING_PAGE = 100;
/**
 * Settled funding rates back to `since`, a page at a time (OKX keeps about three months). Never throws: the
 * backtest then says from when funding is known. `maxPages` bounds the requests for long histories.
 */
export async function fetchFundingHistory(symbol: MarketSymbol, since: number, signal?: AbortSignal, maxPages = 6): Promise<FundingEvent[]> {
  const out: FundingEvent[] = [];
  let after = '';
  for (let page = 0; page < maxPages; page++) {
    const rows = parseFundingHistory(await get(`/api/v5/public/funding-rate-history?instId=${symbol.instId}&limit=${FUNDING_PAGE}${after ? `&after=${after}` : ''}`, signal));
    if (rows.length === 0) break;
    out.unshift(...rows);
    if (rows[0].time <= since || rows.length < FUNDING_PAGE) break;
    after = String(rows[0].time);
  }
  return out;
}

/**
 * OKX demo trading has its own order book, and so its own last price. It normally sits within a few dollars
 * of the real market, but it can drift by more than one percent in a fast move (seen on 19 Nov 2026). The
 * chart and the signals use the real market, so an order sent to demo while the two disagree trades against
 * levels that were not read on its own chart.
 */
export const DEMO_GAP_LIMIT = 0.0015;
export function parseLast(body: unknown): number | null {
  const row = (body as { code?: string; data?: { last?: string }[] } | null)?.data?.[0];
  const last = Number(row?.last);
  return (body as { code?: string } | null)?.code === '0' && row?.last !== undefined && row.last !== '' && Number.isFinite(last) && last > 0 ? last : null;
}
/** Demo price against the real one, as a fraction of the real one; null when either is missing. */
export const demoGap = (demo: number | null, real: number | undefined) => (demo === null || real === undefined || !(real > 0) ? null : (demo - real) / real);
/** Last price of the market in OKX demo trading: the public ticker, asked with the simulation mark. */
export async function fetchDemoLast(instId: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, { signal, headers: { 'x-simulated-trading': '1' } });
    return res.ok ? parseLast(await res.json()) : null;
  } catch {
    return null;
  }
}
