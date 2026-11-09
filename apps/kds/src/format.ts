/* Time formatting for timers and clocks. Digits stay Western Arabic in every language. */

const pad = (n: number): string => String(n).padStart(2, "0");

/** 7:05, 12:40, 1:02:09 */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** 24-hour clock time in the kitchen's local time zone. */
export function clock(iso: string | number): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
