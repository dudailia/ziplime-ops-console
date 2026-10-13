import Link from "next/link";
import { manifest } from "@/lib/seed";

const STEPS: { name: string; code?: string; note: string; outcome: string }[] = [
  { name: "Strategy", note: "Your ziplime algorithm asks for an order on a bar.", outcome: "" },
  { name: "Lot rounding", note: "Whole shares only. A fraction below one share is skipped.", outcome: "skip" },
  { name: "Risk limits", code: "ZIPLIME_*", note: "Allowlist, size, notional, sells, orders per run. Fail closed.", outcome: "refuse" },
  { name: "Order deadline", code: "ZIPLIME_ORDER_DEADLINE_UTC", note: "A stale signal is dropped, not sent late.", outcome: "refuse" },
  { name: "Lime pre-trade check", code: "validate_order", note: "Lime's own check: buying power, price bands.", outcome: "refuse" },
];

export default function Home() {
  return (
    <div className="max-w-5xl">
      <h1 className="t-title max-w-[22ch] text-[34px] text-ink sm:text-[46px]">Would it have traded, and if not, why?</h1>
      <div className="mt-5 flex max-w-[68ch] flex-col gap-3 text-[15px] text-ink">
        <p>
          ziplime is Limex&apos;s open-source trading engine: Zipline rebuilt on Polars, with live trading through Lime. Its dry-run mode (issue #5)
          runs every order through the same checks as live trading, then writes it to a file instead of sending it to the broker.
        </p>
        <p>
          This console reads those files. A trader sees which orders would have gone out and a plain explanation for each one that didn&apos;t.
          The Limex team sees which accounts need help, answers them with drafts grounded in that account&apos;s own file, and approves every
          reply by hand.
        </p>
      </div>

      <h2 className="t-semi mt-10 text-[15px] font-semibold text-ink-2">The path every order takes in dry run</h2>
      <ol className="mt-3 grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-3 lg:grid-cols-6">
        {STEPS.map((s, i) => (
          <li key={s.name} className="flex flex-col gap-1 bg-surface px-3 py-3">
            <span className="t-wide text-[12px] font-[800] text-ink-3">{i + 1}</span>
            <span className="text-[14px] font-semibold text-ink">{s.name}</span>
            {s.code && <code className="font-mono text-[11px] text-ink-2">{s.code}</code>}
            <span className="text-[12px] text-ink-2">{s.note}</span>
            {s.outcome && (
              <span className={`t-cond mt-auto pt-1 text-[12px] font-semibold ${s.outcome === "skip" ? "text-skip" : "text-refuse"}`}>
                {s.outcome === "skip" ? "or skip" : "or refuse"}
              </span>
            )}
          </li>
        ))}
        <li className="flex flex-col gap-1 bg-place-soft px-3 py-3">
          <span className="t-wide text-[12px] font-[800] text-place">6</span>
          <span className="text-[14px] font-semibold text-ink">Written to the file</span>
          <code className="font-mono text-[11px] text-ink-2">dry_run_file</code>
          <span className="text-[12px] text-ink-2">
            Instead of <code className="strike font-mono text-[11px]">place_order</code>. Never fills, never reaches Lime.
          </span>
          <span className="t-cond mt-auto pt-1 text-[12px] font-semibold text-place">would send</span>
        </li>
      </ol>

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link href="/portal" className="group border border-rule bg-surface px-5 py-4 hover:border-ink">
          <span className="text-[12px] text-ink-2">For a trader</span>
          <span className="t-wide mt-1 block text-[20px] font-[750] text-ink">Review a dry run</span>
          <span className="mt-1 block text-[13px] text-ink-2">
            Pick a seeded deployment or open your own .jsonl file. It&apos;s read in the browser and never uploaded.
          </span>
        </Link>
        <Link href="/ops" className="group border border-rule bg-surface px-5 py-4 hover:border-ink">
          <span className="text-[12px] text-ink-2">For the Limex team</span>
          <span className="t-wide mt-1 block text-[20px] font-[750] text-ink">Open the ops CRM</span>
          <span className="mt-1 block text-[13px] text-ink-2">
            Account health, Beta intake, the support inbox with reviewed AI drafts, and automation rules.
          </span>
        </Link>
      </div>

      <p className="mt-8 max-w-[72ch] text-[12px] text-ink-3">
        The seed files were written by ziplime&apos;s own <code className="font-mono">LimeTraderSdkExchange</code> on branch{" "}
        <code className="font-mono">{manifest.ziplime.branch}</code> (commit <code className="font-mono">{manifest.ziplime.commit.slice(0, 7)}</code>), with the
        test suite&apos;s fake Lime client and a simulated clock. No real credentials, no live trading, no real clients.
      </p>
    </div>
  );
}
