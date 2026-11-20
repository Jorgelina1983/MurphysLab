import { describe, expect, it } from 'vitest';
import { closingOf, parseFilledOrders, parseOrderStatus, type FilledOrder, type OrderStatus } from '../src/feed/okxTrade';
import { exitKind, historyMarkdown, outcomeR, outcomeText, type OrderRecord } from '../src/ui/history';
import { pendingOutcomes, readOutcomes, type OutcomeSource } from '../src/ui/outcomes';

const creds = { apiKey: 'k', secret: 's', passphrase: 'p' };
const record = (over: Partial<OrderRecord>): OrderRecord => ({
  id: 'a', time: 1_000_000, status: 'sent', ordId: '11', market: 'BTC-USDT', asset: 'BTC', timeframe: '15m', side: 'long', type: 'market', entry: 65000, stop: 64500, target: 66000, size: 0.02, contracts: 2,
  marginMode: 'cross', leverage: 3, rewardRisk: 1.8, netLoss: 11.3, marginOnCapital: 0.08, verdict: 'ok', rule: 'r', origin: 'signal', originLabel: 'o', edited: false, explanation: [], notes: '', ...over,
});
// Rows as in OKX's order endpoints, trimmed to the fields read. A long of 2 contracts opened by order 11 and
// closed by its take-profit (order 21); an unrelated earlier order (5).
const row = (over: Record<string, string>): Record<string, string> => ({ instId: 'BTC-USDT-SWAP', state: 'filled', category: 'normal', pnl: '0', fee: '-0.65', ...over });
const HISTORY = [
  row({ ordId: '21', side: 'sell', accFillSz: '2', avgPx: '65995', fillTime: '9000000', pnl: '19.7', fee: '-0.66' }),
  row({ ordId: '11', side: 'buy', accFillSz: '2', avgPx: '65010', fillTime: '2000100' }),
  row({ ordId: '5', side: 'sell', accFillSz: '1', avgPx: '64000', fillTime: '1000000' }),
];
const entry = { ordId: '11', side: 'long' as const, price: 65010, time: 2000100, contracts: 2, fee: -0.65 };

describe('reading an order back from OKX', () => {
  it('reads the state and the fill of an order', () => {
    expect(parseOrderStatus({ state: 'filled', avgPx: '65010.5', fillTime: '2000100', accFillSz: '2', fee: '-0.65' })).toEqual({ state: 'filled', fillPrice: 65010.5, fillTime: 2000100, contracts: 2, fee: -0.65 });
    expect(parseOrderStatus({ state: 'live', avgPx: '', fillTime: '', accFillSz: '0', fee: '' })).toEqual({ state: 'live', fillPrice: null, fillTime: null, contracts: 0, fee: 0 });
    expect(parseOrderStatus({ state: 'something' })).toBeNull();
    expect(parseOrderStatus(undefined)).toBeNull();
  });
  it('reads the orders that traded, oldest first, and drops the ones that did not', () => {
    const list = parseFilledOrders([...HISTORY, row({ ordId: '30', side: 'buy', state: 'canceled', accFillSz: '0', avgPx: '', fillTime: '' }), row({ ordId: '31', side: 'sell', accFillSz: '1', avgPx: '60000', fillTime: '9500000', category: 'full_liquidation' })]);
    expect(list.map((o) => o.ordId)).toEqual(['5', '11', '21', '31']);
    expect(list[2]).toEqual({ ordId: '21', side: 'sell', contracts: 2, price: 65995, time: 9000000, pnl: 19.7, fee: -0.66, forced: false });
    expect(list[3].forced).toBe(true);
  });
  it('finds the close of a position in the orders on the other side, net of the fees of both ends', () => {
    const closed = closingOf(entry, parseFilledOrders(HISTORY))!;
    expect(closed).toMatchObject({ side: 'long', openTime: 2000100, closeTime: 9000000, openPrice: 65010, closePrice: 65995, forced: false });
    expect(closed.realizedPnl).toBeCloseTo(19.7 - 0.66 - 0.65);
  });
  it('adds up a close made in parts, and waits until the whole size is closed', () => {
    const parts = [row({ ordId: '11', side: 'buy', accFillSz: '2', avgPx: '65010', fillTime: '2000100' }), row({ ordId: '21', side: 'sell', accFillSz: '1', avgPx: '65500', fillTime: '5000000', pnl: '4.9', fee: '-0.3' })];
    expect(closingOf(entry, parseFilledOrders(parts))).toBeNull();
    const done = closingOf(entry, parseFilledOrders([...parts, row({ ordId: '22', side: 'sell', accFillSz: '1', avgPx: '66500', fillTime: '7000000', pnl: '14.9', fee: '-0.3' })]))!;
    expect(done.closePrice).toBe(66000);
    expect(done.closeTime).toBe(7000000);
    expect(done.realizedPnl).toBeCloseTo(4.9 + 14.9 - 0.3 - 0.3 - 0.65);
  });
  it('does not guess when another order on the same side shares the position, or when nothing closed it', () => {
    const shared = [...HISTORY, row({ ordId: '12', side: 'buy', accFillSz: '1', avgPx: '65200', fillTime: '3000000' })];
    expect(closingOf(entry, parseFilledOrders(shared))).toBeNull();
    expect(closingOf(entry, parseFilledOrders(HISTORY.slice(1)))).toBeNull();
    expect(closingOf(entry, [])).toBeNull();
  });
  it('names where the position closed by its distance to the planned levels', () => {
    const r = { stop: 64500, target: 66000 };
    expect(exitKind(r, 65995, false)).toBe('target');
    expect(exitKind(r, 64480, false)).toBe('stop');
    expect(exitKind(r, 65300, false)).toBe('other');
    expect(exitKind(r, 64480, true)).toBe('forced');
  });
});

describe('outcomes in the history', () => {
  const source = (orders: Record<string, OrderStatus | null | Error>, history: FilledOrder[]): OutcomeSource & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      sync: async () => void calls.push('sync'),
      order: async (_c, instId, ordId) => {
        calls.push(`order ${instId} ${ordId}`);
        const answer = orders[ordId];
        if (answer instanceof Error) throw answer;
        return answer;
      },
      filled: async (_c, instId) => {
        calls.push(`filled ${instId}`);
        return history;
      },
    };
  };
  const filled: OrderStatus = { state: 'filled', fillPrice: 65010, fillTime: 2000100, contracts: 2, fee: -0.65 };
  const waiting = { fillPrice: null, fillTime: null, contracts: 0, fee: 0 };

  it('asks only for orders whose outcome can still change', () => {
    const list = [record({ id: 'a' }), record({ id: 'b', status: 'refused' }), record({ id: 'c', status: 'manual', ordId: undefined }), record({ id: 'd', outcome: { checkedAt: 1, state: 'closed' } }), record({ id: 'e', outcome: { checkedAt: 1, state: 'open' } }), record({ id: 'f', outcome: { checkedAt: 1, state: 'canceled' } })];
    expect(pendingOutcomes(list).map((r) => r.id)).toEqual(['a', 'e']);
  });
  it('records pending, cancelled, open and closed orders, with one history request per market', async () => {
    const list = [record({ id: 'a', ordId: '11' }), record({ id: 'b', ordId: '12' }), record({ id: 'c', ordId: '13' }), record({ id: 'd', ordId: '14', side: 'short' }), record({ id: 'e', ordId: '15', asset: 'ETH', market: 'ETH-USDT' })];
    const s = source({ '11': filled, '12': { state: 'live', ...waiting }, '13': { state: 'canceled', ...waiting }, '14': { ...filled, fillTime: 9500000 }, '15': null }, parseFilledOrders(HISTORY));
    const { updates, errors } = await readOutcomes(list, creds, 7777, s);
    expect(errors).toEqual([]);
    expect(updates.a).toMatchObject({ checkedAt: 7777, state: 'closed', fillPrice: 65010, fillTime: 2000100, closePrice: 65995, closeTime: 9000000, exit: 'target' });
    expect(updates.a.pnl).toBeCloseTo(18.39);
    expect(updates.b).toEqual({ checkedAt: 7777, state: 'live' });
    expect(updates.c).toEqual({ checkedAt: 7777, state: 'canceled' });
    expect(updates.d).toMatchObject({ state: 'open', fillPrice: 65010 }); // filled after everything in the history: nothing has closed it yet
    expect(updates.e).toBeUndefined();
    expect(s.calls[0]).toBe('sync');
    expect(s.calls.filter((c) => c.startsWith('filled'))).toEqual(['filled BTC-USDT-SWAP']);
    expect(s.calls).toContain('order ETH-USDT-SWAP 15');
  });
  it('reports an order that fails to read and goes on with the others', async () => {
    const s = source({ '11': new Error('50011: Too Many Requests'), '12': filled }, parseFilledOrders(HISTORY.map((r) => (r.ordId === '11' ? { ...r, ordId: '12' } : r))));
    const { updates, errors } = await readOutcomes([record({ id: 'a', ordId: '11' }), record({ id: 'b', ordId: '12' })], creds, 1, s);
    expect(errors).toEqual(['BTC-USDT 11: 50011: Too Many Requests']);
    expect(updates.b.state).toBe('closed');
  });
  it('states the result against the loss that was planned at the stop, in the panel and in the export', () => {
    const r = record({ outcome: { checkedAt: 9_500_000, state: 'closed', fillPrice: 65010, fillTime: 2000100, closePrice: 65995, closeTime: 9000000, pnl: 19.2, exit: 'target' } });
    expect(outcomeR(r)).toBeCloseTo(19.2 / 11.3);
    expect(outcomeText(r)).toContain('+19,20 USDT');
    expect(outcomeText(r)).toContain('(+1,70 R)');
    expect(outcomeText(r)).toContain('en el objetivo');
    expect(historyMarkdown([r])).toContain('Resultado en OKX demo: Ejecutada a 65.010,0');
    expect(outcomeText(record({ outcome: { checkedAt: 1, state: 'live' } }))).toContain('sigue pendiente');
    expect(outcomeText(record({}))).toBe('');
    expect(outcomeR(record({ netLoss: 0, outcome: { checkedAt: 1, state: 'closed', pnl: 5 } }))).toBeNull();
  });
});
