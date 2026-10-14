// Trading-clock math in America/New_York, using Intl only.

export const SESSION_OPEN_MINUTE = 9 * 60 + 30;
export const SESSION_CLOSE_MINUTE = 16 * 60;

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// The engine writes isoformat() of aware datetimes, so an offset is always
// there. A timestamp without one would be read in the viewer's own zone.
const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-](\d{2}):\d{2})$/;

/**
 * A real calendar date with an offset Postgres accepts. Date.parse alone is
 * too lenient: it reads 30 February as 2 March and accepts year 0.
 */
export function isIsoWithOffset(value: string): boolean {
  const m = ISO_WITH_OFFSET.exec(value);
  if (!m || Number.isNaN(Date.parse(value))) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && Number(m[7] ?? 0) <= 15;
}

export type EtParts = { date: string; minute: number; seconds: number };

export function toEt(iso: string): EtParts {
  const parts = Object.fromEntries(
    ET.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    seconds: Number(parts.second),
  };
}

export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
