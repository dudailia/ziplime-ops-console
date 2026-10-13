"use client";

/** A KPI number. Step 4 animates it; for now it renders the value as is. */
export function CountUp({ value, format = String }: { value: number; format?: (n: number) => string }) {
  return <span className="tabular-nums">{format(value)}</span>;
}
