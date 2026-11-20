import { BUILTIN_STRATEGIES, DEFAULT_STRATEGY, ENTRY_BLOCKS, type EntryBlock, type StrategyConfig } from './strategy';

/**
 * How two indicators behave in the same rule:
 * - `ok`: they look for the same kind of situation and support each other;
 * - `rare`: they agree in idea, but both depend on a single candle (or a single
 *   price), so they seldom coincide;
 * - `conflict`: on the candle where one is satisfied the other usually says the opposite.
 */
export type Relation = 'ok' | 'rare' | 'conflict';

export interface PairRelation {
  a: EntryBlock;
  b: EntryBlock;
  relation: Relation;
  /** Key of the sentence that explains it, in the i18n table. */
  reason: string;
}

/** What each indicator looks for, in the words used for the kinds of rule. */
export const INDICATOR_FAMILY: Record<EntryBlock, 'reversal' | 'momentum' | 'level' | 'pullback' | 'volume'> = {
  bollinger: 'reversal',
  rsi: 'reversal',
  macd: 'momentum',
  ma: 'momentum',
  sr: 'level',
  fib: 'pullback',
  stoch: 'reversal',
  div: 'reversal',
  tl: 'level',
  pattern: 'reversal',
  volume: 'volume',
};

const key = (a: EntryBlock, b: EntryBlock) => [a, b].sort().join('+');
const PAIRS: Record<string, [Relation, string]> = {
  [key('bollinger', 'rsi')]: ['ok', 'rel.bbRsi'],
  [key('bollinger', 'macd')]: ['conflict', 'rel.reversalMomentum'],
  [key('bollinger', 'ma')]: ['conflict', 'rel.reversalMomentum'],
  [key('rsi', 'macd')]: ['conflict', 'rel.reversalMomentum'],
  [key('rsi', 'ma')]: ['conflict', 'rel.reversalMomentum'],
  [key('bollinger', 'sr')]: ['rare', 'rel.twoEvents'],
  [key('bollinger', 'fib')]: ['rare', 'rel.twoEvents'],
  [key('sr', 'fib')]: ['rare', 'rel.confluence'],
  [key('rsi', 'sr')]: ['ok', 'rel.levelRsi'],
  [key('rsi', 'fib')]: ['ok', 'rel.levelRsi'],
  [key('macd', 'ma')]: ['ok', 'rel.momentumPair'],
  [key('sr', 'macd')]: ['ok', 'rel.breakMomentum'],
  [key('sr', 'ma')]: ['ok', 'rel.breakMomentum'],
  [key('fib', 'ma')]: ['ok', 'rel.pullbackTrend'],
  [key('fib', 'macd')]: ['conflict', 'rel.pullbackMacd'],
  // Stochastics: an oscillator read at its extremes, like the RSI.
  [key('stoch', 'bollinger')]: ['ok', 'rel.bbStoch'],
  [key('stoch', 'rsi')]: ['ok', 'rel.twoOscillators'],
  [key('stoch', 'macd')]: ['conflict', 'rel.reversalMomentum'],
  [key('stoch', 'ma')]: ['conflict', 'rel.reversalMomentum'],
  [key('stoch', 'sr')]: ['ok', 'rel.levelRsi'],
  [key('stoch', 'fib')]: ['ok', 'rel.levelRsi'],
  // Divergence: a warning that appears on one candle, when its second swing point is confirmed.
  [key('div', 'bollinger')]: ['rare', 'rel.twoEvents'],
  [key('div', 'rsi')]: ['ok', 'rel.divOsc'],
  [key('div', 'stoch')]: ['ok', 'rel.divOsc'],
  [key('div', 'macd')]: ['ok', 'rel.divConfirm'],
  [key('div', 'ma')]: ['conflict', 'rel.divMa'],
  [key('div', 'sr')]: ['rare', 'rel.twoEvents'],
  [key('div', 'fib')]: ['rare', 'rel.twoEvents'],
  // A trendline break: an event at a line, read like the break of a level.
  [key('tl', 'macd')]: ['ok', 'rel.breakMomentum'],
  [key('tl', 'ma')]: ['ok', 'rel.breakMomentum'],
  [key('tl', 'rsi')]: ['conflict', 'rel.breakOsc'],
  [key('tl', 'stoch')]: ['conflict', 'rel.breakOsc'],
  [key('tl', 'fib')]: ['conflict', 'rel.tlFib'],
  ...Object.fromEntries((['bollinger', 'sr', 'div', 'pattern'] as const).map((id) => [key('tl', id), ['rare', 'rel.twoEvents'] as [Relation, string]])),
  // A double top or bottom: a reversal that is complete only when its middle point breaks.
  [key('pattern', 'macd')]: ['ok', 'rel.patMomentum'],
  [key('pattern', 'ma')]: ['rare', 'rel.patMa'],
  [key('pattern', 'rsi')]: ['conflict', 'rel.breakOsc'],
  [key('pattern', 'stoch')]: ['conflict', 'rel.breakOsc'],
  [key('pattern', 'fib')]: ['conflict', 'rel.tlFib'],
  ...Object.fromEntries((['bollinger', 'sr', 'div'] as const).map((id) => [key('pattern', id), ['rare', 'rel.twoEvents'] as [Relation, string]])),
  // Volume confirms whatever fires the signal.
  ...Object.fromEntries((['sr', 'tl', 'pattern'] as const).map((id) => [key('volume', id), ['ok', 'rel.volBreak'] as [Relation, string]])),
  ...Object.fromEntries((['bollinger', 'rsi', 'stoch', 'macd', 'ma', 'fib', 'div'] as const).map((id) => [key('volume', id), ['ok', 'rel.volConfirm'] as [Relation, string]])),
};
const ORDER: Relation[] = ['ok', 'rare', 'conflict'];
/** Which indicator fires the signal when several are chosen: the one tied to a price level first. */
const TRIGGER_PRIORITY: EntryBlock[] = ['pattern', 'tl', 'fib', 'sr', 'div', 'bollinger', 'macd', 'ma', 'stoch', 'rsi'];

export interface RelationReport {
  chosen: EntryBlock[];
  pairs: PairRelation[];
  /** The worst relation among the pairs; `ok` when fewer than two indicators are chosen. */
  overall: Relation;
  /** The indicator that would fire the signal; the others confirm. `null` when nothing is chosen, or only volume, which cannot fire one. */
  trigger: EntryBlock | null;
  /**
   * The chosen indicators arranged as a rule, with the modes that give them the
   * best chance to work together: one trigger, the rest as lasting conditions
   * where the indicator has such a mode. Used to count how often they all agree.
   */
  arranged: StrategyConfig;
  /** A ready-made combination that uses exactly these indicators, if there is one. */
  preset: string | null;
}

/** Describe how the indicators switched on in `config` relate to each other. */
export function relate(config: StrategyConfig): RelationReport {
  const chosen = ENTRY_BLOCKS.filter((id) => config[id].on);
  const has = (id: EntryBlock) => chosen.includes(id);
  const pairs: PairRelation[] = [];
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const [relation, reason] = PAIRS[key(chosen[i], chosen[j])];
      pairs.push({ a: chosen[i], b: chosen[j], relation, reason });
    }
  }
  const overall = pairs.reduce<Relation>((worst, p) => (ORDER.indexOf(p.relation) > ORDER.indexOf(worst) ? p.relation : worst), 'ok');
  const trigger = TRIGGER_PRIORITY.find(has) ?? null;
  const momentum = has('macd') || has('ma');
  const arranged: StrategyConfig = {
    ...config,
    bollinger: { ...config.bollinger, mode: 'reversal' },
    // Alone, the RSI needs an event of its own; with Bollinger it reads the candle that touched the band; otherwise the current one.
    rsi: { ...config.rsi, mode: trigger === 'rsi' ? 'exit' : has('bollinger') ? 'extreme' : 'now' },
    macd: { ...config.macd, mode: trigger === 'macd' ? 'cross' : 'side' },
    ma: { ...config.ma, mode: trigger === 'ma' ? 'cross' : 'price' },
    // With momentum and no reversal indicator, a level is traded on its break; otherwise on the bounce.
    sr: { ...config.sr, mode: momentum && !has('bollinger') && !has('rsi') && !has('stoch') ? 'break' : 'bounce' },
    stoch: { ...config.stoch, mode: trigger === 'stoch' ? 'cross' : 'zone' },
    // The divergence is read on an oscillator that is also chosen, when there is one.
    div: { ...config.div, osc: has('rsi') ? 'rsi' : has('stoch') ? 'stoch' : has('macd') ? 'macd' : config.div.osc },
    // A burst of volume backs an event at a price level; the direction of OBV backs a move already under way.
    volume: { ...config.volume, mode: momentum && !has('sr') && !has('tl') && !has('pattern') ? 'obv' : 'above' },
    trend: { ...DEFAULT_STRATEGY.trend, mode: 'off' },
    stop: { ...DEFAULT_STRATEGY.stop, kind: 'atr' },
    target: { kind: 'rr', rr: 2 },
  };
  const same = (s: StrategyConfig) => ENTRY_BLOCKS.every((id) => s[id].on === has(id));
  const preset = chosen.length > 0 ? (BUILTIN_STRATEGIES.find((b) => b.strategy.trend.mode === 'off' && same(b.strategy))?.id ?? null) : null;
  return { chosen, pairs, overall, trigger, arranged, preset };
}
