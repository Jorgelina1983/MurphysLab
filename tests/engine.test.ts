import { describe, expect, it } from 'vitest';
import { buildContext, compileRule, evaluateAt, scanSignals } from '../src/core/rule/engine';
import type { Rule } from '../src/core/rule/types';
import { candles } from './helpers';

const upBar: Rule = {
  id: 'up-bar',
  name: 'Close above open after a down bar',
  indicators: {},
  signals: {
    long: {
      when: { all: [{ gt: ['close', 'open'], label: 'up' }, { lt: ['close[1]', 'open[1]'], label: 'prevDown' }] },
      stop: { min: ['low', 'low[1]'] },
      target: { max: ['high', 'high[1]'] },
    },
  },
};

describe('rule engine', () => {
  it('fires only where every condition holds and reports each condition', () => {
    const cs = candles([
      [10, 11, 9, 10.5], // up
      [10.5, 10.6, 9.5, 9.8], // down
      [9.8, 10.9, 9.7, 10.4], // up after down -> signal
      [10.4, 11, 10.3, 10.8], // up after up -> no
    ]);
    const compiled = compileRule(upBar);
    const ctx = buildContext(upBar, cs);
    const signals = scanSignals(compiled, ctx);
    expect(signals.map((s) => s.index)).toEqual([2]);
    expect(signals[0].stop).toBe(9.5);
    expect(signals[0].target).toBe(10.9);

    const miss = evaluateAt(compiled, ctx, 3).long!;
    expect(miss.fired).toBe(false);
    expect(miss.conditions.map((c) => [c.label, c.pass])).toEqual([
      ['up', true],
      ['prevDown', false],
    ]);
    expect(miss.conditions[1].text).toBe('close[1] < open[1]');
  });

  it('treats missing history as a failed condition, not an error', () => {
    const cs = candles([[10, 11, 9, 10.5]]);
    const ctx = buildContext(upBar, cs);
    expect(evaluateAt(compileRule(upBar), ctx, 0).long!.fired).toBe(false);
  });

  it('never signals on a candle that is still forming', () => {
    const cs = candles([
      [10.5, 10.6, 9.5, 9.8],
      [9.8, 10.9, 9.7, 10.4],
    ]);
    cs[1].closed = false;
    expect(scanSignals(compileRule(upBar), buildContext(upBar, cs))).toEqual([]);
  });

  it('supports indicators, any/not and crossings', () => {
    const cross: Rule = {
      id: 'cross',
      name: 'Fast average crosses above slow',
      indicators: { fast: { type: 'sma', length: 2 }, slow: { type: 'sma', length: 3 } },
      signals: {
        long: {
          when: { all: [{ crossesAbove: ['fast', 'slow'] }, { not: { any: [{ lt: ['close', 0] }] } }] },
          stop: 'low',
          target: 'high',
        },
      },
    };
    // closes: 5,4,3,4,6 -> fast: -,4.5,3.5,3.5,5 ; slow: -,-,4,3.667,4.333 -> crosses at index 4
    const cs = candles([5, 4, 3, 4, 6].map((c) => [c, c + 1, c - 1, c]));
    const signals = scanSignals(compileRule(cross), buildContext(cross, cs));
    expect(signals.map((s) => s.index)).toEqual([4]);
  });

  it('rejects rules it cannot read', () => {
    const bad = (when: unknown): Rule => ({ id: 'x', name: 'x', indicators: {}, signals: { long: { when: when as never, stop: 'low', target: 'high' } } });
    expect(() => compileRule(bad({ gt: ['close', 'nope'] }))).toThrow(/not a candle field or a declared indicator/);
    expect(() => compileRule(bad({ gt: ['close', 1], lt: ['close', 2] }))).toThrow(/exactly one comparison/);
    expect(() => compileRule(bad({ gt: ['close + 1', 1] }))).toThrow(/Cannot read operand/);
    expect(() => compileRule({ id: 'x', name: 'x', indicators: { a: { type: 'magic', length: 3 } }, signals: {} })).toThrow(/unknown type/);
  });
});
