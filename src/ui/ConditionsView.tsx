import { useMemo } from 'react';
import type { Trade } from '../core/backtest';
import { breakdowns, MIN_GROUP, widestGap } from '../core/breakdown';
import type { Candle } from '../core/types';
import { fmtPct, fmtR, t } from '../i18n';

/**
 * Backtest, conditions view: the same trades split by side, trend, volatility, time of day and volume, to see
 * where the rule earns and where it loses. Groups with few trades are shown dimmed: they say nothing yet.
 */
export function ConditionsView({ trades, candles }: { trades: Trade[]; candles: Candle[] }) {
  const list = useMemo(() => breakdowns(trades, candles), [trades, candles]);
  const gap = useMemo(() => widestGap(list), [list]);
  const scale = Math.max(0.01, ...list.flatMap((b) => b.buckets.filter((x) => x.trades > 0).map((x) => Math.abs(x.avgNetR))));
  return (
    <div className="conditions" data-view="conditions">
      <p className="lead">
        {gap
          ? t('cond2.lead', { split: t(`cond2.${gap.id}`), best: t(`cond2.${gap.id}.${gap.best.id}`), bestR: fmtR(gap.best.avgNetR), worst: t(`cond2.${gap.id}.${gap.worst.id}`), worstR: fmtR(gap.worst.avgNetR) })
          : t('cond2.leadNone', { n: MIN_GROUP })}{' '}
        {gap && t('cond2.leadCaveat')}
      </p>
      <p className="muted small">{t('cond2.how', { n: MIN_GROUP })}</p>
      <div className="groups">
        {list.map((b) => (
          <div key={b.id} className="table-wrap static" data-split={b.id}>
            <table>
              <thead>
                <tr>
                  <th title={t(`cond2.${b.id}.about`)}>{t(`cond2.${b.id}`)}</th>
                  <th>{t('cond2.n')}</th>
                  <th>{t('cond2.win')}</th>
                  <th colSpan={2}>{t('cond2.avg')}</th>
                </tr>
              </thead>
              <tbody>
                {b.buckets.map((x) => (
                  <tr key={x.id} className={x.trades < MIN_GROUP ? 'few' : ''} title={x.trades < MIN_GROUP ? t('cond2.few', { n: MIN_GROUP }) : undefined}>
                    <td>{t(`cond2.${b.id}.${x.id}`)}</td>
                    <td>{x.trades}</td>
                    <td>{x.trades ? fmtPct(x.winRate, 0) : '–'}</td>
                    <td className={x.trades === 0 ? '' : x.avgNetR > 0 ? 'good' : 'bad'}>{x.trades ? fmtR(x.avgNetR) : '–'}</td>
                    <td className="bar-cell">
                      {x.trades > 0 && <span className={x.avgNetR > 0 ? 'bar pos' : 'bar neg'} style={{ width: `${Math.round((Math.abs(x.avgNetR) / scale) * 50)}%` }} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
