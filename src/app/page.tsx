import Link from "next/link";
import { frontDoorNumbers } from "@/lib/crm";
import { DEPLOYMENTS, manifest, seedFile, SEED_ACCOUNTS } from "@/lib/seed";
import { sessionLabel } from "@/lib/format";
import { EVENT_WORD, EventGlyph } from "@/components/ui/kit";
import { CountUp } from "@/components/ui/CountUp";
import { SessionClock } from "@/components/portal/SessionClock";
import { TourCta } from "@/components/tour/TourCta";

const PR_URL = "https://github.com/Limex-com/ziplime/pull/39";

// The hero: a real session from the seed with every kind of mark but skip.
const HERO = { deployment: "priya-growth", date: "2026-10-07" };

export default function Home() {
  const n = frontDoorNumbers(SEED_ACCOUNTS, DEPLOYMENTS);
  const session = seedFile(HERO.deployment).sessions.find((s) => s.date === HERO.date)!;
  const c = session.counts;

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-8 lg:gap-10 lg:pt-4">
      <section>
        <h1 className="t-title max-w-[24ch] text-balance text-[34px] text-ink sm:text-[42px] xl:text-[48px]">
          An ops layer for ziplime&apos;s <span className="whitespace-nowrap">dry-run mode</span>, built on{" "}
          <a href={PR_URL} className="underline decoration-accent-ink decoration-[3px] underline-offset-[6px] hover:decoration-ink">
            PR #39
          </a>
        </h1>
        <p className="mt-4 max-w-[64ch] text-[16px] leading-relaxed text-ink-2">
          With a dry-run file set, ziplime runs every order through the same checks as live trading, then writes it to a file instead of
          sending it to Lime. This console reads those files: a portal that tells a trader why an order didn&apos;t go out, and a CRM where
          the Limex team sees who needs help and approves every word sent back.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <TourCta />
          <Link href="/portal" className="press rounded-[4px] border border-rule-strong bg-surface px-4 py-2.5 text-[14px] font-semibold text-ink hover:border-ink hover:bg-sunk">
            Open the portal
          </Link>
          <span className="hidden text-[12px] text-ink-3 lg:inline">
            Press <kbd className="kbd">t</kbd> for the tour, <kbd className="kbd">?</kbd> for shortcuts
          </span>
        </div>
      </section>

      <figure className="overflow-hidden rounded-panel border border-rule bg-surface">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule px-4 py-2.5">
          <span className="t-wide text-[15px] font-[750] text-ink">{sessionLabel(session.date, true)}</span>
          <span className="text-[13px] text-ink-2">Priya Raman, growth rotation</span>
          <span className="t-cond ml-auto flex flex-wrap gap-x-4 text-[12px] text-ink-2">
            {(["place", "refuse", "cancel"] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <EventGlyph kind={k} size={11} />
                <span className="tabular-nums">{c[k]}</span> {EVENT_WORD[k].toLowerCase()}
              </span>
            ))}
          </span>
        </div>
        <Link href={`/portal?d=${HERO.deployment}&s=${HERO.date}`} aria-label={`Open ${sessionLabel(session.date, true)} in the portal`} className="block pb-1 hover:bg-sunk">
          <SessionClock session={session} header={false} minWidth={320} />
        </Link>
        <figcaption className="border-t border-rule px-4 py-2 text-[12px] text-ink-3">
          Every mark is a line ziplime&apos;s own <code className="font-mono">LimeTraderSdkExchange</code> wrote, with the test suite&apos;s fake Lime
          client. Red crosses never reached Lime.
        </figcaption>
      </figure>

      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-rule bg-rule sm:grid-cols-3">
        <Figure id="front-orders" value={n.orders} label="orders ran through the live checks" note={`${n.sessions} sessions across ${n.deployments} deployments`} />
        <Figure id="front-refused" value={n.refused} tone="text-refuse" label="refused before reaching Lime" note={`${n.explained} with a plain-English fix built in`} />
        <Figure id="front-help" value={n.needHelp} of={n.accounts} tone="text-bad" label="accounts need help" note="Health in words, from each account's last 5 sessions" />
      </dl>

      <p className="max-w-[80ch] text-[12px] text-ink-3">
        Seeded on branch <code className="font-mono">{manifest.ziplime.branch}</code> at commit{" "}
        <code className="font-mono">{manifest.ziplime.commit.slice(0, 7)}</code>, with a simulated clock. No real credentials, no live trading,
        no real clients.
      </p>
    </div>
  );
}

function Figure({ id, value, of, label, note, tone = "text-ink" }: { id: string; value: number; of?: number; label: string; note: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-4 py-3 sm:px-5 sm:py-4">
      <dt className="order-2 text-[14px] font-semibold text-ink">{label}</dt>
      <dd className="order-1 flex items-baseline gap-2">
        <span className={`t-wide text-[34px] sm:text-[40px] font-[760] leading-none tabular-nums ${tone}`}>
          <CountUp id={id} value={value} />
        </span>
        {of !== undefined && <span className="t-wide text-[20px] font-[700] text-ink-3">of {of}</span>}
      </dd>
      <dd className="order-3 text-[12px] text-ink-2">{note}</dd>
    </div>
  );
}
