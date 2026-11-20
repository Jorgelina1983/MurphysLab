import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYMBOLS } from '../src/feed/okx';
import { OkxError, buildOrder, connectDemo, placeDemoOrder, sign, toContracts, type OrderInput } from '../src/feed/okxTrade';

const BTC = SYMBOLS[0];
const creds = { apiKey: 'key', secret: 'top-secret', passphrase: 'pass' };
const base: OrderInput = { symbol: BTC, side: 'short', entry: 65000, stop: 65400, target: 64000, size: 0.03, type: 'market', marginMode: 'cross', positionMode: 'net_mode' };

/** Replace `fetch` with canned OKX answers and record every request made. */
function fakeOkx(answers: Record<string, unknown>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: String(init.body ?? '') });
    const hit = Object.keys(answers).find((k) => url.includes(k));
    return new Response(JSON.stringify(hit ? answers[hit] : { code: '404', msg: 'not mocked' }));
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('OKX demo orders', () => {
  it('signs the way OKX specifies: Base64 HMAC-SHA256 of timestamp + METHOD + path + body', async () => {
    const [ts, path, body] = ['2026-11-16T12:00:00.000Z', '/api/v5/trade/order', '{"a":1}'];
    // Reference value computed outside this code, with Node's own crypto module.
    expect(await sign('top-secret', ts, 'post', path, body)).toBe('LFo8jc+7ZtWbjiwhWJq+zc3nSZzcWDtuN1S1NbobtSY=');
    expect(await sign('other-secret', ts, 'post', path, body)).not.toBe('LFo8jc+7ZtWbjiwhWJq+zc3nSZzcWDtuN1S1NbobtSY=');
  });

  it('builds a market order in whole contracts with take-profit and stop-loss attached', () => {
    expect(buildOrder(base)).toEqual({
      instId: 'BTC-USDT-SWAP',
      tdMode: 'cross',
      side: 'sell',
      ordType: 'market',
      sz: '3',
      attachAlgoOrds: [{ tpTriggerPx: '64000.0', tpOrdPx: '-1', slTriggerPx: '65400.0', slOrdPx: '-1' }],
    });
  });

  it('adds the price to a limit order and the position side in long/short mode', () => {
    const body = buildOrder({ ...base, side: 'long', entry: 64000, stop: 63600, target: 65200, type: 'limit', marginMode: 'isolated', positionMode: 'long_short_mode' });
    expect(body).toMatchObject({ side: 'buy', posSide: 'long', ordType: 'limit', px: '64000.0', tdMode: 'isolated' });
  });

  it('refuses sizes under one contract and levels on the wrong side', () => {
    expect(toContracts(0.039, BTC)).toBe(3);
    expect(() => buildOrder({ ...base, size: 0.004 })).toThrow('size');
    expect(() => buildOrder({ ...base, stop: 64000, target: 65400 })).toThrow('levels'); // a short with the stop below
    expect(() => buildOrder({ ...base, entry: 0 })).toThrow('levels');
  });

  it('marks every request, reads and orders alike, as demo trading', async () => {
    const calls = fakeOkx({ 'public/time': { code: '0', data: [{ ts: String(Date.now()) }] }, 'account/config': { code: '0', data: [{ posMode: 'long_short_mode' }] }, 'trade/order': { code: '0', data: [{ ordId: '123', sCode: '0' }] } });
    expect(await connectDemo(creds)).toEqual({ positionMode: 'long_short_mode' });
    expect(await placeDemoOrder(creds, buildOrder(base))).toBe('123');
    const signed = calls.filter((c) => !c.url.includes('public/time'));
    expect(signed).toHaveLength(2);
    for (const c of signed) {
      expect(c.headers['x-simulated-trading']).toBe('1');
      expect(c.headers['OK-ACCESS-KEY']).toBe('key');
      expect(c.headers['OK-ACCESS-SIGN']).toBe(await sign('top-secret', c.headers['OK-ACCESS-TIMESTAMP'], c.method, c.url.replace('https://www.okx.com', ''), c.body));
    }
    expect(signed[1].method).toBe('POST');
    expect(JSON.parse(signed[1].body).sz).toBe('3');
  });

  it('refuses a key from the live account', async () => {
    fakeOkx({ 'public/time': { code: '0', data: [{ ts: String(Date.now()) }] }, 'account/config': { code: '50101', msg: 'APIKey does not match current environment.', data: [] } });
    const error = await connectDemo(creds).catch((e) => e);
    expect(error).toBeInstanceOf(OkxError);
    expect(error.liveKey).toBe(true);
  });

  it("reports OKX's own reason when an order is rejected", async () => {
    fakeOkx({ 'trade/order': { code: '1', msg: 'All operations failed', data: [{ ordId: '', sCode: '51008', sMsg: 'Order failed. Insufficient USDT margin in account' }] } });
    const error = await placeDemoOrder(creds, buildOrder(base)).catch((e) => e);
    expect(error).toMatchObject({ code: '51008', message: 'Order failed. Insufficient USDT margin in account', liveKey: false });
  });
});
