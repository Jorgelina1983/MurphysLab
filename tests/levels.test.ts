import { describe, expect, it } from 'vitest';
import fixture from './fixtures/okx-btc-usdt-swap-5m.json';
import { fibRetracements, levelMap, swingLevels, swingPoints } from '../src/core/levels';
import { buildContext, compileRule, scanSignals } from '../src/core/rule/engine';
import { relate } from '../src/core/rules/relations';
import { BUILTIN_STRATEGIES, DEFAULT_STRATEGY, classifyStrategy, eventBlocks, makeStrategyRule, mixesReversalAndMomentum, normalizeStrategy, soloStrategies, type StrategyConfig } from '../src/core/rules/strategy';
import type { Candle } from '../src/core/types';
import { candles } from './helpers';

const real: Candle[] = fixture.d.split(';').map((row, i) => {
  const [open, high, low, close] = row.split(',').map((v) => Number(v) / 10);
  return { time: fixture.first + i * fixture.step, open, high, low, close, volume: 0, closed: true };
});
const only = (sr: Partial<StrategyConfig['sr']>, rest: Partial<StrategyConfig> = {}): StrategyConfig =>
  normalizeStrategy({ bollinger: { on: false }, rsi: { on: false }, sr: { on: true, ...sr }, target: { kind: 'rr', rr: 2 }, ...rest });
const scan = (s: StrategyConfig) => {
  const rule = makeStrategyRule(s);
  return scanSignals(compileRule(rule), buildContext(rule, real));
};

// open, high, low, close: a peak of 15 at candle 2 and a trough of 8 at candle 5.
const shape = candles([[10, 11, 9, 10], [10, 12, 10, 12], [12, 15, 11, 13], [13, 14, 10, 11], [11, 12, 9, 10], [10, 11, 8, 9], [9, 12, 9, 11], [11, 13, 10, 12], [12, 14, 11, 13.5]]);

describe('swing points', () => {
  it('finds reaction highs and lows and says when each is confirmed', () => {
    expect(swingPoints(shape, 2)).toEqual([
      { index: 2, kind: 'high', price: 15, confirmedAt: 4 },
      { index: 5, kind: 'low', price: 8, confirmedAt: 7 },
    ]);
  });

  it('gives each candle the nearest confirmed level on each side of its close', () => {
    const { support, resistance } = swingLevels(shape, 2, 100);
    expect(resistance).toEqual([null, null, null, null, 15, 15, 15, 15, 15]);
    // The low of 8 forms at candle 5 but is only known two candles later.
    expect(support).toEqual([null, null, null, null, null, null, null, 8, 8]);
  });

  it('reverses the role of a broken level and forgets old pivots', () => {
    const broken = [...shape, ...candles([[13.5, 17, 13, 16]])];
    const all = swingLevels(broken, 2, 100);
    expect(all.resistance[9]).toBeNull();
    expect(all.support[9]).toBe(15); // the old peak, now below the close, is support
    expect(swingLevels(broken, 2, 5).support[9]).toBe(8); // candle 2 is more than 5 candles back
  });

  it('never uses candles that come later', () => {
    const full = swingLevels(real, 3, 60);
    for (const cut of [40, 90, 133, 170]) {
      const part = swingLevels(real.slice(0, cut), 3, 60);
      expect(part.support[cut - 1]).toBe(full.support[cut - 1]);
      expect(part.resistance[cut - 1]).toBe(full.resistance[cut - 1]);
    }
  });
});

describe('support and resistance block', () => {
  it('signals a bounce when the candle reaches the level and closes back on its side', () => {
    const cfg = only({ mode: 'bounce', strength: 3, lookback: 60, tolerance: 0.1 });
    const lv = swingLevels(real, 3, 60);
    const signals = scan(cfg);
    expect(signals.length).toBeGreaterThan(2);
    for (const s of signals) {
      const c = real[s.index];
      if (s.side === 'long') {
        expect(c.low).toBeLessThanOrEqual((lv.support[s.index] as number) * 1.001);
        expect(c.close).toBeGreaterThan(lv.support[s.index] as number);
      } else {
        expect(c.high).toBeGreaterThanOrEqual((lv.resistance[s.index] as number) * 0.999);
        expect(c.close).toBeLessThan(lv.resistance[s.index] as number);
      }
    }
  });

  it('signals a break only on the candle whose close goes through the level', () => {
    const lv = swingLevels(real, 3, 60);
    const expected: [number, string][] = [];
    for (let i = 1; i < real.length; i++) {
      const [r, s] = [lv.resistance[i - 1], lv.support[i - 1]];
      if (s !== null && real[i - 1].close >= s && real[i].close < s) expected.push([i, 'short']);
      if (r !== null && real[i - 1].close <= r && real[i].close > r) expected.push([i, 'long']);
    }
    const signals = scan(only({ mode: 'break', strength: 3, lookback: 60 }));
    expect(signals.map((s) => [s.index, s.side])).toEqual(expected);
    expect(signals.length).toBeGreaterThan(2);
  });

  it('can aim at the next level ahead', () => {
    const lv = swingLevels(real, 3, 60);
    const signals = scan(only({ mode: 'bounce', strength: 3, lookback: 60 }, { target: { kind: 'level', rr: 3 } }));
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) expect(s.target).toBe(s.side === 'long' ? lv.resistance[s.index] : lv.support[s.index]);
  });

  it('ships ready-made combinations that are valid and distinct', () => {
    expect(BUILTIN_STRATEGIES[0].strategy).toEqual(DEFAULT_STRATEGY);
    const seen = new Set(BUILTIN_STRATEGIES.map((b) => JSON.stringify(b.strategy)));
    expect(seen.size).toBe(BUILTIN_STRATEGIES.length);
    for (const b of BUILTIN_STRATEGIES) {
      expect(normalizeStrategy(b.strategy)).toEqual(b.strategy);
      expect(() => scan(b.strategy)).not.toThrow();
    }
  });
});

describe('why a combination does not signal', () => {
  const combo = normalizeStrategy({ macd: { on: true, mode: 'cross' } }); // Bollinger + RSI + MACD cross

  it('counts each block on its own: every signal of the combination is also a signal of each block', () => {
    const solos = soloStrategies(combo);
    expect(solos.map((x) => x.id)).toEqual(['bollinger', 'rsi', 'macd']);
    const together = scan(combo).length;
    for (const solo of solos) {
      expect(solo.strategy.trend.mode).toBe('off');
      expect(scan(solo.strategy).length).toBeGreaterThan(together);
    }
    expect(together).toBe(0); // a band reversal and a MACD crossing never share a candle in this sample
  });

  it('names the blocks that are single-candle events', () => {
    expect(eventBlocks(DEFAULT_STRATEGY)).toEqual(['bollinger']);
    expect(eventBlocks(combo)).toEqual(['bollinger', 'macd']);
    expect(eventBlocks(normalizeStrategy({ macd: { on: true, mode: 'side' } }))).toEqual(['bollinger']);
  });

  it('flags a reversal block combined with a momentum block, even in state mode', () => {
    const state = normalizeStrategy({ macd: { on: true, mode: 'side' } });
    expect(mixesReversalAndMomentum(state)).toBe(true);
    expect(scan(state)).toHaveLength(0); // each block fires often on its own, never together
    expect(mixesReversalAndMomentum(DEFAULT_STRATEGY)).toBe(false);
    expect(mixesReversalAndMomentum(normalizeStrategy({ bollinger: { on: false }, rsi: { on: false }, macd: { on: true }, ma: { on: true } }))).toBe(false);
  });
});

describe('Fibonacci retracements', () => {
  // A low of 8 at candle 2, then a high of 18 at candle 5: an up leg of 10 points.
  const leg = candles([[10, 11, 9.5, 10], [10, 10.5, 9, 9.5], [9.5, 10, 8, 9], [9, 13, 9, 12.5], [12.5, 16, 12, 15.5], [15.5, 18, 15, 17], [17, 17.5, 15.5, 16], [16, 16.5, 14, 14.5], [14.5, 15, 12.8, 13.5], [13.5, 14, 11.5, 11.6]]);

  it('places 38.2, 50 and 61.8% of the latest swing, once its end is confirmed', () => {
    const f = fibRetracements(leg, 2, 100);
    expect(f.dir.slice(0, 7)).toEqual([null, null, null, null, null, null, null]); // the high at candle 5 is known at candle 7
    expect(f.dir[7]).toBe(1);
    expect([f.start[7], f.end[7]]).toEqual([8, 18]);
    expect([f.startAt[7], f.endAt[7]]).toEqual([2, 5]);
    expect(f.r382[7]).toBeCloseTo(14.18, 10);
    expect(f.r500[7]).toBeCloseTo(13, 10);
    expect(f.r618[7]).toBeCloseTo(11.82, 10);
  });

  it('gives the nearest level under the close as support, and none once the pullback is too deep', () => {
    const f = fibRetracements(leg, 2, 100);
    expect(f.support[7]).toBeCloseTo(14.18, 10); // close 14.5
    expect(f.support[8]).toBeCloseTo(13, 10); // close 13.5 is under the 38.2% level
    expect(f.support[9]).toBeNull(); // close 11.6 is under the 61.8% level
    expect(f.resistance[8]).toBeNull(); // resistance only exists after a down leg
  });

  it('never uses candles that come later', () => {
    const full = fibRetracements(real, 3, 80);
    for (const cut of [50, 97, 140, 171]) {
      const part = fibRetracements(real.slice(0, cut), 3, 80);
      for (const key of ['r382', 'r618', 'dir', 'support', 'resistance']) expect(part[key][cut - 1]).toBe(full[key][cut - 1]);
    }
  });

  it('signals a pullback that reaches a level and holds, in the direction of the swing', () => {
    const cfg = normalizeStrategy({ bollinger: { on: false }, rsi: { on: false }, fib: { on: true, strength: 3, lookback: 80, tolerance: 0.1 }, target: { kind: 'fib' } });
    const f = fibRetracements(real, 3, 80);
    const signals = scan(cfg);
    expect(signals.length).toBeGreaterThan(1);
    for (const s of signals) {
      const c = real[s.index];
      expect(f.dir[s.index]).toBe(s.side === 'long' ? 1 : -1);
      expect(s.target).toBe(f.end[s.index]);
      if (s.side === 'long') {
        expect(c.low).toBeLessThanOrEqual((f.support[s.index] as number) * 1.001);
        expect(c.close).toBeGreaterThan(f.support[s.index] as number);
      } else {
        expect(c.high).toBeGreaterThanOrEqual((f.resistance[s.index] as number) * 0.999);
        expect(c.close).toBeLessThan(f.resistance[s.index] as number);
      }
    }
  });
});

describe('ready-made combinations', () => {
  it('each belongs to its kind, has a single trigger and does not mix reversal with momentum', () => {
    for (const b of BUILTIN_STRATEGIES) {
      expect(classifyStrategy(b.strategy), b.id).toBe(b.kind);
      expect(eventBlocks(b.strategy), b.id).toHaveLength(1);
      expect(mixesReversalAndMomentum(b.strategy), b.id).toBe(false);
    }
  });

  // Skipped here and covered in oscillators.test.ts: divergences (too rare for a 171-candle recording) and volume (the recording has none).
  it('each gives signals on the recorded candles (those with a higher-timeframe filter are skipped: no such data here)', () => {
    for (const b of BUILTIN_STRATEGIES.filter((x) => x.strategy.trend.mode === 'off' && !x.strategy.div.on && !x.strategy.volume.on)) expect(scan(b.strategy).length, b.id).toBeGreaterThan(0);
  });
});

describe('level map', () => {
  it('lists the levels on each side, nearest first, and counts repeated tests of one level', () => {
    // Highs near 110 three times (110, 110.1, 109.95) and one at 120; lows at 100 and 95.
    const cs = candles([
      [105, 106, 104, 105], [105, 110, 104.5, 106], [106, 107, 100, 103], [103, 110.1, 102, 106], [106, 107, 103, 104],
      [104, 120, 103.5, 108], [108, 109, 95, 104], [104, 109.95, 103, 106], [106, 107, 104, 105], [105, 106, 104.2, 105.5],
    ]);
    const map = levelMap(cs, 1, 100, 9, 0.2, 3);
    const res = map.filter((l) => l.side === 'resistance');
    const sup = map.filter((l) => l.side === 'support');
    expect(res.map((l) => [l.price, l.touches])).toEqual([[109.95, 3], [120, 1]]);
    expect(res[0].from).toBe(1); // the first of the three tests
    expect(sup.map((l) => l.price)).toEqual([100, 95]);
  });

  it('agrees with the rule: its nearest level on each side is the one swingLevels reports', () => {
    const lv = swingLevels(real, 3, 60);
    for (const at of [60, 100, 140, 170]) {
      const map = levelMap(real, 3, 60, at, 0.15, 3);
      expect(map.find((l) => l.side === 'resistance')?.price ?? null).toBe(lv.resistance[at]);
      expect(map.find((l) => l.side === 'support')?.price ?? null).toBe(lv.support[at]);
      expect(map.filter((l) => l.side === 'support').length).toBeLessThanOrEqual(3);
    }
  });
});

describe('levels tested more than once', () => {
  it('counts the tests of the nearest level the same way the chart does', () => {
    const lv = swingLevels(real, 3, 60);
    for (const at of [60, 100, 140, 170]) {
      const map = levelMap(real, 3, 60, at, 0.15, 3);
      expect(lv.resistanceTests[at]).toBe(map.find((l) => l.side === 'resistance')?.touches ?? null);
      expect(lv.supportTests[at]).toBe(map.find((l) => l.side === 'support')?.touches ?? null);
    }
  });

  it('keeps only the signals at levels with enough tests when the rule asks for it', () => {
    for (const mode of ['bounce', 'break'] as const) {
      const any = scan(only({ mode, strength: 3, lookback: 60 }));
      const tested = scan(only({ mode, strength: 3, lookback: 60, minTests: 2 }));
      const keys = new Set(any.map((s) => `${s.index}${s.side}`));
      expect(tested.length, mode).toBeLessThan(any.length);
      expect(tested.every((s) => keys.has(`${s.index}${s.side}`))).toBe(true);
      const lv = swingLevels(real, 3, 60);
      for (const s of tested) {
        const i = mode === 'bounce' ? s.index : s.index - 1;
        const tests = mode === 'bounce' ? (s.side === 'long' ? lv.supportTests[i] : lv.resistanceTests[i]) : s.side === 'long' ? lv.resistanceTests[i] : lv.supportTests[i];
        expect(tests).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('changes nothing at the default of one test', () => {
    expect(scan(only({ strength: 3, lookback: 60, minTests: 1 }))).toEqual(scan(only({ strength: 3, lookback: 60 })));
  });
});

describe('how indicators relate', () => {
  const pickOnly = (...ids: string[]) => normalizeStrategy(Object.fromEntries(['bollinger', 'rsi', 'macd', 'ma', 'sr', 'fib'].map((id) => [id, { on: ids.includes(id) }])));

  it('knows every pair, and judges a set by its worst pair', () => {
    expect(relate(pickOnly('bollinger', 'rsi')).overall).toBe('ok');
    expect(relate(pickOnly('bollinger', 'macd')).overall).toBe('conflict');
    expect(relate(pickOnly('sr', 'fib')).overall).toBe('rare');
    const three = relate(pickOnly('sr', 'rsi', 'macd'));
    expect(three.pairs).toHaveLength(3);
    expect(three.overall).toBe('conflict'); // RSI extreme against MACD
    expect(relate(pickOnly('bollinger', 'rsi', 'macd', 'ma', 'sr', 'fib')).pairs).toHaveLength(15);
    expect(relate(pickOnly()).overall).toBe('ok');
    expect(relate(pickOnly()).trigger).toBeNull();
  });

  it('arranges the chosen indicators with one trigger and the rest as lasting conditions', () => {
    const breakout = relate(pickOnly('sr', 'macd', 'ma'));
    expect(breakout.trigger).toBe('sr');
    expect([breakout.arranged.sr.mode, breakout.arranged.macd.mode, breakout.arranged.ma.mode]).toEqual(['break', 'side', 'price']);
    const momentum = relate(pickOnly('macd', 'ma'));
    expect([momentum.trigger, momentum.arranged.macd.mode, momentum.arranged.ma.mode]).toEqual(['macd', 'cross', 'price']);
    expect(relate(pickOnly('sr', 'rsi')).arranged.sr.mode).toBe('bounce');
    expect(relate(pickOnly('rsi')).arranged.rsi.mode).toBe('exit');
  });

  it('matches the facts: pairs judged ok give signals on the recorded candles, and a conflict removes nearly all of them', () => {
    // Bollinger alone signals 27 times here; asking the MACD to agree leaves 2.
    const alone = scan(pickOnly('bollinger')).length;
    const withMacd = scan(relate(pickOnly('bollinger', 'macd')).arranged).length;
    expect(alone).toBeGreaterThan(20);
    expect(withMacd).toBeLessThan(alone * 0.15);
    for (const ids of [['bollinger', 'rsi'], ['macd', 'ma'], ['sr', 'rsi'], ['sr', 'ma'], ['fib', 'ma']]) {
      const report = relate(pickOnly(...ids));
      expect(report.overall, ids.join('+')).toBe('ok');
      expect(scan(report.arranged).length, ids.join('+')).toBeGreaterThan(0);
    }
  });

  it('points to the ready-made combination that uses exactly those indicators', () => {
    expect(relate(pickOnly('bollinger', 'rsi')).preset).toBe('bbRsi');
    expect(relate(pickOnly('fib', 'ma')).preset).toBe('fibMa');
    expect(relate(pickOnly('bollinger', 'macd')).preset).toBeNull();
  });
});
