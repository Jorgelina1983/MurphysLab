import type { IndicatorSpec } from '../indicators';
import type { Side } from '../types';

/** A number, a candle field, or an indicator output. `[n]` means n candles back. */
export type Operand = number | string;

/** A value: an operand, the largest or smallest of several, or simple arithmetic on two. */
export type ValueExpr =
  | Operand
  | { max: ValueExpr[] }
  | { min: ValueExpr[] }
  | { add: [ValueExpr, ValueExpr] }
  | { sub: [ValueExpr, ValueExpr] }
  | { mul: [ValueExpr, ValueExpr] };

export const COMPARISONS = ['gt', 'gte', 'lt', 'lte', 'crossesAbove', 'crossesBelow'] as const;
export type Comparison = (typeof COMPARISONS)[number];

export type Condition =
  | ({ [K in Comparison]?: [ValueExpr, ValueExpr] } & { label?: string })
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export interface SignalSpec {
  when: Condition;
  /** Evaluated once, on the signal candle. */
  stop: ValueExpr;
  target: ValueExpr;
}

/** A rule as data. This is the JSON format described in the spec. */
export interface Rule {
  id: string;
  name: string;
  indicators: Record<string, IndicatorSpec>;
  signals: Partial<Record<Side, SignalSpec>>;
}

/** The outcome of one comparison on one candle, shown in the condition checklist. */
export interface ConditionResult {
  label?: string;
  /** The comparison as written in the rule, e.g. `rsi[1] > 70`. */
  text: string;
  left: number | null;
  right: number | null;
  pass: boolean;
}

export interface SideEvaluation {
  fired: boolean;
  conditions: ConditionResult[];
  stop: number | null;
  target: number | null;
}

export interface Signal {
  /** Index of the signal candle in the candle array. */
  index: number;
  time: number;
  side: Side;
  /** Close of the signal candle. */
  reference: number;
  stop: number;
  target: number;
  conditions: ConditionResult[];
}
