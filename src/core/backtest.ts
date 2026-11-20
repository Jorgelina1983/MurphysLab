import type { Signal } from './rule/types';
import type { Candle, Side } from './types';

export interface BacktestOptions {
  /** Fee rate per side as a fraction. Entry is a market order at the next open. */
  feeEntry: number;
  feeExit: number;
  /** Adverse price slippage per fill, as a fraction of price. */
  slippage: number;
  /** Close the trade after this many candles if neither level is hit. */
  timeoutBars: number;
}

export const DEFAULT_BACKTEST_OPTIONS: BacktestOptions = {
  feeEntry: 0.0005,
  feeExit: 0.0005,
  slippage: 0,
  timeoutBars: 20,
};

/** `manual` only happens in practice mode, where the user can close a position by hand. */
export type ExitReason = 'target' | 'stop' | 'timeout' | 'manual';

export interface Trade {
  signal: Signal;
  side: Side;
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  exitReason: ExitReason;
  /** Price distance from entry to stop: the initial risk, 1R. */
  risk: number;
  /** Results per unit of the asset, in price units. */
  grossPnl: number;
  fees: number;
  netPnl: number;
  grossR: number;
  netR: number;
}

export interface Metrics {
  trades: number;
  longs: number;
  shorts: number;
  /** Share of trades with a positive result after fees. Comparable with `breakEvenWinRate`. */
  winRate: number;
  /** Share of trades that reached their target (a timeout can also end in profit). */
  targetRate: number;
  avgGrossR: number;
  avgNetR: number;
  /** Net wins divided by net losses. `null` when there are no losses. */
  profitFactor: number | null;
  /** Largest peak-to-trough fall of the cumulative net result, in R. */
  maxDrawdownR: number;
  totalNetR: number;
  /** Fees as a share of gross profit. `null` when there is no gross profit. */
  feeShare: number | null;
  /** Win rate needed to break even, from the average net win and net loss. */
  breakEvenWinRate: number | null;
  /** Fewer than 30 trades: too few to conclude anything. */
  smallSample: boolean;
}

export interface BacktestResult {
  trades: Trade[];
  /** Signals not traded: a position was open, the next candle was missing, or the levels were already passed. */
  skipped: number;
  /** Of those, signals not traded because the stop was closer to the entry than the fees of the trade (see `stopTooTight`). */
  tooTight: number;
  metrics: Metrics;
}

/**
 * A stop closer to the entry than what the trade pays in fees is not a tradable stop: the fee alone costs more
 * than the amount risked, and the result in R explodes (a stop one cent away turns an ordinary loss into
 * hundreds of R). Such signals are left out, winners and losers alike, and counted.
 */
export const stopTooTight = (entryPrice: number, stop: number, options: { feeEntry: number; feeExit: number }) => Math.abs(entryPrice - stop) < (options.feeEntry + options.feeExit) * entryPrice;

/**
 * Replay signals over closed candles under conservative assumptions:
 * entry at the next candle's open, stop assumed first when stop and target
 * fall in the same candle, one position at a time.
 */
export function backtest(candles: Candle[], signals: Signal[], options: BacktestOptions = DEFAULT_BACKTEST_OPTIONS): BacktestResult {
  const trades: Trade[] = [];
  let skipped = 0;
  let tooTight = 0;
  let freeFrom = 0;
  const ordered = [...signals].sort((a, b) => a.index - b.index);

  for (const signal of ordered) {
    const entryIndex = signal.index + 1;
    const entryCandle = candles[entryIndex];
    if (signal.index < freeFrom || !entryCandle || !entryCandle.closed) {
      skipped++;
      continue;
    }
    const dir = signal.side === 'long' ? 1 : -1;
    const entryPrice = entryCandle.open * (1 + dir * options.slippage);
    // The levels must still bracket the entry: target ahead, stop behind.
    if (dir * (signal.target - entryPrice) <= 0 || dir * (entryPrice - signal.stop) <= 0) {
      skipped++;
      continue;
    }
    if (stopTooTight(entryPrice, signal.stop, options)) {
      skipped++;
      tooTight++;
      continue;
    }

    let exitIndex = entryIndex;
    let exitPrice = entryPrice;
    let exitReason: ExitReason = 'timeout';
    for (let i = entryIndex; i < candles.length && candles[i].closed; i++) {
      const c = candles[i];
      exitIndex = i;
      const stopHit = signal.side === 'long' ? c.low <= signal.stop : c.high >= signal.stop;
      const targetHit = signal.side === 'long' ? c.high >= signal.target : c.low <= signal.target;
      if (stopHit) {
        exitReason = 'stop';
        exitPrice = signal.stop * (1 - dir * options.slippage);
        break;
      }
      if (targetHit) {
        exitReason = 'target';
        exitPrice = signal.target;
        break;
      }
      exitPrice = c.close * (1 - dir * options.slippage);
      if (i - entryIndex + 1 >= options.timeoutBars) break;
    }

    const risk = Math.abs(entryPrice - signal.stop);
    const grossPnl = dir * (exitPrice - entryPrice);
    const fees = options.feeEntry * entryPrice + options.feeExit * exitPrice;
    const netPnl = grossPnl - fees;
    trades.push({
      signal,
      side: signal.side,
      entryIndex,
      entryTime: entryCandle.time,
      entryPrice,
      exitIndex,
      exitTime: candles[exitIndex].time,
      exitPrice,
      exitReason,
      risk,
      grossPnl,
      fees,
      netPnl,
      grossR: grossPnl / risk,
      netR: netPnl / risk,
    });
    freeFrom = exitIndex;
  }

  return { trades, skipped, tooTight, metrics: computeMetrics(trades) };
}

export function computeMetrics(trades: Trade[]): Metrics {
  const n = trades.length;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const netWins = trades.filter((t) => t.netR > 0).map((t) => t.netR);
  const netLosses = trades.filter((t) => t.netR <= 0).map((t) => -t.netR);
  const grossProfit = sum(trades.filter((t) => t.grossPnl > 0).map((t) => t.grossPnl));
  const totalFees = sum(trades.map((t) => t.fees));

  let peak = 0;
  let cum = 0;
  let maxDrawdownR = 0;
  for (const t of trades) {
    cum += t.netR;
    peak = Math.max(peak, cum);
    maxDrawdownR = Math.max(maxDrawdownR, peak - cum);
  }

  const avgWin = netWins.length ? sum(netWins) / netWins.length : 0;
  const avgLoss = netLosses.length ? sum(netLosses) / netLosses.length : 0;
  return {
    trades: n,
    longs: trades.filter((t) => t.side === 'long').length,
    shorts: trades.filter((t) => t.side === 'short').length,
    winRate: n ? netWins.length / n : 0,
    targetRate: n ? trades.filter((t) => t.exitReason === 'target').length / n : 0,
    avgGrossR: n ? sum(trades.map((t) => t.grossR)) / n : 0,
    avgNetR: n ? sum(trades.map((t) => t.netR)) / n : 0,
    profitFactor: sum(netLosses) > 0 ? sum(netWins) / sum(netLosses) : null,
    maxDrawdownR,
    totalNetR: cum,
    feeShare: grossProfit > 0 ? totalFees / grossProfit : null,
    breakEvenWinRate: avgWin > 0 && avgLoss > 0 ? avgLoss / (avgWin + avgLoss) : null,
    smallSample: n < 30,
  };
}

/**
 * Out-of-sample check: metrics for the trades whose signal came before
 * `splitTime` (the part used to choose parameters) and for the ones after it
 * (the part the rule was never tuned on).
 */
export function splitMetrics(trades: Trade[], splitTime: number): { inSample: Metrics; outOfSample: Metrics } {
  return {
    inSample: computeMetrics(trades.filter((t) => t.signal.time < splitTime)),
    outOfSample: computeMetrics(trades.filter((t) => t.signal.time >= splitTime)),
  };
}
