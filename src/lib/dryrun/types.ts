// The dry-run file as LimeTraderSdkExchange writes it (ziplime feat/dry-run-orders,
// _write_dry_run_record and its callers). One JSON object per line.

export const EVENT_KINDS = ["place", "refuse", "skip", "cancel"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Where an event sits on the trading clock. Derived, not in the file. */
export type ClockPosition = {
  /** ET trading date, YYYY-MM-DD. */
  session: string;
  /** Minutes since midnight ET (09:30 is 570). */
  minuteET: number;
  /** Which timestamp the position came from. Cancels have no order_dt. */
  source: "order_dt" | "recorded_at";
};

type Common = {
  /** 1-based line number in the source file. */
  line: number;
  /** The line exactly as read. */
  raw: string;
  recorded_at: string;
  /** Masked by the engine ("de***nt"), "****" for short ids, null if unset. */
  account: string | null;
  /** Fields this console doesn't know about, kept so newer files still load. */
  extra: Record<string, unknown>;
  clock: ClockPosition;
};

export type PlaceEvent = Common & {
  event: "place";
  dry_run_id: string;
  ziplime_order_id: string;
  order_dt: string | null;
  symbol: string;
  /** Signed, after lot rounding. */
  requested_amount: number;
  client_order_id: string;
  side: "buy" | "sell";
  /** Unsigned whole shares, a Decimal string. */
  quantity: string;
  order_type: "market" | "limit";
  limit_price: string | null;
  time_in_force: string;
  route: string;
  /** False when the exchange ran with validate_orders=False: Lime was never asked. */
  broker_validated: boolean;
};

export type RefuseEvent = Common & {
  event: "refuse";
  ziplime_order_id: string;
  order_dt: string | null;
  symbol: string;
  /** Signed, after lot rounding. A refusal carries no side or quantity field. */
  requested_amount: number;
  /** "<ExceptionType>: <message>" */
  reason: string;
};

export type SkipEvent = Common & {
  event: "skip";
  ziplime_order_id: string;
  order_dt: string | null;
  symbol: string;
  /** Signed and fractional: the amount before rounding to whole lots. */
  requested_amount: number;
  reason: string;
};

export type CancelEvent = Common & {
  event: "cancel";
  /** The cancelled id. A plain broker id when known_order is false. */
  dry_run_id: string;
  known_order: boolean;
  symbol: string | null;
};

export type DryRunEvent = PlaceEvent | RefuseEvent | SkipEvent | CancelEvent;

export type ParseError = { line: number; message: string; raw: string };

export type EventCounts = Record<EventKind, number>;

export type Session = {
  date: string;
  /** In clock order. */
  events: DryRunEvent[];
  counts: EventCounts;
  /** refuse / (place + refuse). Skips are warnings in the engine, not failures. */
  refusalRate: number;
};

export type ParsedFile = {
  source: string;
  /** Valid lines, in file order. */
  events: DryRunEvent[];
  errors: ParseError[];
  warnings: string[];
  /** Ascending by date. */
  sessions: Session[];
  /** Distinct masked account ids seen. */
  accounts: string[];
};
