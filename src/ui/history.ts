import type { Side } from '../core/types';
import { fmtMoney, fmtNum, fmtPct, fmtPrice, fmtTime, t } from '../i18n';

/**
 * One order as it was when it left the tool, with the reasons behind it. Kept
 * in this browser so the user can go back to what was sent and why.
 */
export interface OrderRecord {
  id: string;
  time: number;
  /** `sent`: accepted by OKX demo. `refused`: OKX answered with an error. `manual`: the user logged an order typed by hand. */
  status: 'sent' | 'refused' | 'manual';
  ordId?: string;
  error?: string;
  market: string;
  asset: string;
  timeframe: string;
  side: Side;
  type: 'market' | 'limit';
  entry: number;
  stop: number;
  target: number;
  size: number;
  contracts: number;
  marginMode: string;
  leverage: number;
  /** Net reward-to-risk, net loss at the stop in USDT, and margin as a share of capital, from the risk check at that moment. */
  rewardRisk: number | null;
  netLoss: number;
  marginOnCapital: number;
  verdict: string;
  /** The rule in force, in words. */
  rule: string;
  /** Where the levels came from: a signal, an anticipated order at a level, or typed by hand. */
  origin: 'signal' | 'pending' | 'manual';
  originLabel: string;
  /** The levels were changed by hand after being loaded from a signal. */
  edited: boolean;
  /** The explanation of the signal, one sentence per entry; empty when the order did not come from a signal. */
  explanation: string[];
  notes: string;
  /** What OKX demo says happened to the order, the last time it was asked. Absent until then. */
  outcome?: OrderOutcome;
}

export interface OrderOutcome {
  checkedAt: number;
  /** `open`: filled and the position is still open (or could not be told apart from another). `closed`: the position it opened is closed. */
  state: 'live' | 'canceled' | 'open' | 'closed';
  fillPrice?: number;
  fillTime?: number;
  closePrice?: number;
  closeTime?: number;
  /** Result in USDT after the fees of the entry and of the close. Funding is not included. */
  pnl?: number;
  /** Where it closed, judged by the closing price: at the planned target, at the planned stop, or somewhere else. */
  exit?: 'target' | 'stop' | 'other' | 'forced';
}

/** A closing price this close to a planned level, as a share of the level, counts as closing at it (slippage on a market exit). */
const AT_LEVEL = 0.002;
export function exitKind(r: { stop: number; target: number }, closePrice: number, forced: boolean): NonNullable<OrderOutcome['exit']> {
  if (forced) return 'forced';
  if (Math.abs(closePrice - r.target) <= r.target * AT_LEVEL) return 'target';
  if (Math.abs(closePrice - r.stop) <= r.stop * AT_LEVEL) return 'stop';
  return 'other';
}

/** The result as a multiple of the loss planned at the stop, which is what 1 R was for this order. `null` when that is unknown. */
export const outcomeR = (r: OrderRecord) => (r.outcome?.pnl !== undefined && r.netLoss > 0 ? r.outcome.pnl / r.netLoss : null);

export function outcomeText(r: OrderRecord): string {
  const o = r.outcome;
  if (!o) return '';
  const when = t('outcome.checked', { time: fmtTime(o.checkedAt) });
  if (o.state === 'live') return `${t('outcome.live')} ${when}`;
  if (o.state === 'canceled') return `${t('outcome.canceled')} ${when}`;
  const fill = t('outcome.filled', { price: fmtPrice(o.fillPrice ?? 0), time: fmtTime(o.fillTime ?? 0) });
  if (o.state === 'open') return `${fill} ${t('outcome.open')} ${when}`;
  const R = outcomeR(r);
  return `${fill} ${t('outcome.closed', { price: fmtPrice(o.closePrice ?? 0), time: fmtTime(o.closeTime ?? 0), how: t(`outcome.exit.${o.exit ?? 'other'}`), pnl: `${(o.pnl ?? 0) >= 0 ? '+' : ''}${fmtMoney(o.pnl ?? 0)}`, r: R === null ? '' : ` (${R >= 0 ? '+' : ''}${fmtNum(R, 2)} R)` })} ${when}`;
}

export const HISTORY_KEY = 'murphy-signal-lab.history.v1';
export const HISTORY_LIMIT = 300;

export const statusText = (r: OrderRecord) => (r.status === 'sent' ? t('history.sent', { id: r.ordId ?? '' }) : r.status === 'refused' ? t('history.refused', { error: r.error ?? '' }) : t('history.manual'));
export const orderText = (r: OrderRecord) =>
  t('history.order', {
    type: r.type === 'limit' ? t('ticket.limit', { price: fmtPrice(r.entry) }) : t('ticket.market'),
    entry: fmtPrice(r.entry),
    stop: fmtPrice(r.stop),
    target: fmtPrice(r.target),
    size: fmtNum(r.size, 2),
    asset: r.asset,
    contracts: r.contracts,
    margin: t(`okx.${r.marginMode}`).toLowerCase(),
    lev: r.leverage,
  });
export const riskText = (r: OrderRecord) => t('history.risk', { rr: r.rewardRisk === null ? '–' : fmtNum(r.rewardRisk), loss: fmtMoney(r.netLoss), margin: fmtPct(r.marginOnCapital), verdict: t(`verdict.${r.verdict}`) });

/** The whole history as Markdown, oldest first, ready to paste into a report. */
export function historyMarkdown(records: OrderRecord[]): string {
  const sorted = [...records].sort((a, b) => a.time - b.time);
  const blocks = sorted.map((r, i) =>
    [
      `## ${i + 1}. ${t(`side.${r.side}`)} ${r.market} ${r.timeframe} · ${fmtTime(r.time)} UTC`,
      '',
      `- ${t('history.status')}: ${statusText(r)}`,
      `- ${t('history.orderLabel')}: ${orderText(r)}`,
      `- ${t('history.riskLabel')}: ${riskText(r)}`,
      ...(r.outcome ? [`- ${t('outcome.label')}: ${outcomeText(r)}`] : []),
      `- ${t('history.rule')}: ${r.rule}`,
      `- ${t('history.origin')}: ${r.originLabel}${r.edited ? ` (${t('history.edited')})` : ''}`,
      ...(r.explanation.length ? ['', `**${t('signal.title')}**`, '', ...r.explanation] : []),
      ...(r.notes.trim() ? ['', `**${t('history.notes')}**`, '', r.notes.trim()] : []),
    ].join('\n'),
  );
  return [`# ${t('history.title')} · Murphy Signal Lab`, '', ...blocks].join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
