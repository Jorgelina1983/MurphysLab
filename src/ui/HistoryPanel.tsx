import { useState } from 'react';
import { fmtMoney, fmtNum, fmtTime, t } from '../i18n';
import { historyMarkdown, orderText, outcomeR, outcomeText, riskText, statusText, type OrderOutcome, type OrderRecord } from './history';
import { loadDemoKeys } from './okxKeys';
import { pendingOutcomes, readOutcomes } from './outcomes';
import { Panel } from './panels';

interface Props {
  records: OrderRecord[];
  onNotes: (id: string, notes: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  /** Outcomes read from OKX demo, by record id. */
  onOutcomes: (updates: Record<string, OrderOutcome>) => void;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Every order sent to OKX demo (or logged by hand) with the reasons it was taken, newest first. */
export function HistoryPanel({ records, onNotes, onDelete, onClear, onOutcomes }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [copied, setCopied] = useState('');
  const copy = (id: string, text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(id);
        setTimeout(() => setCopied(''), 1500);
      },
      () => setCopied(''),
    );
  const stamp = new Date().toISOString().slice(0, 10);
  // Outcomes: asked from OKX demo on request, never on a timer, with the key saved in the Orden tab.
  const [sync, setSync] = useState<{ busy: boolean; message: string; warn: boolean }>({ busy: false, message: '', warn: false });
  const pending = pendingOutcomes(records).length;
  const readFromOkx = async () => {
    const keys = loadDemoKeys();
    if (!keys) return setSync({ busy: false, message: t('outcome.noKeys'), warn: true });
    setSync({ busy: true, message: t('outcome.reading'), warn: false });
    try {
      const { updates, errors } = await readOutcomes(records, keys, Date.now());
      onOutcomes(updates);
      setSync({ busy: false, message: errors.length ? t('outcome.error', { msg: errors[0] }) : t('outcome.done', { n: Object.keys(updates).length }), warn: errors.length > 0 });
    } catch (e) {
      setSync({ busy: false, message: t('outcome.error', { msg: e instanceof Error ? e.message : String(e) }), warn: true });
    }
  };
  const closed = records.filter((r) => r.outcome?.state === 'closed');
  const totalPnl = closed.reduce((sum, r) => sum + (r.outcome?.pnl ?? 0), 0);
  const rs = closed.map(outcomeR).filter((v): v is number => v !== null);
  const signed = (v: number, text: string) => `${v >= 0 ? '+' : ''}${text}`;

  return (
    <Panel title={t('history.title')} actions={<span className="count-note">{records.length}</span>}>
      {records.length === 0 ? (
        <p className="muted">{t('history.empty')}</p>
      ) : (
        <>
          {closed.length > 0 && (
            <p className={`lead ${totalPnl > 0 ? 'good' : 'bad'}`} data-block="outcome-summary">
              {t('outcome.summary', { n: closed.length, pnl: signed(totalPnl, fmtMoney(totalPnl)), r: rs.length === closed.length ? ` (${signed(rs.reduce((a, b) => a + b, 0), fmtNum(rs.reduce((a, b) => a + b, 0), 2))} R)` : '' })}
            </p>
          )}
          <span className="actions left">
            <button className="primary" data-action="read-outcomes" disabled={sync.busy || pending === 0} title={pending === 0 ? t('outcome.none') : undefined} onClick={readFromOkx}>{t('outcome.read', { n: pending })}</button>
            {sync.message && <span className={sync.warn ? 'warn small' : 'muted small'} role="status" data-block="outcome-status">{sync.message}</span>}
          </span>
          <span className="actions left">
            <button onClick={() => download(`murphy-signal-lab-ordenes-${stamp}.md`, historyMarkdown(records), 'text/markdown')}>{t('history.exportText')}</button>
            <button onClick={() => download(`murphy-signal-lab-ordenes-${stamp}.json`, JSON.stringify(records, null, 2), 'application/json')}>{t('history.exportData')}</button>
            {clearing ? (
              <>
                <button className="danger" data-action="clear-confirm" onClick={() => { onClear(); setClearing(false); }}>{t('history.clearConfirm', { n: records.length })}</button>
                <button onClick={() => setClearing(false)}>{t('okx.cancel')}</button>
              </>
            ) : (
              <button onClick={() => setClearing(true)}>{t('history.clear')}</button>
            )}
          </span>
          <ul className="history">
            {records.map((r) => (
              <li key={r.id} className={`record ${r.status}`} data-record={r.status}>
                <button className="record-head" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className={`badge ${r.side === 'long' ? 'good' : 'bad'}`}>{t(`side.${r.side}`)}</span>
                  <strong>{r.market} · {r.timeframe}</strong>
                  <span className="muted">{fmtTime(r.time)}</span>
                  <span className={`state ${r.status}`}>{t(`history.state.${r.status}`)}</span>
                  {r.outcome && <span className={`state outcome ${r.outcome.state} ${r.outcome.state === 'closed' ? ((r.outcome.pnl ?? 0) > 0 ? 'won' : 'lost') : ''}`} data-outcome={r.outcome.state}>{r.outcome.state === 'closed' ? `${signed(r.outcome.pnl ?? 0, fmtMoney(r.outcome.pnl ?? 0))} USDT` : t(`outcome.state.${r.outcome.state}`)}</span>}
                  <span className="chev">{open === r.id ? '▾' : '▸'}</span>
                </button>
                {open === r.id && (
                  <div className="record-body">
                    <p className={r.status === 'refused' ? 'warn' : undefined}>{statusText(r)}</p>
                    {r.outcome && <p data-block="outcome"><strong>{t('outcome.label')}:</strong> {outcomeText(r)}</p>}
                    <p>{orderText(r)}</p>
                    <p>{riskText(r)}</p>
                    <p className="muted small">
                      {t('history.rule')}: {r.rule}. {t('history.origin')}: {r.originLabel}
                      {r.edited && ` (${t('history.edited')})`}.
                    </p>
                    {r.explanation.length > 0 && (
                      <div className="explain">
                        <p><strong>{r.explanation[0]}</strong></p>
                        {r.explanation.slice(1).map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                      </div>
                    )}
                    <label className="field">
                      <span>{t('history.notes')}</span>
                      <textarea rows={2} value={r.notes} placeholder={t('history.notesHint')} onChange={(e) => onNotes(r.id, e.target.value)} />
                    </label>
                    <span className="actions left">
                      {r.explanation.length > 0 && <button onClick={() => copy(r.id, r.explanation.join('\n'))}>{copied === r.id ? t('signal.copied') : t('signal.copy')}</button>}
                      <button onClick={() => onDelete(r.id)}>{t('history.delete')}</button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">{t('history.about')}</p>
    </Panel>
  );
}
