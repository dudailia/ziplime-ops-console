// Display formatting. Dates in the seed are ET trading dates (YYYY-MM-DD).

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const DAY_YEAR = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const STAMP = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/New_York",
});

const parts = (f: Intl.DateTimeFormat, d: Date) => Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));

/** "Mon 12 Oct" */
export function sessionLabel(date: string, withYear = false): string {
  const p = parts(withYear ? DAY_YEAR : DAY, new Date(`${date}T12:00:00Z`));
  return `${p.weekday} ${p.day} ${p.month}${withYear ? ` ${p.year}` : ""}`;
}

/** "12 Oct" */
export function shortDate(date: string): string {
  const p = parts(DAY, new Date(`${date}T12:00:00Z`));
  return `${p.day} ${p.month}`;
}

/** "Oct 12, 14:05 ET" from any ISO timestamp. */
export function stampET(iso: string): string {
  const p = parts(STAMP, new Date(iso));
  return `${p.month} ${p.day}, ${p.hour}:${p.minute} ET`;
}

export function pct(rate: number): string {
  if (rate === 0) return "0%";
  if (rate < 0.01) return "<1%";
  return `${Math.round(rate * 100)}%`;
}

export function num(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
