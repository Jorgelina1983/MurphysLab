import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { Signal } from '../core/rule/types';
import type { Candle, Series } from '../core/types';

export interface ChartLevels {
  entry: number;
  stop: number;
  target: number;
}

/** One indicator line. Pane 0 is the price chart; higher numbers are panes below it. */
export interface ChartLine {
  id: string;
  pane: number;
  kind: 'line' | 'histogram';
  color: string;
  width?: 1 | 2;
  /** Histograms only: colour each bar by the sign of this series, not of its own value (volume by candle direction). */
  signs?: Series;
  /** Histograms only: draw in the lower fifth of its pane on a scale of its own, behind the main series. */
  overlay?: boolean;
  /** Show values as 1,2K / 3,4M. */
  compact?: boolean;
  /** Label shown beside the line's value on the price scale. */
  title?: string;
  dashed?: boolean;
  /**
   * Set on lines whose whole shape can change between candles (a Fibonacci grid moving to a new swing).
   * When it changes, the line is redrawn in full; other lines only get their last point updated.
   */
  rev?: string;
  /** Draw as dotted steps: for values that hold and then jump, like support and resistance levels. */
  steps?: boolean;
  data: Series;
  /** Horizontal reference lines for this series, e.g. the RSI thresholds or the MACD zero line. */
  levels?: number[];
  /** Draw on the overlay scale of the histogram with this id (the volume average over the volume bars). */
  scale?: string;
  /** Never label the last value on the price scale: for short segments that end in the past. */
  quiet?: boolean;
}

interface Props {
  candles: Candle[];
  /**
   * Indicator lines. Which lines exist is read once, when the chart is created:
   * the parent gives the chart a new `key` when the set of lines changes.
   */
  lines: ChartLine[];
  signals: Signal[];
  /** Changes whenever the whole dataset must be redrawn (timeframe, parameters, reload). */
  dataKey: string;
  levels: ChartLevels | null;
  /** Candle time to centre on, with a counter so the same time can be focused twice. */
  focus: { time: number; n: number } | null;
  /** Axis label size in pixels; follows the interface text size. */
  fontSize: number;
  /** Colours of the chart's own surface. Read when the chart is created: the parent remounts it on a theme change. */
  theme: ChartTheme;
  /** When a candle is added, move the view along with it and keep its zoom and placement (practice mode, where candles arrive by hand). */
  follow?: boolean;
  /** Changes when the user asks for the default view back: latest candles, standard zoom, automatic price scales. */
  viewReset?: number;
  onHover: (time: number | null) => void;
}

export interface ChartTheme {
  background: string;
  text: string;
  grid: string;
  border: string;
}
export const CHART_THEMES: Record<'dark' | 'light', ChartTheme> = {
  dark: { background: '#12161c', text: '#c8d0da', grid: '#1c222b', border: '#2a313b' },
  light: { background: '#ffffff', text: '#3a4553', grid: '#eef1f5', border: '#d3d9e1' },
};

const UP = '#26a69a';
const DOWN = '#ef5350';
const sec = (ms: number) => (ms / 1000) as UTCTimestamp;
const point = (l: ChartLine, c: Candle, v: number | null | undefined, i: number) => {
  if (v === null || v === undefined) return { time: sec(c.time) };
  if (l.kind !== 'histogram') return { time: sec(c.time), value: v };
  const alpha = l.overlay ? 0.35 : 0.6;
  const up = (l.signs ? (l.signs[i] ?? 0) : v) >= 0;
  return { time: sec(c.time), value: v, color: up ? `rgba(38,166,154,${alpha})` : `rgba(239,83,80,${alpha})` };
};

export function Chart({ candles, lines, signals, dataKey, levels, focus, fontSize, theme, follow, viewReset, onHover }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{
    chart: IChartApi;
    price: ISeriesApi<'Candlestick'>;
    series: (ISeriesApi<'Line'> | ISeriesApi<'Histogram'>)[];
    markers: ISeriesMarkersPluginApi<Time>;
  } | null>(null);
  const drawn = useRef({ key: '', length: 0 });
  const drawnRevs = useRef<(string | undefined)[]>([]);
  const levelLines = useRef<IPriceLine[]>([]);
  // Labels on the price axis. The library pushes overlapping labels apart, which moves them away from their
  // lines; when the axis is squeezed, the labels of Entrada, Stop and Objetivo ended up far from where the lines
  // are. So the order's labels and the last price always keep their place, and any other label on the price pane
  // (levels, Fibonacci, trendlines) is hidden while it would sit on top of one of them or of a label already
  // shown. The lines themselves stay. Checked a few times a second, since the axis can be dragged at any time.
  const labelState = useRef<(boolean | undefined)[]>([]);
  const latest = useRef({ lines, levels, candles, fontSize });
  latest.current = { lines, levels, candles, fontSize };
  useEffect(() => {
    const tick = () => {
      const a = api.current;
      const now = latest.current;
      if (!a || now.candles.length === 0) return;
      const gap = now.fontSize + 9;
      const taken: number[] = [];
      const claim = (price: number | null | undefined) => {
        const y = price == null ? null : a.price.priceToCoordinate(price);
        if (y !== null) taken.push(y);
      };
      if (now.levels) [now.levels.entry, now.levels.stop, now.levels.target].forEach(claim);
      claim(now.candles[now.candles.length - 1].close);
      now.lines.forEach((l, k) => {
        if (l.pane !== 0 || l.kind !== 'line' || l.quiet || l.scale || !l.title) return;
        let value: number | null = null;
        for (let i = l.data.length - 1; i >= 0 && value === null; i--) value = l.data[i];
        const y = value === null ? null : a.price.priceToCoordinate(value);
        const show = y !== null && taken.every((t) => Math.abs(t - y) >= gap);
        if (show && y !== null) taken.push(y);
        if (labelState.current[k] === show) return;
        labelState.current[k] = show;
        a.series[k]?.applyOptions({ lastValueVisible: show, title: show ? l.title : '' });
      });
    };
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, []);
  const refLines = useRef<{ series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'>; line: IPriceLine }[]>([]);
  const hover = useRef(onHover);
  hover.current = onHover;
  const panes = Math.max(0, ...lines.map((l) => l.pane));

  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: theme.background }, textColor: theme.text, fontSize, panes: { separatorColor: theme.border } },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: theme.border },
      rightPriceScale: { borderColor: theme.border },
      crosshair: { mode: 0 },
    });
    const price = chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false });
    const quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    const series = lines.map((l) =>
      l.kind === 'histogram'
        ? chart.addSeries(
            HistogramSeries,
            { ...quiet, lastValueVisible: l.title !== undefined, title: l.title ?? '', priceFormat: l.compact ? { type: 'volume' } : { type: 'price', precision: 2, minMove: 0.01 }, ...(l.overlay ? { priceScaleId: `overlay-${l.scale ?? l.id}` } : {}) },
            l.pane,
          )
        : chart.addSeries(LineSeries, { ...quiet, lastValueVisible: !l.quiet && (l.pane > 0 || l.title !== undefined), title: l.title ?? '', color: l.color, lineWidth: l.width ?? 1, ...(l.scale ? { priceScaleId: `overlay-${l.scale}` } : {}), ...(l.steps ? { lineType: LineType.WithSteps, lineStyle: LineStyle.Dashed } : l.dashed ? { lineStyle: LineStyle.Dashed } : {}) }, l.pane),
    );
    lines.forEach((l, k) => l.overlay && series[k].priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } }));
    // The price keeps three parts of the height for each part an indicator pane gets, however many panes there are.
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
    const markers = createSeriesMarkers(price, []);
    chart.subscribeCrosshairMove((p) => hover.current(typeof p.time === 'number' ? p.time * 1000 : null));
    api.current = { chart, price, series, markers };
    return () => {
      chart.remove();
      api.current = null;
      drawn.current = { key: '', length: 0 };
      refLines.current = [];
      levelLines.current = [];
    };
  }, []);

  useEffect(() => {
    api.current?.chart.applyOptions({ layout: { fontSize } });
  }, [fontSize]);

  // The default view: the latest candles at the standard zoom, with room on the right so the level labels
  // (Resist., Soporte, Máximo…) do not sit on top of the last candles, and every price scale back on automatic
  // (dragging a price axis switches that off).
  const count = useRef(0);
  count.current = candles.length;
  const defaultView = () => {
    const a = api.current;
    if (!a || count.current === 0) return;
    a.chart.timeScale().setVisibleLogicalRange({ from: count.current - 150, to: count.current + 22 });
    for (const s of [a.price, ...a.series]) s.priceScale().applyOptions({ autoScale: true });
  };
  useEffect(() => {
    if (viewReset) defaultView();
  }, [viewReset]);

  // Candles and indicator lines. A live tick only touches the last candle, so it is patched in place.
  useEffect(() => {
    const a = api.current;
    if (!a || candles.length === 0) return;
    const i = candles.length - 1;
    const c = candles[i];
    if (drawn.current.key === dataKey && drawn.current.length === candles.length) {
      a.price.update({ time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close });
      lines.forEach((l, k) => {
        if (l.rev === drawnRevs.current[k]) return a.series[k]?.update(point(l, c, l.data[i], i));
        a.series[k]?.setData(candles.map((cc, j) => point(l, cc, l.data[j], j)));
        // A line with a revision can also change its label and weight (a level tested once more).
        if (l.kind === 'line') a.series[k]?.applyOptions({ title: l.title ?? '', lineWidth: l.width ?? 1 });
        labelState.current[k] = undefined;
        drawnRevs.current[k] = l.rev;
      });
      return;
    }
    const firstDraw = drawn.current.key !== dataKey;
    // In practice mode the view the user has arranged (zoom, and where the last candle sits) is kept: it is
    // read before the redraw and moved along by the candles added. A view panned back into the past is left alone.
    const before = !firstDraw && follow ? a.chart.timeScale().getVisibleLogicalRange() : null;
    const added = candles.length - drawn.current.length;
    a.price.setData(candles.map((k) => ({ time: sec(k.time), open: k.open, high: k.high, low: k.low, close: k.close })));
    lines.forEach((l, k) =>
      a.series[k]?.setData(
        candles.map((cc, j) => {
          const p = point(l, cc, l.data[j], j);
          // The stroke that joins a level to its new value is made invisible, so each level reads as a separate horizontal segment.
          return l.steps && j > 0 && 'value' in p && l.data[j] !== l.data[j - 1] ? { ...p, color: 'transparent' } : p;
        }),
      ),
    );
    if (firstDraw) defaultView();
    else if (before && added > 0 && before.to >= drawn.current.length - 1) a.chart.timeScale().setVisibleLogicalRange({ from: before.from + added, to: before.to + added });
    drawn.current = { key: dataKey, length: candles.length };
    lines.forEach((l, k) => l.rev !== undefined && l.kind === 'line' && a.series[k]?.applyOptions({ title: l.title ?? '', lineWidth: l.width ?? 1 }));
    drawnRevs.current = lines.map((l) => l.rev);
    labelState.current = [];
  }, [candles, lines, dataKey]);

  useEffect(() => {
    const marks: SeriesMarker<Time>[] = signals.map((s) =>
      s.side === 'short'
        ? { time: sec(s.time), position: 'aboveBar', color: DOWN, shape: 'arrowDown', text: 'V' }
        : { time: sec(s.time), position: 'belowBar', color: UP, shape: 'arrowUp', text: 'C' },
    );
    api.current?.markers.setMarkers(marks);
  }, [signals]);

  const refKey = lines.map((l) => (l.levels ?? []).join(',')).join('|');
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    refLines.current.forEach((r) => r.series.removePriceLine(r.line));
    refLines.current = lines.flatMap((l, k) =>
      (l.levels ?? []).map((price) => ({ series: a.series[k], line: a.series[k].createPriceLine({ price, color: '#5c6673', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }) })),
    );
  }, [refKey]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    levelLines.current.forEach((l) => a.price.removePriceLine(l));
    levelLines.current = levels
      ? [
          a.price.createPriceLine({ price: levels.entry, color: theme.text, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Entrada' }),
          a.price.createPriceLine({ price: levels.stop, color: DOWN, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Stop' }),
          a.price.createPriceLine({ price: levels.target, color: UP, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Objetivo' }),
        ]
      : [];
  }, [levels?.entry, levels?.stop, levels?.target]);

  useEffect(() => {
    const a = api.current;
    if (!a || !focus) return;
    const i = candles.findIndex((c) => c.time === focus.time);
    if (i >= 0) a.chart.timeScale().setVisibleLogicalRange({ from: i - 70, to: i + 70 });
  }, [focus?.n]);

  return <div ref={el} className={`chart panes-${panes}`} />;
}
