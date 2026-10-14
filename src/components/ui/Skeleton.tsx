// A loading state shaped like the page it stands in for, so nothing jumps
// when the real content arrives. Static: no shimmer to watch.
export function PageSkeleton({ label, panels = [180, 320] }: { label: string; panels?: number[] }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="mb-1 flex flex-col gap-2">
        <div className="h-8 w-56 rounded-[4px] bg-rule" />
        <div className="h-4 w-[min(520px,90%)] rounded-[4px] bg-rule opacity-70" />
      </div>
      {panels.map((h, i) => (
        <div key={i} aria-hidden className="rounded-panel border border-rule bg-surface" style={{ height: h }}>
          <div className="h-10 border-b border-rule" />
        </div>
      ))}
    </div>
  );
}
