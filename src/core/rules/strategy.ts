import type { IndicatorSpec } from '../indicators';
import type { Condition, Rule, ValueExpr } from '../rule/types';
import type { TrendMode } from './bbRsiReversal';

/**
 * A strategy is a set of blocks the user switches on and combines. Each block
 * contributes one or more conditions; a signal fires when every condition of
 * every active block holds on the same closed candle. `makeStrategyRule` turns
 * this into a plain rule that the engine evaluates.
 */
export interface StrategyConfig {
  bollinger: {
    on: boolean;
    length: number;
    mult: number;
    /** `reversal`: previous candle reached the band and this one closed back inside. `touch`: this candle reaches the band. */
    mode: 'reversal' | 'touch';
  };
  rsi: {
    on: boolean;
    length: number;
    overbought: number;
    oversold: number;
    /** `extreme`: previous candle beyond the threshold. `now`: this candle beyond it. `exit`: crosses back out of the zone. */
    mode: 'extreme' | 'now' | 'exit';
  };
  macd: {
    on: boolean;
    fast: number;
    slow: number;
    signal: number;
    /** `cross`: MACD crosses its signal line on this candle. `side`: MACD is on the right side of it. */
    mode: 'cross' | 'side';
    /** Also require MACD below zero for shorts and above zero for longs. */
    zero: boolean;
  };
  ma: {
    on: boolean;
    type: 'sma' | 'ema';
    fast: number;
    slow: number;
    /** `cross`: fast average crosses the slow one on this candle. `price`: close is on the right side of the slow average. */
    mode: 'cross' | 'price';
  };
  /** Support and resistance from swing points. */
  sr: {
    on: boolean;
    /** Candles on each side that a high or low must beat to count as a swing point. */
    strength: number;
    /** How many candles back a swing point stays in use. */
    lookback: number;
    /** How close the candle must come to the level, in percent of the level, to count as reaching it. */
    tolerance: number;
    /** `bounce`: the candle reaches the level and closes back on its side. `break`: the close goes through the level. */
    mode: 'bounce' | 'break';
    /** Only use a level that swing points have tested at least this many times. 1 accepts any level. */
    minTests: number;
  };
  /** Fibonacci retracement of the latest swing: a pullback that reaches a level and holds. */
  fib: {
    on: boolean;
    /** Candles on each side that a high or low must beat to count as the start or end of a swing. */
    strength: number;
    lookback: number;
    /** How close the candle must come to the level, in percent of the level. */
    tolerance: number;
  };
  /** Slow stochastics: %K against %D, read in the overbought and oversold areas. */
  stoch: {
    on: boolean;
    length: number;
    /** Candles that smooth %K, and candles of %D (the average of %K). */
    smooth: number;
    signal: number;
    overbought: number;
    oversold: number;
    /** `cross`: %K crosses %D with %D in the extreme area on the previous candle. `zone`: %D is in the extreme area now. */
    mode: 'cross' | 'zone';
  };
  /** Divergence between price and an oscillator, known when its second swing point is confirmed. */
  div: {
    on: boolean;
    /** The oscillator compared with price. It uses the lengths of its own block, whether that block is on or not. */
    osc: 'rsi' | 'macd' | 'stoch';
    /** Candles on each side that a high or low must beat to count as a swing point. */
    strength: number;
    /** The two swing points compared are at most this many candles apart. */
    lookback: number;
    /** Only count it when the first swing point has the oscillator in its extreme area (beyond the zero line, for MACD). */
    zone: boolean;
  };
  /** A close through the trendline in force: below an up line (sell) or above a down line (buy). */
  tl: {
    on: boolean;
    strength: number;
    lookback: number;
    /** Swing points the broken line must have had on it. Two draw a line; a third confirms it. */
    minTouches: number;
  };
  /** A double top or double bottom, on the candle that completes it. */
  pattern: {
    on: boolean;
    strength: number;
    lookback: number;
    /** How far apart the two tops (or bottoms) may be, in percent of their price. */
    tolerance: number;
    /** Least height of the pattern, in average ranges (ATR 14). */
    minHeight: number;
  };
  /** Volume as confirmation. It never fires a signal on its own. */
  volume: {
    on: boolean;
    length: number;
    /** `above`: the signal candle trades more than `mult` times the average of the candles before it. `obv`: On Balance Volume is on the trade's side of its own average. */
    mode: 'above' | 'obv';
    mult: number;
  };
  trend: { mode: TrendMode; length: number };
  stop: {
    /** `candles`: extreme of this candle and the previous one. `swing`: extreme of the last N candles. `atr`: a multiple of the average range away from the close. */
    kind: 'candles' | 'swing' | 'atr';
    lookback: number;
    atrLength: number;
    atrMult: number;
  };
  target: {
    /** `basis`: the middle Bollinger band. `rr`: a fixed multiple of the risk. `level`: the next swing level ahead. `fib`: the end of the swing being retraced. `pattern`: the measured objective of the double top or bottom. */
    kind: 'basis' | 'rr' | 'level' | 'fib' | 'pattern';
    rr: number;
  };
}

/** The default is the Bollinger + RSI reversal, identical to `makeBbRsiRule` with default parameters. */
export const DEFAULT_STRATEGY: StrategyConfig = {
  bollinger: { on: true, length: 20, mult: 2, mode: 'reversal' },
  rsi: { on: true, length: 14, overbought: 70, oversold: 30, mode: 'extreme' },
  macd: { on: false, fast: 12, slow: 26, signal: 9, mode: 'cross', zero: false },
  ma: { on: false, type: 'sma', fast: 20, slow: 50, mode: 'cross' },
  sr: { on: false, strength: 5, lookback: 150, tolerance: 0.1, mode: 'bounce', minTests: 1 },
  fib: { on: false, strength: 8, lookback: 200, tolerance: 0.1 },
  stoch: { on: false, length: 14, smooth: 3, signal: 3, overbought: 80, oversold: 20, mode: 'cross' },
  div: { on: false, osc: 'rsi', strength: 5, lookback: 60, zone: true },
  tl: { on: false, strength: 5, lookback: 150, minTouches: 2 },
  pattern: { on: false, strength: 5, lookback: 80, tolerance: 0.4, minHeight: 2 },
  volume: { on: false, length: 20, mode: 'above', mult: 1.5 },
  trend: { mode: 'off', length: 200 },
  stop: { kind: 'candles', lookback: 10, atrLength: 14, atrMult: 1.5 },
  target: { kind: 'basis', rr: 3 },
};

const int = (v: unknown, fallback: number, min = 2) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.round(v)) : fallback);
const pos = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const level = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : fallback);

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

/**
 * Fill missing fields with defaults and keep every number inside what the
 * indicators can compute. Used for settings read from storage and for values
 * typed in the interface.
 */
export function normalizeStrategy(input: DeepPartial<StrategyConfig> = {}): StrategyConfig {
  const d = DEFAULT_STRATEGY;
  const { bollinger: b = {}, rsi: r = {}, macd: m = {}, ma = {}, sr = {}, fib = {}, stoch: so = {}, div: dv = {}, tl = {}, pattern: pt = {}, volume: vo = {}, trend: t = {}, stop: st = {}, target: tg = {} } = input;
  const maFast = int(ma.fast, d.ma.fast);
  const macdFast = int(m.fast, d.macd.fast);
  return {
    bollinger: { on: b.on ?? d.bollinger.on, length: int(b.length, d.bollinger.length), mult: pos(b.mult, d.bollinger.mult), mode: pick(b.mode, ['reversal', 'touch'], d.bollinger.mode) },
    rsi: { on: r.on ?? d.rsi.on, length: int(r.length, d.rsi.length), overbought: level(r.overbought, d.rsi.overbought), oversold: level(r.oversold, d.rsi.oversold), mode: pick(r.mode, ['extreme', 'now', 'exit'], d.rsi.mode) },
    // The slow average must be slower than the fast one, or the block would compare an average with itself.
    macd: { on: m.on ?? d.macd.on, fast: macdFast, slow: Math.max(macdFast + 1, int(m.slow, d.macd.slow)), signal: int(m.signal, d.macd.signal), mode: pick(m.mode, ['cross', 'side'], d.macd.mode), zero: m.zero ?? d.macd.zero },
    ma: { on: ma.on ?? d.ma.on, type: pick(ma.type, ['sma', 'ema'], d.ma.type), fast: maFast, slow: Math.max(maFast + 1, int(ma.slow, d.ma.slow)), mode: pick(ma.mode, ['cross', 'price'], d.ma.mode) },
    sr: { on: sr.on ?? d.sr.on, strength: int(sr.strength, d.sr.strength, 1), lookback: int(sr.lookback, d.sr.lookback, 10), tolerance: typeof sr.tolerance === 'number' && sr.tolerance >= 0 && sr.tolerance < 50 ? sr.tolerance : d.sr.tolerance, mode: pick(sr.mode, ['bounce', 'break'], d.sr.mode), minTests: Math.min(5, int(sr.minTests, d.sr.minTests, 1)) },
    fib: { on: fib.on ?? d.fib.on, strength: int(fib.strength, d.fib.strength, 1), lookback: int(fib.lookback, d.fib.lookback, 10), tolerance: typeof fib.tolerance === 'number' && fib.tolerance >= 0 && fib.tolerance < 50 ? fib.tolerance : d.fib.tolerance },
    stoch: { on: so.on ?? d.stoch.on, length: int(so.length, d.stoch.length), smooth: int(so.smooth, d.stoch.smooth, 1), signal: int(so.signal, d.stoch.signal, 1), overbought: level(so.overbought, d.stoch.overbought), oversold: level(so.oversold, d.stoch.oversold), mode: pick(so.mode, ['cross', 'zone'], d.stoch.mode) },
    div: { on: dv.on ?? d.div.on, osc: pick(dv.osc, ['rsi', 'macd', 'stoch'], d.div.osc), strength: int(dv.strength, d.div.strength, 1), lookback: int(dv.lookback, d.div.lookback, 5), zone: dv.zone ?? d.div.zone },
    tl: { on: tl.on ?? d.tl.on, strength: int(tl.strength, d.tl.strength, 1), lookback: int(tl.lookback, d.tl.lookback, 10), minTouches: Math.min(5, int(tl.minTouches, d.tl.minTouches, 2)) },
    pattern: { on: pt.on ?? d.pattern.on, strength: int(pt.strength, d.pattern.strength, 1), lookback: int(pt.lookback, d.pattern.lookback, 10), tolerance: typeof pt.tolerance === 'number' && pt.tolerance > 0 && pt.tolerance < 20 ? pt.tolerance : d.pattern.tolerance, minHeight: typeof pt.minHeight === 'number' && pt.minHeight >= 0 ? pt.minHeight : d.pattern.minHeight },
    volume: { on: vo.on ?? d.volume.on, length: int(vo.length, d.volume.length), mode: pick(vo.mode, ['above', 'obv'], d.volume.mode), mult: pos(vo.mult, d.volume.mult) },
    trend: { mode: pick(t.mode, ['off', 'same', 'higher'], d.trend.mode), length: int(t.length, d.trend.length) },
    stop: { kind: pick(st.kind, ['candles', 'swing', 'atr'], d.stop.kind), lookback: int(st.lookback, d.stop.lookback), atrLength: int(st.atrLength, d.stop.atrLength), atrMult: pos(st.atrMult, d.stop.atrMult) },
    target: { kind: pick(tg.kind, ['basis', 'rr', 'level', 'fib', 'pattern'], d.target.kind), rr: pos(tg.rr, d.target.rr) },
  };
}

/**
 * How many blocks that can fire a signal are on. With none, the rule never signals: volume only confirms,
 * and its condition is the same for a buy and for a sell.
 */
export const activeBlocks = (s: StrategyConfig) => [s.bollinger.on, s.rsi.on, s.macd.on, s.ma.on, s.sr.on, s.fib.on, s.stoch.on, s.div.on, s.tl.on, s.pattern.on].filter(Boolean).length;

/**
 * `confirmOnly` builds the rule even when only confirmation blocks are on. Such a rule is not for trading: it
 * is used to count on how many candles a confirmation holds by itself.
 */
export function makeStrategyRule(s: StrategyConfig, trendTimeframe?: string, confirmOnly = false): Rule {
  const indicators: Record<string, IndicatorSpec> = {};
  const short: Condition[] = [];
  const long: Condition[] = [];

  if (s.bollinger.on || s.target.kind === 'basis') {
    indicators.bb = { type: 'bollinger', source: 'close', length: s.bollinger.length, mult: s.bollinger.mult };
  }
  if (s.bollinger.on) {
    if (s.bollinger.mode === 'reversal') {
      short.push({ gte: ['high[1]', 'bb.upper[1]'], label: 'cond.touchUpper' }, { lt: ['close', 'bb.upper'], label: 'cond.closeBelowUpper' }, { gt: ['close', 'bb.lower'], label: 'cond.closeAboveLower' });
      long.push({ lte: ['low[1]', 'bb.lower[1]'], label: 'cond.touchLower' }, { lt: ['close', 'bb.upper'], label: 'cond.closeBelowUpper' }, { gt: ['close', 'bb.lower'], label: 'cond.closeAboveLower' });
    } else {
      short.push({ gte: ['high', 'bb.upper'], label: 'cond.atUpper' });
      long.push({ lte: ['low', 'bb.lower'], label: 'cond.atLower' });
    }
  }

  // A divergence is read on an oscillator, so that oscillator is computed (and drawn) even when its own block is off.
  if (s.rsi.on || (s.div.on && s.div.osc === 'rsi')) indicators.rsi = { type: 'rsi', source: 'close', length: s.rsi.length };
  if (s.macd.on || (s.div.on && s.div.osc === 'macd')) indicators.macd = { type: 'macd', source: 'close', length: s.macd.slow, fast: s.macd.fast, slow: s.macd.slow, signal: s.macd.signal };
  if (s.stoch.on || (s.div.on && s.div.osc === 'stoch')) indicators.stoch = { type: 'stoch', length: s.stoch.length, smooth: s.stoch.smooth, signal: s.stoch.signal };

  if (s.rsi.on) {
    if (s.rsi.mode === 'extreme') {
      short.push({ gt: ['rsi[1]', s.rsi.overbought], label: 'cond.rsiOverbought' });
      long.push({ lt: ['rsi[1]', s.rsi.oversold], label: 'cond.rsiOversold' });
    } else if (s.rsi.mode === 'now') {
      short.push({ gt: ['rsi', s.rsi.overbought], label: 'cond.rsiOverboughtNow' });
      long.push({ lt: ['rsi', s.rsi.oversold], label: 'cond.rsiOversoldNow' });
    } else {
      short.push({ crossesBelow: ['rsi', s.rsi.overbought], label: 'cond.rsiExitOverbought' });
      long.push({ crossesAbove: ['rsi', s.rsi.oversold], label: 'cond.rsiExitOversold' });
    }
  }

  if (s.macd.on) {
    if (s.macd.mode === 'cross') {
      short.push({ crossesBelow: ['macd.macd', 'macd.signal'], label: 'cond.macdCrossDown' });
      long.push({ crossesAbove: ['macd.macd', 'macd.signal'], label: 'cond.macdCrossUp' });
    } else {
      short.push({ lt: ['macd.macd', 'macd.signal'], label: 'cond.macdBelowSignal' });
      long.push({ gt: ['macd.macd', 'macd.signal'], label: 'cond.macdAboveSignal' });
    }
    if (s.macd.zero) {
      short.push({ lt: ['macd.macd', 0], label: 'cond.macdBelowZero' });
      long.push({ gt: ['macd.macd', 0], label: 'cond.macdAboveZero' });
    }
  }

  if (s.ma.on) {
    indicators.maSlow = { type: s.ma.type, source: 'close', length: s.ma.slow };
    if (s.ma.mode === 'cross') {
      indicators.maFast = { type: s.ma.type, source: 'close', length: s.ma.fast };
      short.push({ crossesBelow: ['maFast', 'maSlow'], label: 'cond.maCrossDown' });
      long.push({ crossesAbove: ['maFast', 'maSlow'], label: 'cond.maCrossUp' });
    } else {
      short.push({ lt: ['close', 'maSlow'], label: 'cond.priceBelowMa' });
      long.push({ gt: ['close', 'maSlow'], label: 'cond.priceAboveMa' });
    }
  }

  if (s.sr.on || s.target.kind === 'level') {
    indicators.sr = { type: 'levels', length: s.sr.strength, lookback: s.sr.lookback };
  }
  if (s.sr.on) {
    const tol = s.sr.tolerance / 100;
    if (s.sr.mode === 'bounce') {
      short.push({ gte: ['high', { mul: ['sr.resistance', 1 - tol] }], label: 'cond.srReachRes' }, { lt: ['close', 'sr.resistance'], label: 'cond.srRejectRes' });
      long.push({ lte: ['low', { mul: ['sr.support', 1 + tol] }], label: 'cond.srReachSup' }, { gt: ['close', 'sr.support'], label: 'cond.srRejectSup' });
    } else {
      // The level is the one in force on the previous candle: once the close is through it, it has already changed role.
      short.push({ gte: ['close[1]', 'sr.support[1]'], label: 'cond.srWasAboveSup' }, { lt: ['close', 'sr.support[1]'], label: 'cond.srBreakSup' });
      long.push({ lte: ['close[1]', 'sr.resistance[1]'], label: 'cond.srWasBelowRes' }, { gt: ['close', 'sr.resistance[1]'], label: 'cond.srBreakRes' });
    }
    if (s.sr.minTests > 1) {
      // A bounce is judged on the level in force now; a break on the level that was in force before the close went through it.
      const at = s.sr.mode === 'bounce' ? '' : '[1]';
      const [down, up] = s.sr.mode === 'bounce' ? ['resistance', 'support'] : ['support', 'resistance'];
      short.push({ gte: [`sr.${down}Tests${at}`, s.sr.minTests], label: 'cond.srTested' });
      long.push({ gte: [`sr.${up}Tests${at}`, s.sr.minTests], label: 'cond.srTested' });
    }
  }

  if (s.fib.on || s.target.kind === 'fib') {
    indicators.fib = { type: 'fib', length: s.fib.strength, lookback: s.fib.lookback };
  }
  if (s.fib.on) {
    const tol = s.fib.tolerance / 100;
    // A pullback is traded in the direction of the swing it retraces: buy the dip of an up leg, sell the rally of a down leg.
    short.push({ lt: ['fib.dir', 0], label: 'cond.fibDown' }, { gte: ['high', { mul: ['fib.resistance', 1 - tol] }], label: 'cond.fibReachRes' }, { lt: ['close', 'fib.resistance'], label: 'cond.fibHoldRes' });
    long.push({ gt: ['fib.dir', 0], label: 'cond.fibUp' }, { lte: ['low', { mul: ['fib.support', 1 + tol] }], label: 'cond.fibReachSup' }, { gt: ['close', 'fib.support'], label: 'cond.fibHoldSup' });
  }

  if (s.stoch.on) {
    if (s.stoch.mode === 'cross') {
      short.push({ gt: ['stoch.d[1]', s.stoch.overbought], label: 'cond.stochOverbought' }, { crossesBelow: ['stoch.k', 'stoch.d'], label: 'cond.stochCrossDown' });
      long.push({ lt: ['stoch.d[1]', s.stoch.oversold], label: 'cond.stochOversold' }, { crossesAbove: ['stoch.k', 'stoch.d'], label: 'cond.stochCrossUp' });
    } else {
      short.push({ gt: ['stoch.d', s.stoch.overbought], label: 'cond.stochOverboughtNow' });
      long.push({ lt: ['stoch.d', s.stoch.oversold], label: 'cond.stochOversoldNow' });
    }
  }

  if (s.div.on) {
    const zone = s.div.osc === 'rsi' ? { upper: s.rsi.overbought, lower: s.rsi.oversold } : s.div.osc === 'stoch' ? { upper: s.stoch.overbought, lower: s.stoch.oversold } : { upper: 0, lower: 0 };
    const lengths = s.div.osc === 'macd' ? { fast: s.macd.fast, slow: s.macd.slow, signal: s.macd.signal } : s.div.osc === 'stoch' ? { oscLength: s.stoch.length, smooth: s.stoch.smooth, signal: s.stoch.signal } : { oscLength: s.rsi.length };
    indicators.div = { type: 'divergence', length: s.div.strength, lookback: s.div.lookback, osc: s.div.osc, ...lengths, ...(s.div.zone ? zone : {}) };
    short.push({ gt: ['div.bear', 0], label: 'cond.divBear' });
    long.push({ gt: ['div.bull', 0], label: 'cond.divBull' });
  }

  if (s.tl.on) {
    indicators.tl = { type: 'trendlines', length: s.tl.strength, lookback: s.tl.lookback };
    short.push({ gte: ['tl.upBreak', s.tl.minTouches], label: 'cond.tlBreakUp' });
    long.push({ gte: ['tl.downBreak', s.tl.minTouches], label: 'cond.tlBreakDown' });
  }

  if (s.pattern.on || s.target.kind === 'pattern') {
    indicators.pat = { type: 'doubles', length: s.pattern.strength, lookback: s.pattern.lookback, tolerance: s.pattern.tolerance, minHeight: s.pattern.minHeight };
  }
  if (s.pattern.on) {
    short.push({ gt: ['pat.top', 0], label: 'cond.doubleTop' });
    long.push({ gt: ['pat.bottom', 0], label: 'cond.doubleBottom' });
  }

  if (s.volume.on) {
    if (s.volume.mode === 'above') {
      // Against the average of the candles before this one, so a burst of volume is not diluted by itself.
      indicators.vol = { type: 'volume', length: s.volume.length };
      const more: Condition = { gt: ['volume', { mul: ['vol.avg[1]', s.volume.mult] }], label: 'cond.volAbove' };
      short.push(more);
      long.push(more);
    } else {
      indicators.obv = { type: 'obv', length: s.volume.length };
      short.push({ lt: ['obv.value', 'obv.avg'], label: 'cond.obvDown' });
      long.push({ gt: ['obv.value', 'obv.avg'], label: 'cond.obvUp' });
    }
  }

  if (s.trend.mode !== 'off') {
    indicators.trend = { type: 'sma', source: 'close', length: s.trend.length, ...(s.trend.mode === 'higher' && trendTimeframe ? { timeframe: trendTimeframe } : {}) };
    short.push({ lt: ['close', 'trend'], label: 'cond.trendDown' });
    long.push({ gt: ['close', 'trend'], label: 'cond.trendUp' });
  }

  let stopShort: ValueExpr;
  let stopLong: ValueExpr;
  if (s.stop.kind === 'swing') {
    indicators.swingHigh = { type: 'highest', source: 'high', length: s.stop.lookback };
    indicators.swingLow = { type: 'lowest', source: 'low', length: s.stop.lookback };
    stopShort = 'swingHigh';
    stopLong = 'swingLow';
  } else if (s.stop.kind === 'atr') {
    indicators.atr = { type: 'atr', length: s.stop.atrLength };
    stopShort = { add: ['close', { mul: [s.stop.atrMult, 'atr'] }] };
    stopLong = { sub: ['close', { mul: [s.stop.atrMult, 'atr'] }] };
  } else {
    stopShort = { max: ['high', 'high[1]'] };
    stopLong = { min: ['low', 'low[1]'] };
  }

  // A fixed reward-to-risk target sits `rr` times the stop distance away, on the other side of the close.
  const targetShort: ValueExpr = s.target.kind === 'basis' ? 'bb.basis' : s.target.kind === 'level' ? 'sr.support' : s.target.kind === 'fib' ? 'fib.end' : s.target.kind === 'pattern' ? 'pat.objective' : { sub: ['close', { mul: [s.target.rr, { sub: [stopShort, 'close'] }] }] };
  const targetLong: ValueExpr = s.target.kind === 'basis' ? 'bb.basis' : s.target.kind === 'level' ? 'sr.resistance' : s.target.kind === 'fib' ? 'fib.end' : s.target.kind === 'pattern' ? 'pat.objective' : { add: ['close', { mul: [s.target.rr, { sub: ['close', stopLong] }] }] };

  const hasEntry = activeBlocks(s) > 0 || (confirmOnly && CONFIRM_BLOCKS.some((id) => s[id].on));
  return {
    id: 'strategy',
    name: 'Strategy',
    indicators,
    signals: hasEntry
      ? {
          short: { when: { all: short }, stop: stopShort, target: targetShort },
          long: { when: { all: long }, stop: stopLong, target: targetLong },
        }
      : {},
  };
}

/**
 * What a rule looks for. Blocks of one kind agree with each other; mixing kinds
 * usually leaves no signals, so the ready-made combinations stay inside one.
 * - `reversal`: a turn at an extreme (band, overbought, support or resistance).
 * - `pullback`: a retracement inside a move, bought or sold in the move's direction.
 * - `momentum`: a move already under way (MACD or moving-average crossing).
 * - `breakout`: a close through support or resistance.
 */
export const STRATEGY_KINDS = ['reversal', 'pullback', 'momentum', 'breakout'] as const;
export type StrategyKind = (typeof STRATEGY_KINDS)[number];

export function classifyStrategy(s: StrategyConfig): StrategyKind {
  if ((s.sr.on && s.sr.mode === 'break') || s.tl.on) return 'breakout';
  if (s.pattern.on) return 'reversal';
  if (s.fib.on) return 'pullback';
  if (s.div.on) return 'reversal';
  // An oscillator turning from its extreme area, taken only in the direction of the trend, is a pullback entry.
  if (s.stoch.on && s.trend.mode !== 'off' && !s.bollinger.on && !s.sr.on) return 'pullback';
  if (s.stoch.on && !s.macd.on && !s.ma.on) return 'reversal';
  if ((s.macd.on && s.macd.mode === 'cross') || (s.ma.on && s.ma.mode === 'cross')) return 'momentum';
  if (s.bollinger.on || s.rsi.on || s.sr.on || s.stoch.on) return 'reversal';
  return s.macd.on || s.ma.on ? 'momentum' : 'reversal';
}

const off = { bollinger: { on: false }, rsi: { on: false } };

/** Ready-made combinations, one trigger each plus confirmations of the same kind. Names live in the i18n table under `preset.<id>`. */
export const BUILTIN_STRATEGIES: { id: string; kind: StrategyKind; strategy: StrategyConfig; timeoutBars: number }[] = [
  { id: 'bbRsi', kind: 'reversal', strategy: DEFAULT_STRATEGY, timeoutBars: 20 },
  { id: 'bbRsiTrend', kind: 'reversal', strategy: normalizeStrategy({ trend: { mode: 'higher', length: 200 } }), timeoutBars: 20 },
  {
    id: 'srBounce',
    kind: 'reversal',
    strategy: normalizeStrategy({ bollinger: { on: false }, rsi: { on: true, mode: 'now', overbought: 60, oversold: 40 }, sr: { on: true, mode: 'bounce' }, stop: { kind: 'atr', atrMult: 1.5 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'doubleTop',
    kind: 'reversal',
    strategy: normalizeStrategy({ ...off, pattern: { on: true }, stop: { kind: 'atr', atrMult: 2 }, target: { kind: 'pattern' } }),
    timeoutBars: 60,
  },
  {
    id: 'divRsi',
    kind: 'reversal',
    strategy: normalizeStrategy({ ...off, div: { on: true, osc: 'rsi', zone: true }, stop: { kind: 'swing', lookback: 10 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'divMacd',
    kind: 'reversal',
    strategy: normalizeStrategy({ ...off, div: { on: true, osc: 'macd', zone: true }, macd: { on: true, mode: 'side' }, stop: { kind: 'swing', lookback: 10 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'stochTrend',
    kind: 'pullback',
    strategy: normalizeStrategy({ ...off, stoch: { on: true, mode: 'cross' }, trend: { mode: 'higher', length: 200 }, stop: { kind: 'atr', atrMult: 1.5 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'fibMa',
    kind: 'pullback',
    strategy: normalizeStrategy({ ...off, fib: { on: true }, ma: { on: true, mode: 'price', slow: 50 }, stop: { kind: 'atr', atrMult: 1.5 }, target: { kind: 'fib' } }),
    timeoutBars: 40,
  },
  {
    id: 'fibTrend',
    kind: 'pullback',
    strategy: normalizeStrategy({ ...off, fib: { on: true }, trend: { mode: 'higher', length: 200 }, stop: { kind: 'atr', atrMult: 1.5 }, target: { kind: 'fib' } }),
    timeoutBars: 40,
  },
  {
    id: 'macdTrend',
    kind: 'momentum',
    strategy: normalizeStrategy({ ...off, macd: { on: true, mode: 'cross' }, ma: { on: true, mode: 'price', slow: 50 }, stop: { kind: 'swing', lookback: 10 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'maCross',
    kind: 'momentum',
    strategy: normalizeStrategy({ ...off, ma: { on: true, mode: 'cross', type: 'ema', fast: 20, slow: 50 }, macd: { on: true, mode: 'side' }, stop: { kind: 'atr', atrMult: 2 }, target: { kind: 'rr', rr: 3 } }),
    timeoutBars: 60,
  },
  {
    id: 'macdObv',
    kind: 'momentum',
    strategy: normalizeStrategy({ ...off, macd: { on: true, mode: 'cross' }, volume: { on: true, mode: 'obv', length: 20 }, stop: { kind: 'swing', lookback: 10 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'srBreakVol',
    kind: 'breakout',
    strategy: normalizeStrategy({ ...off, sr: { on: true, mode: 'break' }, volume: { on: true, mode: 'above', length: 20, mult: 1.5 }, stop: { kind: 'atr', atrMult: 1.5 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'tlBreak',
    kind: 'breakout',
    strategy: normalizeStrategy({ ...off, tl: { on: true, minTouches: 3 }, stop: { kind: 'atr', atrMult: 1.5 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'tlBreakMacd',
    kind: 'breakout',
    strategy: normalizeStrategy({ ...off, tl: { on: true, minTouches: 2 }, macd: { on: true, mode: 'side' }, stop: { kind: 'atr', atrMult: 1.5 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'srBreakMacd',
    kind: 'breakout',
    strategy: normalizeStrategy({ ...off, sr: { on: true, mode: 'break' }, macd: { on: true, mode: 'side' }, stop: { kind: 'atr', atrMult: 1.5 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'srBreakBoth',
    kind: 'breakout',
    strategy: normalizeStrategy({ ...off, sr: { on: true, mode: 'break' }, macd: { on: true, mode: 'side' }, ma: { on: true, mode: 'price', slow: 50 }, stop: { kind: 'atr', atrMult: 1.5 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
  {
    id: 'srBreakMa',
    kind: 'breakout',
    strategy: normalizeStrategy({ ...off, sr: { on: true, mode: 'break' }, ma: { on: true, mode: 'price', slow: 50 }, stop: { kind: 'atr', atrMult: 1.5 }, target: { kind: 'rr', rr: 2 } }),
    timeoutBars: 40,
  },
];

export const ENTRY_BLOCKS = ['bollinger', 'rsi', 'stoch', 'macd', 'ma', 'sr', 'tl', 'fib', 'div', 'pattern', 'volume'] as const;
export type EntryBlock = (typeof ENTRY_BLOCKS)[number];
/** Blocks that only confirm: they narrow the signals of the others and never fire one. */
export const CONFIRM_BLOCKS: readonly EntryBlock[] = ['volume'];

/**
 * Blocks whose condition is an event: true on one candle and gone on the next
 * (a crossing, a touch of a band or level). Two events rarely fall on the same
 * candle, so a rule works best with one event as the trigger and the other
 * blocks describing a state that lasts.
 */
export function eventBlocks(s: StrategyConfig): EntryBlock[] {
  const out: EntryBlock[] = [];
  if (s.bollinger.on) out.push('bollinger');
  if (s.rsi.on && s.rsi.mode === 'exit') out.push('rsi');
  if (s.macd.on && s.macd.mode === 'cross') out.push('macd');
  if (s.ma.on && s.ma.mode === 'cross') out.push('ma');
  if (s.sr.on) out.push('sr');
  if (s.fib.on) out.push('fib');
  if (s.stoch.on && s.stoch.mode === 'cross') out.push('stoch');
  if (s.div.on) out.push('div');
  if (s.tl.on) out.push('tl');
  if (s.pattern.on) out.push('pattern');
  return out;
}

/**
 * The same strategy with a single entry block left on and no trend filter, one
 * per active block. Scanning each shows how often that block is satisfied on
 * its own, which explains a combination that never signals.
 */
export function soloStrategies(s: StrategyConfig): { id: EntryBlock; strategy: StrategyConfig }[] {
  return ENTRY_BLOCKS.filter((id) => s[id].on).map((id) => {
    const solo: StrategyConfig = { ...s, trend: { ...s.trend, mode: 'off' } };
    for (const other of ENTRY_BLOCKS) if (other !== id) (solo[other] as { on: boolean }) = { ...solo[other], on: false };
    return { id, strategy: solo };
  });
}

/**
 * True when the rule mixes blocks that pull in opposite directions. Bollinger
 * and an RSI extreme look for a turn against the move (sell after a rise),
 * while MACD and moving averages ask for the move to be already in the trade's
 * favour (sell when momentum is down). On the candle where the first kind
 * fires, the second kind almost always says the opposite.
 */
export function mixesReversalAndMomentum(s: StrategyConfig): boolean {
  const reversal = s.bollinger.on || (s.rsi.on && s.rsi.mode !== 'exit') || s.stoch.on;
  return reversal && (s.macd.on || s.ma.on);
}
