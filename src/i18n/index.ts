import { es, type MessageKey } from './es';

const messages: Record<MessageKey, string> = es;

/** Translate a key, filling `{name}` placeholders. Unknown keys are shown as-is so they are easy to spot. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const text = (messages as Record<string, string>)[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** A count with its noun in the right number: `tn('count.trade', 1)` gives "1 operación". */
export const tn = (key: string, n: number) => t(`${key}.${n === 1 ? 'one' : 'other'}`, { n });

const LOCALE = 'es-AR';
/** Prices: one decimal for five-digit prices (BTC), two below that (ETH). */
export const fmtPrice = (v: number) => {
  const digits = Math.abs(v) >= 10_000 ? 1 : 2;
  return v.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
export const fmtMoney = (v: number) => v.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtNum = (v: number, digits = 2) => v.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPct = (v: number, digits = 1) => `${(v * 100).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const fmtR = (v: number) => `${v >= 0 ? '+' : ''}${fmtNum(v)} R`;
export const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString(LOCALE, { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
