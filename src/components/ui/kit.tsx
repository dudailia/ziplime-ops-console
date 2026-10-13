// Small shared pieces. Event colours come only from here.
import type { ReactNode } from "react";
import type { EventKind } from "@/lib/dryrun/types";

export const EVENT_WORD: Record<EventKind, string> = {
  place: "Would send",
  refuse: "Refused",
  skip: "Skipped",
  cancel: "Cancelled",
};

export const EVENT_TEXT: Record<EventKind, string> = {
  place: "text-place",
  refuse: "text-refuse",
  skip: "text-skip",
  cancel: "text-cancel",
};

/** The same glyph the session clock draws, at text size. */
export function EventGlyph({ kind, size = 12 }: { kind: EventKind; size?: number }) {
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className={`inline-block shrink-0 ${EVENT_TEXT[kind]}`}>
      {kind === "place" && <rect x={c - 1.5} y={1} width={3} height={size - 2} fill="currentColor" />}
      {kind === "refuse" && (
        <path d={`M2 2L${size - 2} ${size - 2}M${size - 2} 2L2 ${size - 2}`} stroke="currentColor" strokeWidth={2} />
      )}
      {kind === "skip" && <circle cx={c} cy={c} r={c - 2} fill="none" stroke="currentColor" strokeWidth={1.6} />}
      {kind === "cancel" && <path d={`M1 ${c}H${size - 1}M${size - 1.5} 2V${size - 2}`} stroke="currentColor" strokeWidth={1.6} />}
    </svg>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`min-w-0 border border-rule bg-surface ${className}`}>
      {(title || aside) && (
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule px-4 py-2.5">
          {title && <h2 className="t-semi text-[15px] font-semibold text-ink">{title}</h2>}
          {aside && <div className="ml-auto text-[12px] text-ink-2">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="t-title text-[26px] text-ink sm:text-[30px]">{title}</h1>
        {sub && <p className="mt-1.5 max-w-[68ch] text-[14px] text-ink-2">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{children}</div>}
    </div>
  );
}

export function Env({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[12px] text-ink">{children}</code>;
}

export function Button({
  children,
  onClick,
  disabled,
  kind = "secondary",
  type = "button",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "quiet";
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  const styles = {
    primary: "bg-ink text-surface hover:opacity-90 disabled:bg-rule disabled:text-ink-3",
    secondary: "border border-rule-strong bg-surface text-ink hover:border-ink disabled:border-rule disabled:text-ink-3",
    quiet: "text-ink-2 underline underline-offset-2 hover:text-ink disabled:text-ink-3 disabled:no-underline",
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-sm px-3 py-1.5 text-[13px] font-semibold disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Chip({
  active,
  onClick,
  children,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`t-cond inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[13px] ${
        active ? "border-ink bg-surface font-semibold text-ink" : "border-rule bg-sunk text-ink-3 hover:border-rule-strong hover:text-ink"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, tone, note }: { label: ReactNode; value: ReactNode; tone?: string; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-ink-2">{label}</div>
      <div className={`t-wide text-[26px] font-[750] leading-tight tabular-nums ${tone ?? "text-ink"}`}>{value}</div>
      {note && <div className="text-[12px] text-ink-3">{note}</div>}
    </div>
  );
}

export function AiOffNote({ children }: { children?: ReactNode }) {
  return (
    <p className="text-[12px] text-ink-2">
      <span className="font-semibold text-ink">AI drafting is off.</span>{" "}
      {children ?? "Set ANTHROPIC_API_KEY on the server to turn it on. Everything else works without it."}
    </p>
  );
}
