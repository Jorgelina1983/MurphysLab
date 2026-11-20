import { describe, expect, it } from 'vitest';
import { backtest, type Trade } from '../src/core/backtest';
import { breakdowns, MIN_GROUP, widestGap } from '../src/core/breakdown';
import { withFunding } from '../src/core/funding';
import { buildContext, compileRule, scanSignals } from '../src/core/rule/engine';
import { BUILTIN_STRATEGIES, makeStrategyRule, type StrategyConfig } from '../src/core/rules/strategy';
import { sweep, sweepParams, sweepSummary, sweepValues, SWEEP_PARAMS, type SweepCell } from '../src/core/sweep';
import { parseFundingHistory } from '../src/feed/okxContext';
import { real15 } from './real';

const opts = { feeEntry: 0.0005, feeExit: 0.0005, slippage: 0, timeoutBars: 40 };
const run = (s: StrategyConfig) => {
  const rule = makeStrategyRule(s);
  return backtest(real15, scanSignals(compileRule(rule), buildContext(rule, real15)), opts);
};
const preset = (id: string) => BUILTIN_STRATEGIES.find((b) => b.id === id)!.strategy;

describe('results by condition', () => {
  const { trades } = run(preset('srBreakMa'));
  const list = breakdowns(trades, real15);

  it('puts every trade in exactly one group of each split it can be read on', () => {
    for (const b of list) {
      const n = b.buckets.reduce((sum, x) => sum + x.trades, 0);
      expect(n).toBeLessThanOrEqual(trades.length);
      // Side, exit and session are always known; the others need the averages to be formed.
      if (['side', 'exit', 'session'].includes(b.id)) expect([b.id, n]).toEqual([b.id, trades.length]);
    }
    const total = trades.reduce((sum, t) => sum + t.netR, 0);
    expect(list.find((b) => b.id === 'side')!.buckets.reduce((sum, x) => sum + x.totalNetR, 0)).toBeCloseTo(total);
  });
  it('reads the trend, the session and the volume from the signal candle only', () => {
    const one = (t: Partial<Trade>) => breakdowns([{ ...trades[0], ...t } as Trade], real15);
    const i = 400;
    const avg = real15.slice(i - 199, i + 1).reduce((s, c) => s + c.close, 0) / 200;
    const signal = { ...trades[0].signal, index: i, time: real15[i].time, reference: real15[i].close };
    const withTrend = real15[i].close > avg ? 'long' : 'short';
    expect(one({ signal, side: withTrend }).find((b) => b.id === 'trend')!.buckets.map((x) => x.trades)).toEqual([1, 0]);
    expect(one({ signal, side: withTrend === 'long' ? 'short' : 'long' }).find((b) => b.id === 'trend')!.buckets.map((x) => x.trades)).toEqual([0, 1]);
    const hour = new Date(real15[i].time).getUTCHours();
    expect(one({ signal }).find((b) => b.id === 'session')!.buckets.find((x) => x.trades === 1)!.id).toBe(hour < 8 ? 'asia' : hour < 16 ? 'europe' : 'america');
    const before = real15.slice(i - 20, i).reduce((s, c) => s + c.volume, 0) / 20;
    expect(one({ signal }).find((b) => b.id === 'volume')!.buckets.find((x) => x.trades === 1)!.id).toBe(real15[i].volume > before ? 'above' : 'below');
  });
  it('names the widest gap only between groups with enough trades, and never by how the trade ended', () => {
    const gap = widestGap(list);
    expect(gap).not.toBeNull();
    expect(gap!.id).not.toBe('exit');
    expect(gap!.best.trades).toBeGreaterThanOrEqual(MIN_GROUP);
    expect(gap!.worst.trades).toBeGreaterThanOrEqual(MIN_GROUP);
    expect(gap!.best.avgNetR).toBeGreaterThanOrEqual(gap!.worst.avgNetR);
    expect(widestGap(breakdowns(trades.slice(0, 5), real15))).toBeNull();
  });
});

describe('funding cost', () => {
  const base = { side: 'long', entryTime: 1000, exitTime: 5000, entryPrice: 100, risk: 2, netPnl: 3, netR: 1.5, grossPnl: 3.1, fees: 0.1, grossR: 1.55 } as Trade;
  const events = [{ time: 500, rate: 0.01 }, { time: 2000, rate: 0.001 }, { time: 5000, rate: 0.002 }, { time: 6000, rate: 0.5 }];

  it('charges a long every funding time it is open through, and pays a short the same amount', () => {
    const long = withFunding([base], events);
    expect(long.trades[0].funding).toBeCloseTo(0.3); // (0.001 + 0.002) × 100
    expect(long.trades[0].netPnl).toBeCloseTo(2.7);
    expect(long.trades[0].netR).toBeCloseTo(1.35);
    expect(long).toMatchObject({ crossed: 1, unknown: 0, since: 500 });
    expect(long.totalR).toBeCloseTo(0.15);
    expect(long.metrics.totalNetR).toBeCloseTo(1.35);
    const short = withFunding([{ ...base, side: 'short' }], events);
    expect(short.trades[0].funding).toBeCloseTo(-0.3);
    expect(short.trades[0].netR).toBeCloseTo(1.65);
  });
  it('leaves alone a trade that crosses no funding time, and one older than the data', () => {
    const quick = withFunding([{ ...base, entryTime: 2000, exitTime: 4000 }], events);
    expect(quick.trades[0]).toMatchObject({ funding: 0, netR: 1.5 });
    expect(quick.crossed).toBe(0);
    const old = withFunding([{ ...base, entryTime: 100 }], events);
    expect(old.trades[0]).toMatchObject({ funding: null, netR: 1.5 });
    expect(old.unknown).toBe(1);
    expect(withFunding([base], [])).toMatchObject({ unknown: 1, since: null });
  });
  it("reads OKX's funding history", () => {
    const body = { code: '0', data: [{ fundingRate: '0.0000614882963635', realizedRate: '0.0000614882963635', fundingTime: '1794844800000' }, { fundingRate: '-0.0000004970281698', fundingTime: '1794729600000' }, { fundingRate: 'x', fundingTime: '1' }] };
    expect(parseFundingHistory(body)).toEqual([{ time: 1794729600000, rate: -0.0000004970281698 }, { time: 1794844800000, rate: 0.0000614882963635 }]);
    expect(parseFundingHistory({ code: '1' })).toEqual([]);
  });
});

describe('parameter map', () => {
  it('offers only the parameters of what the rule uses', () => {
    expect(sweepParams(preset('bbRsi')).map((p) => p.id)).toEqual(['bollinger.length', 'bollinger.mult', 'rsi.length', 'rsi.band']);
    expect(sweepParams(preset('srBreakVol')).map((p) => p.id)).toEqual(['sr.strength', 'sr.lookback', 'volume.mult', 'volume.length', 'stop.atrMult', 'target.rr']);
    expect(sweepParams(preset('divRsi')).map((p) => p.id)).toContain('rsi.length');
  });
  it('changes only its own field, and keeps the current value in the grid', () => {
    const s = preset('bbRsi');
    const band = SWEEP_PARAMS.find((p) => p.id === 'rsi.band')!;
    expect(band.get(s)).toBe(20);
    expect(band.set(s, 25).rsi).toMatchObject({ overbought: 75, oversold: 25, length: 14 });
    expect(band.set(s, 25).bollinger).toEqual(s.bollinger);
    const odd = { ...s, bollinger: { ...s.bollinger, length: 18 } };
    expect(sweepValues(SWEEP_PARAMS[0], odd)).toEqual([10, 15, 18, 20, 25, 30]);
  });
  it('runs every pair, marks the current one, and reproduces the plain backtest there', () => {
    const s = preset('bbRsi');
    const [px, py] = [SWEEP_PARAMS.find((p) => p.id === 'bollinger.length')!, SWEEP_PARAMS.find((p) => p.id === 'rsi.band')!];
    const calls: StrategyConfig[] = [];
    const map = sweep(s, px, py, (cfg) => {
      calls.push(cfg);
      const m = run(cfg).metrics;
      return { trades: m.trades, avgNetR: m.avgNetR, totalNetR: m.totalNetR };
    });
    expect(calls).toHaveLength(25);
    expect(map.rows).toHaveLength(map.ys.length);
    const current = map.rows.flat().filter((c) => c.current);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ x: 20, y: 20, trades: run(s).metrics.trades });
    expect(current[0].avgNetR).toBeCloseTo(run(s).metrics.avgNetR);
  });
  it('summarises how the current cell compares with its neighbours', () => {
    const cell = (x: number, y: number, avgNetR: number, trades = 20, current = false): SweepCell => ({ x, y, avgNetR, trades, totalNetR: avgNetR * trades, current });
    const rows = [
      [cell(1, 1, -0.2), cell(2, 1, -0.1), cell(3, 1, 0.3)],
      [cell(1, 2, -0.3), cell(2, 2, 0.4, 20, true), cell(3, 2, -0.5, 3)],
      [cell(1, 3, -0.1), cell(2, 3, 0.1), cell(3, 3, -0.2)],
    ];
    const sum = sweepSummary(rows, 10);
    expect(sum).toMatchObject({ cells: 9, measured: 8, positive: 3, neighbours: 7, sameSign: 2 });
    expect(sum.current?.avgNetR).toBe(0.4);
    expect([sum.neighbourMin, sum.neighbourMax]).toEqual([-0.3, 0.3]);
  });
});
