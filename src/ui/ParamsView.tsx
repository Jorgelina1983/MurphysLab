import { useEffect, useMemo, useState } from 'react';
import type { StrategyConfig } from '../core/rules/strategy';
import { sweep, sweepParams, sweepSummary, type SweepCell } from '../core/sweep';
import { fmtNum, fmtR, t } from '../i18n';

/** Cells with fewer trades than this are shown but not counted: their average means little. */
const MIN_TRADES = 5;
type Map = ReturnType<typeof sweep>;

/**
 * Backtest, parameters view: the rule run over a grid of two of its parameters, on the tuning part of the
 * history only. It answers one question: do the settings next to the current one give a similar result?
 */
export function ParamsView({ strategy, run, pct, resetKey, onApply }: { strategy: StrategyConfig; run: (cfg: StrategyConfig) => { trades: number; avgNetR: number; totalNetR: number }; pct: number; resetKey: string; onApply: (next: StrategyConfig) => void }) {
  const params = useMemo(() => sweepParams(strategy), [strategy]);
  const ids = params.map((p) => p.id).join(',');
  const [xId, setX] = useState('');
  const [yId, setY] = useState('');
  // Start with one parameter of the entry and, when there is one, one of the exit: the two halves of a rule.
  useEffect(() => {
    const exit = params.find((p) => p.id === 'target.rr' || p.id.startsWith('stop.'));
    const first = params.find((p) => p !== exit);
    setX(first?.id ?? '');
    setY((exit ?? params.find((p) => p !== first))?.id ?? '');
  }, [ids]);
  const [px, py] = [params.find((p) => p.id === xId), params.find((p) => p.id === yId)];
  const [map, setMap] = useState<Map | null>(null);
  // A map belongs to the rule and the candles it was computed with: any change makes it stale.
  useEffect(() => setMap(null), [JSON.stringify(strategy), xId, yId, resetKey]);
  const summary = useMemo(() => (map ? sweepSummary(map.rows, MIN_TRADES) : null), [map]);
  const scale = map ? Math.max(0.05, ...map.rows.flat().filter((c) => c.trades >= MIN_TRADES).map((c) => Math.abs(c.avgNetR))) : 1;
  const tint = (c: SweepCell) => (c.trades < MIN_TRADES ? 'transparent' : `color-mix(in srgb, var(${c.avgNetR > 0 ? '--good' : '--bad'}) ${Math.round(Math.min(1, Math.abs(c.avgNetR) / scale) * 55) + 8}%, transparent)`);
  const num = (v: number) => fmtNum(v, Number.isInteger(v) ? 0 : 1);

  if (params.length < 2) return <p className="muted" data-view="params">{t('sweep.tooFew')}</p>;
  return (
    <div className="params" data-view="params">
      {summary && summary.current ? (
        <p className={`lead ${summary.neighbours > 0 && summary.sameSign === summary.neighbours ? '' : 'warn'}`}>
          {summary.neighbours === 0
            ? t('sweep.leadAlone', { r: fmtR(summary.current.avgNetR) })
            : t(summary.sameSign === summary.neighbours ? 'sweep.leadStable' : summary.sameSign === 0 ? 'sweep.leadPeak' : 'sweep.leadMixed', { r: fmtR(summary.current.avgNetR), same: summary.sameSign, n: summary.neighbours, min: fmtR(summary.neighbourMin), max: fmtR(summary.neighbourMax) })}{' '}
          {t('sweep.leadShare', { pos: summary.positive, n: summary.measured })}
        </p>
      ) : (
        <p className="lead">{t('sweep.intro')}</p>
      )}
      <div className="sweep-controls">
        <label className="field inline">
          <span>{t('sweep.x')}</span>
          <select data-sweep="x" value={xId} onChange={(e) => setX(e.target.value)}>
            {params.filter((p) => p.id !== yId).map((p) => (
              <option key={p.id} value={p.id}>{t(`sweep.${p.id}`)}</option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>{t('sweep.y')}</span>
          <select data-sweep="y" value={yId} onChange={(e) => setY(e.target.value)}>
            {params.filter((p) => p.id !== xId).map((p) => (
              <option key={p.id} value={p.id}>{t(`sweep.${p.id}`)}</option>
            ))}
          </select>
        </label>
        <button className="primary" data-action="sweep-run" disabled={!px || !py} onClick={() => px && py && setMap(sweep(strategy, px, py, run))}>{t(map ? 'sweep.again' : 'sweep.run')}</button>
      </div>
      {map && px && py && (
        <div className="table-wrap static">
          <table className="heat">
            <thead>
              <tr>
                <th>{t(`sweep.${py.id}`)} ↓ · {t(`sweep.${px.id}`)} →</th>
                {map.xs.map((x) => (
                  <th key={x}>{num(x)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {map.rows.map((row, i) => (
                <tr key={map.ys[i]}>
                  <th>{num(map.ys[i])}</th>
                  {row.map((c) => (
                    <td key={c.x} className={`${c.current ? 'current' : ''} ${c.trades < MIN_TRADES ? 'few' : ''}`} style={{ background: tint(c) }} title={t('sweep.cell', { x: num(c.x), y: num(c.y), n: c.trades, total: fmtR(c.totalNetR) })}>
                      <button disabled={c.current} onClick={() => onApply(py.set(px.set(strategy, c.x), c.y))}>
                        <strong>{c.trades ? fmtR(c.avgNetR) : '–'}</strong>
                        <span>{c.trades}</span>
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{t('sweep.how', { pct, n: MIN_TRADES })}</p>
    </div>
  );
}
