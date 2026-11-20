import { useEffect, useMemo, useRef, useState } from 'react';
import type { Trade } from '../core/backtest';
import { equityCurve, histogram, type EquityStats } from '../core/stats';
import { fmtNum, fmtR, fmtTime, t, tn } from '../i18n';

/** Width of the element in CSS pixels, kept up to date as the page is resized. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round steps for an axis: about `count` ticks covering [min, max], always including 0 when it is inside. */
export function axisTicks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const raw = span / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

const BIN = 0.5;
const RANGE = { min: -3, max: 5 };

/** The sentence that goes before the numbers: where the rule ended and what it cost to get there. */
function lead(s: EquityStats): string[] {
  const n = s.points.length;
  const out = [t(s.finalR > 0 ? 'curve.leadUp' : 'curve.leadDown', { r: fmtR(s.finalR), ops: tn('count.trade', n) })];
  if (s.worst) {
    const range = { dd: fmtNum(s.maxDrawdownR), from: s.worst.from + 2, to: s.worst.to + 1 };
    out.push(s.worst.recoveredAt === null ? t('curve.ddOpen', range) : t('curve.ddClosed', { ...range, at: s.worst.recoveredAt + 1 }));
  } else {
    out.push(t('curve.ddNone'));
  }
  if (n >= 2 && s.bestR > 0) out.push(t(s.finalR > 0 && s.withoutBestR <= 0 ? 'curve.leansOnBest' : 'curve.withoutBest', { best: fmtR(s.bestR), rest: fmtR(s.withoutBestR) }));
  return out;
}

export function EquityView({ trades, splitTime, selected, onSelect }: { trades: Trade[]; splitTime: number; selected: Trade | null; onSelect: (t: Trade) => void }) {
  const stats = useMemo(() => equityCurve(trades), [trades]);
  const bins = useMemo(() => histogram(trades.map((x) => x.netR), BIN, RANGE), [trades]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = trades.length;
  if (n === 0) return null; // the parent shows this view only when there are trades

  // Equity curve: x is the trade number (0 is the start, before any trade), y the cumulative net result in R.
  // Until the first measurement the plots are drawn narrow and hidden, so nothing jumps.
  const W = Math.max(320, width);
  const H = Math.round(Math.min(280, Math.max(190, W * 0.3)));
  const pad = { l: 46, r: 12, t: 10, b: 24 };
  const cums = [0, ...stats.points.map((p) => p.cumR)];
  const lo = Math.min(...cums);
  const hi = Math.max(...cums);
  const margin = (hi - lo || 1) * 0.08;
  const y0 = lo - margin;
  const y1 = hi + margin;
  const x = (i: number) => pad.l + (i / n) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((y1 - v) / (y1 - y0)) * (H - pad.t - pad.b);
  const path = (from: number, to: number) => cums.slice(from, to + 1).map((v, k) => `${k ? 'L' : 'M'}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const yTicks = axisTicks(y0, y1, 4);
  const xTicks = axisTicks(0, n, Math.min(8, n)).filter((v) => Number.isInteger(v) && v > 0);
  const splitAt = trades.findIndex((tr) => tr.signal.time >= splitTime);
  const selectedAt = selected ? trades.findIndex((tr) => tr.entryTime === selected.entryTime) : -1;
  const shown = hover ?? (selectedAt >= 0 ? selectedAt : null);
  const point = shown === null ? null : stats.points[shown];

  /** The trade under the pointer: the nearest point of the curve. */
  const tradeAt = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(n, Math.max(1, Math.round(((e.clientX - box.left - pad.l) / (W - pad.l - pad.r)) * n))) - 1;
  };

  // Histogram: one bar per half R of net result.
  const HH = 150;
  const hp = { l: 46, r: 12, t: 16, b: 24 };
  const most = Math.max(...bins.map((b) => b.count));
  const bw = (W - hp.l - hp.r) / bins.length;
  const by = (c: number) => hp.t + (1 - c / most) * (HH - hp.t - hp.b);
  const edge = (v: number) => hp.l + ((v - bins[0].from) / BIN) * bw;
  const label = (v: number) => fmtNum(v, Number.isInteger(v) ? 0 : 1);

  return (
    <div className="curve" data-view="curve" ref={ref} style={{ visibility: width ? 'visible' : 'hidden' }}>
      <p className="lead">{lead(stats).join(' ')}</p>
      <p className="muted small">{t('curve.how')}</p>
      <div className="plot-box" style={{ height: H }}>
      <svg
        className="plot"
        width={W}
        height={H}
        role="img"
        aria-label={t('curve.aria', { n, r: fmtR(stats.finalR) })}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => setHover(tradeAt(e))}
        onClick={(e) => onSelect(trades[tradeAt(e)])}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? 'zero' : 'grid'} x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text className="tick" x={pad.l - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">{label(v)} R</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={v} className="tick" x={x(v)} y={H - 6} textAnchor="middle">{v}</text>
        ))}
        {splitAt > 0 && (
          <g className="split">
            <line x1={x(splitAt)} x2={x(splitAt)} y1={pad.t} y2={H - pad.b} />
            <text className="tick" x={x(splitAt) + 5} y={pad.t + 10}>{t('curve.split')}</text>
          </g>
        )}
        <path className="equity" d={path(0, n)} />
        {stats.worst && <path className="fall" d={path(stats.worst.from + 1, stats.worst.to + 1)} />}
        {point && shown !== null && (
          <g className="cursor">
            <line x1={x(shown + 1)} x2={x(shown + 1)} y1={pad.t} y2={H - pad.b} />
            <circle cx={x(shown + 1)} cy={y(point.cumR)} r={4} />
          </g>
        )}
      </svg>
      </div>
      <p className="readout small" aria-live="polite">
        {point && shown !== null
          ? t('curve.point', { i: shown + 1, time: fmtTime(point.time), side: t(`side.${trades[shown].side}`), r: fmtR(point.netR), cum: fmtR(point.cumR) })
          : t('curve.hover')}
      </p>

      <div className="funnel">
        <span className="chip">{t('curve.losing', { n: stats.longestLosingStreak })}</span>
        <span className="chip">{t('curve.winning', { n: stats.longestWinningStreak })}</span>
        <span className="chip">{t('curve.underwater', { pct: Math.round(stats.underwaterShare * 100) })}</span>
        <span className="chip">{t('curve.median', { r: fmtR(stats.medianR) })}</span>
      </div>

      <h3>{t('dist.title')}</h3>
      <p className="muted small">{t('dist.how')}</p>
      <div className="plot-box" style={{ height: HH }}>
      <svg className="plot" width={W} height={HH} role="img" aria-label={t('dist.aria')}>
        <line className="zero" x1={hp.l} x2={W - hp.r} y1={HH - hp.b} y2={HH - hp.b} />
        {bins.map((b, i) => (
          <g key={b.from}>
            {b.count > 0 && (
              <>
                <rect className={b.to <= 1e-9 ? 'bar loss' : 'bar win'} x={hp.l + i * bw + 1.5} width={Math.max(1, bw - 3)} y={by(b.count)} height={HH - hp.b - by(b.count)} rx={2}>
                  <title>{t(b.count === 1 ? 'dist.bar1' : 'dist.bar', { from: b.open === 'below' ? '−∞' : label(b.from), to: b.open === 'above' ? '+∞' : label(b.to), n: b.count })}</title>
                </rect>
                <text className="tick count" x={hp.l + (i + 0.5) * bw} y={by(b.count) - 4} textAnchor="middle">{b.count}</text>
              </>
            )}
          </g>
        ))}
        {bins.map((b, i) =>
          b.open ? (
            <text key={b.from} className="tick" x={hp.l + (i + 0.5) * bw} y={HH - 6} textAnchor="middle">{b.open === 'below' ? `≤ ${label(b.to)}` : `> ${label(b.from)}`}</text>
          ) : Number.isInteger(b.from) && bw * 2 > 30 && !(i === 1 && bins[0].open) ? (
            <text key={b.from} className="tick" x={edge(b.from)} y={HH - 6} textAnchor="middle">{label(b.from)}{b.from === 0 ? ' R' : ''}</text>
          ) : null,
        )}
        {bins[0].from < 0 && bins[bins.length - 1].to > 0 && <line className="split" x1={edge(0)} x2={edge(0)} y1={hp.t - 6} y2={HH - hp.b} />}
      </svg>
      </div>
    </div>
  );
}
