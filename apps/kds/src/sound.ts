/* New-order chime made with Web Audio (no audio file to load).
   Browsers only allow sound after the first tap, so the board shows
   a "tap to turn on sounds" banner until unlock() has run. */

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

export const audioReady = (): boolean => ctx?.state === "running";

/** Three rising notes, loud enough to cut through kitchen noise but short. */
export function chime(): void {
  if (!ctx || ctx.state !== "running") return;
  const start = ctx.currentTime + 0.02;
  [784, 988, 1319].forEach((freq, i) => {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const t0 = start + i * 0.16;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.5);
  });
}
