/**
 * Crypto Fear & Greed Index from alternative.me: one number per day, 0 (extreme
 * fear) to 100 (extreme greed), for the crypto market as a whole. It is market
 * sentiment, not one of Murphy's indicators, and no rule uses it.
 */
export interface FearGreed {
  value: number;
  /** One of: extremeFear, fear, neutral, greed, extremeGreed. */
  mood: string;
  /** Yesterday's value, when the service returns it. */
  previous: number | null;
  /** Start of the day the value belongs to, in milliseconds. */
  time: number;
}

const URL = 'https://api.alternative.me/fng/?limit=2';
const MOODS: Record<string, string> = { 'extreme fear': 'extremeFear', fear: 'fear', neutral: 'neutral', greed: 'greed', 'extreme greed': 'extremeGreed' };

/** Parse the service's answer; `null` when it does not have the expected shape. */
export function parseFearGreed(body: unknown): FearGreed | null {
  const rows = (body as { data?: { value?: string; value_classification?: string; timestamp?: string }[] } | null)?.data;
  const today = rows?.[0];
  const value = Number(today?.value);
  if (!today || today.value === undefined || !Number.isFinite(value) || value < 0 || value > 100) return null;
  const previous = Number(rows?.[1]?.value);
  const byValue = value < 25 ? 'extremeFear' : value < 47 ? 'fear' : value < 55 ? 'neutral' : value < 76 ? 'greed' : 'extremeGreed';
  return {
    value,
    mood: MOODS[(today.value_classification ?? '').toLowerCase()] ?? byValue,
    previous: rows?.[1]?.value !== undefined && Number.isFinite(previous) ? previous : null,
    time: Number(today.timestamp) * 1000 || 0,
  };
}

/** Never throws: the index is an extra, and the page must work without it. */
export async function fetchFearGreed(signal?: AbortSignal): Promise<FearGreed | null> {
  try {
    const res = await fetch(URL, { signal });
    return res.ok ? parseFearGreed(await res.json()) : null;
  } catch {
    return null;
  }
}
