let ctx: AudioContext | null = null;

/** Browsers block sound until the user has clicked on the page, so call this from a click. */
export async function enableSound(): Promise<boolean> {
  try {
    ctx ??= new AudioContext();
    await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

export const soundEnabled = () => ctx?.state === 'running';

/** Two short tones: rising for a long signal, falling for a short one. */
export function beep(side: 'long' | 'short'): void {
  if (!ctx || ctx.state !== 'running') return;
  const tones = side === 'long' ? [660, 880] : [880, 660];
  tones.forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    const start = ctx!.currentTime + i * 0.18;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(start);
    osc.stop(start + 0.17);
  });
}
