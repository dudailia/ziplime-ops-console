// A loading state shaped like the page it stands in for, so nothing jumps
// when the real content arrives. Static: no shimmer to watch. At least a
// screen tall, so the footer starts below the fold and doesn't jump down when
// the page arrives (it did on a phone: layout shift 0.13).
export function PageSkeleton({ label, panels = [180, 320] }: { label: string; panels?: number[] }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh flex-col gap-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="mb-1 flex flex-col gap-2">
        <div className="h-8 w-56 rounded-[2px] bg-rule" />
        <div className="h-4 w-[min(520px,90%)] rounded-[2px] bg-rule opacity-70" />
      </div>
      {panels.map((h, i) => (
        <div key={i} aria-hidden className="rounded-panel border border-rule bg-surface" style={{ height: h }}>
          <div className="h-10 border-b border-rule" />
        </div>
      ))}
    </div>
  );
}
