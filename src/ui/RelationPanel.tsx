import type { EntryBlock } from '../core/rules/strategy';
import { INDICATOR_FAMILY, type RelationReport } from '../core/rules/relations';
import { t } from '../i18n';
import { Panel } from './panels';

interface Props {
  report: RelationReport;
  /** Candles on which each chosen indicator is satisfied on its own, and on which all are at once. */
  counts: { solo: Partial<Record<EntryBlock, number>>; together: number; candles: number } | null;
  /** Load the ready-made combination made of exactly these indicators as the rule. */
  onUsePreset: (id: string) => void;
}

const TONE = { ok: 'good', rare: 'warn', conflict: 'bad' } as const;
const MARK = { ok: '✓', rare: '≈', conflict: '✗' } as const;

/**
 * Shown in place of the backtest while the Explorar tab is open: whether the
 * indicators on the chart can work together in one rule, pair by pair, with
 * the counts that back the verdict.
 */
export function RelationPanel({ report, counts, onUsePreset }: Props) {
  const { chosen, pairs, overall, trigger } = report;
  return (
    <Panel title={t('rel.title')}>
      {chosen.length === 0 && <p className="muted">{t('rel.none')}</p>}
      {chosen.length === 1 && <p className="muted">{t('rel.one')}</p>}
      {chosen.length > 0 && trigger === null && <p className="notice">{t('rel.confirmOnly')}</p>}
      {chosen.length >= 2 && <div className={`verdict ${TONE[overall]}`}>{t(`rel.overall.${overall}`)}</div>}

      {chosen.length > 0 && (
        <div className="table-wrap static">
          <table className="relation">
            <thead>
              <tr>
                <th>{t('rel.indicator')}</th>
                <th>{t('rel.family')}</th>
                <th>{t('rel.role')}</th>
                <th>{t('rel.alone')}</th>
              </tr>
            </thead>
            <tbody>
              {chosen.map((id) => (
                <tr key={id}>
                  <td>{t(`block.${id}`)}</td>
                  <td>{t(`rel.family.${INDICATOR_FAMILY[id]}`)}</td>
                  <td>{id === trigger ? t('rel.trigger') : t('rel.confirm')}</td>
                  <td>{counts?.solo[id] ?? '…'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {chosen.length >= 2 && counts && (
        <p>
          {t('rel.together', { n: counts.together, total: counts.candles })} {counts.together === 0 ? t('rel.togetherNone') : ''}
        </p>
      )}

      {pairs.length > 0 && (
        <ul className="pairs">
          {pairs.map((p) => (
            <li key={p.a + p.b} className={TONE[p.relation]} data-relation={p.relation}>
              <span className="mark">{MARK[p.relation]}</span>
              <span>
                <strong>{t(`block.${p.a}`)} + {t(`block.${p.b}`)}:</strong> {t(p.reason)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {report.preset && (
        <p className="actions left">
          <span>{t('rel.preset', { name: t(`preset.${report.preset}`) })}</span>
          <button className="primary" data-action="use-preset" onClick={() => onUsePreset(report.preset as string)}>{t('rel.usePreset')}</button>
        </p>
      )}
      {chosen.length >= 2 && !report.preset && overall === 'ok' && <p className="muted small">{t('rel.noPreset')}</p>}
      <p className="muted small">{t('rel.about')}</p>
    </Panel>
  );
}
