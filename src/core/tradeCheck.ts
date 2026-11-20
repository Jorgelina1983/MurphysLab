import type { Side } from './types';

/**
 * Murphy's money-management guidelines, checked against the 1999 edition:
 * chapter 16, "Money Management and Trading Tactics", pp. 395-398. The four
 * allocation limits are on pp. 395-396 and the reward-to-risk yardstick on p. 398.
 * He presents them as standard guidelines that a trader can adjust.
 */
export interface Thresholds {
  /** Minimum reward to risk. Murphy: 3 to 1 (p. 398). */
  minRewardRisk: number;
  /** Maximum share of capital at risk on one trade. Murphy: 5% (p. 396). */
  maxRiskOnCapital: number;
  /** Maximum share of capital as margin in one market. Murphy: 10 to 15% (p. 396). */
  maxMarginOnCapital: number;
  /** Fees above this share of the gross gain flag the trade. Added by this tool, not from Murphy. */
  maxFeeShare: number;
}

export const MURPHY_THRESHOLDS: Thresholds = {
  minRewardRisk: 3,
  maxRiskOnCapital: 0.05,
  maxMarginOnCapital: 0.15,
  maxFeeShare: 0.3,
};

/** OKX base tier for USDT perpetuals. Confirm on OKX's own fee page. */
export const OKX_BASE_FEES = { maker: 0.0002, taker: 0.0005 };

export interface TradeCheckInput {
  entry: number;
  stop: number;
  target: number;
  /** Position size in the base asset (BTC). */
  size: number;
  capital: number;
  leverage: number;
  /** Fee rate on the entry order, as a fraction (0.0005 = 0.05%). */
  feeEntry: number;
  /** Fee rate on the exit order. Stops and take-profits that trigger a market order pay the taker rate. */
  feeExit: number;
  thresholds?: Thresholds;
}

export type Verdict = 'meets' | 'below' | 'breaksLimit' | 'feesDominate' | 'invalid';

export interface TradeCheckResult {
  side: Side | null;
  grossGain: number;
  grossLoss: number;
  feesOnWin: number;
  feesOnLoss: number;
  netGain: number;
  netLoss: number;
  /** Net gain divided by net loss. Negative when fees exceed the gross gain. */
  rewardRisk: number;
  /** Win rate needed to break even. `null` when the trade cannot break even. */
  breakEvenWinRate: number | null;
  feeShare: number;
  riskOnCapital: number;
  margin: number;
  marginOnCapital: number;
  verdict: Verdict;
}

/** After fees, is the possible gain worth the possible loss? */
export function tradeCheck(input: TradeCheckInput): TradeCheckResult {
  const { entry, stop, target, size, capital, leverage, feeEntry, feeExit } = input;
  const th = input.thresholds ?? MURPHY_THRESHOLDS;
  const side: Side | null = target > entry && stop < entry ? 'long' : target < entry && stop > entry ? 'short' : null;

  const grossGain = size * Math.abs(target - entry);
  const grossLoss = size * Math.abs(entry - stop);
  const feesOnWin = size * (feeEntry * entry + feeExit * target);
  const feesOnLoss = size * (feeEntry * entry + feeExit * stop);
  const netGain = grossGain - feesOnWin;
  const netLoss = grossLoss + feesOnLoss;
  const rewardRisk = netLoss > 0 ? netGain / netLoss : 0;
  const breakEvenWinRate = netGain > 0 ? netLoss / (netGain + netLoss) : null;
  const feeShare = grossGain > 0 ? feesOnWin / grossGain : Infinity;
  const riskOnCapital = capital > 0 ? netLoss / capital : Infinity;
  const margin = leverage > 0 ? (size * entry) / leverage : size * entry;
  const marginOnCapital = capital > 0 ? margin / capital : Infinity;

  let verdict: Verdict;
  if (side === null || !(size > 0)) verdict = 'invalid';
  else if (netGain <= 0 || feeShare > th.maxFeeShare) verdict = 'feesDominate';
  else if (riskOnCapital > th.maxRiskOnCapital || marginOnCapital > th.maxMarginOnCapital) verdict = 'breaksLimit';
  else if (rewardRisk < th.minRewardRisk) verdict = 'below';
  else verdict = 'meets';

  return {
    side,
    grossGain,
    grossLoss,
    feesOnWin,
    feesOnLoss,
    netGain,
    netLoss,
    rewardRisk,
    breakEvenWinRate,
    feeShare,
    riskOnCapital,
    margin,
    marginOnCapital,
    verdict,
  };
}

export interface SizeSuggestion {
  /** Suggested position size in the base asset, a whole number of steps. Zero when even one step is too much. */
  size: number;
  /** What the risk alone would allow, before the margin cap. */
  byRisk: number;
  /** True when the margin cap, not the risk, set the size. */
  capped: boolean;
}

/**
 * Position size from the money the trader accepts to lose at the stop
 * (`riskPct` percent of capital), never above the cap on margin per market.
 * With a tight stop the risk alone would allow a position far larger than the
 * margin cap, so the smaller of the two wins. Rounded down to the size step.
 */
export function suggestSize(input: { entry: number; stop: number; capital: number; riskPct: number; leverage: number; sizeStep: number; thresholds?: Thresholds }): SizeSuggestion {
  const { entry, stop, capital, riskPct, leverage, sizeStep } = input;
  const th = input.thresholds ?? MURPHY_THRESHOLDS;
  const distance = Math.abs(entry - stop);
  if (!(distance > 0) || !(entry > 0) || !(sizeStep > 0)) return { size: 0, byRisk: 0, capped: false };
  const round = (steps: number) => Number((Math.max(0, steps) * sizeStep).toFixed(6));
  const riskSteps = Math.floor((capital * riskPct) / 100 / distance / sizeStep + 1e-9);
  const marginSteps = Math.floor((th.maxMarginOnCapital * capital * Math.max(1, leverage)) / entry / sizeStep + 1e-9);
  return { size: round(Math.min(riskSteps, marginSteps)), byRisk: round(riskSteps), capped: marginSteps < riskSteps };
}
