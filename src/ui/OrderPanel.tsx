import { useState } from 'react';
import { MURPHY_THRESHOLDS, suggestSize, type TradeCheckResult } from '../core/tradeCheck';
import type { MarketSymbol } from '../feed/okx';
import { fmtMoney, fmtNum, fmtPct, fmtPrice, t } from '../i18n';
import type { ChartLevels } from './Chart';
import { OkxDemo } from './OkxDemo';
import { Info, Num, Panel, TradeCheckResultView } from './panels';
import type { Settings } from './settings';

interface Props {
  symbol: MarketSymbol;
  levels: ChartLevels;
  onLevels: (next: ChartLevels) => void;
  size: number;
  onSize: (v: number) => void;
  settings: Settings;
  onSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  check: TradeCheckResult;
  lastPrice: number | undefined;
  /** Refill the form from the most recent signal. `null` when there is none. */
  onLatestSignal: (() => void) | null;
  /** Orders that can be placed before a signal: a limit at a level the rule watches, with stop and target. */
  pending: { key: string; label: string; levels: ChartLevels }[];
  onPending: (p: { label: string; levels: ChartLevels }) => void;
  /** Log an order in the history: one that went to OKX, or one the user typed there by hand. */
  onRecord: (outcome: { status: 'sent' | 'refused' | 'manual'; ordId?: string; error?: string; contracts: number }) => void;
}

/**
 * One form for an order: the levels, the size, whether the trade is worth its
 * risk, and the text to type into OKX demo. The tool sends nothing.
 */
export function OrderPanel({ symbol, levels, onLevels, size, onSize, settings, onSetting, check, lastPrice, onLatestSignal, pending, onPending, onRecord }: Props) {
  const [copied, setCopied] = useState(false);
  const [logged, setLogged] = useState(false);
  const valid = check.verdict !== 'invalid' && check.side !== null;
  const suggestion = suggestSize({ entry: levels.entry, stop: levels.stop, capital: settings.capital, riskPct: settings.riskPct, leverage: settings.leverage, sizeStep: symbol.sizeStep });
  const dir = check.side === 'long' ? 1 : -1;
  // Levels are stale once the price has gone through the stop or the target.
  const stale = valid && lastPrice !== undefined && (dir * (lastPrice - levels.stop) <= 0 || dir * (levels.target - lastPrice) <= 0);
  const moved = valid && lastPrice !== undefined && levels.entry > 0 ? (lastPrice - levels.entry) / levels.entry : 0;
  const ticket = valid
    ? [
        t('ticket.mode'),
        `${t('ticket.instrument')}: ${symbol.instId}`,
        `${t('ticket.side')}: ${t(`ticket.${check.side}`)}`,
        `${t('ticket.type')}: ${settings.entryOrder === 'limit' ? t('ticket.limit', { price: fmtPrice(levels.entry) }) : t('ticket.market')}`,
        `${t('ticket.size')}: ${fmtNum(size, 2)} ${symbol.id}`,
        `${t('ticket.leverage')}: ${settings.leverage}x`,
        `${t('ticket.tp')}: ${fmtPrice(levels.target)}`,
        `${t('ticket.sl')}: ${fmtPrice(levels.stop)}`,
      ]
    : [];
  const copy = () =>
    navigator.clipboard?.writeText(ticket.join('\n')).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  const empty = levels.entry === 0 && levels.stop === 0 && levels.target === 0;

  return (
    <Panel title={t('order.title')} actions={<button disabled={!onLatestSignal} onClick={() => onLatestSignal?.()}>{t('trade.fromSignal')}</button>}>
      {empty && <p className="muted">{t('order.empty')}</p>}
      {stale && <p className="notice">{t('ticket.stale', { price: fmtPrice(lastPrice as number) })}</p>}
      {!stale && Math.abs(moved) > 0.0005 && <p className="muted small">{t('ticket.moved', { price: fmtPrice(lastPrice as number), pct: fmtPct(moved, 2) })}</p>}

      {pending.length > 0 && (
        <div className="pending" data-block="pending">
          <span className="muted small">{t('pending.title')}</span>
          {pending.map((p) => (
            <button key={p.key} onClick={() => onPending(p)}>{p.label}</button>
          ))}
        </div>
      )}
      <div className="grid3" data-block="levels">
        <Num label={t('trade.entry')} value={levels.entry} step={0.1} onChange={(entry) => onLevels({ ...levels, entry })} />
        <Num label={t('trade.stop')} value={levels.stop} step={0.1} onChange={(stop) => onLevels({ ...levels, stop })} />
        <Num label={t('trade.target')} value={levels.target} step={0.1} onChange={(target) => onLevels({ ...levels, target })} />
        <Num label={t('trade.size', { asset: symbol.id })} value={size} step={symbol.sizeStep} min={0} onChange={onSize} />
        <Num label={t('ticket.riskPct')} value={settings.riskPct} step={0.25} min={0.1} onChange={(v) => v > 0 && onSetting('riskPct', v)} />
        <label className="field">
          <span>{t('trade.entryOrder')}</span>
          <select value={settings.entryOrder} onChange={(e) => onSetting('entryOrder', e.target.value as Settings['entryOrder'])}>
            <option value="market">{t('trade.market')}</option>
            <option value="limit">{t('trade.limit')}</option>
          </select>
        </label>
      </div>
      {valid && (
        <p className="suggest small">
          {suggestion.size > 0 ? (
            <>
              <span>
                {suggestion.capped
                  ? t('ticket.capped', { size: fmtNum(suggestion.size, 2), pct: fmtPct(MURPHY_THRESHOLDS.maxMarginOnCapital, 0), wanted: fmtNum(suggestion.byRisk, 2), asset: symbol.id })
                  : t('order.suggested', { size: fmtNum(suggestion.size, 2), asset: symbol.id, pct: String(settings.riskPct).replace('.', ',') })}
              </span>
              {Math.abs(suggestion.size - size) > 1e-9 && <button onClick={() => onSize(suggestion.size)}>{t('order.useSuggested')}</button>}
            </>
          ) : (
            <span className="warn">{t('ticket.tooSmall', { step: symbol.sizeStep, asset: symbol.id })}</span>
          )}
        </p>
      )}

      {!empty && <TradeCheckResultView r={check} />}

      <OkxDemo
        symbol={symbol}
        levels={levels}
        size={size}
        type={settings.entryOrder}
        check={check}
        lastPrice={lastPrice}
        stale={stale}
        marginMode={settings.marginMode}
        onMarginMode={(m) => onSetting('marginMode', m)}
        leverage={settings.leverage}
        onOutcome={onRecord}
      />

      {valid && size > 0 && (
        <details className="info" data-block="manual">
          <summary>{t('ticket.title')}</summary>
          <pre className="ticket">{ticket.join('\n')}</pre>
          <span className="actions left">
            <button onClick={copy}>{copied ? t('signal.copied') : t('ticket.copy')}</button>
            <button data-action="log-manual" onClick={() => { onRecord({ status: 'manual', contracts: Math.floor(size / symbol.contractSize + 1e-9) }); setLogged(true); setTimeout(() => setLogged(false), 1500); }}>{logged ? t('history.logged') : t('history.logManual')}</button>
          </span>
          <p className="muted small">{t('ticket.note')}</p>
        </details>
      )}

      <details className="info" data-block="account">
        <summary>{t('order.account', { capital: fmtMoney(settings.capital), lev: settings.leverage, taker: String(settings.feeTakerPct).replace('.', ',') })}</summary>
        <div className="grid2">
          <Num label={t('trade.capital')} value={settings.capital} step={100} min={0} onChange={(v) => onSetting('capital', v)} />
          <Num label={t('trade.leverage')} value={settings.leverage} min={1} onChange={(v) => onSetting('leverage', v)} />
          <Num label={t('trade.feeMaker')} value={settings.feeMakerPct} step={0.005} min={0} onChange={(v) => onSetting('feeMakerPct', v)} />
          <Num label={t('trade.feeTaker')} value={settings.feeTakerPct} step={0.005} min={0} onChange={(v) => onSetting('feeTakerPct', v)} />
        </div>
      </details>
      <Info>
        <p>{t('trade.exitNote')}</p>
        <p>{t('verdict.basis')}</p>
      </Info>
    </Panel>
  );
}
