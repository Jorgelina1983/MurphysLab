import type { Condition, Rule } from '../rule/types';

export interface BbRsiParams {
  bbLength: number;
  bbMult: number;
  rsiLength: number;
  rsiOverbought: number;
  rsiOversold: number;
  /**
   * Trend filter: shorts only below the trend average, longs only above it.
   * `same` computes the average on the chart's timeframe, `higher` on a
   * higher one (see `trendTimeframe`).
   */
  trendMode: TrendMode;
  /** Length of the simple moving average that defines the trend. */
  trendLength: number;
  /** Id of the higher timeframe used when `trendMode` is `higher`, e.g. `1h`. */
  trendTimeframe?: string;
}

export type TrendMode = 'off' | 'same' | 'higher';

export const DEFAULT_BB_RSI_PARAMS: BbRsiParams = {
  bbLength: 20,
  bbMult: 2,
  rsiLength: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  trendMode: 'off',
  trendLength: 200,
};

/**
 * Bollinger + RSI reversal, the same rule as `pine/bb_rsi_reversal.pine`
 * (the Pine script has no trend filter).
 * Returns plain data: the engine interprets it, no rule logic lives in code.
 * `label` values are translation keys used by the condition checklist.
 *
 * With a trend filter, each side gains one condition, so the rule only trades
 * in the direction of the larger trend. Murphy's advice is to take oscillator
 * signals with the trend; moving averages are on pp. 195-208 (1999).
 */
export function makeBbRsiRule(p: BbRsiParams = DEFAULT_BB_RSI_PARAMS): Rule {
  const filtered = p.trendMode !== 'off';
  const trendDown: Condition[] = filtered ? [{ lt: ['close', 'trend'], label: 'cond.trendDown' }] : [];
  const trendUp: Condition[] = filtered ? [{ gt: ['close', 'trend'], label: 'cond.trendUp' }] : [];
  const higher = p.trendMode === 'higher' && p.trendTimeframe ? { timeframe: p.trendTimeframe } : {};
  return {
    id: 'bb-rsi-reversal',
    name: 'Bollinger + RSI reversal',
    indicators: {
      bb: { type: 'bollinger', source: 'close', length: p.bbLength, mult: p.bbMult },
      rsi: { type: 'rsi', source: 'close', length: p.rsiLength },
      ...(filtered ? { trend: { type: 'sma', source: 'close' as const, length: p.trendLength, ...higher } } : {}),
    },
    signals: {
      short: {
        when: {
          all: [
            { gte: ['high[1]', 'bb.upper[1]'], label: 'cond.touchUpper' },
            { gt: ['rsi[1]', p.rsiOverbought], label: 'cond.rsiOverbought' },
            { lt: ['close', 'bb.upper'], label: 'cond.closeBelowUpper' },
            { gt: ['close', 'bb.lower'], label: 'cond.closeAboveLower' },
            ...trendDown,
          ],
        },
        stop: { max: ['high', 'high[1]'] },
        target: 'bb.basis',
      },
      long: {
        when: {
          all: [
            { lte: ['low[1]', 'bb.lower[1]'], label: 'cond.touchLower' },
            { lt: ['rsi[1]', p.rsiOversold], label: 'cond.rsiOversold' },
            { lt: ['close', 'bb.upper'], label: 'cond.closeBelowUpper' },
            { gt: ['close', 'bb.lower'], label: 'cond.closeAboveLower' },
            ...trendUp,
          ],
        },
        stop: { min: ['low', 'low[1]'] },
        target: 'bb.basis',
      },
    },
  };
}
