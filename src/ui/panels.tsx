import { useEffect, useState, type ReactNode } from 'react';
import type { BacktestResult, Metrics, Trade } from '../core/backtest';
import type { SideEvaluation } from '../core/rule/types';
import type { TradeCheckResult } from '../core/tradeCheck';
import type { Side } from '../core/types';
import { fmtMoney, fmtNum, fmtPct, fmtPrice, fmtR, fmtTime, t, tn } from '../i18n';

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** A number input that can be cleared while typing; it reports only valid numbers. */
export function Num({ label, value, onChange, step = 1, min }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
  }, [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="row">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

/** Conditions that are a yes or no (the direction of the last swing): their raw numbers say nothing to a reader. */
export const PLAIN_CONDITIONS = new Set(['cond.fibUp', 'cond.fibDown', 'cond.divBear', 'cond.divBull', 'cond.doubleTop', 'cond.doubleBottom']);

/** Conditions that compare counts, shown as whole numbers. */
export const COUNT_CONDITIONS = new Set(['cond.srTested', 'cond.tlBreakUp', 'cond.tlBreakDown']);

export function Checklist({ evals, heading }: { evals: Partial<Record<Side, SideEvaluation>> | null; heading: string }) {
  return (
    <Panel title={t('check.title')}>
      <p className="muted">{heading}</p>
      {!evals && <p className="muted">{t('check.warmup')}</p>}
      {evals &&
        (['short', 'long'] as const).map((side) => {
          const e = evals[side];
          if (!e) return null;
          return (
            <div key={side} className="checklist">
              <h3>
                {t(`check.${side}`)} <span className={e.fired ? 'badge good' : 'badge'}>{e.fired ? t('check.fired') : t('check.noSignal')}</span>
              </h3>
              <ul>
                {e.conditions.map((c, i) => (
                  <li key={i} className={c.pass ? 'pass' : 'fail'} title={c.text}>
                    <span className="mark">{c.pass ? '✓' : '✗'}</span>
                    <span>{c.label ? t(c.label) : c.text}</span>
                    <code>{c.left === null || c.right === null || PLAIN_CONDITIONS.has(c.label ?? '') ? '' : COUNT_CONDITIONS.has(c.label ?? '') ? `${fmtNum(c.left, 0)} / ${fmtNum(c.right, 0)}` : `${fmtNum(c.left, 1)} / ${fmtNum(c.right, 1)}`}</code>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </Panel>
  );
}

/** Background reading that stays folded until asked for, so it does not push the controls down. */
export function Info({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <details className="info">
      <summary>{label ?? t('info.more')}</summary>
      <div className="muted small">{children}</div>
    </details>
  );
}

/** The verdict and the three numbers it rests on; every other figure sits under "ver detalle". */
export function TradeCheckResultView({ r }: { r: TradeCheckResult }) {
  const tone = r.verdict === 'meets' ? 'good' : r.verdict === 'below' ? 'warn' : 'bad';
  return (
    <>
      <div className={`verdict ${tone}`}>{t(`verdict.${r.verdict}`)}</div>
      {r.verdict !== 'invalid' && (
        <>
          <div className="keys">
            <div><span>{t('trade.rr')}</span><strong>{r.netGain > 0 ? `${fmtNum(r.rewardRisk)} a 1` : '–'}</strong></div>
            <div><span>{t('trade.netLoss')}</span><strong>{fmtMoney(r.netLoss)} USDT</strong></div>
            <div><span>{t('trade.margin')}</span><strong>{fmtPct(r.marginOnCapital)}</strong></div>
          </div>
          <details className="info">
            <summary>{t('trade.detail')}</summary>
            <div className="rows">
              <Row label={t('trade.side')} value={r.side ? t(`side.${r.side}`) : '–'} />
              <Row label={t('trade.grossGain')} value={`${fmtMoney(r.grossGain)} USDT`} />
              <Row label={t('trade.grossLoss')} value={`${fmtMoney(r.grossLoss)} USDT`} />
              <Row label={t('trade.feesWin')} value={`${fmtMoney(r.feesOnWin)} USDT`} />
              <Row label={t('trade.netGain')} value={`${fmtMoney(r.netGain)} USDT`} tone={r.netGain > 0 ? 'good' : 'bad'} />
              <Row label={t('trade.netLoss')} value={`${fmtMoney(r.netLoss)} USDT`} />
              <Row label={t('trade.rr')} value={r.netGain > 0 ? `${fmtNum(r.rewardRisk)} a 1` : '–'} />
              <Row label={t('trade.breakEven')} value={r.breakEvenWinRate === null ? t('trade.never') : fmtPct(r.breakEvenWinRate)} />
              <Row label={t('trade.feeShare')} value={Number.isFinite(r.feeShare) ? fmtPct(r.feeShare) : '–'} />
              <Row label={t('trade.risk')} value={fmtPct(r.riskOnCapital, 2)} />
              <Row label={t('trade.margin')} value={fmtPct(r.marginOnCapital)} />
            </div>
          </details>
        </>
      )}
    </>
  );
}

/**
 * The conclusion before the numbers: did the rule win or lose after fees, and how far that can be trusted.
 * A small sample outranks the result: with few trades the sign of the total means nothing yet.
 */
export function Verdict({ m }: { m: Metrics }) {
  if (m.trades === 0) return null;
  const won = m.avgNetR > 0;
  const vars = { ops: tn('count.trade', m.trades), total: fmtR(m.totalNetR), avg: fmtR(m.avgNetR) };
  const tone = m.smallSample ? 'warn' : won ? 'good' : 'bad';
  return (
    <p className={`lead ${tone}`} data-verdict={m.smallSample ? 'small' : won ? 'won' : 'lost'}>
      {t(won ? 'verdict.won' : 'verdict.lost', vars)}
      {!won && m.avgGrossR > 0 && ` ${t('verdict.fees')}`}
      {` ${t(m.smallSample ? 'verdict.small' : won ? 'verdict.validate' : 'verdict.lostNext')}`}
    </p>
  );
}

export function MetricsView({ m, skipped }: { m: Metrics; skipped: number }) {
  if (m.trades === 0) return <p className="muted">{t('results.none')}</p>;
  const beats = m.breakEvenWinRate !== null && m.winRate > m.breakEvenWinRate;
  return (
    <>
      <div className="metrics">
        <Row label={t('results.trades')} value={`${m.trades} (${t('results.longShort', { l: m.longs, s: m.shorts })})`} />
        <Row label={t('results.winRate')} value={fmtPct(m.winRate)} tone={beats ? 'good' : 'bad'} />
        <Row label={t('results.breakEven')} value={m.breakEvenWinRate === null ? '–' : fmtPct(m.breakEvenWinRate)} />
        <Row label={t('results.targetRate')} value={fmtPct(m.targetRate)} />
        <Row label={t('results.avgGross')} value={fmtR(m.avgGrossR)} />
        <Row label={t('results.avgNet')} value={fmtR(m.avgNetR)} tone={m.avgNetR > 0 ? 'good' : 'bad'} />
        <Row label={t('results.total')} value={fmtR(m.totalNetR)} tone={m.totalNetR > 0 ? 'good' : 'bad'} />
        <Row label={t('results.pf')} value={m.profitFactor === null ? '–' : fmtNum(m.profitFactor)} />
        <Row label={t('results.dd')} value={`${fmtNum(m.maxDrawdownR)} R`} />
        <Row label={t('results.feeShare')} value={m.feeShare === null ? '–' : fmtPct(m.feeShare)} />
        <Row label={t('results.skipped')} value={String(skipped)} />
      </div>
    </>
  );
}

export function TradeTable({ result, selected, onSelect }: { result: BacktestResult; selected: Trade | null; onSelect: (t: Trade) => void }) {
  if (result.trades.length === 0) return null;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('trades.time')}</th>
            <th>{t('trades.side')}</th>
            <th>{t('trades.entry')}</th>
            <th>{t('trades.exit')}</th>
            <th>{t('trades.reason')}</th>
            <th>{t('trades.netR')}</th>
          </tr>
        </thead>
        <tbody>
          {[...result.trades].reverse().map((tr) => (
            <tr key={tr.entryTime} className={selected?.entryTime === tr.entryTime ? 'selected' : ''} onClick={() => onSelect(tr)}>
              <td>{fmtTime(tr.entryTime)}</td>
              <td className={tr.side === 'long' ? 'good' : 'bad'}>{t(`side.${tr.side}`)}</td>
              <td>{fmtPrice(tr.entryPrice)}</td>
              <td>{fmtPrice(tr.exitPrice)}</td>
              <td>{t(`exit.${tr.exitReason}`)}</td>
              <td className={tr.netR > 0 ? 'good' : 'bad'}>{fmtR(tr.netR)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Out-of-sample check: the tuning part is always shown, the validation part only once revealed. */
export function SplitTable({ inSample, outOfSample, pct, splitTime, revealed }: { inSample: Metrics; outOfSample: Metrics; pct: number; splitTime: number; revealed: boolean }) {
  const row = (label: string, when: string, m: Metrics, show: boolean) => {
    const beats = m.breakEvenWinRate !== null && m.winRate > m.breakEvenWinRate;
    const hidden = <td className="muted">{t('oos.hidden')}</td>;
    return (
      <tr>
        <td>
          {label} <span className="muted small">{when}</span>
        </td>
        {show ? <td>{m.trades}{m.trades > 0 && m.smallSample ? ' *' : ''}</td> : hidden}
        {show ? <td className={m.trades ? (beats ? 'good' : 'bad') : ''}>{m.trades ? fmtPct(m.winRate) : '–'}</td> : hidden}
        {show ? <td>{m.breakEvenWinRate === null ? '–' : fmtPct(m.breakEvenWinRate)}</td> : hidden}
        {show ? <td className={m.trades ? (m.avgNetR > 0 ? 'good' : 'bad') : ''}>{m.trades ? fmtR(m.avgNetR) : '–'}</td> : hidden}
        {show ? <td className={m.trades ? (m.totalNetR > 0 ? 'good' : 'bad') : ''}>{m.trades ? fmtR(m.totalNetR) : '–'}</td> : hidden}
      </tr>
    );
  };
  return (
    <div className="table-wrap static">
      <table>
        <thead>
          <tr>
            <th>{t('oos.segment')}</th>
            <th>{t('results.trades')}</th>
            <th>{t('results.winRate')}</th>
            <th>{t('results.breakEven')}</th>
            <th>{t('results.avgNet')}</th>
            <th>{t('results.total')}</th>
          </tr>
        </thead>
        <tbody>
          {row(t('oos.in', { pct }), t('oos.until', { time: fmtTime(splitTime) }), inSample, true)}
          {row(t('oos.out', { pct: 100 - pct }), t('oos.from', { time: fmtTime(splitTime) }), outOfSample, revealed)}
        </tbody>
      </table>
    </div>
  );
}

export interface CompareRow {
  tf: string;
  m: Metrics;
}

export function CompareTable({ rows }: { rows: CompareRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('compare.tf')}</th>
            <th>{t('results.trades')}</th>
            <th>{t('results.winRate')}</th>
            <th>{t('results.breakEven')}</th>
            <th>{t('results.avgNet')}</th>
            <th>{t('results.feeShare')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ tf, m }) => {
            const beats = m.breakEvenWinRate !== null && m.winRate > m.breakEvenWinRate;
            return (
              <tr key={tf}>
                <td>{tf}</td>
                <td>{m.trades}{m.smallSample ? ' *' : ''}</td>
                <td className={m.trades ? (beats ? 'good' : 'bad') : ''}>{m.trades ? fmtPct(m.winRate) : '–'}</td>
                <td>{m.breakEvenWinRate === null ? '–' : fmtPct(m.breakEvenWinRate)}</td>
                <td className={m.avgNetR > 0 ? 'good' : m.trades ? 'bad' : ''}>{m.trades ? fmtR(m.avgNetR) : '–'}</td>
                <td>{m.feeShare === null ? '–' : fmtPct(m.feeShare)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
