import { useEffect, useState } from 'react';
import type { TradeCheckResult } from '../core/tradeCheck';
import type { MarketSymbol } from '../feed/okx';
import { DEMO_GAP_LIMIT, demoGap, fetchDemoLast } from '../feed/okxContext';
import { OkxError, buildOrder, connectDemo, fetchLeverage, placeDemoOrder, toContracts, type DemoAccount, type MarginMode, type OkxCredentials, type OrderBody } from '../feed/okxTrade';
import { fmtNum, fmtPct, fmtPrice, t } from '../i18n';
import type { ChartLevels } from './Chart';
import { NO_KEYS, OKX_KEYS } from './okxKeys';
import { loadJson, saveJson } from './storage';

const KEYS = OKX_KEYS;
const EMPTY = NO_KEYS;

interface Props {
  symbol: MarketSymbol;
  levels: ChartLevels;
  size: number;
  type: 'market' | 'limit';
  check: TradeCheckResult;
  /** Last price of the real market, which the chart and the signals use. */
  lastPrice: number | undefined;
  /** The price already went through the stop or the target. */
  stale: boolean;
  marginMode: MarginMode;
  onMarginMode: (m: MarginMode) => void;
  /** Leverage the tool assumes in its margin figures. */
  leverage: number;
  /** Called once per order that reached OKX, accepted or refused, so it can be logged. */
  onOutcome: (outcome: { status: 'sent' | 'refused'; ordId?: string; error?: string; contracts: number }) => void;
}

/** What to change in OKX for refusals that come from how the API key was set up, by OKX error code. */
const HINTS: Record<string, string> = { '50123': 'okx.hintCrypto', '50124': 'okx.hintMarket' };
const refusal = (e: OkxError) => t('okx.rejected', { code: e.code, msg: e.message }) + (HINTS[e.code] ? ` ${t(HINTS[e.code])}` : '');

type Sent = { ok: true; id: string; text: string } | { ok: false; text: string };

/**
 * Connect a demo-trading API key and send the order on screen to OKX demo.
 * Nothing is sent without two clicks from the user, and only to demo trading:
 * see `feed/okxTrade.ts` for how that is enforced.
 */
export function OkxDemo({ symbol, levels, size, type, check, lastPrice, stale, marginMode, onMarginMode, leverage, onOutcome }: Props) {
  const [creds, setCreds] = useState<OkxCredentials>(() => ({ ...EMPTY, ...loadJson<Partial<OkxCredentials>>(KEYS, {}) }));
  const [account, setAccount] = useState<DemoAccount | null>(null);
  const [okxLeverage, setOkxLeverage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<OrderBody | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [demoLast, setDemoLast] = useState<number | null>(null);
  const filled = creds.apiKey !== '' && creds.secret !== '' && creds.passphrase !== '';

  const connect = async (c: OkxCredentials) => {
    setBusy(true);
    setError('');
    try {
      setAccount(await connectDemo(c));
      saveJson(KEYS, c);
    } catch (e) {
      setAccount(null);
      setError(e instanceof OkxError ? (e.liveKey ? t('okx.liveKey') : refusal(e)) : t('okx.unreachable'));
    } finally {
      setBusy(false);
    }
  };
  // Keys saved earlier reconnect on load, so the send button is ready when a signal fires.
  useEffect(() => {
    if (filled) void connect(creds);
  }, []);
  useEffect(() => {
    setOkxLeverage(null);
    if (account) void fetchLeverage(creds, symbol, marginMode).then(setOkxLeverage);
  }, [account, symbol.id, marginMode]);
  // The demo book has its own price: read it while connected, to warn when it is away from the chart's.
  useEffect(() => {
    setDemoLast(null);
    if (!account) return;
    const stop = new AbortController();
    const read = () => void fetchDemoLast(symbol.instId, stop.signal).then((v) => !stop.signal.aborted && setDemoLast(v));
    read();
    const timer = setInterval(read, 20_000);
    return () => {
      stop.abort();
      clearInterval(timer);
    };
  }, [account, symbol.id]);
  const gap = demoGap(demoLast, lastPrice);
  // Any change to the order cancels a pending confirmation: what is confirmed must be what is on screen.
  useEffect(() => setConfirm(null), [levels.entry, levels.stop, levels.target, size, type, symbol.id, marginMode]);

  const forget = () => {
    saveJson(KEYS, EMPTY);
    setCreds(EMPTY);
    setAccount(null);
    setSent(null);
    setError('');
  };

  const blocked = !account
    ? ''
    : check.side === null || check.verdict === 'invalid'
      ? t('okx.blockInvalid')
      : check.verdict === 'breaksLimit'
        ? t('okx.blockLimit')
        : stale
          ? t('okx.blockStale')
          : toContracts(size, symbol) < 1
            ? t('okx.blockSize', { step: symbol.contractSize, asset: symbol.id })
            : '';

  const prepare = () => {
    setSent(null);
    if (!account || !check.side) return;
    try {
      setConfirm(buildOrder({ symbol, side: check.side, entry: levels.entry, stop: levels.stop, target: levels.target, size, type, marginMode, positionMode: account.positionMode }));
    } catch {
      setConfirm(null);
    }
  };
  const send = async () => {
    if (!confirm) return;
    const body = confirm;
    setConfirm(null);
    setBusy(true);
    try {
      const id = await placeDemoOrder(creds, body);
      setSent({ ok: true, id, text: t('okx.sent', { id }) });
      onOutcome({ status: 'sent', ordId: id, contracts: Number(body.sz) });
    } catch (e) {
      setSent({ ok: false, text: e instanceof OkxError ? refusal(e) : t('okx.unreachable') });
      // An order that never reached OKX is not logged: there is nothing to look up on the exchange.
      if (e instanceof OkxError) onOutcome({ status: 'refused', error: `${e.code}: ${e.message}`, contracts: Number(body.sz) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="okx" data-block="okx">
      <h3 className="section">
        {t('okx.title')} <span className={account ? 'badge good' : 'badge'}>{account ? t('okx.connected') : t('okx.disconnected')}</span>
      </h3>

      {!account && (
        <>
          <p className="muted small">{t('okx.setup')}</p>
          <div className="grid2">
            <label className="field wide">
              <span>API key</span>
              <input type="text" autoComplete="off" spellCheck={false} value={creds.apiKey} onChange={(e) => setCreds({ ...creds, apiKey: e.target.value.trim() })} />
            </label>
            <label className="field">
              <span>Secret key</span>
              <input type="password" autoComplete="off" value={creds.secret} onChange={(e) => setCreds({ ...creds, secret: e.target.value.trim() })} />
            </label>
            <label className="field">
              <span>Passphrase</span>
              <input type="password" autoComplete="off" value={creds.passphrase} onChange={(e) => setCreds({ ...creds, passphrase: e.target.value })} />
            </label>
          </div>
          <span className="actions left">
            <button className="primary" disabled={!filled || busy} onClick={() => connect(creds)}>{busy ? t('okx.connecting') : t('okx.connect')}</button>
          </span>
        </>
      )}
      {error && <p className="notice">{error}</p>}

      {account && (
        <>
          <div className="grid2">
            <label className="field">
              <span>{t('okx.marginMode')}</span>
              <select value={marginMode} onChange={(e) => onMarginMode(e.target.value as MarginMode)}>
                <option value="cross">{t('okx.cross')}</option>
                <option value="isolated">{t('okx.isolated')}</option>
              </select>
            </label>
            <div className="field">
              <span>{t('okx.positionMode')}</span>
              <strong className="big">{t(`okx.${account.positionMode}`)}</strong>
            </div>
          </div>
          {gap !== null && Math.abs(gap) > DEMO_GAP_LIMIT && (
            <p className="notice" data-block="demo-gap">{t('okx.demoGap', { demo: fmtPrice(demoLast as number), real: fmtPrice(lastPrice as number), pct: fmtPct(Math.abs(gap), 2), dir: t(gap > 0 ? 'okx.above' : 'okx.below') })}</p>
          )}
          {okxLeverage !== null && okxLeverage !== leverage && <p className="notice">{t('okx.leverageDiffers', { okx: fmtNum(okxLeverage, 0), tool: leverage })}</p>}

          {confirm ? (
            <div className="confirm" role="alertdialog">
              <p>
                <strong>{t('okx.confirmTitle')}</strong>
              </p>
              <p>
                {t('okx.confirmLine', {
                  side: t(`ticket.${check.side}`),
                  contracts: confirm.sz,
                  size: fmtNum(Number(confirm.sz) * symbol.contractSize, 2),
                  asset: symbol.id,
                  inst: confirm.instId,
                  type: confirm.ordType === 'limit' ? t('ticket.limit', { price: fmtPrice(levels.entry) }) : t('ticket.market').toLowerCase(),
                  tp: fmtPrice(levels.target),
                  sl: fmtPrice(levels.stop),
                })}
              </p>
              <span className="actions left">
                <button className="primary" data-action="confirm" onClick={send}>{t('okx.confirm')}</button>
                <button onClick={() => setConfirm(null)}>{t('okx.cancel')}</button>
              </span>
            </div>
          ) : (
            <span className="actions left">
              <button className="primary" data-action="send" disabled={busy || blocked !== ''} onClick={prepare}>{busy ? t('okx.sending') : t('okx.send')}</button>
              <button onClick={forget}>{t('okx.forget')}</button>
            </span>
          )}
          {blocked && <p className="muted small">{blocked}</p>}
          {sent && <p className={sent.ok ? 'result good' : 'notice'}>{sent.text}</p>}
          <p className="muted small">{t('okx.note')}</p>
        </>
      )}
    </div>
  );
}
