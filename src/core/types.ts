/** One candle. `time` is the candle's opening time in milliseconds (UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** False while the candle is still forming. Only closed candles reach the engine. */
  closed: boolean;
}

export type Side = 'long' | 'short';

/** A series aligned to the candles. `null` during an indicator's warm-up. */
export type Series = (number | null)[];

/** Named outputs of one indicator, e.g. { basis, upper, lower }. */
export type IndicatorOutputs = Record<string, Series>;
