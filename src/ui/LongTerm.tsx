import { useEffect, useMemo, useRef, useState } from 'react';
import { sma } from '../core/indicators';
import { LONG_FAST, LONG_SLOW, longTerm } from '../core/longTerm';
import type { Candle } from '../core/types';
import { fmtPct, fmtPrice, fmtTime, t } from '../i18n';

/**
 * The year behind the chart: daily closes with their 50 and 200-day averages, and the stretch the main chart
 * covers marked on it. Folded by default; opening it is remembered.
 */
export function LongTermStrip({ daily, from, to, open, onOpen }: { daily: Candle[]; from: number; to: number; open: boolean; onOpen: (v: boolean) => void }) {
  const lt = useMemo(() => longTerm(daily), [daily]);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);
  if (!lt) return null;

  const closed = daily.filter((c) => c.closed);
  const year = closed.slice(-366);
  const offset = closed.length - year.length;
  const closes = closed.map((c) => c.close);
  const [fast, slow] = [sma(closes, LONG_FAST).slice(offset), sma(closes, LONG_SLOW).slice(offset)];
  const W = Math.max(320, width);
  const H = 130;
  const pad = { l: 8, r: 64, t: 8, b: 18 };
  const all = [...year.map((c) => c.close), ...fast, ...slow].filter((v): v is number => v !== null);
  const [lo, hi] = [Math.min(...all), Math.max(...all)];
  const x = (i: number) => pad.l + (i / Math.max(1, year.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const line = (values: (number | null)[]) => values.map((v, i) => (v === null ? '' : `${i === 0 || values[i - 1] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
  // The loaded stretch as a band: from the first candle on the main chart to the last.
  const at = (time: number) => Math.min(year.length - 1, Math.max(0, year.findIndex((c) => c.time + 86_400_000 > time) === -1 ? year.length - 1 : year.findIndex((c) => c.time + 86_400_000 > time)));
  const [bandFrom, bandTo] = [x(at(from)), x(at(to))];

  return (
    <details className="longterm" data-block="longterm" open={open} onToggle={(e) => onOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        {t('long.title')} <span className={`chip ${lt.trend === 'up' ? 'good' : lt.trend === 'down' ? 'bad' : ''}`}>{t(`long.${lt.trend}`)}</span>
      </summary>
      <p className="lead">
        {lt.sma50 === null || lt.sma200 === null
          ? t('long.leadUnknown', { n: LONG_SLOW })
          : t(`long.lead.${lt.trend}`, { close: fmtPrice(lt.close), fast: fmtPrice(lt.sma50), slow: fmtPrice(lt.sma200) })}{' '}
        {t('long.change', { days: lt.days, pct: `${lt.change >= 0 ? '+' : ''}${fmtPct(lt.change, 0)}` })}
      </p>
      <p className="muted small">{t('long.how')}</p>
      <div className="plot-box" ref={ref} style={{ height: H }}>
        {width > 0 && (
          <svg className="plot" width={W} height={H} role="img" aria-label={t('long.aria')}>
            <rect className="band" x={bandFrom} y={pad.t} width={Math.max(3, bandTo - bandFrom)} height={H - pad.t - pad.b} />
            <path className="slow" d={line(slow)} />
            <path className="fast" d={line(fast)} />
            <path className="price" d={line(year.map((c) => c.close))} />
            <text className="tick" x={pad.l} y={H - 4}>{fmtTime(year[0].time).slice(0, 8)}</text>
            <text className="tick" x={W - pad.r} y={H - 4} textAnchor="end">{fmtTime(year[year.length - 1].time).slice(0, 8)}</text>
            <text className="tick" x={W - pad.r + 6} y={y(lt.close)} dominantBaseline="middle">{fmtPrice(lt.close)}</text>
            {lt.sma50 !== null && <text className="tick fast" x={W - pad.r + 6} y={Math.min(H - pad.b, Math.max(pad.t + 8, y(lt.sma50) + (Math.abs(y(lt.sma50) - y(lt.close)) < 11 ? 11 : 0)))} dominantBaseline="middle">SMA 50</text>}
            {lt.sma200 !== null && <text className="tick slow" x={W - pad.r + 6} y={Math.min(H - pad.b, Math.max(pad.t + 8, y(lt.sma200)))} dominantBaseline="middle">SMA 200</text>}
          </svg>
        )}
      </div>
    </details>
  );
}
