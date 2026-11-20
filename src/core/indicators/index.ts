import type { Candle, IndicatorOutputs, Series } from '../types';
import { divergenceSeries, findDivergences } from '../divergence';
import { fibRetracements, swingLevels } from '../levels';
import { doubleSeries } from '../patterns';
import { trendlines } from '../trendlines';

export type PriceField = 'open' | 'high' | 'low' | 'close';

export interface IndicatorSpec {
  type: string;
  source?: PriceField;
  length: number;
  /** Standard-deviation multiplier (Bollinger only). */
  mult?: number;
  /** MACD only: lengths of the fast and slow averages and of the signal line. */
  fast?: number;
  slow?: number;
  signal?: number;
  /** Swing levels only: how many candles back a pivot stays in use. */
  lookback?: number;
  /** Stochastics only: candles used to smooth %K. */
  smooth?: number;
  /**
   * Divergence only: the oscillator compared with price, its own length, and the
   * extreme area the first swing point must be in (left out: anywhere).
   * `length` is then the number of candles on each side of a swing point.
   */
  osc?: 'rsi' | 'macd' | 'stoch';
  oscLength?: number;
  upper?: number;
  lower?: number;
  /** Double tops and bottoms only: how far apart the two extremes may be (percent), and the least height in average ranges. */
  tolerance?: number;
  minHeight?: number;
  /**
   * Id of a higher timeframe to compute this indicator on (e.g. `1h` under a
   * 5m chart). Its values are then aligned to the chart's candles, using only
   * higher-timeframe candles that had already closed.
   */
  timeframe?: string;
}

/** Candles of a higher timeframe, with that timeframe's duration. */
export interface HigherData {
  candles: Candle[];
  ms: number;
}

export interface ComputeOptions {
  /** Duration of the chart's own candles. Needed to align higher-timeframe indicators. */
  ms?: number;
  higher?: Record<string, HigherData>;
}

/**
 * Bring a higher-timeframe series down to the chart's candles without
 * look-ahead: each candle gets the value of the last higher-timeframe candle
 * that had closed by the time this candle closed.
 */
export function alignHigher(candles: Candle[], ms: number, higher: Candle[], higherMs: number, series: Series): Series {
  const out: Series = new Array(candles.length).fill(null);
  let j = -1;
  for (let i = 0; i < candles.length; i++) {
    const closeTime = candles[i].time + ms;
    while (j + 1 < higher.length && higher[j + 1].time + higherMs <= closeTime) j++;
    out[i] = j >= 0 ? (series[j] ?? null) : null;
  }
  return out;
}

/** Simple moving average. */
export function sma(values: number[], length: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `length` values. */
export function ema(values: number[], length: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < length) return out;
  const k = 2 / (length + 1);
  let prev = 0;
  for (let i = 0; i < length; i++) prev += values[i];
  prev /= length;
  out[length - 1] = prev;
  for (let i = length; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Bollinger Bands: SMA basis with bands `mult` standard deviations away.
 * Uses the population standard deviation, as TradingView does.
 * Murphy (1999), pp. 209-213.
 */
export function bollinger(values: number[], length: number, mult: number): IndicatorOutputs {
  const basis = sma(values, length);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i++) {
    const mean = basis[i] as number;
    let sq = 0;
    for (let j = i - length + 1; j <= i; j++) sq += (values[j] - mean) ** 2;
    const sd = Math.sqrt(sq / length);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { basis, upper, lower };
}

/**
 * Relative Strength Index with Wilder's smoothing. The first average is the
 * simple mean of the first `length` changes. Murphy (1999), pp. 239-246.
 */
export function rsi(values: number[], length: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= length) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= length; i++) {
    const ch = values[i] - values[i - 1];
    avgGain += Math.max(ch, 0) / length;
    avgLoss += Math.max(-ch, 0) / length;
  }
  const value = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[length] = value(avgGain, avgLoss);
  for (let i = length + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    avgGain = (avgGain * (length - 1) + Math.max(ch, 0)) / length;
    avgLoss = (avgLoss * (length - 1) + Math.max(-ch, 0)) / length;
    out[i] = value(avgGain, avgLoss);
  }
  return out;
}

/**
 * MACD: fast EMA minus slow EMA, its signal line (an EMA of the MACD line) and
 * the histogram (their difference). Murphy (1999), pp. 252-256.
 */
export function macd(values: number[], fast: number, slow: number, signal: number): IndicatorOutputs {
  const n = values.length;
  const fastE = ema(values, fast);
  const slowE = ema(values, slow);
  const line: Series = values.map((_, i) => (fastE[i] === null || slowE[i] === null ? null : (fastE[i] as number) - (slowE[i] as number)));
  const start = line.findIndex((v) => v !== null);
  const sig: Series = new Array(n).fill(null);
  if (start >= 0) ema(line.slice(start) as number[], signal).forEach((v, k) => (sig[start + k] = v));
  const hist: Series = line.map((v, i) => (v === null || sig[i] === null ? null : v - (sig[i] as number)));
  return { macd: line, signal: sig, hist };
}

/** Average True Range with Wilder's smoothing: the typical size of a candle, gaps included. */
export function atr(candles: Candle[], length: number): Series {
  const out: Series = new Array(candles.length).fill(null);
  let prev = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tr = i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close));
    if (i < length) {
      prev += tr / length;
      if (i === length - 1) out[i] = prev;
    } else {
      prev = (prev * (length - 1) + tr) / length;
      out[i] = prev;
    }
  }
  return out;
}

/** Highest (or lowest) value of the last `length` candles, the current one included. */
export function extreme(values: number[], length: number, kind: 'max' | 'min'): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i++) {
    let v = values[i];
    for (let j = i - length + 1; j < i; j++) v = kind === 'max' ? Math.max(v, values[j]) : Math.min(v, values[j]);
    out[i] = v;
  }
  return out;
}

/** Simple moving average of a series that starts with a warm-up of nulls. */
function smaOf(series: Series, length: number): Series {
  const out: Series = new Array(series.length).fill(null);
  const start = series.findIndex((v) => v !== null);
  if (start >= 0) sma(series.slice(start) as number[], length).forEach((v, k) => (out[start + k] = v));
  return out;
}

/**
 * Slow stochastics. Raw %K places the close inside the high-low range of the
 * last `length` candles, from 0 to 100; %K is its average over `smooth`
 * candles and %D the average of %K over `signal` candles. A flat range counts
 * as the middle. Murphy (1999), pp. 246-249.
 */
export function stochastic(candles: Candle[], length: number, smooth: number, signal: number): IndicatorOutputs {
  const hi = extreme(candles.map((c) => c.high), length, 'max');
  const lo = extreme(candles.map((c) => c.low), length, 'min');
  const raw: Series = candles.map((c, i) => {
    const h = hi[i];
    const l = lo[i];
    return h === null || l === null ? null : h === l ? 50 : (100 * (c.close - l)) / (h - l);
  });
  const k = smaOf(raw, smooth);
  return { k, d: smaOf(k, signal) };
}

/**
 * On Balance Volume: a running total that adds the candle's volume when it
 * closes higher than the one before and subtracts it when it closes lower.
 * Only its direction matters, not its level. Murphy (1999), pp. 162-169.
 */
export function obv(candles: Candle[]): number[] {
  const out: number[] = [];
  let total = 0;
  candles.forEach((c, i) => {
    if (i > 0) total += c.close > candles[i - 1].close ? c.volume : c.close < candles[i - 1].close ? -c.volume : 0;
    out.push(total);
  });
  return out;
}

/** The oscillator a divergence is measured on, computed with the lengths the spec carries. */
function oscillator(candles: Candle[], s: IndicatorSpec): Series {
  const closes = candles.map((c) => c.close);
  if (s.osc === 'macd') return macd(closes, s.fast ?? 12, s.slow ?? 26, s.signal ?? 9).macd;
  if (s.osc === 'stoch') return stochastic(candles, s.oscLength ?? 14, s.smooth ?? 3, s.signal ?? 3).d;
  return rsi(closes, s.oscLength ?? 14);
}

interface IndicatorDef {
  /** Output used when a rule names the indicator without an output, e.g. `rsi`. */
  defaultOutput: string;
  /** `values` is the chosen price field; `candles` is there for indicators that need the whole candle. */
  compute(values: number[], spec: IndicatorSpec, candles: Candle[]): IndicatorOutputs;
}

/**
 * The indicator registry. Adding an indicator from Murphy's book means adding
 * one pure function above and one entry here.
 */
export const INDICATORS: Record<string, IndicatorDef> = {
  sma: { defaultOutput: 'value', compute: (v, s) => ({ value: sma(v, s.length) }) },
  ema: { defaultOutput: 'value', compute: (v, s) => ({ value: ema(v, s.length) }) },
  rsi: { defaultOutput: 'value', compute: (v, s) => ({ value: rsi(v, s.length) }) },
  bollinger: { defaultOutput: 'basis', compute: (v, s) => bollinger(v, s.length, s.mult ?? 2) },
  macd: { defaultOutput: 'macd', compute: (v, s) => macd(v, s.fast ?? 12, s.slow ?? s.length, s.signal ?? 9) },
  // Support and resistance from swing points; `length` is the number of candles on each side of a pivot.
  levels: { defaultOutput: 'support', compute: (_v, s, c) => swingLevels(c, s.length, s.lookback ?? 150) },
  // Fibonacci retracements of the latest swing; `length` is the number of candles on each side of a pivot.
  fib: { defaultOutput: 'r500', compute: (_v, s, c) => fibRetracements(c, s.length, s.lookback ?? 200) },
  atr: { defaultOutput: 'value', compute: (_v, s, c) => ({ value: atr(c, s.length) }) },
  // Trendlines and their breaks, and double tops and bottoms; `length` is the number of candles on each side of a swing point.
  trendlines: { defaultOutput: 'up', compute: (_v, s, c) => trendlines(c, s.length, s.lookback ?? 150) },
  doubles: { defaultOutput: 'top', compute: (_v, s, c) => doubleSeries(c, { strength: s.length, lookback: s.lookback ?? 80, tolerance: s.tolerance ?? 0.4, minHeight: s.minHeight ?? 2 }) },
  stoch: { defaultOutput: 'd', compute: (_v, s, c) => stochastic(c, s.length, s.smooth ?? 3, s.signal ?? 3) },
  // Volume with its own average over `length` candles.
  volume: { defaultOutput: 'value', compute: (_v, s, c) => ({ value: c.map((x) => x.volume), avg: sma(c.map((x) => x.volume), s.length) }) },
  // On Balance Volume with its average, to read its direction.
  obv: { defaultOutput: 'value', compute: (_v, s, c) => ({ value: obv(c), avg: sma(obv(c), s.length) }) },
  // Divergences between price and an oscillator; `length` is the number of candles on each side of a swing point.
  divergence: {
    defaultOutput: 'bear',
    compute: (_v, s, c) => divergenceSeries(c.length, findDivergences(c, oscillator(c, s), s.length, s.lookback ?? 60, s.upper !== undefined && s.lower !== undefined ? { upper: s.upper, lower: s.lower } : undefined)),
  },
  highest: { defaultOutput: 'value', compute: (v, s) => ({ value: extreme(v, s.length, 'max') }) },
  lowest: { defaultOutput: 'value', compute: (v, s) => ({ value: extreme(v, s.length, 'min') }) },
};

/** Compute every indicator a rule declares, keyed by the rule's indicator ids. */
export function computeIndicators(
  candles: Candle[],
  specs: Record<string, IndicatorSpec>,
  options: ComputeOptions = {},
): Record<string, IndicatorOutputs> {
  const out: Record<string, IndicatorOutputs> = {};
  for (const [id, spec] of Object.entries(specs)) {
    const def = INDICATORS[spec.type];
    if (!def) throw new Error(`Unknown indicator type "${spec.type}"`);
    const field = spec.source ?? 'close';
    if (!spec.timeframe) {
      out[id] = def.compute(candles.map((c) => c[field]), spec, candles);
      continue;
    }
    // Higher timeframe: compute on its closed candles, then align. While that
    // data is missing (still loading), the outputs are empty and nothing signals.
    const data = options.higher?.[spec.timeframe];
    const closed = data ? data.candles.filter((c) => c.closed) : [];
    const computed = def.compute(closed.map((c) => c[field]), spec, closed);
    const aligned: IndicatorOutputs = {};
    for (const [key, series] of Object.entries(computed)) {
      aligned[key] = data && options.ms ? alignHigher(candles, options.ms, closed, data.ms, series) : new Array(candles.length).fill(null);
    }
    out[id] = aligned;
  }
  return out;
}
