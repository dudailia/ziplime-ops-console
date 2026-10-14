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
  tour,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  /** Marks the panel as a tour target. */
  tour?: string;
}) {
  return (
    <section id={id} data-tour={tour} className={`min-w-0 overflow-hidden rounded-panel border border-rule bg-surface ${className}`}>
      {(title || aside) && (
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule px-4 py-2.5">
          {title && <h2 className="t-label bullet text-ink-2">{title}</h2>}
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
  tour,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "quiet";
  type?: "button" | "submit";
  title?: string;
  className?: string;
  tour?: string;
}) {
  // Primary is the one lime control on a screen: the next thing to do. Like
  // ziplime's, it goes to ink on hover. Secondary is their lavender wash.
  const styles = {
    primary:
      "t-btn border border-accent bg-accent text-on-accent hover:border-ink hover:bg-ink hover:text-ground disabled:border-rule disabled:bg-sunk disabled:text-ink-3",
    secondary:
      "t-btn border border-rule-strong bg-wash text-ink hover:border-ink disabled:border-rule disabled:bg-transparent disabled:text-ink-3",
    quiet: "text-[13px] font-semibold text-ink-2 underline hover:text-ink disabled:text-ink-3 disabled:no-underline",
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-tour={tour}
      className={`press px-3 py-1.5 text-[12px] transition-[background-color,border-color,color,transform] duration-150 disabled:cursor-not-allowed ${styles} ${className}`}
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
      className={`t-cond inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-1 text-[13px] transition-colors duration-150 ${
        active ? "border-ink bg-sunk font-semibold text-ink" : "border-rule bg-surface text-ink-2 hover:border-rule-strong hover:text-ink"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, tone, note }: { label: ReactNode; value: ReactNode; tone?: string; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="t-label">{label}</div>
      <div className={`t-wide mt-0.5 text-[24px] font-[700] leading-tight tabular-nums ${tone ?? "text-ink"}`}>{value}</div>
      {note && <div className="font-mono text-[11px] text-ink-3">{note}</div>}
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

/** A drawn check mark, for approved and passing states. */
export function Check({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className="shrink-0">
      <path d="M2 6.5l2.6 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
