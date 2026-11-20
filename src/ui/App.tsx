import { useEffect, useMemo, useRef, useState } from 'react';
import { backtest, splitMetrics, type Trade } from '../core/backtest';
import { buildContext, compileRule, evaluateAt, scanSignals } from '../core/rule/engine';
import type { Signal } from '../core/rule/types';
import { relate } from '../core/rules/relations';
import { BUILTIN_STRATEGIES, DEFAULT_STRATEGY, ENTRY_BLOCKS, activeBlocks, classifyStrategy, makeStrategyRule, mixesReversalAndMomentum, normalizeStrategy, soloStrategies, type StrategyConfig } from '../core/rules/strategy';
import { suggestSize, tradeCheck } from '../core/tradeCheck';
import type { Candle } from '../core/types';
import { atr } from '../core/indicators';
import { findDivergences } from '../core/divergence';
import { longTerm } from '../core/longTerm';
import { findDoubles } from '../core/patterns';
import { LEVEL_MERGE_PCT, levelMap } from '../core/levels';
import { liquidationClusters, liquidationsPerCandle, type Liquidation } from '../core/liquidations';
import { withFunding, type FundingEvent } from '../core/funding';
import { fetchFearGreed, type FearGreed } from '../feed/fearGreed';
import { fetchFundingHistory } from '../feed/okxContext';
import { SYMBOLS, TIMEFRAMES, TREND_TIMEFRAME, fetchCandles, fetchLiquidations, mergeCandle, subscribeCandles, type FeedStatus } from '../feed/okx';
import { fmtNum, fmtPrice, fmtTime, t } from '../i18n';
import { CHART_THEMES, Chart, type ChartLine } from './Chart';
import { ConditionsView } from './ConditionsView';
import { ContextStrip, useMarketContext } from './ContextStrip';
import { ParamsView } from './ParamsView';
import { EquityView } from './EquityView';
import { LongTermStrip } from './LongTerm';
import { PracticeBar, PracticePanel, PracticeResults, usePractice } from './Practice';
import { HISTORY_KEY, HISTORY_LIMIT, type OrderRecord } from './history';
import { HistoryPanel } from './HistoryPanel';
import { OrderPanel } from './OrderPanel';
import { Checklist, CompareTable, MetricsView, Panel, SplitTable, TradeTable, Verdict, type CompareRow } from './panels';
import { DEFAULT_SETTINGS, HISTORY_OPTIONS, PRESETS_KEY, SETTINGS_KEY, migrateSettings, type Preset, type Settings } from './settings';
import { RelationPanel } from './RelationPanel';
import { SignalExplain, explain } from './SignalPanel';
import { ExplorePanel, StrategyPanel } from './StrategyPanel';
import { beep, enableSound, soundEnabled } from './sound';
import { loadJson, saveJson } from './storage';

/**
 * Three ways of using the page. Operar: rule, signal, order. Explorar: an analysis board without signals.
 * Practicar: a stretch of history played candle by candle, deciding with the future hidden.
 */
const MODES = ['trade', 'explore', 'practice'] as const;
type Mode = (typeof MODES)[number];
const TABS = ['rule', 'signal', 'order', 'alerts', 'history'] as const;
type Tab = (typeof TABS)[number];
const VIEWS = ['summary', 'curve', 'conditions', 'params'] as const;
type View = (typeof VIEWS)[number];

/** Indicator colours that are too pale on a white chart, with the darker shade used on the light theme. */
const ON_LIGHT: Record<string, string> = { '#e6c84f': '#b08900', '#e0a73a': '#b26a00', '#4fc3f7': '#0277bd', '#4dd0e1': '#00838f', '#f48fb1': '#c2185b', '#b39ddb': '#6a3fb5', '#b388ff': '#6d3bd6', '#7f8a99': '#5d6877', '#ff7043': '#d84315', '#29b6f6': '#0277bd', '#5b9cf6': '#2563d9' };

/** The current time in UTC, ticking every second, so chart times can be compared with the clock at a glance. */
function UtcClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const d = new Date(now);
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    <time className="clock" dateTime={d.toISOString()}>
      {t('app.utcNow', { time: `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}` })}
    </time>
  );
}

/** Changes only when a candle closes, so work that depends on closed candles is not redone on every tick. */
const closedKey = (candles: Candle[]) => {
  for (let i = candles.length - 1; i >= 0; i--) if (candles[i].closed) return candles[i].time;
  return 0;
};

type Status = { kind: 'loading' | FeedStatus } | { kind: 'error'; msg: string };

interface Alert {
  id: number;
  signal: Signal;
}

/** Market and timeframe from the page address, e.g. `?symbol=ETH&tf=15m`. */
function readUrl() {
  const q = new URLSearchParams(window.location.search);
  const s = (q.get('symbol') ?? '').toUpperCase();
  const f = (q.get('tf') ?? '').toLowerCase();
  return { symbol: SYMBOLS.find((x) => x.id === s || x.instId === s) ?? null, tf: TIMEFRAMES.find((x) => x.id === f) ?? null };
}

export function App() {
  const [symbol, setSymbol] = useState(() => readUrl().symbol ?? SYMBOLS[0]);
  const [settings, setSettings] = useState<Settings>(() => {
    // Settings saved by an earlier version are brought up to date; missing fields take their defaults.
    const saved = migrateSettings(loadJson(SETTINGS_KEY, DEFAULT_SETTINGS));
    const fromUrl = readUrl().tf;
    return fromUrl ? { ...saved, timeframe: fromUrl.id } : saved;
  });
  useEffect(() => saveJson(SETTINGS_KEY, settings), [settings]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);
  // Combinations saved under a name, kept in this browser.
  const [presets, setPresets] = useState<Preset[]>(() => {
    const stored = loadJson<Preset[]>(PRESETS_KEY, []);
    return Array.isArray(stored) ? stored.filter((p) => p && typeof p.name === 'string' && p.strategy) : [];
  });
  useEffect(() => saveJson(PRESETS_KEY, presets), [presets]);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }));

  // Text size: the stylesheet scales with the window; A- / A+ multiplies it. The chart follows.
  const [chartFont, setChartFont] = useState(14);
  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(settings.fontScale));
    const measure = () => setChartFont(Math.round(parseFloat(getComputedStyle(document.body).fontSize) * 0.85));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [settings.fontScale]);
  useEffect(() => {
    document.documentElement.style.setProperty('--chart-scale', String(settings.chartScale));
  }, [settings.chartScale]);
  const bumpChart = (d: number) => set('chartScale', Math.min(1.8, Math.max(0.6, Math.round((settings.chartScale + d) * 10) / 10)));
  const bumpFont = (d: number) => set('fontScale', Math.min(1.8, Math.max(0.8, Math.round((settings.fontScale + d) * 10) / 10)));

  const tf = TIMEFRAMES.find((x) => x.id === settings.timeframe) ?? TIMEFRAMES[1];
  // Keep the address in step with the selection, so each market and timeframe has its own link.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.set('symbol', symbol.id);
    q.set('tf', tf.id);
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
    document.title = `${symbol.id} ${tf.id} · Murphy Signal Lab`;
  }, [symbol.id, tf.id]);
  useEffect(() => {
    const onNav = () => {
      const u = readUrl();
      if (u.symbol) setSymbol(u.symbol);
      if (u.tf) setSettings((s) => ({ ...s, timeframe: u.tf!.id }));
    };
    window.addEventListener('popstate', onNav);
    return () => window.removeEventListener('popstate', onNav);
  }, []);
  // Crypto Fear & Greed Index: market sentiment shown for context. It changes once a day and no rule uses it.
  const [mood, setMood] = useState<FearGreed | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const load = () => fetchFearGreed(abort.signal).then((v) => v && setMood(v));
    load();
    const timer = window.setInterval(load, 30 * 60_000);
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, []);
  const context = useMarketContext(symbol);
  // A year and a half of daily candles for the long-term reading; refreshed every hour.
  const [daily, setDaily] = useState<Candle[]>([]);
  useEffect(() => {
    setDaily([]);
    const day = TIMEFRAMES.find((x) => x.id === '1d');
    if (!day) return;
    const abort = new AbortController();
    const load = () => fetchCandles(symbol, day, 560, abort.signal).then((list) => !abort.signal.aborted && setDaily(list), () => undefined);
    load();
    const timer = window.setInterval(load, 3_600_000);
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, [symbol.id]);
  const long = useMemo(() => longTerm(daily), [daily]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [liqs, setLiqs] = useState<Liquidation[]>([]);
  const [liqState, setLiqState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [reload, setReload] = useState(0);
  /** Candles fetched so far during a history load, for the loading indicator. */
  const [progress, setProgress] = useState(0);
  /** Time of the last closed candle already checked for alerts. `null` right after a (re)load. */
  const lastClosed = useRef<number | null>(null);

  // History, then the live stream. A reconnect refetches history to fill the gap.
  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    let unsubscribe = () => {};
    setCandles([]);
    setProgress(0);
    setStatus({ kind: 'loading' });
    const load = async () => {
      const list = await fetchCandles(symbol, tf, settings.history, abort.signal, (n) => alive && setProgress(n));
      if (!alive) return;
      lastClosed.current = null;
      setCandles(list);
    };
    load()
      .then(() => {
        if (!alive) return;
        unsubscribe = subscribeCandles(
          symbol,
          tf,
          (c) => setCandles((list) => (list.length ? mergeCandle(list, c) : list)),
          (s, reconnected) => {
            if (!alive) return;
            setStatus({ kind: s });
            if (reconnected) load().catch(() => {});
          },
        );
      })
      .catch((e: unknown) => {
        if (alive) setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
      abort.abort();
      unsubscribe();
    };
  }, [symbol.id, tf.id, settings.history, reload]);

  // Liquidations already executed on OKX, loaded only while that layer is on: back to the start of the chart
  // or as far as 40 pages reach, then the newest page again every minute.
  const firstTime = candles[0]?.time ?? 0;
  useEffect(() => {
    setLiqs([]);
    if (!settings.showLiquidations || firstTime === 0) {
      setLiqState('idle');
      return;
    }
    const abort = new AbortController();
    let alive = true;
    const key = (l: Liquidation) => `${l.time}|${l.price}|${l.usd}|${l.side}`;
    const merge = (fresh: Liquidation[]) =>
      setLiqs((old) => {
        const seen = new Set(old.map(key));
        const added = fresh.filter((l) => !seen.has(key(l)));
        return added.length ? [...added, ...old] : old;
      });
    setLiqState('loading');
    fetchLiquidations(symbol, firstTime, 40, abort.signal, (all) => alive && setLiqs(all))
      .then(() => alive && setLiqState('ready'))
      .catch(() => alive && setLiqState('error'));
    const timer = window.setInterval(() => fetchLiquidations(symbol, Date.now(), 1, abort.signal).then((page) => alive && merge(page)).catch(() => {}), 60_000);
    return () => {
      alive = false;
      abort.abort();
      window.clearInterval(timer);
    };
  }, [settings.showLiquidations, symbol.id, firstTime, reload]);

  // One rule definition drives the chart, the backtest and the alerts.
  const trendTf = TREND_TIMEFRAME[tf.id];
  const strategy = useMemo(() => normalizeStrategy(settings.strategy), [JSON.stringify(settings.strategy)]);

  // Higher-timeframe candles for the trend filter: enough to cover the chart's history plus the average's warm-up.
  const [trendCandles, setTrendCandles] = useState<Candle[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendTick, setTrendTick] = useState(0);
  const useHigher = strategy.trend.mode === 'higher';
  useEffect(() => {
    if (!useHigher) {
      setTrendCandles([]);
      return;
    }
    const abort = new AbortController();
    let alive = true;
    const count = Math.ceil((settings.history * tf.ms) / trendTf.ms) + strategy.trend.length + 3;
    if (trendTick === 0) setTrendLoading(true);
    fetchCandles(symbol, trendTf, count, abort.signal)
      .then((list) => alive && setTrendCandles(list))
      .catch((e: unknown) => alive && setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) }))
      .finally(() => alive && setTrendLoading(false));
    return () => {
      alive = false;
      abort.abort();
    };
  }, [useHigher, symbol.id, tf.id, settings.history, strategy.trend.length, reload, trendTick]);
  const higher = useMemo(() => (useHigher ? { [trendTf.id]: { candles: trendCandles, ms: trendTf.ms } } : undefined), [useHigher, trendTf.id, trendCandles]);
  const rule = useMemo(() => makeStrategyRule(strategy, trendTf.id), [strategy, trendTf.id]);
  const compiled = useMemo(() => compileRule(rule), [rule]);
  const ctx = useMemo(() => buildContext(rule, candles, { ms: tf.ms, higher }), [rule, candles, higher]);
  const signals = useMemo(() => scanSignals(compiled, ctx), [compiled, ctx]);
  // How many candles satisfy each active block on its own. It explains a combination that gives no signals:
  // the backtest did run, but the blocks never agree on the same candle.
  const funnel = useMemo(() => {
    const solos = soloStrategies(strategy);
    if (solos.length < 2 || candles.length === 0) return [];
    return solos.map(({ id, strategy: solo }) => {
      // Candles, not signals: a confirmation such as volume holds for a buy and for a sell on the same candle.
      const soloRule = makeStrategyRule(solo, undefined, true);
      return { id, count: new Set(scanSignals(compileRule(soloRule), buildContext(soloRule, candles, { ms: tf.ms })).map((x) => x.index)).size };
    });
  }, [strategy, candles.length, candles[0]?.time, closedKey(candles)]);
  const taker = settings.feeTakerPct / 100;
  const maker = settings.feeMakerPct / 100;
  const rawResult = useMemo(
    () => backtest(candles, signals, { feeEntry: taker, feeExit: taker, slippage: 0, timeoutBars: Math.max(1, Math.round(settings.timeoutBars)) }),
    [candles, signals, taker, settings.timeoutBars],
  );
  // Funding settled during the loaded period, charged to the trades that were open through it. OKX keeps about
  // three months of it, so on long histories the oldest trades stay without funding, and the panel says so.
  const [fundingEvents, setFundingEvents] = useState<FundingEvent[]>([]);
  useEffect(() => {
    setFundingEvents([]);
    if (!firstTime) return;
    const abort = new AbortController();
    fetchFundingHistory(symbol, firstTime, abort.signal).then((list) => !abort.signal.aborted && setFundingEvents(list));
    return () => abort.abort();
  }, [symbol.id, firstTime, reload]);
  const funded = useMemo(() => withFunding(rawResult.trades, fundingEvents), [rawResult, fundingEvents]);
  const result = useMemo(() => ({ ...rawResult, trades: funded.trades, metrics: funded.metrics }), [rawResult, funded]);

  // The side column shows one tab at a time, in the order of the work: build the rule, read the signal, prepare the order.
  const [tab, setTab] = useState<Tab>('rule');
  /** A signal fired while another tab was showing; marks the Señal tab until it is opened. */
  const [unseen, setUnseen] = useState(false);
  const [mode, setMode] = useState<Mode>('trade');
  /** Bumped by "Restablecer vista" to bring the chart back to its default zoom and position. */
  const [viewReset, setViewReset] = useState(0);
  /** Explorar turns the chart into an analysis board without signals; the rule keeps running underneath. */
  const exploring = mode === 'explore';
  const openMode = (next: Mode) => {
    setMode(next);
    // Explorar is worked from its panel, so entering it brings the panel back.
    if (next === 'explore') setSettings((s) => (s.panelOpen ? s : { ...s, panelOpen: true }));
  };
  /** Which reading of the backtest is showing. */
  const [view, setView] = useState<View>('summary');
  const openTab = (next: Tab) => {
    setMode('trade');
    setTab(next);
    setSettings((s) => (s.panelOpen ? s : { ...s, panelOpen: true })); // asking for a tab brings the panel back
    if (next === 'signal') setUnseen(false);
  };
  // Practice mode plays a stretch of the closed candles with the same rule, fees and timeout as the backtest.
  const ruleContext = useMemo(() => ({ ms: tf.ms, higher }), [tf.ms, higher]);
  const practiceOptions = useMemo(() => ({ feeEntry: taker, feeExit: taker, slippage: 0, timeoutBars: Math.max(1, Math.round(settings.timeoutBars)) }), [taker, settings.timeoutBars]);
  const closedForPractice = useMemo(() => candles.filter((c) => c.closed), [candles.length, candles[0]?.time, closedKey(candles)]);
  const practice = usePractice({ active: mode === 'practice', closed: closedForPractice, rule, context: ruleContext, options: practiceOptions, resetKey: `${symbol.id}|${tf.id}|${settings.history}` });
  const practicing = mode === 'practice' && practice.session !== null;
  // Any ready-made or saved combination can be the rule practised against; choosing one makes it the current rule.
  const practiceRules = useMemo(
    () => [
      ...BUILTIN_STRATEGIES.map((b) => ({ key: `builtin:${b.id}`, label: t(`preset.${b.id}`), group: t(`kind.${b.kind}`), strategy: b.strategy, timeoutBars: b.timeoutBars })),
      ...presets.map((p) => ({ key: `saved:${p.name}`, label: p.name, group: t('practice.ruleSaved'), strategy: normalizeStrategy(p.strategy), timeoutBars: p.timeoutBars })),
    ],
    [presets],
  );
  /** In Explorar and in practice the chart is not following a picked signal. */
  const studying = mode !== 'trade';

  // Count parameter sets tried, as a reminder that the best of many tries is not evidence.
  // Out-of-sample check: the last part of the history stays hidden until asked for,
  // and hides again whenever the rule, the market or the history changes.
  const closedCandles = useMemo(() => candles.filter((c) => c.closed), [candles]);
  const splitPct = Math.min(90, Math.max(10, settings.splitPct));
  const splitTime = closedCandles[Math.floor((closedCandles.length * splitPct) / 100)]?.time ?? 0;
  const split = useMemo(() => splitMetrics(result.trades, splitTime), [result, splitTime]);
  const [revealed, setRevealed] = useState(false);
  const [reveals, setReveals] = useState(0);
  useEffect(() => setRevealed(false), [strategy, symbol.id, tf.id, settings.history, splitPct, settings.timeoutBars, taker]);

  const [tries, setTries] = useState(1);
  const firstParams = useRef(true);
  useEffect(() => {
    if (firstParams.current) firstParams.current = false;
    else setTries((n) => n + 1);
  }, [strategy]);

  // Alerts: once per newly closed candle, never for candles loaded from history.
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [banner, setBanner] = useState<Alert | null>(null);
  // Sound has two parts: the user's choice (stored as `muted`) and the browser's permission, which
  // every page load has to earn again with a click or a key press. `audioReady` tracks the second.
  const [audioReady, setAudioReady] = useState(soundEnabled());
  const soundOn = audioReady && !settings.muted;
  useEffect(() => {
    if (settings.muted || audioReady) return;
    // Some browsers allow sound straight away on pages the user visits often; otherwise the first
    // interaction anywhere on the page unlocks it, so the choice survives a reload without a second click.
    let alive = true;
    const unlock = () => enableSound().then((ok) => alive && ok && setAudioReady(true));
    unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      alive = false;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [settings.muted, audioReady]);
  const toggleSound = async () => {
    if (soundOn) return set('muted', true);
    set('muted', false);
    const ok = await enableSound();
    setAudioReady(ok);
    if (ok) beep('long'); // confirms that it works, and at what volume
  };
  const alertId = useRef(0);
  const fire = (signal: Signal) => {
    const alert = { id: ++alertId.current, signal };
    setAlerts((list) => [alert, ...list].slice(0, 50));
    setBanner(alert);
    setPicked(null); // the explanation follows the newest signal
    if (tab !== 'signal' || !settings.panelOpen) setUnseen(true);
    if (soundOn) beep(signal.side);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      new Notification(`${t(`side.${signal.side}`)} ${symbol.label} ${tf.id}`, { body: `${fmtPrice(signal.reference)} · SL ${fmtPrice(signal.stop)} · TP ${fmtPrice(signal.target)}` });
    }
  };
  useEffect(() => {
    let last: Candle | undefined;
    for (let i = candles.length - 1; i >= 0 && !last; i--) if (candles[i].closed) last = candles[i];
    if (!last) return;
    if (lastClosed.current === null) {
      lastClosed.current = last.time;
      return;
    }
    if (last.time <= lastClosed.current) return;
    lastClosed.current = last.time;
    // A higher-timeframe candle has just closed: refresh the trend data. (The alert for this
    // one candle still uses the previous trend value; the backtest uses the new one.)
    const lastTrend = trendCandles[trendCandles.length - 1];
    if (useHigher && lastTrend && last.time + tf.ms >= lastTrend.time + (lastTrend.closed ? 2 : 1) * trendTf.ms) setTrendTick((n) => n + 1);
    if (Date.now() - (last.time + tf.ms) > tf.ms) return; // closed more than one candle ago: too old to alert
    signals.filter((s) => s.time === last.time).forEach(fire);
  }, [candles, signals]);

  // Condition checklist: the hovered candle, or the latest closed one.
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const indexByTime = useMemo(() => new Map(candles.map((c, i) => [c.time, i])), [candles]);
  let checkIndex = hoverTime !== null ? (indexByTime.get(hoverTime) ?? -1) : -1;
  if (checkIndex < 0) for (let i = candles.length - 1; i >= 0 && checkIndex < 0; i--) if (candles[i].closed) checkIndex = i;
  // Every indicator the rule uses must have a value on this candle and the one before it (crossings look back one candle).
  // Swing levels are left out: having no resistance above an all-time high is an answer, not missing data.
  const warm = checkIndex >= 1 && Object.entries(ctx.series).every(([id, outputs]) => id === 'sr' || id === 'fib' || Object.values(outputs).every((v) => v[checkIndex] != null && v[checkIndex - 1] != null));
  const evals = useMemo(() => (warm ? evaluateAt(compiled, ctx, checkIndex) : null), [compiled, ctx, checkIndex, warm]);
  const checkHeading = hoverTime !== null && indexByTime.has(hoverTime) ? t('check.at', { time: fmtTime(hoverTime) }) : t('check.latest');

  // Trade check: levels typed by hand, or taken from a signal or a backtest trade.
  const [selected, setSelected] = useState<Trade | null>(null);
  /** Signal shown in the explanation panel when one was picked by hand; otherwise the latest one is shown. */
  const [picked, setPicked] = useState<Signal | null>(null);
  useEffect(() => setPicked(null), [strategy, symbol.id, tf.id]);
  const [focus, setFocus] = useState<{ time: number; n: number } | null>(null);
  const [levels, setLevels] = useState({ entry: 0, stop: 0, target: 0 });
  const seeded = useRef(false);
  const roundPrice = (v: number) => Math.round(v * 10 ** symbol.decimals) / 10 ** symbol.decimals;
  // Orders that can be left in OKX before any signal: a limit at the level the rule is watching (support,
  // resistance or a Fibonacci retracement). The stop sits 1.5 times the average range beyond the level, and the
  // target at the rule's reward-to-risk multiple, or 2 when the rule aims at something else.
  const pending = useMemo(() => {
    let i = candles.length - 1;
    while (i > 0 && !candles[i].closed) i--;
    const range = candles.length > 20 ? atr(candles, 14)[i] : null;
    if (!range || (!strategy.sr.on && !strategy.fib.on)) return [];
    const ratio = strategy.target.kind === 'rr' ? strategy.target.rr : 2;
    const out: { key: string; label: string; levels: { entry: number; stop: number; target: number } }[] = [];
    const add = (side: 'long' | 'short', what: string, level: number | null | undefined) => {
      if (level == null) return;
      const dir = side === 'long' ? 1 : -1;
      const entry = roundPrice(level);
      const stop = roundPrice(level - dir * 1.5 * range);
      out.push({ key: `${side}-${what}`, label: t(`pending.${side}`, { what: t(`pending.${what}`), price: fmtPrice(entry) }), levels: { entry, stop, target: roundPrice(entry + dir * ratio * Math.abs(entry - stop)) } });
    };
    if (strategy.sr.on) {
      // Only levels the rule would accept: tested as many times as it asks for.
      const enough = (tests: number | null | undefined) => (tests ?? 0) >= strategy.sr.minTests;
      if (enough(ctx.series.sr?.supportTests[i])) add('long', 'support', ctx.series.sr?.support[i]);
      if (enough(ctx.series.sr?.resistanceTests[i])) add('short', 'resistance', ctx.series.sr?.resistance[i]);
    }
    if (strategy.fib.on) {
      add('long', 'fib', ctx.series.fib?.support[i]);
      add('short', 'fib', ctx.series.fib?.resistance[i]);
    }
    return out;
  }, [ctx, strategy, symbol.id]);
  // Orders sent to OKX demo (or logged by hand), kept in this browser with the reasons behind each.
  const [history, setHistory] = useState<OrderRecord[]>(() => {
    const stored = loadJson<OrderRecord[]>(HISTORY_KEY, []);
    return Array.isArray(stored) ? stored.filter((r) => r && typeof r.id === 'string') : [];
  });
  useEffect(() => saveJson(HISTORY_KEY, history), [history]);
  /** Where the levels in the order form came from, so the history can say why an order was taken. */
  const [origin, setOrigin] = useState<{ kind: 'signal'; signal: Signal; lines: string[] } | { kind: 'pending'; label: string } | null>(null);
  const size = settings.sizes[symbol.id] ?? symbol.defaultSize;
  const setSize = (v: number) => setSettings((s) => ({ ...s, sizes: { ...s.sizes, [symbol.id]: v } }));
  /** Load a signal into the order form: its levels, and the size that risks the chosen share of the capital. */
  const useSignal = (s: Signal, entry = s.reference) => {
    const next = { entry: roundPrice(entry), stop: roundPrice(s.stop), target: roundPrice(s.target) };
    setLevels(next);
    setOrigin({ kind: 'signal', signal: s, lines: explain(s, strategy, symbol, tf.id, trendTf.id) });
    const suggested = suggestSize({ ...next, capital: settings.capital, riskPct: settings.riskPct, leverage: settings.leverage, sizeStep: symbol.sizeStep }).size;
    if (suggested > 0) setSize(suggested);
  };
  // A different combination of blocks gives different signals: drop the old levels so the chart never shows
  // an entry, stop and target that the current rule did not produce. The effect below then prefills them again.
  useEffect(() => {
    seeded.current = false;
    setSelected(null);
    setOrigin(null);
    setLevels({ entry: 0, stop: 0, target: 0 });
  }, [strategy]);
  useEffect(() => {
    // Prefill the trade check from the latest signal, but only a recent one: levels
    // from a signal far back in the history would sit nowhere near the current price.
    const latest = signals[signals.length - 1];
    if (!seeded.current && latest && candles.length > 0) {
      seeded.current = true;
      if (latest.index >= candles.length - 60) useSignal(latest);
    }
  }, [signals]);
  // Levels belong to one market and timeframe: a stop sized for 1 minute means nothing on 4 hours.
  useEffect(() => {
    seeded.current = false;
    setSelected(null);
    setOrigin(null);
    setLevels({ entry: 0, stop: 0, target: 0 });
  }, [symbol.id, tf.id]);
  // A different market also starts with its own alerts and comparison.
  useEffect(() => {
    setAlerts([]);
    setBanner(null);
    setCompare([]);
  }, [symbol.id]);
  const selectTrade = (tr: Trade) => {
    setSelected(tr);
    setPicked(tr.signal);
    openTab('signal');
    useSignal(tr.signal, tr.entryPrice);
    setFocus((f) => ({ time: tr.signal.time, n: (f?.n ?? 0) + 1 }));
  };
  const check = tradeCheck({
    ...levels,
    size,
    capital: settings.capital,
    leverage: settings.leverage,
    feeEntry: settings.entryOrder === 'limit' ? maker : taker,
    feeExit: taker,
  });

  // Timeframe comparison: the same rule and fees on every timeframe.
  const [compare, setCompare] = useState<CompareRow[]>([]);
  const [comparing, setComparing] = useState<string | null>(null);
  const compareCount = Math.min(settings.history, 1500);
  const runCompare = async () => {
    const rows: CompareRow[] = [];
    try {
      for (const frame of TIMEFRAMES) {
        setComparing(frame.id);
        const list = (await fetchCandles(symbol, frame, compareCount)).filter((c) => c.closed);
        const frameTrend = TREND_TIMEFRAME[frame.id];
        const frameRule = makeStrategyRule(strategy, frameTrend.id);
        const frameHigher = useHigher
          ? { [frameTrend.id]: { candles: await fetchCandles(symbol, frameTrend, Math.ceil((compareCount * frame.ms) / frameTrend.ms) + strategy.trend.length + 3), ms: frameTrend.ms } }
          : undefined;
        const sigs = scanSignals(compileRule(frameRule), buildContext(frameRule, list, { ms: frame.ms, higher: frameHigher }));
        rows.push({ tf: frame.id, m: backtest(list, sigs, { feeEntry: taker, feeExit: taker, slippage: 0, timeoutBars: settings.timeoutBars }).metrics });
        setCompare([...rows]);
      }
    } catch (e) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setComparing(null);
    }
  };

  const loading = status.kind === 'loading';
  const lastTrendTime = trendCandles[trendCandles.length - 1]?.time ?? 0;
  const closedCount = candles.filter((c) => c.closed).length;
  const lastPrice = candles[candles.length - 1]?.close;
  const dataKey = practicing
    ? `practice|${practice.session?.id}|${JSON.stringify(strategy)}|${trendCandles.length}`
    : `${symbol.id}|${tf.id}|${JSON.stringify(strategy)}|${exploring ? JSON.stringify(settings.explore) : ''}|${candles[0]?.time ?? 0}|${reload}|${trendCandles.length}|${lastTrendTime}`;
  /** The candles on the chart: in practice, only the ones played so far. */
  const viewCandles = practicing ? practice.view : candles;

  const explained = picked ?? signals[signals.length - 1] ?? null;

  // The chart draws only the indicators of the blocks that are on.
  // While Explorar is open the chart is an analysis board: it draws that tab's own indicators, with
  // their own parameters, and no signals. They are computed apart from the rule, so they can never change it.
  const shown = useMemo(() => {
    if (practicing) return { view: strategy, series: practice.series };
    if (!exploring) return { view: strategy, series: ctx.series };
    const view: StrategyConfig = { ...normalizeStrategy(settings.explore), trend: { mode: 'off', length: 200 }, target: { kind: 'rr', rr: 2 }, stop: DEFAULT_STRATEGY.stop };
    view.ma = { ...view.ma, mode: 'cross' }; // draw both averages
    const viewRule = makeStrategyRule(view);
    // A rule reads volume one way or the other; on the analysis board both are drawn: the average over the bars, and OBV.
    if (view.volume.on) Object.assign(viewRule.indicators, { vol: { type: 'volume', length: view.volume.length }, obv: { type: 'obv', length: view.volume.length } });
    return { view, series: buildContext(viewRule, candles, { ms: tf.ms }).series };
  }, [exploring, practicing, practice.series, ctx, strategy, JSON.stringify(settings.explore)]);
  // In Explorar, the backtest's place is taken by a reading of the chosen indicators: can they work
  // together in one rule, and how often each is satisfied alone and all at once on the candles loaded.
  const relation = useMemo(() => {
    if (!exploring) return null;
    const report = relate(normalizeStrategy(settings.explore));
    if (report.chosen.length === 0 || candles.length === 0) return { report, counts: null };
    const count = (cfg: StrategyConfig) => {
      const r = makeStrategyRule(cfg, undefined, true);
      return new Set(scanSignals(compileRule(r), buildContext(r, candles, { ms: tf.ms })).map((x) => x.index)).size;
    };
    const solo = Object.fromEntries(soloStrategies(report.arranged).map((x) => [x.id, count(x.strategy)]));
    return { report, counts: { solo, together: count(report.arranged), candles: closedCount } };
  }, [exploring, JSON.stringify(settings.explore), candles.length, candles[0]?.time, closedKey(candles)]);
  const lines = useMemo<ChartLine[]>(() => {
    const candles = viewCandles; // everything below draws what the chart shows, which in practice stops at the cursor
    const { view, series } = shown;
    const out: ChartLine[] = [];
    const add = (id: string, output: string, pane: number, color: string, extra: Partial<ChartLine> = {}) => {
      const data = series[id]?.[output];
      if (data) out.push({ id: `${id}.${output}`, pane, kind: 'line', color, data, ...extra });
    };
    const finish = () => (settings.theme === 'light' ? out.map((l) => ({ ...l, color: ON_LIGHT[l.color] ?? l.color })) : out);
    if (view.bollinger.on) {
      add('bb', 'upper', 0, '#ef5350');
      add('bb', 'lower', 0, '#26a69a');
    }
    add('bb', 'basis', 0, '#5b9cf6');
    add('maFast', 'value', 0, '#4dd0e1');
    add('maSlow', 'value', 0, '#f48fb1');
    add('trend', 'value', 0, '#e0a73a', { width: 2 });
    // Support and resistance: the levels in force on the candle being studied, each drawn from the swing that
    // created it to the right edge. Up to three on each side; a level tested more than once is drawn heavier
    // and labelled with its number of tests.
    if (series.sr) {
      const chosen = studying ? null : picked;
      let ref = chosen ? chosen.index : candles.length - 1;
      while (!chosen && ref > 0 && !candles[ref]?.closed) ref--;
      // Every level in the window, nearest first. The three nearest on each side are drawn, plus the farthest one:
      // the highest high and the lowest low of the period, which bound the whole range and would otherwise be
      // left out whenever three nearer levels exist.
      const map = levelMap(candles, view.sr.strength, view.sr.lookback, ref, LEVEL_MERGE_PCT, 99);
      for (const side of ['resistance', 'support'] as const) {
        const all = map.filter((l) => l.side === side);
        const shown: ((typeof all)[number] | undefined)[] = [all[0], all[1], all[2], all.length > 3 ? all[all.length - 1] : undefined];
        shown.forEach((l, k) => {
          const extreme = k === 3;
          const name = extreme ? t(side === 'resistance' ? 'sr.rMax' : 'sr.sMin') : t(side === 'resistance' ? 'sr.r' : 'sr.s');
          out.push({
            id: `sr.${side}${k}`,
            pane: 0,
            kind: 'line',
            color: side === 'resistance' ? '#ff7043' : '#29b6f6',
            width: l && (k === 0 || extreme || l.touches > 1) ? 2 : 1,
            dashed: extreme,
            title: l ? `${name}${l.touches > 1 ? ` ×${l.touches}` : ''}` : '',
            rev: l ? `${candles[0]?.time}|${l.price}|${l.touches}|${l.from}|${candles.length}` : 'none',
            data: candles.map((_, j) => (l && j >= l.from ? l.price : null)),
          });
        });
      }
    }
    // Fibonacci is drawn the way it is drawn by hand: one grid over the swing being measured, from where the swing
    // starts to the right edge, with the swing itself as a dashed diagonal. The grid is the one in force on the
    // signal picked for study, or on the latest closed candle.
    const fib = series.fib;
    if (fib) {
      const chosen = studying ? null : picked;
      let ref = chosen ? chosen.index : candles.length - 1;
      while (!chosen && ref > 0 && !candles[ref]?.closed) ref--;
      const [from, to] = [fib.startAt[ref], fib.endAt[ref]];
      const has = from != null && to != null;
      const rev = has ? `${candles[0]?.time}|${from}|${to}|${candles.length}` : 'none';
      const flat = (value: number | null | undefined) => candles.map((_, j) => (has && value != null && j >= (from as number) ? value : null));
      const grid: [string, number | null | undefined, string, string][] = [
        ['0', fib.end[ref], '0%', '#7f8a99'],
        ['382', fib.r382[ref], '38,2%', '#e6c84f'],
        ['500', fib.r500[ref], '50%', '#e0a73a'],
        ['618', fib.r618[ref], '61,8%', '#e07b39'],
        ['100', fib.start[ref], '100%', '#7f8a99'],
      ];
      for (const [id, value, title, color] of grid) out.push({ id: `fib.${id}`, pane: 0, kind: 'line', color, title, rev, data: flat(value) });
      // Two points, joined by the chart: the swing from its start to its end.
      out.push({ id: 'fib.leg', pane: 0, kind: 'line', color: '#7f8a99', dashed: true, rev, data: candles.map((_, j) => (!has ? null : j === from ? fib.start[ref] : j === to ? fib.end[ref] : null)) });
    }
    // Trendlines in force on the candle being studied: each from its first anchor to the right edge, with its
    // channel line as a dashed parallel. An up line and a down line that converge are a triangle.
    const tl = series.tl;
    if (tl) {
      const chosen = studying ? null : picked;
      let ref = chosen ? chosen.index : candles.length - 1;
      while (!chosen && ref > 0 && !candles[ref]?.closed) ref--;
      const last = candles.length - 1;
      const [up, down] = [tl.up[ref], tl.down[ref]];
      // A triangle: both lines in force, converging, and the price already at least halfway from where the pattern
      // starts to the point where the lines meet. Two wide lines that would meet far away are not one.
      const closing = up != null && down != null && down > up ? (tl.upSlope[ref] as number) - (tl.downSlope[ref] as number) : 0;
      const triangle = closing > 0 && ((down as number) - (up as number)) / closing <= ref - Math.min(tl.upFrom[ref] as number, tl.downFrom[ref] as number);
      for (const side of ['up', 'down'] as const) {
        const [v, from, slope, channel, touches] = [tl[side][ref], tl[`${side}From`][ref], tl[`${side}Slope`][ref], tl[`${side}Channel`][ref], tl[`${side}Touches`][ref]];
        const has = v != null && from != null && slope != null && from < last;
        const rev = has ? `${candles[0]?.time}|${from}|${slope}|${ref}|${last}|${triangle}` : 'none';
        const segment = (shift: number) => candles.map((_, j) => (!has ? null : j === from ? (v as number) - (slope as number) * (ref - (from as number)) + shift : j === last ? (v as number) + (slope as number) * (last - ref) + shift : null));
        const name = t(side === 'up' ? 'layer.tlUp' : 'layer.tlDown');
        out.push({ id: `tl.${side}`, pane: 0, kind: 'line', color: side === 'up' ? '#26a69a' : '#ef5350', width: 2, title: has ? `${triangle ? `${t('layer.triangle')} · ` : ''}${name} ×${touches}` : '', rev, data: segment(0) });
        out.push({ id: `tl.${side}.channel`, pane: 0, kind: 'line', color: side === 'up' ? '#26a69a' : '#ef5350', dashed: true, quiet: true, rev, data: segment((side === 'up' ? 1 : -1) * ((channel as number) ?? 0)) });
      }
    }
    // Double tops and bottoms completed by the candle being studied: the two extremes joined through the middle
    // point, the line whose break completed the pattern, and the measured objective of the latest one.
    if (series.pat) {
      const chosen = studying ? null : picked;
      let ref = chosen ? chosen.index : candles.length - 1;
      while (!chosen && ref > 0 && !candles[ref]?.closed) ref--;
      const found = findDoubles(candles.slice(0, ref + 1), { strength: view.pattern.strength, lookback: view.pattern.lookback, tolerance: view.pattern.tolerance, minHeight: view.pattern.minHeight });
      for (const kind of ['top', 'bottom'] as const) {
        const latest = found.filter((d) => d.kind === kind).slice(-2).reverse();
        for (let k = 0; k < 2; k++) {
          const d = latest[k];
          const color = kind === 'top' ? '#ef5350' : '#26a69a';
          const rev = d ? `${candles[0]?.time}|${d.first}|${d.second}|${d.completedAt}|${candles.length}` : 'none';
          const extreme = (i: number) => (kind === 'top' ? candles[i].high : candles[i].low);
          out.push({ id: `pat.${kind}${k}`, pane: 0, kind: 'line', color, width: 2, title: d ? t(kind === 'top' ? 'layer.doubleTop' : 'layer.doubleBottom') : '', quiet: true, rev, data: candles.map((_, j) => (!d ? null : j === d.first || j === d.second ? extreme(j) : j === d.middle ? d.neckline : null)) });
          out.push({ id: `pat.${kind}${k}.neck`, pane: 0, kind: 'line', color, dashed: true, quiet: true, rev, data: candles.map((_, j) => (d && (j === d.middle || j === d.completedAt) ? d.neckline : null)) });
        }
      }
      const newest = found[found.length - 1];
      out.push({ id: 'pat.objective', pane: 0, kind: 'line', color: '#7f8a99', dashed: true, title: newest ? t('layer.objective') : '', rev: newest ? `${candles[0]?.time}|${newest.completedAt}|${newest.objective}|${candles.length}` : 'none', data: candles.map((_, j) => (newest && j >= newest.completedAt ? newest.objective : null)) });
    }
    // The volume block needs the bars it is read against, so it brings them even when the layer is switched off.
    if (settings.showVolume || series.vol) out.push({ id: 'volume', pane: 0, kind: 'histogram', color: '', overlay: true, compact: true, data: candles.map((c) => c.volume), signs: candles.map((c) => (c.close >= c.open ? 1 : -1)) });
    add('vol', 'avg', 0, '#e0a73a', { scale: 'volume', quiet: true });
    // Zones: the three price bands where most money was liquidated in the loaded period.
    // Liquidations are known for the whole period at once, so in practice they would show the future.
    const showLiqs = settings.showLiquidations && !practicing;
    if (showLiqs) {
      const clusters = liquidationClusters(liqs, 0.15, 3);
      const from = liqs.length ? Math.min(...liqs.map((l) => l.time)) : Infinity;
      for (let k = 0; k < 3; k++) {
        const c = clusters[k];
        out.push({ id: `liq.zone${k}`, pane: 0, kind: 'line', color: '#b388ff', dashed: true, title: t('liq.zone'), rev: c ? `${c.price}|${Math.round(c.usd)}|${candles.length}` : 'none', data: candles.map((cc) => (c && cc.time + tf.ms > from ? c.price : null)) });
      }
    }
    // Panes under the price, in a fixed order. An oscillator gets its pane whenever it is computed: for its own
    // block, or because a divergence is being read on it.
    let pane = 0;
    const paneOf: Partial<Record<'rsi' | 'stoch' | 'macd', number>> = {};
    if (series.rsi) {
      paneOf.rsi = ++pane;
      add('rsi', 'value', pane, '#b39ddb', { levels: [view.rsi.overbought, view.rsi.oversold] });
    }
    if (series.stoch) {
      paneOf.stoch = ++pane;
      add('stoch', 'k', pane, '#4fc3f7', { levels: [view.stoch.overbought, view.stoch.oversold] });
      add('stoch', 'd', pane, '#e0a73a');
    }
    if (series.macd) {
      paneOf.macd = ++pane;
      add('macd', 'hist', pane, '', { kind: 'histogram' });
      add('macd', 'macd', pane, '#5b9cf6', { levels: [0] });
      add('macd', 'signal', pane, '#e0a73a');
    }
    if (series.obv) {
      pane++;
      add('obv', 'value', pane, '#4dd0e1', { title: 'OBV' });
      add('obv', 'avg', pane, '#e0a73a');
    }
    // Divergences: the latest ones known on the candle being studied, each as two segments joining the two swing
    // points compared: one over the price and one over the oscillator. Three of each kind at most.
    if (view.div.on) {
      const osc = view.div.osc;
      const values = osc === 'rsi' ? series.rsi?.value : osc === 'stoch' ? series.stoch?.d : series.macd?.macd;
      const chosen = studying ? null : picked;
      let ref = chosen ? chosen.index : candles.length - 1;
      while (!chosen && ref > 0 && !candles[ref]?.closed) ref--;
      const zone = !view.div.zone ? undefined : osc === 'rsi' ? { upper: view.rsi.overbought, lower: view.rsi.oversold } : osc === 'stoch' ? { upper: view.stoch.overbought, lower: view.stoch.oversold } : { upper: 0, lower: 0 };
      const known = values ? findDivergences(candles.slice(0, ref + 1), values, view.div.strength, view.div.lookback, zone) : [];
      for (const side of ['bear', 'bull'] as const) {
        const latest = known.filter((d) => d.side === side).slice(-3).reverse();
        for (let k = 0; k < 3; k++) {
          const d = latest[k];
          const rev = d ? `${candles[0]?.time}|${d.from}|${d.to}|${candles.length}` : 'none';
          const color = side === 'bear' ? '#ef5350' : '#26a69a';
          const segment = (a: number, b: number) => candles.map((_, j) => (!d ? null : j === d.from ? a : j === d.to ? b : null));
          out.push({ id: `div.${side}${k}`, pane: 0, kind: 'line', color, width: 2, quiet: true, rev, data: d ? segment(d.priceFrom, d.priceTo) : segment(0, 0) });
          out.push({ id: `div.${side}${k}.osc`, pane: paneOf[osc] ?? 0, kind: 'line', color, width: 2, quiet: true, rev, data: d && paneOf[osc] ? segment(d.oscFrom, d.oscTo) : segment(0, 0) });
        }
      }
    }
    if (showLiqs) {
      pane++;
      const per = liquidationsPerCandle(candles, tf.ms, liqs);
      const rev = `${liqs.length}|${candles.length}`;
      out.push({ id: 'liq.shorts', pane, kind: 'histogram', color: '', compact: true, title: t('liq.shorts'), rev, data: per.shorts });
      out.push({ id: 'liq.longs', pane, kind: 'histogram', color: '', compact: true, title: t('liq.longs'), rev, data: per.longs });
    }
    return finish();
  }, [shown, viewCandles, picked, studying, practicing, settings.showVolume, settings.showLiquidations, settings.theme, liqs]);
  const chartSignals = useMemo(() => (practicing ? practice.revealed : exploring ? [] : signals), [exploring, practicing, practice.revealed, signals]);
  const layoutKey = lines.map((l) => `${l.id}@${l.pane}`).join(',');

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>{t('app.title')}</h1>
          <p className="muted">{t('app.subtitle', { symbol: symbol.label })}</p>
        </div>
        <div className="controls">
          <label className="field inline">
            <span>{t('symbol.label')}</span>
            <select value={symbol.id} onChange={(e) => setSymbol(SYMBOLS.find((x) => x.id === e.target.value) ?? SYMBOLS[0])}>
              {SYMBOLS.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>{t('tf.label')}</span>
            <select value={tf.id} onChange={(e) => { setSelected(null); set('timeframe', e.target.value); }}>
              {TIMEFRAMES.map((x) => (
                <option key={x.id} value={x.id}>{x.id}</option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>{t('history.label')}</span>
            <select value={settings.history} onChange={(e) => set('history', Number(e.target.value))}>
              {HISTORY_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className="field inline">
            <span>{t('font.label')}</span>
            <span className="fontsize">
              <button title={t('font.smaller')} onClick={() => bumpFont(-0.1)}>A−</button>
              <button title={t('font.larger')} onClick={() => bumpFont(0.1)}>A+</button>
            </span>
          </div>
          <div className="field inline">
            <span>{t('sound.label')}</span>
            <button
              className={soundOn ? 'icon on' : 'icon'}
              aria-pressed={soundOn}
              aria-label={soundOn ? t('sound.turnOff') : t('sound.turnOn')}
              title={soundOn ? t('sound.turnOff') : settings.muted ? t('sound.turnOn') : t('sound.blocked')}
              onClick={toggleSound}
            >
              <svg viewBox="0 0 24 24" width="1.25em" height="1.25em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
                {soundOn ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 6 6m0-6-6 6" />}
              </svg>
            </button>
          </div>
          <ContextStrip mood={mood} context={context} asset={symbol.label} long={long} onLong={() => { set('showLongTerm', true); window.setTimeout(() => document.querySelector('[data-block=longterm]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50); }} />
          <div className="field inline">
            <span>{t('theme.label')}</span>
            <button className="icon" data-control="theme" aria-label={settings.theme === 'dark' ? t('theme.toLight') : t('theme.toDark')} title={settings.theme === 'dark' ? t('theme.toLight') : t('theme.toDark')} onClick={() => set('theme', settings.theme === 'dark' ? 'light' : 'dark')}>
              <svg viewBox="0 0 24 24" width="1.25em" height="1.25em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {settings.theme === 'dark' ? (
                  <>
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                  </>
                ) : (
                  <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
                )}
              </svg>
            </button>
          </div>
          <div className="field inline">
            <span>{t('panel.label')}</span>
            <button
              className={settings.panelOpen ? 'icon on' : 'icon'}
              aria-pressed={settings.panelOpen}
              aria-label={settings.panelOpen ? t('panel.hide') : t('panel.show')}
              title={settings.panelOpen ? t('panel.hide') : t('panel.show')}
              data-control="panel"
              onClick={() => { set('panelOpen', !settings.panelOpen); if (!settings.panelOpen && tab === 'signal') setUnseen(false); }}
            >
              <svg viewBox="0 0 24 24" width="1.25em" height="1.25em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M15 4v16" />
                {settings.panelOpen && <rect x="15" y="4" width="6" height="16" fill="currentColor" stroke="none" opacity="0.45" />}
              </svg>
              {!settings.panelOpen && unseen && <span className="dot" title={t('tab.newSignal')} />}
            </button>
          </div>
          <div className={`status ${status.kind}`}>
            {loading && <span className="spinner tiny" />}
            {status.kind === 'error' ? t('status.error', { msg: status.msg }) : t(`status.${status.kind}`)}
            {status.kind === 'error' && <button onClick={() => setReload((n) => n + 1)}>{t('status.retry')}</button>}
          </div>
          {lastPrice !== undefined && <div className="price">{fmtPrice(lastPrice)}</div>}
        </div>
      </header>

      {banner && (
        <div className={`banner ${banner.signal.side}`} onClick={() => { setBanner(null); openTab('signal'); }}>
          <strong>{t(`side.${banner.signal.side}`).toUpperCase()} {symbol.label} · {tf.id}</strong>
          <span>{fmtPrice(banner.signal.reference)} · SL {fmtPrice(banner.signal.stop)} · TP {fmtPrice(banner.signal.target)}</span>
          <span className="muted">{fmtTime(banner.signal.time)} ✕</span>
        </div>
      )}

      <div className={`modebar ${mode}`}>
        <div className="seg" role="tablist" aria-label={t('mode.label')}>
          {MODES.map((id) => (
            <button key={id} role="tab" data-mode={id} aria-selected={mode === id} className={mode === id ? 'active' : ''} onClick={() => openMode(id)}>
              {t(`mode.${id}`)}
            </button>
          ))}
        </div>
        <span className="about" role="status">{t(`mode.${mode}About`)}</span>
      </div>

      <div className={settings.panelOpen ? 'layout' : 'layout wide'}>
        <main>
          {/* Above the chart, so the choices stay in view however tall the chart is. */}
          {mode === 'practice' && <PracticeBar p={practice} />}
          <div className="chart-wrap">
            <Chart
              key={`${layoutKey}|${settings.theme}`}
              theme={CHART_THEMES[settings.theme]}
              candles={viewCandles}
              lines={lines}
              signals={chartSignals}
              dataKey={dataKey}
              levels={
                practicing
                  ? practice.mine.open
                    ? { entry: practice.mine.open.entryPrice ?? viewCandles[viewCandles.length - 1]?.close ?? 0, stop: practice.mine.open.stop, target: practice.mine.open.target }
                    : null
                  : exploring || check.verdict === 'invalid'
                    ? null
                    : levels
              }
              focus={practicing ? null : focus}
              follow={practicing}
              viewReset={viewReset}
              fontSize={chartFont}
              onHover={setHoverTime}
            />
            {(loading || trendLoading) && (
              <div className="overlay" role="status">
                <div className="spinner" />
                <span>{loading ? t('status.loadingN', { tf: tf.id, n: progress, total: settings.history }) : t('status.loadingTrend', { tf: trendTf.id })}</span>
              </div>
            )}
          </div>
          <div className="chart-foot">
            <span>
              {t('app.utc')} · <UtcClock />
            </span>
            <label>
              <input type="checkbox" checked={settings.showVolume} onChange={(e) => set('showVolume', e.target.checked)} />
              {t('layer.volume', { asset: symbol.id })}
            </label>
            <label title={t('liq.about')}>
              <input type="checkbox" checked={settings.showLiquidations} onChange={(e) => set('showLiquidations', e.target.checked)} />
              {t('layer.liquidations')}
            </label>
            {settings.showLiquidations && (
              <span data-liq={liqState}>
                {liqState === 'error'
                  ? t('liq.error')
                  : liqs.length === 0
                    ? t(liqState === 'loading' ? 'liq.loading' : 'liq.none')
                    : t('liq.status', { n: liqs.length, from: fmtTime(Math.min(...liqs.map((l) => l.time))), usd: fmtNum(liqs.reduce((sum, l) => sum + l.usd, 0) / 1e6, 2) })}
                {liqState === 'loading' && liqs.length > 0 && ' …'}
              </span>
            )}
            <button className="sizer-reset" data-action="reset-view" title={t('chart.resetHint')} onClick={() => setViewReset((n) => n + 1)}>{t('chart.reset')}</button>
            <span className="sizer" data-control="chart-size">
              {t('chart.height')}
              <button onClick={() => bumpChart(-0.1)} disabled={settings.chartScale <= 0.6} aria-label={t('chart.shorter')} title={t('chart.shorter')}>−</button>
              <button onClick={() => bumpChart(0.1)} disabled={settings.chartScale >= 1.8} aria-label={t('chart.taller')} title={t('chart.taller')}>+</button>
            </span>
          </div>

          {mode !== 'practice' && viewCandles.length > 0 && <LongTermStrip daily={daily} from={viewCandles[0].time} to={viewCandles[viewCandles.length - 1].time} open={settings.showLongTerm} onOpen={(v) => v !== settings.showLongTerm && set('showLongTerm', v)} />}

          {mode === 'practice' ? (
            <PracticeResults p={practice} />
          ) : relation ? (
            <RelationPanel
              report={relation.report}
              counts={relation.counts}
              onUsePreset={(id) => {
                const preset = BUILTIN_STRATEGIES.find((x) => x.id === id);
                if (!preset) return;
                setSettings((st) => ({ ...st, strategy: preset.strategy, timeoutBars: preset.timeoutBars }));
                openTab('rule');
              }}
            />
          ) : (
          <Panel
            title={t('results.title')}
            actions={
              result.trades.length > 0 && !loading ? (
                <div className="seg small" role="tablist" aria-label={t('view.label')}>
                  {VIEWS.map((id) => (
                    <button key={id} role="tab" data-view-tab={id} aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
                      {t(`view.${id}`)}
                    </button>
                  ))}
                </div>
              ) : undefined
            }
          >
            {candles.length > 0 && (
              <p className="muted small">{t('results.period', { n: closedCount, from: fmtTime(candles[0].time), to: fmtTime(candles[candles.length - 1].time) })}</p>
            )}
            {loading ? (
              <p className="muted">{t('status.loading')}</p>
            ) : view === 'curve' && result.trades.length > 0 ? (
              <EquityView trades={result.trades} splitTime={splitTime} selected={selected} onSelect={selectTrade} />
            ) : view === 'conditions' && result.trades.length > 0 ? (
              <ConditionsView trades={result.trades} candles={candles} />
            ) : view === 'params' && result.trades.length > 0 ? (
              <ParamsView
                strategy={strategy}
                pct={splitPct}
                resetKey={`${symbol.id}|${tf.id}|${candles[0]?.time ?? 0}|${closedCount}|${splitTime}|${taker}|${settings.timeoutBars}|${trendCandles.length}`}
                onApply={(next) => set('strategy', next)}
                run={(cfg) => {
                  // Only the tuning part of the history: the validation part must stay unseen by any search for parameters.
                  const part = closedCandles.filter((c) => c.time < splitTime);
                  const r = makeStrategyRule(cfg, trendTf.id);
                  const m = backtest(part, scanSignals(compileRule(r), buildContext(r, part, { ms: tf.ms, higher })), { feeEntry: taker, feeExit: taker, slippage: 0, timeoutBars: Math.max(1, Math.round(settings.timeoutBars)) }).metrics;
                  return { trades: m.trades, avgNetR: m.avgNetR, totalNetR: m.totalNetR };
                }}
              />
            ) : (
              <>
                {result.trades.length > 0 && <Verdict m={result.metrics} />}
                {funnel.length > 0 && (
                  <div className="funnel" title={t('funnel.hint')}>
                    <span className="muted">{t('funnel.title')}:</span>
                    {funnel.map((f) => (
                      <span key={f.id} className={f.count === 0 ? 'chip bad' : 'chip'}>{t(`block.${f.id}`)} <strong>{f.count}</strong></span>
                    ))}
                    <span className="muted">→ {t('funnel.all')}:</span>
                    <span className={signals.length === 0 ? 'chip bad' : 'chip good'}><strong>{t('funnel.signals', { n: signals.length })}</strong></span>
                    {strategy.trend.mode !== 'off' && <span className="muted small">{t('funnel.trend')}</span>}
                  </div>
                )}
                {result.trades.length === 0 ? (
                  <p className="notice">
                    {activeBlocks(strategy) === 0 ? t('results.noBlocks') : signals.length === 0 ? t('results.noSignals') : t('results.noneTraded', { n: signals.length })}
                    {signals.length === 0 && funnel.length > 0 && ` ${mixesReversalAndMomentum(strategy) ? t('blocks.conflict') : t('funnel.hint')}`}
                  </p>
                ) : (
                  <MetricsView m={result.metrics} skipped={result.skipped} />
                )}
                {result.trades.length > 0 && (
                  <p className="muted small" data-block="funding">
                    {funded.since === null
                      ? t('funding.none')
                      : t(funded.crossed === 0 ? 'funding.zero' : funded.totalR > 0 ? 'funding.cost' : 'funding.gain', { n: funded.crossed, r: fmtNum(Math.abs(funded.totalR), 2) })}
                    {funded.since !== null && funded.unknown > 0 && ` ${t('funding.unknown', { n: funded.unknown, time: fmtTime(funded.since) })}`}
                  </p>
                )}
                {rawResult.tooTight > 0 && <p className="muted small" data-block="too-tight">{t('results.tooTight', { n: rawResult.tooTight })}</p>}
                {result.trades.length > 0 && <p className="muted small">{t('results.rNote')}</p>}
                {result.trades.length > 0 && (
                  <>
                    <div className="subhead">
                      <h3>{t('oos.title')}</h3>
                      <span className="actions">
                        <label className="field inline">
                          <select aria-label={t('oos.split')} value={splitPct} onChange={(e) => set('splitPct', Number(e.target.value))}>
                            {[50, 60, 70, 80].map((p) => (
                              <option key={p} value={p}>{p} / {100 - p}</option>
                            ))}
                          </select>
                        </label>
                        <button disabled={revealed} onClick={() => { setRevealed(true); setReveals((n) => n + 1); }}>{t('oos.reveal')}</button>
                      </span>
                    </div>
                    <SplitTable inSample={split.inSample} outOfSample={split.outOfSample} pct={splitPct} splitTime={splitTime} revealed={revealed} />
                    <p className="muted small">
                      {t('oos.note')} {reveals > 1 && t('oos.revealed', { n: reveals })}
                    </p>
                  </>
                )}
                <p className="muted small">{t('results.assumptions')}</p>
                <TradeTable result={result} selected={selected} onSelect={selectTrade} />
              </>
            )}
          </Panel>
          )}

          {mode !== 'practice' && <Panel
            title={t('compare.title')}
            actions={<button disabled={comparing !== null} onClick={runCompare}>{comparing ? t('compare.running', { tf: comparing }) : t('compare.run')}</button>}
          >
            <p className="muted small">{t('compare.hint', { n: compareCount })}</p>
            <CompareTable rows={compare} />
          </Panel>}
        </main>

        <aside className="side" hidden={!settings.panelOpen}>
          <div className="tabs" role="tablist">
            {mode !== 'trade' && <span className="tab active solo">{t(`mode.${mode}`)}</span>}
            {mode === 'trade' && TABS.map((id) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab active' : 'tab'} onClick={() => openTab(id)}>
                {t(`tab.${id}`)}
                {id === 'signal' && unseen && <span className="dot" title={t('tab.newSignal')} />}
                {id === 'alerts' && alerts.length > 0 && <span className="count">{alerts.length}</span>}
                {id === 'history' && history.length > 0 && <span className="count">{history.length}</span>}
              </button>
            ))}
            <button className="tab collapse" title={t('panel.hide')} aria-label={t('panel.hide')} onClick={() => set('panelOpen', false)}>»</button>
          </div>

          {/* Hidden tabs stay mounted so half-typed values and open blocks survive a switch. */}
          <div className="tab-body" role="tabpanel" hidden={mode !== 'trade' || tab !== 'rule'}>
            <StrategyPanel
              strategy={settings.strategy}
              onChange={(next) => set('strategy', next)}
              timeoutBars={settings.timeoutBars}
              onTimeout={(v) => set('timeoutBars', v)}
              trendTf={trendTf.id}
              tries={tries}
              presets={presets}
              onLoad={(next, timeoutBars) => setSettings((s) => ({ ...s, strategy: next, timeoutBars }))}
              onSave={(name) => setPresets((list) => [...list.filter((p) => p.name !== name), { name, strategy, timeoutBars: settings.timeoutBars }].sort((a, b) => a.name.localeCompare(b.name)))}
              onDelete={(name) => setPresets((list) => list.filter((p) => p.name !== name))}
            />
          </div>

          <div className="tab-body" role="tabpanel" hidden={mode !== 'trade' || tab !== 'signal'}>
            <SignalExplain
              signal={explained}
              latest={picked === null}
              strategy={strategy}
              symbol={symbol}
              tf={tf.id}
              trendTf={trendTf.id}
              onPrepare={() => {
                if (!explained) return;
                setSelected(null);
                useSignal(explained);
                openTab('order');
              }}
            />
            <Checklist evals={evals} heading={checkHeading} />
          </div>

          <div className="tab-body" role="tabpanel" hidden={mode !== 'trade' || tab !== 'order'}>
            <OrderPanel
              symbol={symbol}
              levels={levels}
              onLevels={setLevels}
              size={size}
              onSize={setSize}
              settings={settings}
              onSetting={set}
              check={check}
              lastPrice={lastPrice}
              pending={pending}
              onPending={(p) => {
                set('entryOrder', 'limit');
                setLevels(p.levels);
                setOrigin({ kind: 'pending', label: p.label });
              }}
              onRecord={(outcome) => {
                if (!check.side) return;
                // A signal explains an order only while the order still goes the signal's way: levels retyped into the
                // opposite trade are a different decision, logged as typed by hand.
                const fromSignal = origin?.kind === 'signal' && origin.signal.side === check.side ? origin.signal : null;
                const kind = fromSignal ? 'signal' : origin?.kind === 'pending' ? 'pending' : 'manual';
                const blocks = ENTRY_BLOCKS.filter((id) => strategy[id].on).map((id) => t(`block.${id}`));
                const record: OrderRecord = {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  time: Date.now(),
                  ...outcome,
                  market: symbol.label,
                  asset: symbol.id,
                  timeframe: tf.id,
                  side: check.side,
                  type: settings.entryOrder,
                  ...levels,
                  size,
                  marginMode: settings.marginMode,
                  leverage: settings.leverage,
                  rewardRisk: check.netGain > 0 ? check.rewardRisk : null,
                  netLoss: check.netLoss,
                  marginOnCapital: check.marginOnCapital,
                  verdict: check.verdict,
                  rule: `${t(`kind.${classifyStrategy(strategy)}`)}: ${blocks.join(' + ')}${strategy.trend.mode !== 'off' ? ` + ${t('block.trend').toLowerCase()}` : ''}`,
                  origin: kind,
                  originLabel: fromSignal ? t('history.fromSignal', { time: fmtTime(fromSignal.time) }) : kind === 'pending' && origin?.kind === 'pending' ? origin.label : t('history.byHand'),
                  // Only the stop and the target tell whether the plan was changed; the entry differs by design (next candle's open, or a limit price).
                  edited: fromSignal !== null && (levels.stop !== roundPrice(fromSignal.stop) || levels.target !== roundPrice(fromSignal.target)),
                  explanation: fromSignal && origin?.kind === 'signal' ? origin.lines : [],
                  notes: '',
                };
                setHistory((list) => [record, ...list].slice(0, HISTORY_LIMIT));
              }}
              onLatestSignal={signals.length > 0 ? () => { setSelected(null); setPicked(null); useSignal(signals[signals.length - 1]); } : null}
            />
          </div>

          <div className="tab-body" role="tabpanel" hidden={mode !== 'practice'}>
            <PracticePanel
              p={practice}
              ruleName={`${t(`kind.${classifyStrategy(strategy)}`)}: ${ENTRY_BLOCKS.filter((id) => strategy[id].on).map((id) => t(`block.${id}`)).join(' + ')}`}
              rules={practiceRules.map(({ key, label, group }) => ({ key, label, group }))}
              ruleKey={practiceRules.find((r) => JSON.stringify(r.strategy) === JSON.stringify(strategy) && r.timeoutBars === settings.timeoutBars)?.key ?? ''}
              onRule={(key) => {
                const r = practiceRules.find((x) => x.key === key);
                if (r) setSettings((st) => ({ ...st, strategy: r.strategy, timeoutBars: r.timeoutBars }));
              }}
            />
          </div>

          <div className="tab-body" role="tabpanel" hidden={!exploring}>
            <ExplorePanel config={settings.explore} onChange={(next) => set('explore', next)} />
          </div>

          <div className="tab-body" role="tabpanel" hidden={mode !== 'trade' || tab !== 'history'}>
            <HistoryPanel
              records={history}
              onNotes={(id, notes) => setHistory((list) => list.map((r) => (r.id === id ? { ...r, notes } : r)))}
              onDelete={(id) => setHistory((list) => list.filter((r) => r.id !== id))}
              onClear={() => setHistory([])}
              onOutcomes={(updates) => setHistory((list) => list.map((r) => (updates[r.id] ? { ...r, outcome: updates[r.id] } : r)))}
            />
          </div>

          <div className="tab-body" role="tabpanel" hidden={mode !== 'trade' || tab !== 'alerts'}>
            <Panel
              title={t('alerts.title')}
              actions={
                typeof Notification !== 'undefined' && Notification.permission === 'default' ? (
                  <button onClick={() => Notification.requestPermission().then(() => setReload((n) => n))}>{t('alerts.notify')}</button>
                ) : undefined
              }
            >
              {alerts.length === 0 && <p className="muted small">{t('alerts.empty')}</p>}
              <ul className="alerts">
                {alerts.map((a) => (
                  <li key={a.id} className={a.signal.side} onClick={() => { setPicked(a.signal); setFocus((f) => ({ time: a.signal.time, n: (f?.n ?? 0) + 1 })); openTab('signal'); }}>
                    <strong>{t(`side.${a.signal.side}`)}</strong> {fmtTime(a.signal.time)} · {fmtPrice(a.signal.reference)} · SL {fmtPrice(a.signal.stop)} · TP {fmtPrice(a.signal.target)}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </aside>
      </div>
    </div>
  );
}
