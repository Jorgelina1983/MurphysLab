import { INDICATORS, computeIndicators, type ComputeOptions } from '../indicators';
import type { Candle, IndicatorOutputs, Side } from '../types';
import {
  COMPARISONS,
  type Comparison,
  type Condition,
  type ConditionResult,
  type Rule,
  type SideEvaluation,
  type Signal,
  type ValueExpr,
} from './types';

export interface Context {
  candles: Candle[];
  series: Record<string, IndicatorOutputs>;
}

type ValueFn = (ctx: Context, i: number) => number | null;

type Compiled =
  | { kind: 'cmp'; op: Comparison; left: ValueFn; right: ValueFn; text: string; label?: string }
  | { kind: 'all' | 'any'; items: Compiled[] }
  | { kind: 'not'; item: Compiled };

interface CompiledSignal {
  when: Compiled;
  stop: ValueFn;
  target: ValueFn;
}

export interface CompiledRule {
  rule: Rule;
  signals: Partial<Record<Side, CompiledSignal>>;
}

const CANDLE_FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const;
type CandleField = (typeof CANDLE_FIELDS)[number];
const OPERAND = /^([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?(?:\[(\d+)\])?$/;
const SYMBOL: Record<Comparison, string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  crossesAbove: 'crosses above',
  crossesBelow: 'crosses below',
};

function compileOperand(op: number | string, rule: Rule): ValueFn {
  if (typeof op === 'number') return () => op;
  const m = OPERAND.exec(op.trim());
  if (!m) throw new Error(`Cannot read operand "${op}"`);
  const [, name, output, back] = m;
  const offset = back ? Number(back) : 0;
  if (!output && (CANDLE_FIELDS as readonly string[]).includes(name)) {
    const field = name as CandleField;
    return (ctx, i) => ctx.candles[i - offset]?.[field] ?? null;
  }
  const spec = rule.indicators[name];
  if (!spec) throw new Error(`Operand "${op}" names "${name}", which is not a candle field or a declared indicator`);
  const key = output ?? INDICATORS[spec.type]?.defaultOutput;
  if (!key) throw new Error(`Unknown indicator type "${spec.type}"`);
  return (ctx, i) => {
    const s = ctx.series[name]?.[key];
    if (!s) throw new Error(`Indicator "${name}" has no output "${key}"`);
    return i - offset >= 0 ? (s[i - offset] ?? null) : null;
  };
}

const ARITHMETIC = {
  add: (a: number, b: number) => a + b,
  sub: (a: number, b: number) => a - b,
  mul: (a: number, b: number) => a * b,
} as const;
const ARITHMETIC_SYMBOL = { add: '+', sub: '-', mul: '*' } as const;

function arithmeticOf(expr: Exclude<ValueExpr, number | string>): { op: keyof typeof ARITHMETIC; pair: [ValueExpr, ValueExpr] } | null {
  if ('add' in expr) return { op: 'add', pair: expr.add };
  if ('sub' in expr) return { op: 'sub', pair: expr.sub };
  if ('mul' in expr) return { op: 'mul', pair: expr.mul };
  return null;
}

function compileValue(expr: ValueExpr, rule: Rule): ValueFn {
  if (typeof expr === 'number' || typeof expr === 'string') return compileOperand(expr, rule);
  const arithmetic = arithmeticOf(expr);
  if (arithmetic) {
    const fn = ARITHMETIC[arithmetic.op];
    const left = compileValue(arithmetic.pair[0], rule);
    const right = compileValue(arithmetic.pair[1], rule);
    return (ctx, i) => {
      const a = left(ctx, i);
      const b = right(ctx, i);
      return a === null || b === null ? null : fn(a, b);
    };
  }
  const list = 'max' in expr ? expr.max : 'min' in expr ? expr.min : [];
  const isMax = 'max' in expr;
  const parts = list.map((e) => compileValue(e, rule));
  if (parts.length === 0) throw new Error('max/min needs at least one value');
  return (ctx, i) => {
    const vals = parts.map((p) => p(ctx, i));
    if (vals.some((v) => v === null)) return null;
    return isMax ? Math.max(...(vals as number[])) : Math.min(...(vals as number[]));
  };
}

function valueText(expr: ValueExpr): string {
  if (typeof expr === 'number' || typeof expr === 'string') return String(expr);
  const arithmetic = arithmeticOf(expr);
  if (arithmetic) return `(${valueText(arithmetic.pair[0])} ${ARITHMETIC_SYMBOL[arithmetic.op]} ${valueText(arithmetic.pair[1])})`;
  if ('max' in expr) return `max(${expr.max.map(valueText).join(', ')})`;
  return 'min' in expr ? `min(${expr.min.map(valueText).join(', ')})` : '';
}

function compileCondition(cond: Condition, rule: Rule): Compiled {
  if ('all' in cond) return { kind: 'all', items: cond.all.map((c) => compileCondition(c, rule)) };
  if ('any' in cond) return { kind: 'any', items: cond.any.map((c) => compileCondition(c, rule)) };
  if ('not' in cond) return { kind: 'not', item: compileCondition(cond.not, rule) };
  const ops = COMPARISONS.filter((k) => cond[k] !== undefined);
  if (ops.length !== 1) throw new Error(`A condition needs exactly one comparison, got: ${JSON.stringify(cond)}`);
  const op = ops[0];
  const pair = cond[op];
  if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`"${op}" needs two operands`);
  return {
    kind: 'cmp',
    op,
    left: compileValue(pair[0], rule),
    right: compileValue(pair[1], rule),
    text: `${valueText(pair[0])} ${SYMBOL[op]} ${valueText(pair[1])}`,
    label: cond.label,
  };
}

/** Validate a rule and turn it into evaluators. Nothing is ever passed to `eval`. */
export function compileRule(rule: Rule): CompiledRule {
  for (const [id, spec] of Object.entries(rule.indicators)) {
    if (!INDICATORS[spec.type]) throw new Error(`Indicator "${id}" has unknown type "${spec.type}"`);
    if (!Number.isInteger(spec.length) || spec.length < 1) throw new Error(`Indicator "${id}" needs a positive whole length`);
  }
  const signals: CompiledRule['signals'] = {};
  for (const side of ['short', 'long'] as const) {
    const spec = rule.signals[side];
    if (!spec) continue;
    signals[side] = {
      when: compileCondition(spec.when, rule),
      stop: compileValue(spec.stop, rule),
      target: compileValue(spec.target, rule),
    };
  }
  return { rule, signals };
}

function compare(op: Comparison, a: number, b: number, prevA: number | null, prevB: number | null): boolean {
  switch (op) {
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    case 'crossesAbove':
      return prevA !== null && prevB !== null && prevA <= prevB && a > b;
    case 'crossesBelow':
      return prevA !== null && prevB !== null && prevA >= prevB && a < b;
  }
}

function run(node: Compiled, ctx: Context, i: number, out: ConditionResult[]): boolean {
  if (node.kind === 'not') return !run(node.item, ctx, i, out);
  if (node.kind !== 'cmp') {
    // Evaluate every item (no short-circuit) so the checklist shows each condition.
    const passes = node.items.map((n) => run(n, ctx, i, out));
    return node.kind === 'all' ? passes.every(Boolean) : passes.some(Boolean);
  }
  const left = node.left(ctx, i);
  const right = node.right(ctx, i);
  const crossing = (node.op === 'crossesAbove' || node.op === 'crossesBelow') && i > 0;
  const pass = left !== null && right !== null && compare(node.op, left, right, crossing ? node.left(ctx, i - 1) : null, crossing ? node.right(ctx, i - 1) : null);
  out.push({ label: node.label, text: node.text, left, right, pass });
  return pass;
}

/** Evaluate both sides of a rule on candle `i`, keeping every condition's result. */
export function evaluateAt(compiled: CompiledRule, ctx: Context, i: number): Partial<Record<Side, SideEvaluation>> {
  const result: Partial<Record<Side, SideEvaluation>> = {};
  for (const side of ['short', 'long'] as const) {
    const sig = compiled.signals[side];
    if (!sig) continue;
    const conditions: ConditionResult[] = [];
    const fired = run(sig.when, ctx, i, conditions);
    result[side] = { fired, conditions, stop: sig.stop(ctx, i), target: sig.target(ctx, i) };
  }
  return result;
}

/** `options` carries the higher-timeframe candles for indicators that declare a `timeframe`. */
export function buildContext(rule: Rule, candles: Candle[], options: ComputeOptions = {}): Context {
  return { candles, series: computeIndicators(candles, rule.indicators, options) };
}

/** Every signal over a range of candles. Candles that are still forming never signal. */
export function scanSignals(compiled: CompiledRule, ctx: Context, from = 0, to = ctx.candles.length): Signal[] {
  const out: Signal[] = [];
  for (let i = Math.max(from, 0); i < Math.min(to, ctx.candles.length); i++) {
    const candle = ctx.candles[i];
    if (!candle.closed) continue;
    const evals = evaluateAt(compiled, ctx, i);
    for (const side of ['short', 'long'] as const) {
      const e = evals[side];
      if (!e?.fired || e.stop === null || e.target === null) continue;
      out.push({ index: i, time: candle.time, side, reference: candle.close, stop: e.stop, target: e.target, conditions: e.conditions });
    }
  }
  return out;
}
