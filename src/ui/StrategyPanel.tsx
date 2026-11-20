import { useEffect, useState, type ReactNode } from 'react';
import {
  BUILTIN_STRATEGIES,
  ENTRY_BLOCKS,
  STRATEGY_KINDS,
  activeBlocks,
  classifyStrategy,
  eventBlocks,
  mixesReversalAndMomentum,
  normalizeStrategy,
  type EntryBlock,
  type StrategyConfig,
  type StrategyKind,
} from '../core/rules/strategy';
import { fmtNum, t } from '../i18n';
import { Info, Num, Panel } from './panels';
import type { Preset } from './settings';

interface Props {
  strategy: StrategyConfig;
  onChange: (next: StrategyConfig) => void;
  timeoutBars: number;
  onTimeout: (v: number) => void;
  /** Name of the higher timeframe the trend filter would use, e.g. `1h`. */
  trendTf: string;
  /** Parameter sets tried in this session. */
  tries: number;
  /** Combinations saved by the user. */
  presets: Preset[];
  onLoad: (strategy: StrategyConfig, timeoutBars: number) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}

const PAGES: Record<EntryBlock | 'trend', string> = { bollinger: 'pp. 209–213', rsi: 'pp. 239–246', stoch: 'pp. 246–249', macd: 'pp. 252–256', ma: 'pp. 195–208', sr: 'pp. 55–65', fib: 'pp. 334–338', div: 'pp. 226–228 y 239–246', tl: 'pp. 65–85', pattern: 'pp. 117–121', volume: 'pp. 162–169', trend: 'pp. 195–208' };

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * One indicator as a single line with a summary of its settings; it opens to its
 * controls when asked. `onToggle` adds a checkbox (the trend filter, or showing
 * an indicator on the chart); without it the block is a fixed part of the rule.
 */
function Block({ id, scope, on, onToggle, summary, open, onOpen, children }: { id: string; scope: 'rule' | 'chart'; on: boolean; onToggle?: (v: boolean) => void; summary: string; open: boolean; onOpen: (v: boolean) => void; children: ReactNode }) {
  const name = <strong>{t(`block.${id}`)}</strong>;
  return (
    <div className={on ? 'block on' : 'block'} data-block={id} data-scope={scope}>
      <div className="block-head">
        {onToggle ? (
          <label>
            <input type="checkbox" checked={on} onChange={(e) => { onToggle(e.target.checked); onOpen(e.target.checked && scope === 'rule'); }} />
            {name}
          </label>
        ) : (
          name
        )}
        <button className="block-toggle" aria-expanded={open} title={open ? t('blocks.close') : t('blocks.edit')} onClick={() => onOpen(!open)}>
          <span>{summary}</span>
          <span className="chev">{open ? '▾' : '▸'}</span>
        </button>
      </div>
      {open && (
        <>
          <div className="grid2">{children}</div>
          <p className="muted small pages">Murphy (1999), {PAGES[id as EntryBlock]}</p>
        </>
      )}
    </div>
  );
}

type Setter = <K extends keyof StrategyConfig>(key: K, patch: Partial<StrategyConfig[K]>) => void;

/** One-line summaries and parameter fields of every indicator block, for the rule and for the explore tab alike. */
function blockUi(s: StrategyConfig, set: Setter) {
  // Lower-case the first letter so the text can follow the summary, leaving names such as OBV or %K as written.
  const mode = (key: string, vars: Record<string, string | number> = {}) => {
    const text = t(key, vars);
    return /^[A-ZÁÉÍÓÚ][a-záéíóúñ ]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
  };
  const summary: Record<EntryBlock, string> = {
    bollinger: `${s.bollinger.length} · ${s.bollinger.mult}σ`,
    rsi: `${s.rsi.length} · ${s.rsi.overbought}/${s.rsi.oversold}`,
    macd: `${s.macd.fast}/${s.macd.slow}/${s.macd.signal}`,
    ma: `${s.ma.type.toUpperCase()} ${s.ma.mode === 'cross' || !s.ma.on ? `${s.ma.fast}/` : ''}${s.ma.slow}`,
    sr: `±${s.sr.strength} velas${s.sr.on && s.sr.minTests > 1 ? ` · ×${s.sr.minTests}+` : ''}`,
    fib: `±${s.fib.strength} velas · 38/50/62%`,
    stoch: `${s.stoch.length}/${s.stoch.smooth}/${s.stoch.signal} · ${s.stoch.overbought}/${s.stoch.oversold}`,
    div: `${t(`osc.${s.div.osc}`)} · ±${s.div.strength} velas`,
    volume: `${t('p.volAvg', { n: s.volume.length })}`,
    tl: `±${s.tl.strength} velas${s.tl.on && s.tl.minTouches > 2 ? ` · ×${s.tl.minTouches}+` : ''}`,
    pattern: `±${s.pattern.strength} velas · ${fmtNum(s.pattern.tolerance, 1)}%`,
  };
  const condition: Record<EntryBlock, string> = {
    bollinger: mode(`mode.bb.${s.bollinger.mode}`),
    rsi: mode(`mode.rsi.${s.rsi.mode}`),
    macd: mode(`mode.macd.${s.macd.mode}`),
    ma: mode(`mode.ma.${s.ma.mode}`),
    sr: mode(`mode.sr.${s.sr.mode}`),
    fib: mode('mode.fib.bounce'),
    stoch: mode(`mode.stoch.${s.stoch.mode}`),
    div: mode(s.div.zone ? 'mode.div.zone' : 'mode.div.any'),
    tl: mode('mode.tl.break'),
    pattern: mode('mode.pattern.complete'),
    volume: s.volume.mode === 'above' ? mode('mode.volume.aboveN', { n: fmtNum(s.volume.mult, 1) }) : mode('mode.volume.obv'),
  };
  /** The parameters of a block. In the rule, Bollinger and RSI also offer the variants that keep their meaning. */
  const fields = (id: EntryBlock, inRule: boolean): ReactNode => {
    switch (id) {
      case 'bollinger':
        return (
          <>
            <Num label={t('p.length')} value={s.bollinger.length} min={2} onChange={(length) => set('bollinger', { length })} />
            <Num label={t('p.mult')} value={s.bollinger.mult} step={0.1} min={0.1} onChange={(mult) => set('bollinger', { mult })} />
            {inRule && <Select label={t('p.condition')} value={s.bollinger.mode} onChange={(m) => set('bollinger', { mode: m })} options={[['reversal', t('mode.bb.reversal')], ['touch', t('mode.bb.touch')]]} />}
          </>
        );
      case 'rsi':
        return (
          <>
            <Num label={t('p.length')} value={s.rsi.length} min={2} onChange={(length) => set('rsi', { length })} />
            {inRule ? <Select label={t('p.condition')} value={s.rsi.mode} onChange={(m) => set('rsi', { mode: m })} options={[['extreme', t('mode.rsi.extreme')], ['now', t('mode.rsi.now')], ['exit', t('mode.rsi.exit')]]} /> : <span />}
            <Num label={t('p.overbought')} value={s.rsi.overbought} onChange={(overbought) => set('rsi', { overbought })} />
            <Num label={t('p.oversold')} value={s.rsi.oversold} onChange={(oversold) => set('rsi', { oversold })} />
          </>
        );
      case 'macd':
        return (
          <>
            <Num label={t('p.fast')} value={s.macd.fast} min={2} onChange={(fast) => set('macd', { fast })} />
            <Num label={t('p.slow')} value={s.macd.slow} min={3} onChange={(slow) => set('macd', { slow })} />
            <Num label={t('p.signal')} value={s.macd.signal} min={2} onChange={(signal) => set('macd', { signal })} />
            {inRule && (
              <label className="field check">
                <input type="checkbox" checked={s.macd.zero} onChange={(e) => set('macd', { zero: e.target.checked })} />
                <span>{t('p.macdZero')}</span>
              </label>
            )}
          </>
        );
      case 'ma':
        return (
          <>
            <Select label={t('p.maType')} value={s.ma.type} onChange={(type) => set('ma', { type })} options={[['sma', t('p.sma')], ['ema', t('p.ema')]]} />
            {(!inRule || s.ma.mode === 'cross') && <Num label={t('p.fast')} value={s.ma.fast} min={2} onChange={(fast) => set('ma', { fast })} />}
            <Num label={t('p.slow')} value={s.ma.slow} min={3} onChange={(slow) => set('ma', { slow })} />
          </>
        );
      case 'sr':
        return (
          <>
            <Num label={t('p.srStrength')} value={s.sr.strength} min={1} onChange={(strength) => set('sr', { strength })} />
            <Num label={t('p.srLookback')} value={s.sr.lookback} min={10} step={10} onChange={(lookback) => set('sr', { lookback })} />
            {inRule && s.sr.mode === 'bounce' && <Num label={t('p.srTolerance')} value={s.sr.tolerance} step={0.05} min={0} onChange={(tolerance) => set('sr', { tolerance })} />}
            {inRule && <Num label={t('p.srMinTests')} value={s.sr.minTests} min={1} onChange={(minTests) => set('sr', { minTests })} />}
          </>
        );
      case 'fib':
        return (
          <>
            <Num label={t('p.srStrength')} value={s.fib.strength} min={1} onChange={(strength) => set('fib', { strength })} />
            <Num label={t('p.srLookback')} value={s.fib.lookback} min={10} step={10} onChange={(lookback) => set('fib', { lookback })} />
            {inRule && <Num label={t('p.srTolerance')} value={s.fib.tolerance} step={0.05} min={0} onChange={(tolerance) => set('fib', { tolerance })} />}
          </>
        );
      case 'stoch':
        return (
          <>
            <Num label={t('p.length')} value={s.stoch.length} min={2} onChange={(length) => set('stoch', { length })} />
            {inRule ? <Select label={t('p.condition')} value={s.stoch.mode} onChange={(m) => set('stoch', { mode: m })} options={[['cross', t('mode.stoch.cross')], ['zone', t('mode.stoch.zone')]]} /> : <span />}
            <Num label={t('p.stochSmooth')} value={s.stoch.smooth} min={1} onChange={(smooth) => set('stoch', { smooth })} />
            <Num label={t('p.stochSignal')} value={s.stoch.signal} min={1} onChange={(signal) => set('stoch', { signal })} />
            <Num label={t('p.overbought')} value={s.stoch.overbought} onChange={(overbought) => set('stoch', { overbought })} />
            <Num label={t('p.oversold')} value={s.stoch.oversold} onChange={(oversold) => set('stoch', { oversold })} />
          </>
        );
      case 'div':
        return (
          <>
            <Select label={t('p.divOsc')} value={s.div.osc} onChange={(osc) => set('div', { osc })} options={[['rsi', t('osc.rsi')], ['stoch', t('osc.stoch')], ['macd', t('osc.macd')]]} />
            <Num label={t('p.srStrength')} value={s.div.strength} min={1} onChange={(strength) => set('div', { strength })} />
            <Num label={t('p.divLookback')} value={s.div.lookback} min={5} step={5} onChange={(lookback) => set('div', { lookback })} />
            <label className="field check">
              <input type="checkbox" checked={s.div.zone} onChange={(e) => set('div', { zone: e.target.checked })} />
              <span>{t(s.div.osc === 'macd' ? 'p.divZoneMacd' : 'p.divZone')}</span>
            </label>
            {/* The divergence is read on this oscillator, with the oscillator's own lengths and areas. */}
            {!s[s.div.osc].on && fields(s.div.osc, false)}
          </>
        );
      case 'tl':
        return (
          <>
            <Num label={t('p.srStrength')} value={s.tl.strength} min={1} onChange={(strength) => set('tl', { strength })} />
            <Num label={t('p.srLookback')} value={s.tl.lookback} min={10} step={10} onChange={(lookback) => set('tl', { lookback })} />
            {inRule && <Num label={t('p.tlMinTouches')} value={s.tl.minTouches} min={2} onChange={(minTouches) => set('tl', { minTouches })} />}
          </>
        );
      case 'pattern':
        return (
          <>
            <Num label={t('p.srStrength')} value={s.pattern.strength} min={1} onChange={(strength) => set('pattern', { strength })} />
            <Num label={t('p.patLookback')} value={s.pattern.lookback} min={10} step={10} onChange={(lookback) => set('pattern', { lookback })} />
            <Num label={t('p.patTolerance')} value={s.pattern.tolerance} step={0.1} min={0.1} onChange={(tolerance) => set('pattern', { tolerance })} />
            <Num label={t('p.patMinHeight')} value={s.pattern.minHeight} step={0.5} min={0} onChange={(minHeight) => set('pattern', { minHeight })} />
          </>
        );
      case 'volume':
        return (
          <>
            <Num label={t('p.length')} value={s.volume.length} min={2} onChange={(length) => set('volume', { length })} />
            {inRule ? <Select label={t('p.condition')} value={s.volume.mode} onChange={(m) => set('volume', { mode: m })} options={[['above', t('mode.volume.above')], ['obv', t('mode.volume.obv')]]} /> : <span />}
            {(!inRule || s.volume.mode === 'above') && <Num label={t('p.volMult')} value={s.volume.mult} step={0.1} min={0.1} onChange={(mult) => set('volume', { mult })} />}
          </>
        );
    }
  };
  return { summary, condition, fields };
}

/**
 * The rule tab. A rule is picked from combinations sorted by what they look
 * for, then tuned. Indicators outside the rule can still be drawn on the chart
 * for study; that never changes the signals.
 */
export function StrategyPanel({ strategy: s, onChange, timeoutBars, onTimeout, trendTf, tries, presets, onLoad, onSave, onDelete }: Props) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const all = [
    ...BUILTIN_STRATEGIES.map((b) => ({ key: `builtin:${b.id}`, saved: false, label: t(`preset.${b.id}`), about: t(`preset.${b.id}.about`), kind: b.kind, strategy: b.strategy, timeoutBars: b.timeoutBars })),
    ...presets.map((p) => {
      const strategy = normalizeStrategy(p.strategy);
      return { key: `saved:${p.name}`, saved: true, label: p.name, about: t('preset.yours'), kind: classifyStrategy(strategy), strategy, timeoutBars: p.timeoutBars };
    }),
  ];
  // A combination shows as chosen only while the rule on screen still matches it.
  const now = JSON.stringify(normalizeStrategy(s));
  const matches = all.filter((p) => JSON.stringify(p.strategy) === now && p.timeoutBars === timeoutBars);
  const current = matches.find((p) => p.saved) ?? matches[0]; // a saved copy of an example wins: it is the one just saved
  const ruleKind = classifyStrategy(s);
  const [kind, setKind] = useState<StrategyKind>(ruleKind);
  // When the rule changes kind from outside this panel (a combination loaded from the Explorar analysis), show that kind.
  useEffect(() => setKind(ruleKind), [ruleKind]);
  const trimmed = name.trim();
  const set: Setter = (key, patch) => onChange({ ...s, [key]: { ...s[key], ...patch } });
  const mode = (key: string) => t(key).toLowerCase();
  const events = eventBlocks(s);

  const { summary, condition, fields } = blockUi(s, set);
  const blockProps = (id: string, scope: 'rule' | 'chart') => ({ id, scope, open: open[`${scope}:${id}`] ?? false, onOpen: (v: boolean) => setOpen((o) => ({ ...o, [`${scope}:${id}`]: v })) });
  // The trigger (the block that fires on one candle) is listed first, then its confirmations.
  const inRule = ENTRY_BLOCKS.filter((id) => s[id].on).sort((a, b) => Number(events.includes(b)) - Number(events.includes(a)));

  return (
    <>
      <Panel title={t('rule.title')}>
        <div className="kinds" role="tablist">
          {STRATEGY_KINDS.map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'kind active' : 'kind'} data-kind={k} onClick={() => setKind(k)}>
              {t(`kind.${k}`)}
              {ruleKind === k && <span className="dot current" title={t('kind.current')} />}
            </button>
          ))}
        </div>
        <p className="muted small">{t(`kind.${kind}.about`)}</p>
        <div className="preset-list">
          {all.filter((p) => p.kind === kind).map((p) => (
            <div key={p.key} className={matches.includes(p) ? 'preset active' : 'preset'} data-preset={p.key}>
              <button className="preset-pick" aria-pressed={matches.includes(p)} onClick={() => onLoad(p.strategy, p.timeoutBars)}>
                <strong>{p.label}</strong>
                <span className="muted small">{p.about}</span>
              </button>
              {p.saved && <button className="preset-del" title={t('preset.delete')} aria-label={`${t('preset.delete')} ${p.label}`} onClick={() => onDelete(p.label)}>×</button>}
            </div>
          ))}
        </div>

        <h3 className="section">
          {t('rule.tune')} <span className="muted small">{current ? current.label : t('preset.unsaved')}</span>
        </h3>
        {inRule.map((id) => (
          <Block key={id} {...blockProps(id, 'rule')} on summary={`${summary[id]} · ${condition[id]}`}>
            {fields(id, true)}
          </Block>
        ))}
        <Block {...blockProps('trend', 'rule')} on={s.trend.mode !== 'off'} onToggle={(on) => set('trend', { mode: on ? 'higher' : 'off' })} summary={s.trend.mode === 'off' ? t('trend.off') : `SMA ${s.trend.length} · ${s.trend.mode === 'same' ? mode('params.trendSame') : trendTf}`}>
          <Select label={t('p.trendWhere')} value={s.trend.mode === 'off' ? 'higher' : s.trend.mode} onChange={(m) => set('trend', { mode: m })} options={[['higher', t('params.trendHigher', { tf: trendTf })], ['same', t('params.trendSame')]]} />
          <Num label={t('params.trendLength')} value={s.trend.length} min={2} onChange={(length) => set('trend', { length })} />
        </Block>

        {activeBlocks(s) === 0 && <p className="notice">{t('blocks.none')}</p>}
        {mixesReversalAndMomentum(s) && <p className="notice">{t('blocks.conflict')}</p>}
        {events.length >= 2 && !mixesReversalAndMomentum(s) && <p className="notice">{t('blocks.twoCrosses')}</p>}

        <div className="grid2 exits" data-block="exits">
          <Select label={t('exits.stop')} value={s.stop.kind} onChange={(k) => set('stop', { kind: k })} options={[['candles', t('stop.candles')], ['swing', t('stop.swing')], ['atr', t('stop.atr')]]} />
          {s.stop.kind === 'swing' && <Num label={t('stop.lookback')} value={s.stop.lookback} min={2} onChange={(lookback) => set('stop', { lookback })} />}
          {s.stop.kind === 'atr' && <Num label={t('stop.atrMult')} value={s.stop.atrMult} step={0.1} min={0.1} onChange={(atrMult) => set('stop', { atrMult })} />}
          {s.stop.kind === 'candles' && <span />}
          <Select label={t('exits.target')} value={s.target.kind} onChange={(k) => set('target', { kind: k })} options={[['basis', t('target.basis')], ['rr', t('target.rr')], ['level', t('target.level')], ['fib', t('target.fib')], ['pattern', t('target.pattern')]]} />
          {s.target.kind === 'rr' ? <Num label={t('target.ratio')} value={s.target.rr} step={0.5} min={0.1} onChange={(rr) => set('target', { rr })} /> : <span />}
          <Num label={t('params.timeout')} value={timeoutBars} min={1} onChange={onTimeout} />
          {s.stop.kind === 'atr' && <Num label={t('stop.atrLength')} value={s.stop.atrLength} min={2} onChange={(atrLength) => set('stop', { atrLength })} />}
        </div>
        {s.target.kind === 'basis' && (s.macd.on || s.ma.on || s.fib.on) && <p className="notice">{t('exits.basisNote')}</p>}

        <div className="save-row" data-block="presets">
          <input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('preset.name')} aria-label={t('preset.name')} />
          <button disabled={trimmed === ''} onClick={() => { onSave(trimmed); setName(''); setKind(ruleKind); }}>
            {presets.some((p) => p.name === trimmed) ? t('preset.overwrite') : t('preset.save')}
          </button>
        </div>
        <Info>
          <p>{t('blocks.intro')}</p>
          {s.trend.mode !== 'off' && (
            <p>
              {t('params.trendNote')} {s.trend.mode === 'higher' && t('params.trendHigherNote', { tf: trendTf })}
            </p>
          )}
          {(s.sr.on || s.target.kind === 'level') && <p>{t('sr.note', { n: s.sr.strength })}</p>}
          {(s.fib.on || s.target.kind === 'fib') && <p>{t('fib.note', { n: s.fib.strength })}</p>}
          {s.div.on && <p>{t('div.note', { n: s.div.strength })}</p>}
          {s.tl.on && <p>{t('tl.note', { n: s.tl.strength })}</p>}
          {(s.pattern.on || s.target.kind === 'pattern') && <p>{t('pattern.note')}</p>}
          {s.volume.on && <p>{t('volume.note')}</p>}
          {s.target.kind === 'level' && <p>{t('exits.levelNote')}</p>}
          {tries > 1 && <p>{t('params.tried', { n: tries })}</p>}
        </Info>
      </Panel>

    </>
  );
}

/**
 * The explore tab: any indicator, with its own parameters, drawn on the chart
 * for study. It has its own settings, so nothing here can change the rule; while
 * it is open the chart shows no signals.
 */
export function ExplorePanel({ config, onChange }: { config: StrategyConfig; onChange: (next: StrategyConfig) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const set: Setter = (key, patch) => onChange({ ...config, [key]: { ...config[key], ...patch } });
  const { summary, fields } = blockUi({ ...config, ma: { ...config.ma, mode: 'cross' } }, set);
  return (
    <Panel title={t('explore.title')}>
      <p className="muted small">{t('explore.about')}</p>
      {ENTRY_BLOCKS.map((id) => (
        <Block key={id} id={id} scope="chart" on={config[id].on} onToggle={(on) => set(id, { on } as Partial<StrategyConfig[typeof id]>)} summary={summary[id]} open={open[id] ?? false} onOpen={(v) => setOpen((o) => ({ ...o, [id]: v }))}>
          {fields(id, false)}
        </Block>
      ))}
    </Panel>
  );
}
