import { useEffect, useState } from 'react';
import type { FearGreed } from '../feed/fearGreed';
import type { MarketSymbol } from '../feed/okx';
import { addOiSample, fetchContext, fundingPerYear, fundingTone, oiChange, type Funding, type OiSample } from '../feed/okxContext';
import type { LongTerm } from '../core/longTerm';
import { fmtNum, fmtPct, fmtPrice, fmtTime, t } from '../i18n';
import { loadJson, saveJson } from './storage';

/** Open-interest samples kept by this browser, per market, to measure its change (OKX gives only the current value). */
export const OI_KEY = 'murphy-signal-lab.oi.v1';
const REFRESH = 60_000;

export interface MarketContext {
  funding: Funding | null;
  oi: OiSample | null;
  oiDelta: { pct: number; hours: number } | null;
}
const EMPTY: MarketContext = { funding: null, oi: null, oiDelta: null };

/** Funding rate and open interest of the market on screen, refreshed every minute. Empty until the first answer. */
export function useMarketContext(symbol: MarketSymbol): MarketContext {
  const [ctx, setCtx] = useState<MarketContext>(EMPTY);
  useEffect(() => {
    setCtx(EMPTY);
    const abort = new AbortController();
    const load = async () => {
      const next = await fetchContext(symbol, abort.signal);
      if (abort.signal.aborted) return;
      let oiDelta: MarketContext['oiDelta'] = null;
      if (next.oi) {
        const all = loadJson<Record<string, OiSample[]>>(OI_KEY, {});
        const stored = all[symbol.id];
        const samples = Array.isArray(stored) ? stored.filter((s) => Number.isFinite(s?.time) && s?.usd > 0) : [];
        oiDelta = oiChange(samples, next.oi);
        saveJson(OI_KEY, { ...all, [symbol.id]: addOiSample(samples, next.oi) });
      }
      // A failed refresh keeps the last good value on screen instead of blanking the chip.
      setCtx((prev) => ({ funding: next.funding ?? prev.funding, oi: next.oi ?? prev.oi, oiDelta: next.oi ? oiDelta : prev.oiDelta }));
    };
    load();
    const timer = window.setInterval(load, REFRESH);
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, [symbol.id]);
  return ctx;
}

const signed = (v: number, digits: number) => `${v > 0 ? '+' : ''}${fmtPct(v, digits)}`;
/** Time left as "5 h 51 min" or "51 min". */
export function timeLeft(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

/**
 * One strip for everything that is context and not a signal: market sentiment, funding and open interest.
 * Each chip gives the reading in a word or two; the full explanation is in its tooltip.
 */
export function ContextStrip({ mood, context, asset, long, onLong }: { mood: FearGreed | null; context: MarketContext; asset: string; long: LongTerm | null; onLong: () => void }) {
  const { funding, oi, oiDelta } = context;
  if (!mood && !funding && !oi && !long) return null;
  const tone = funding ? fundingTone(funding.rate) : 'flat';
  return (
    <div className="field inline context" data-block="context">
      <span>{t('ctx.label')}</span>
      <span className="chips">
        {long && long.trend !== 'unknown' && (
          <button className={`mood-chip ${long.trend === 'up' ? 'greed' : long.trend === 'down' ? 'fear' : ''}`} data-chip="long" title={`${t(`long.lead.${long.trend}`, { close: fmtPrice(long.close), fast: fmtPrice(long.sma50 ?? 0), slow: fmtPrice(long.sma200 ?? 0) })} ${t('long.chipHint')}`} onClick={onLong}>
            <span className="k">{t('long.chip')}</span> <strong>{t(`long.${long.trend}`)}</strong>
          </button>
        )}
        {mood && (
          <a className={`mood-chip ${mood.mood}`} data-chip="mood" href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noreferrer" title={t('mood.title', { prev: mood.previous ?? '–' })}>
            <span className="k">{t('mood.short')}</span> <strong>{mood.value}</strong> {t(`mood.${mood.mood}`)}
          </a>
        )}
        {funding && (
          <span
            className={`mood-chip ${tone === 'longsCrowded' || tone === 'shortsCrowded' ? 'hot' : ''}`}
            data-chip="funding"
            tabIndex={0}
            title={`${t('ctx.fundingTitle', { asset, rate: signed(funding.rate, 4), h: fmtNum(funding.periodHours, 0), year: signed(fundingPerYear(funding), 1), left: timeLeft(funding.settleTime - Date.now()), time: fmtTime(funding.settleTime) })} ${t(`ctx.tone.${tone}`)} ${t('ctx.noRule')}`}
          >
            <span className="k">{t('ctx.funding')}</span> <strong>{signed(funding.rate, 4)}</strong> {t(`ctx.short.${tone}`)}
          </span>
        )}
        {oi && (
          <span
            className="mood-chip"
            data-chip="oi"
            tabIndex={0}
            title={`${t('ctx.oiTitle', { asset, usd: fmtNum(oi.usd / 1e6, 0) })} ${oiDelta ? t('ctx.oiChange', { pct: signed(oiDelta.pct, 2), h: fmtNum(oiDelta.hours, 1) }) : t('ctx.oiNoChange')} ${t('ctx.oiMurphy')} ${t('ctx.noRule')}`}
          >
            <span className="k">{t('ctx.oi')}</span> <strong>{fmtNum(oi.usd / 1e6, 0)} M</strong>
            {oiDelta && <span className={oiDelta.pct >= 0 ? 'up' : 'down'}> {oiDelta.pct >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(oiDelta.pct), 1)}</span>}
          </span>
        )}
      </span>
    </div>
  );
}
