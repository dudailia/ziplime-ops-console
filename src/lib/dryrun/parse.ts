import {
  EVENT_KINDS,
  type ClockPosition,
  type DryRunEvent,
  type EventCounts,
  type EventKind,
  type ParseError,
  type ParsedFile,
  type Session,
} from "./types";
import { isIsoWithOffset, toEt } from "./time";

type FieldKind =
  | "string"
  | "nullable-string"
  | "number"
  | "boolean"
  | "iso"
  | "nullable-iso"
  | readonly string[];

const COMMON: Record<string, FieldKind> = {
  recorded_at: "iso",
  account: "nullable-string",
};

const ORDER_FIELDS: Record<string, FieldKind> = {
  ziplime_order_id: "string",
  order_dt: "nullable-iso",
  symbol: "string",
  requested_amount: "number",
};

// Required fields per event, from _dry_run_order_fields, _record_dry_run_order,
// submit_order and cancel_order in lime_trader_sdk_exchange.py.
const SPECS: Record<EventKind, Record<string, FieldKind>> = {
  place: {
    ...COMMON,
    ...ORDER_FIELDS,
    dry_run_id: "string",
    client_order_id: "string",
    side: ["buy", "sell"],
    quantity: "string",
    order_type: ["market", "limit"],
    limit_price: "nullable-string",
    time_in_force: "string",
    route: "string",
    broker_validated: "boolean",
  },
  refuse: { ...COMMON, ...ORDER_FIELDS, reason: "string" },
  skip: { ...COMMON, ...ORDER_FIELDS, reason: "string" },
  cancel: {
    ...COMMON,
    dry_run_id: "string",
    known_order: "boolean",
    symbol: "nullable-string",
  },
};

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function checkField(name: string, kind: FieldKind, value: unknown): string | null {
  if (Array.isArray(kind)) {
    return typeof value === "string" && kind.includes(value)
      ? null
      : `"${name}" must be one of ${kind.join(", ")}, got ${JSON.stringify(value)}`;
  }
  switch (kind) {
    case "string":
      return typeof value === "string" ? null : `"${name}" must be a string, got ${describe(value)}`;
    case "nullable-string":
      return value === null || typeof value === "string"
        ? null
        : `"${name}" must be a string or null, got ${describe(value)}`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `"${name}" must be a finite number, got ${describe(value)}`;
    case "boolean":
      return typeof value === "boolean" ? null : `"${name}" must be true or false, got ${describe(value)}`;
    case "iso":
    case "nullable-iso":
      if (value === null && kind === "nullable-iso") return null;
      return typeof value === "string" && isIsoWithOffset(value)
        ? null
        : `"${name}" must be an ISO timestamp with a timezone offset, got ${JSON.stringify(value)}`;
  }
  return null;
}

function snippet(raw: string): string {
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

// Distributes over the union, so narrowing on `event` still works.
type Unplaced = DryRunEvent extends infer E ? (E extends DryRunEvent ? Omit<E, "clock"> : never) : never;

function parseLine(raw: string, line: number): Unplaced | ParseError {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (exc) {
    const detail = exc instanceof Error ? exc.message : String(exc);
    return { line, message: `Not valid JSON (${detail})`, raw: snippet(raw) };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { line, message: `Expected a JSON object, got ${describe(value)}`, raw: snippet(raw) };
  }
  const record = value as Record<string, unknown>;
  const event = record.event;
  if (typeof event !== "string" || !(EVENT_KINDS as readonly string[]).includes(event)) {
    return {
      line,
      message:
        event === undefined
          ? `Missing "event"`
          : `Unknown event ${JSON.stringify(event)} (expected place, refuse, skip or cancel)`,
      raw: snippet(raw),
    };
  }
  const spec = SPECS[event as EventKind];
  const problems: string[] = [];
  for (const [name, kind] of Object.entries(spec)) {
    if (!(name in record)) {
      problems.push(`missing "${name}"`);
      continue;
    }
    const problem = checkField(name, kind, record[name]);
    if (problem) problems.push(problem);
  }
  if (problems.length > 0) {
    return { line, message: `${event}: ${problems.join("; ")}`, raw: snippet(raw) };
  }

  const extra: Record<string, unknown> = {};
  for (const [name, fieldValue] of Object.entries(record)) {
    if (name !== "event" && !(name in spec)) extra[name] = fieldValue;
  }
  const known = Object.fromEntries(
    Object.keys(spec).map((name) => [name, record[name]]),
  );
  return { ...known, event, line, raw, extra } as Unplaced;
}

function isError(value: Unplaced | ParseError): value is ParseError {
  return "message" in value && !("event" in value);
}

function emptyCounts(): EventCounts {
  return { place: 0, refuse: 0, skip: 0, cancel: 0 };
}

export function countEvents(events: readonly DryRunEvent[]): EventCounts {
  const counts = emptyCounts();
  for (const e of events) counts[e.event] += 1;
  return counts;
}

export function refusalRate(counts: EventCounts): number {
  const attempts = counts.place + counts.refuse;
  return attempts === 0 ? 0 : counts.refuse / attempts;
}

function placeOnClock(events: Unplaced[]): DryRunEvent[] {
  const placeSession = new Map<string, string>();
  const placed: DryRunEvent[] = [];
  for (const e of events) {
    let clock: ClockPosition;
    if (e.event === "cancel") {
      // No order_dt on a cancel: its time is when it was written, its session
      // the one of the order it cancels.
      const at = toEt(e.recorded_at);
      clock = {
        session: placeSession.get(e.dry_run_id) ?? at.date,
        minuteET: at.minute,
        source: "recorded_at",
      };
    } else {
      const source = e.order_dt ? "order_dt" : "recorded_at";
      const at = toEt(e.order_dt ?? e.recorded_at);
      clock = { session: at.date, minuteET: at.minute, source };
      if (e.event === "place") placeSession.set(e.dry_run_id, at.date);
    }
    placed.push({ ...e, clock } as DryRunEvent);
  }
  return placed;
}

export function groupSessions(events: readonly DryRunEvent[]): Session[] {
  const byDate = new Map<string, DryRunEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.clock.session) ?? [];
    list.push(e);
    byDate.set(e.clock.session, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => {
      const sorted = [...list].sort(
        (a, b) => a.clock.minuteET - b.clock.minuteET || a.line - b.line,
      );
      const counts = countEvents(sorted);
      return { date, events: sorted, counts, refusalRate: refusalRate(counts) };
    });
}

/**
 * Parse a dry-run JSON Lines file. Never throws: a bad line becomes an error
 * with its line number and the rest of the file still loads.
 */
export function parseDryRun(text: string, source: string): ParsedFile {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const lines = body.split("\n");
  const warnings: string[] = [];
  if (body.length > 0 && !body.endsWith("\n")) {
    warnings.push(
      `Line ${lines.length} has no trailing newline. The engine ends every record with one, so the run may have been cut off.`,
    );
  }

  const parsed: Unplaced[] = [];
  const errors: ParseError[] = [];
  lines.forEach((rawLine, index) => {
    const raw = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (raw.trim() === "") return;
    const result = parseLine(raw, index + 1);
    if (isError(result)) errors.push(result);
    else parsed.push(result);
  });

  const seenPlaceIds = new Set<string>();
  for (const e of parsed) {
    if (e.event !== "place") continue;
    if (seenPlaceIds.has(e.dry_run_id)) {
      warnings.push(`Line ${e.line}: dry_run_id ${e.dry_run_id} was already placed earlier in the file.`);
    }
    seenPlaceIds.add(e.dry_run_id);
  }

  const events = placeOnClock(parsed);
  const accounts = [...new Set(events.map((e) => e.account).filter((a): a is string => a !== null))];
  return { source, events, errors, warnings, sessions: groupSessions(events), accounts };
}
