import { backtest, splitMetrics } from './core/backtest';
import { buildContext, compileRule, scanSignals } from './core/rule/engine';
import { BUILTIN_STRATEGIES, makeStrategyRule } from './core/rules/strategy';
import { OKX_BASE_FEES } from './core/tradeCheck';
import { fetchCandles, SYMBOLS, TIMEFRAMES, TREND_TIMEFRAME } from './feed/okx';

/**
 * A study tool, not part of the page: every ready-made combination run over one market and timeframe with the
 * same engine and assumptions as the Backtest panel (entry at the next open, stop first, taker fee each side,
 * the combination's own timeout), split 70/30 in time. Funding is not included.
 *
 * From the browser console, with the dev server running:
 *   const { runStudy } = await import('/src/study.ts'); console.table(await runStudy('BTC', '15m', 6000));
 */
export interface StudyRow {
  id: string;
  kind: string;
  trades: number;
  winRate: number;
  avgNetR: number;
  totalNetR: number;
  maxDrawdownR: number;
  /** First 70% of the period, and the last 30%. */
  /** Signals left out because the stop was closer than the fees. */
  tooTight: number;
  inTrades: number;
  inAvg: number;
  outTrades: number;
  outAvg: number;
}

export async function runStudy(symbolId: string, tfId: string, count: number): Promise<{ from: string; to: string; candles: number; rows: StudyRow[] }> {
  const symbol = SYMBOLS.find((s) => s.id === symbolId);
  const tf = TIMEFRAMES.find((t) => t.id === tfId);
  if (!symbol || !tf) throw new Error('unknown market or timeframe');
  const trendTf = TREND_TIMEFRAME[tf.id];
  const [all, trend] = await Promise.all([fetchCandles(symbol, tf, count), fetchCandles(symbol, trendTf, 1500)]);
  const candles = all.filter((c) => c.closed);
  const higher = { [trendTf.id]: { candles: trend, ms: trendTf.ms } };
  const splitTime = candles[Math.floor(candles.length * 0.7)].time;
  const round = (v: number) => Math.round(v * 100) / 100;
  const rows = BUILTIN_STRATEGIES.map((b) => {
    const rule = makeStrategyRule(b.strategy, trendTf.id);
    const signals = scanSignals(compileRule(rule), buildContext(rule, candles, { ms: tf.ms, higher }));
    const { trades, tooTight, metrics: m } = backtest(candles, signals, { feeEntry: OKX_BASE_FEES.taker, feeExit: OKX_BASE_FEES.taker, slippage: 0, timeoutBars: b.timeoutBars });
    const { inSample, outOfSample } = splitMetrics(trades, splitTime);
    return { id: b.id, kind: b.kind, trades: m.trades, winRate: round(m.winRate), avgNetR: round(m.avgNetR), totalNetR: round(m.totalNetR), maxDrawdownR: round(m.maxDrawdownR), tooTight, inTrades: inSample.trades, inAvg: round(inSample.avgNetR), outTrades: outOfSample.trades, outAvg: round(outOfSample.avgNetR) };
  });
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: day(candles[0].time), to: day(candles[candles.length - 1].time), candles: candles.length, rows };
}
