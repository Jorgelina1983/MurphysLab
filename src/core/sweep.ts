import type { StrategyConfig } from './rules/strategy';

/**
 * A parameter map: the same rule run over a grid of two of its parameters, to
 * see whether the current setting sits on a plateau of similar results or on
 * a lone peak. A lone peak is usually luck, not an edge.
 */
export interface SweepParam {
  /** `<block>.<field>`; the label lives in the i18n table under `sweep.<id>`. */
  id: string;
  available: (s: StrategyConfig) => boolean;
  get: (s: StrategyConfig) => number;
  set: (s: StrategyConfig, v: number) => StrategyConfig;
  values: number[];
}

const field = <B extends keyof StrategyConfig>(block: B, key: keyof StrategyConfig[B] & string, values: number[], available: (s: StrategyConfig) => boolean): SweepParam => ({
  id: `${block}.${key}`,
  available,
  get: (s) => s[block][key] as number,
  set: (s, v) => ({ ...s, [block]: { ...s[block], [key]: v } }),
  values,
});

export const SWEEP_PARAMS: SweepParam[] = [
  field('bollinger', 'length', [10, 15, 20, 25, 30], (s) => s.bollinger.on),
  field('bollinger', 'mult', [1.5, 2, 2.5, 3], (s) => s.bollinger.on),
  field('rsi', 'length', [7, 10, 14, 21], (s) => s.rsi.on || (s.div.on && s.div.osc === 'rsi')),
  {
    // Both thresholds at once, as a distance from 50: 20 means 70 and 30.
    id: 'rsi.band',
    available: (s) => s.rsi.on,
    get: (s) => s.rsi.overbought - 50,
    set: (s, v) => ({ ...s, rsi: { ...s.rsi, overbought: 50 + v, oversold: 50 - v } }),
    values: [10, 15, 20, 25, 30],
  },
  field('stoch', 'length', [9, 14, 21], (s) => s.stoch.on || (s.div.on && s.div.osc === 'stoch')),
  field('macd', 'fast', [8, 12, 16], (s) => s.macd.on || (s.div.on && s.div.osc === 'macd')),
  field('macd', 'slow', [21, 26, 34, 42], (s) => s.macd.on || (s.div.on && s.div.osc === 'macd')),
  field('ma', 'fast', [10, 20, 30], (s) => s.ma.on && s.ma.mode === 'cross'),
  field('ma', 'slow', [50, 100, 150, 200], (s) => s.ma.on),
  field('sr', 'strength', [3, 5, 8, 12], (s) => s.sr.on),
  field('sr', 'lookback', [100, 150, 300], (s) => s.sr.on),
  field('tl', 'strength', [3, 5, 8], (s) => s.tl.on),
  field('tl', 'lookback', [100, 150, 300], (s) => s.tl.on),
  field('pattern', 'tolerance', [0.2, 0.4, 0.8], (s) => s.pattern.on),
  field('pattern', 'minHeight', [1, 2, 3], (s) => s.pattern.on),
  field('fib', 'strength', [5, 8, 12], (s) => s.fib.on),
  field('div', 'strength', [3, 5, 8], (s) => s.div.on),
  field('div', 'lookback', [30, 60, 120], (s) => s.div.on),
  field('volume', 'mult', [1.2, 1.5, 2, 3], (s) => s.volume.on && s.volume.mode === 'above'),
  field('volume', 'length', [10, 20, 50], (s) => s.volume.on),
  field('trend', 'length', [50, 100, 200], (s) => s.trend.mode !== 'off'),
  field('stop', 'atrMult', [1, 1.5, 2, 3], (s) => s.stop.kind === 'atr'),
  field('stop', 'lookback', [5, 10, 20], (s) => s.stop.kind === 'swing'),
  field('target', 'rr', [1, 1.5, 2, 3, 4], (s) => s.target.kind === 'rr'),
];

export const sweepParams = (s: StrategyConfig) => SWEEP_PARAMS.filter((p) => p.available(s));

/** The grid values of a parameter, with the rule's current value added when it is not one of them. */
export function sweepValues(p: SweepParam, s: StrategyConfig): number[] {
  return [...new Set([...p.values, p.get(s)])].sort((a, b) => a - b);
}

export interface SweepCell {
  x: number;
  y: number;
  trades: number;
  avgNetR: number;
  totalNetR: number;
  current: boolean;
}

/** Run `run` for every pair of values. Rows follow `y`, columns follow `x`. */
export function sweep(s: StrategyConfig, px: SweepParam, py: SweepParam, run: (cfg: StrategyConfig) => { trades: number; avgNetR: number; totalNetR: number }): { xs: number[]; ys: number[]; rows: SweepCell[][] } {
  const xs = sweepValues(px, s);
  const ys = sweepValues(py, s);
  const rows = ys.map((y) => xs.map((x) => ({ x, y, ...run(py.set(px.set(s, x), y)), current: x === px.get(s) && y === py.get(s) })));
  return { xs, ys, rows };
}

export interface SweepSummary {
  cells: number;
  /** Cells with at least `minTrades` trades, and how many of those end positive. */
  measured: number;
  positive: number;
  current: SweepCell | null;
  /** The measured cells next to the current one (up to eight), and how many share its sign. */
  neighbours: number;
  sameSign: number;
  neighbourMin: number;
  neighbourMax: number;
}

export function sweepSummary(rows: SweepCell[][], minTrades: number): SweepSummary {
  const all = rows.flat();
  const ok = (c: SweepCell) => c.trades >= minTrades;
  const measured = all.filter(ok);
  let current: SweepCell | null = null;
  const near: SweepCell[] = [];
  rows.forEach((row, i) =>
    row.forEach((cell, j) => {
      if (!cell.current) return;
      current = cell;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if ((di || dj) && rows[i + di]?.[j + dj] && ok(rows[i + di][j + dj])) near.push(rows[i + di][j + dj]);
    }),
  );
  const cur = current as SweepCell | null;
  return {
    cells: all.length,
    measured: measured.length,
    positive: measured.filter((c) => c.avgNetR > 0).length,
    current: cur,
    neighbours: near.length,
    sameSign: cur ? near.filter((c) => c.avgNetR > 0 === cur.avgNetR > 0).length : 0,
    neighbourMin: near.length ? Math.min(...near.map((c) => c.avgNetR)) : 0,
    neighbourMax: near.length ? Math.max(...near.map((c) => c.avgNetR)) : 0,
  };
}
