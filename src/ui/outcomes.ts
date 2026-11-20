import { SYMBOLS } from '../feed/okx';
import { closingOf, fetchFilledOrders, fetchOrderStatus, syncClock, type FilledOrder, type OkxCredentials, type OrderStatus } from '../feed/okxTrade';
import { exitKind, type OrderOutcome, type OrderRecord } from './history';

/** What reading the outcomes needs from OKX; replaced by simulated answers in tests. */
export interface OutcomeSource {
  sync: () => Promise<void>;
  order: (creds: OkxCredentials, instId: string, ordId: string) => Promise<OrderStatus | null>;
  filled: (creds: OkxCredentials, instId: string) => Promise<FilledOrder[]>;
}
const OKX: OutcomeSource = { sync: syncClock, order: fetchOrderStatus, filled: fetchFilledOrders };
/** A pause between requests, so a history of many orders does not arrive at OKX as a burst. */
const PAUSE = 150;

/** Orders whose outcome can still change: sent to OKX, and not yet seen cancelled or closed. */
export const pendingOutcomes = (records: OrderRecord[]) => records.filter((r) => r.status === 'sent' && r.ordId && (!r.outcome || r.outcome.state === 'live' || r.outcome.state === 'open'));

/**
 * Ask OKX demo how each pending order stands. One request per order, plus one per market for the orders that
 * closed positions. An order that fails to read is reported and the rest go on.
 */
export async function readOutcomes(records: OrderRecord[], creds: OkxCredentials, now: number, source: OutcomeSource = OKX): Promise<{ updates: Record<string, OrderOutcome>; errors: string[] }> {
  const updates: Record<string, OrderOutcome> = {};
  const errors: string[] = [];
  const filled = new Map<string, FilledOrder[]>();
  const wait = () => (source === OKX ? new Promise((r) => setTimeout(r, PAUSE)) : Promise.resolve());
  await source.sync();
  for (const r of pendingOutcomes(records)) {
    const instId = SYMBOLS.find((s) => s.id === r.asset)?.instId;
    if (!instId) continue;
    try {
      await wait();
      const status = await source.order(creds, instId, r.ordId as string);
      if (!status) continue;
      // A partly filled order that was then cancelled still opened a position, so the fill decides.
      if (status.fillPrice === null || status.fillTime === null) {
        updates[r.id] = { checkedAt: now, state: status.state === 'canceled' || status.state === 'mmp_canceled' ? 'canceled' : 'live' };
        continue;
      }
      if (!filled.has(instId)) filled.set(instId, await source.filled(creds, instId));
      const position = closingOf({ ordId: r.ordId as string, side: r.side, price: status.fillPrice, time: status.fillTime, contracts: status.contracts, fee: status.fee }, filled.get(instId) ?? []);
      const base = { checkedAt: now, fillPrice: status.fillPrice, fillTime: status.fillTime };
      updates[r.id] = position
        ? { ...base, state: 'closed', closePrice: position.closePrice, closeTime: position.closeTime, pnl: position.realizedPnl, exit: exitKind(r, position.closePrice, position.forced) }
        : { ...base, state: 'open' };
    } catch (e) {
      errors.push(`${r.market} ${r.ordId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { updates, errors };
}
