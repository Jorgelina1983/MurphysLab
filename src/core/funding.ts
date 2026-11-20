import type { Trade } from './backtest';
import { computeMetrics, type Metrics } from './backtest';

/**
 * Funding of a perpetual: at fixed times, positions on one side pay the other
 * a rate on their value. With a positive rate, longs pay shorts. A trade pays
 * or collects every funding time it is open through.
 */
export interface FundingEvent {
  time: number;
  /** As a fraction: 0.0001 is 0.01%. */
  rate: number;
}

export interface FundedTrade extends Trade {
  /** Funding paid (positive) or collected (negative), in price units per unit of the asset. `null`: no data for that time. */
  funding: number | null;
}

export interface FundingReport {
  trades: FundedTrade[];
  metrics: Metrics;
  /** Trades open through at least one funding time. */
  crossed: number;
  /** Trades that start before the first known funding time, left without funding. */
  unknown: number;
  /** Total funding over all trades, in R. Positive: it cost. */
  totalR: number;
  /** First funding time known. */
  since: number | null;
}

/**
 * Charge funding to each trade and recompute its net result. A funding time
 * counts when the trade was open at it: after the entry and up to the open of
 * the candle it exits on, since the exit can happen anywhere inside that
 * candle. The amount uses the entry price as the position's value, which is
 * close enough for trades that last hours.
 */
export function withFunding(trades: Trade[], events: FundingEvent[]): FundingReport {
  const ordered = [...events].sort((a, b) => a.time - b.time);
  const since = ordered[0]?.time ?? null;
  let crossed = 0;
  let unknown = 0;
  let totalR = 0;
  const out = trades.map<FundedTrade>((t) => {
    if (since === null || t.entryTime < since) {
      unknown += 1;
      return { ...t, funding: null };
    }
    const dir = t.side === 'long' ? 1 : -1;
    const during = ordered.filter((e) => e.time > t.entryTime && e.time <= t.exitTime);
    if (during.length === 0) return { ...t, funding: 0 };
    crossed += 1;
    const funding = dir * during.reduce((sum, e) => sum + e.rate, 0) * t.entryPrice;
    totalR += funding / t.risk;
    const netPnl = t.netPnl - funding;
    return { ...t, funding, netPnl, netR: netPnl / t.risk };
  });
  return { trades: out, metrics: computeMetrics(out), crossed, unknown, totalR, since };
}
