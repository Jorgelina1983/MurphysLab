import type { BbRsiParams } from '../core/rules/bbRsiReversal';
import { DEFAULT_STRATEGY, normalizeStrategy, type StrategyConfig } from '../core/rules/strategy';
import { OKX_BASE_FEES } from '../core/tradeCheck';

export interface Settings {
  timeframe: string;
  history: number;
  /** The indicator blocks that are on, their parameters, and the stop and target rules. */
  strategy: StrategyConfig;
  timeoutBars: number;
  /** Fee rates in percent, as shown on screen (0.05 means 0.05%). */
  feeMakerPct: number;
  feeTakerPct: number;
  entryOrder: 'market' | 'limit';
  /** Margin mode used for orders sent to OKX demo. */
  marginMode: 'cross' | 'isolated';
  capital: number;
  /** Chart layers that are not indicators: traded volume under the candles, and OKX liquidations. */
  showVolume: boolean;
  showLiquidations: boolean;
  /** Whether the long-term strip under the chart is open. */
  showLongTerm: boolean;
  theme: 'dark' | 'light';
  /** Whether the side column with the working tabs is showing. Hidden, the chart takes the full width. */
  panelOpen: boolean;
  /**
   * The Explorar tab's own indicators and parameters, kept apart from the rule: only its `on` flags and
   * indicator parameters are used, to draw the chart while that tab is open.
   */
  explore: StrategyConfig;
  /** Share of the capital, in percent, that the order ticket risks between entry and stop. */
  riskPct: number;
  leverage: number;
  /** Position size for the trade check, per market id, in the base asset. */
  sizes: Record<string, number>;
  muted: boolean;
  /** Multiplier for the interface text size, changed with the A- / A+ buttons. */
  fontScale: number;
  /** Chart height as a multiple of its default, set with the − / + under the chart. */
  chartScale: number;
  /** Share of the history, in percent, used as the tuning part of the out-of-sample check. */
  splitPct: number;
}

export const DEFAULT_SETTINGS: Settings = {
  timeframe: '5m',
  history: 1500,
  strategy: DEFAULT_STRATEGY,
  timeoutBars: 20,
  feeMakerPct: OKX_BASE_FEES.maker * 100,
  feeTakerPct: OKX_BASE_FEES.taker * 100,
  entryOrder: 'market',
  marginMode: 'cross',
  showVolume: true,
  showLiquidations: false,
  showLongTerm: false,
  theme: 'dark',
  panelOpen: true,
  explore: DEFAULT_STRATEGY,
  capital: 5000,
  riskPct: 1,
  leverage: 3,
  sizes: {},
  muted: false,
  fontScale: 1,
  chartScale: 1,
  splitPct: 70,
};

export const HISTORY_OPTIONS = [500, 1500, 3000, 6000];
export const SETTINGS_KEY = 'murphy-signal-lab.settings.v1';

/** A combination of blocks saved under a name. */
export interface Preset {
  name: string;
  strategy: StrategyConfig;
  timeoutBars: number;
}
export const PRESETS_KEY = 'murphy-signal-lab.presets.v1';

/**
 * Settings as stored by any earlier version. Before the blocks existed the rule
 * was a flat `params` object for Bollinger + RSI; it becomes the same strategy.
 */
export function migrateSettings(stored: Partial<Settings> & { params?: Partial<BbRsiParams> & { trendFilter?: boolean } }): Settings {
  const { params: old, ...rest } = stored;
  const strategy = stored.strategy
    ? normalizeStrategy(stored.strategy)
    : normalizeStrategy(
        old
          ? {
              bollinger: { length: old.bbLength, mult: old.bbMult },
              rsi: { length: old.rsiLength, overbought: old.rsiOverbought, oversold: old.rsiOversold },
              trend: { mode: old.trendMode ?? (old.trendFilter ? 'same' : 'off'), length: old.trendLength },
            }
          : {},
      );
  return { ...DEFAULT_SETTINGS, ...rest, strategy, explore: normalizeStrategy(stored.explore ?? {}) };
}
