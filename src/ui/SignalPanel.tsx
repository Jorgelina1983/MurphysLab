import { useState } from 'react';
import type { Signal } from '../core/rule/types';
import type { StrategyConfig } from '../core/rules/strategy';
import type { MarketSymbol } from '../feed/okx';
import { fmtNum, fmtPrice, fmtTime, t } from '../i18n';
import { COUNT_CONDITIONS, PLAIN_CONDITIONS, Panel } from './panels';

interface Props {
  signal: Signal | null;
  /** True when the signal shown is the most recent one, false when it was picked from the list. */
  latest: boolean;
  strategy: StrategyConfig;
  symbol: MarketSymbol;
  tf: string;
  trendTf: string;
  /** Load this signal's levels into the order form and show it. */
  onPrepare: () => void;
}

/** Indicator values are small for MACD and large for prices; show enough digits for both. */
const fmtVal = (v: number) => fmtNum(v, Math.abs(v) >= 1000 ? 1 : 2);

function references(s: StrategyConfig): string {
  const parts: string[] = [];
  if (s.bollinger.on) parts.push(t('ref.bollinger'));
  if (s.rsi.on) parts.push(t('ref.rsi'));
  if (s.macd.on) parts.push(t('ref.macd'));
  if (s.ma.on || s.trend.mode !== 'off') parts.push(t('ref.ma'));
  if (s.sr.on || s.target.kind === 'level') parts.push(t('ref.sr'));
  if (s.fib.on || s.target.kind === 'fib') parts.push(t('ref.fib'));
  if (s.stoch.on) parts.push(t('ref.stoch'));
  if (s.div.on) parts.push(t('ref.div'));
  if (s.tl.on) parts.push(t('ref.tl'));
  if (s.pattern.on || s.target.kind === 'pattern') parts.push(t('ref.pattern'));
  if (s.volume.on) parts.push(t('ref.volume'));
  return parts.join('; ');
}

/** The reasons for a signal as plain sentences: what fired, with the values, and where the exits sit and why. */
export function explain(signal: Signal, s: StrategyConfig, symbol: MarketSymbol, tf: string, trendTf: string): string[] {
  const conditions = signal.conditions.map((c) => {
    const text = c.label ? t(c.label, { tf: trendTf }) : c.text;
    if (c.left === null || c.right === null || PLAIN_CONDITIONS.has(c.label ?? '')) return text;
    const show = COUNT_CONDITIONS.has(c.label ?? '') ? (v: number) => fmtNum(v, 0) : fmtVal;
    return `${text} (${show(c.left)} ${t('explain.vs')} ${show(c.right)})`;
  });
  const risk = Math.abs(signal.reference - signal.stop);
  const reward = Math.abs(signal.target - signal.reference);
  const stopWhy = s.stop.kind === 'swing' ? t(`explain.stop.swing.${signal.side}`, { n: s.stop.lookback }) : s.stop.kind === 'atr' ? t('explain.stop.atr', { mult: fmtNum(s.stop.atrMult, 1), n: s.stop.atrLength }) : t(`explain.stop.candles.${signal.side}`);
  const targetWhy =
    s.target.kind === 'basis' ? t('explain.target.basis', { n: s.bollinger.length }) : s.target.kind === 'level' ? t(`explain.target.level.${signal.side}`) : s.target.kind === 'fib' ? t(`explain.target.fib.${signal.side}`) : s.target.kind === 'pattern' ? t('explain.target.pattern') : t('explain.target.rr', { rr: fmtNum(s.target.rr, 1) });
  return [
    t('explain.head', { side: t(`side.${signal.side}`), symbol: symbol.label, tf, time: fmtTime(signal.time), price: fmtPrice(signal.reference) }),
    ...conditions.map((c, i) => `${i + 1}. ${c}.`),
    t('explain.stop', { price: fmtPrice(signal.stop), why: stopWhy }),
    t('explain.target', { price: fmtPrice(signal.target), why: targetWhy }),
    t('explain.ratio', { rr: risk > 0 ? fmtNum(reward / risk, 2) : '–' }),
    t('explain.refs', { refs: references(s) }),
  ];
}

export function SignalExplain({ signal, latest, strategy, symbol, tf, trendTf, onPrepare }: Props) {
  const [copied, setCopied] = useState(false);
  if (!signal) {
    return (
      <Panel title={t('signal.title')}>
        <p className="muted">{t('signal.none')}</p>
      </Panel>
    );
  }
  const lines = explain(signal, strategy, symbol, tf, trendTf);
  const n = signal.conditions.length;
  const copy = () =>
    navigator.clipboard?.writeText(lines.join('\n')).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  return (
    <Panel title={t('signal.title')} actions={<span className={`badge ${signal.side === 'long' ? 'good' : 'bad'}`}>{latest ? t('signal.latest') : t('signal.picked')}</span>}>
      <div className="explain">
        <p><strong>{lines[0]}</strong></p>
        <ol>
          {lines.slice(1, n + 1).map((l, i) => (
            <li key={i}>{l.replace(/^\d+\. /, '')}</li>
          ))}
        </ol>
        {lines.slice(n + 1, n + 4).map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        <p className="muted small">{lines[n + 4]}</p>
      </div>
      <span className="actions left">
        <button className="primary" onClick={onPrepare}>{t('signal.prepare')}</button>
        <button onClick={copy}>{copied ? t('signal.copied') : t('signal.copy')}</button>
      </span>
    </Panel>
  );
}
