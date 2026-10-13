import { HEALTH_LABEL, type Health, type HealthLevel } from "@/lib/health";

const TONE: Record<HealthLevel, { dot: string; text: string }> = {
  red: { dot: "bg-bad", text: "text-bad" },
  amber: { dot: "bg-warn", text: "text-warn" },
  green: { dot: "bg-ok", text: "text-ok" },
  grey: { dot: "bg-none", text: "text-ink-2" },
};

/** Colour plus words, never colour alone. */
export function HealthBadge({ health, reason = true }: { health: Health; reason?: boolean }) {
  const tone = TONE[health.level];
  const first = health.reasons[0];
  return (
    <span className="inline-flex min-w-0 flex-col">
      <span className={`t-semi inline-flex items-center gap-1.5 text-[13px] font-semibold ${tone.text}`}>
        <span className={`inline-block size-2.5 shrink-0 rounded-[2px] ${tone.dot}`} aria-hidden />
        {HEALTH_LABEL[health.level]}
      </span>
      {reason && first && <span className="text-[12px] leading-snug text-ink-2">{first.text}</span>}
    </span>
  );
}

export function HealthDot({ level }: { level: HealthLevel }) {
  return <span className={`inline-block size-2.5 shrink-0 rounded-[2px] ${TONE[level].dot}`} aria-hidden />;
}

export const HEALTH_TEXT: Record<HealthLevel, string> = {
  red: "text-bad",
  amber: "text-warn",
  green: "text-ok",
  grey: "text-ink-2",
};
