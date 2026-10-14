"use client";

import Link from "next/link";
import { frontDoorNumbers } from "@/lib/crm";
import { useDataset } from "@/lib/data/DatasetProvider";
import { deploymentById, fileOf } from "@/lib/data/lookup";
import { sessionLabel } from "@/lib/format";
import { heroLine, tickerItems } from "@/lib/front";
import { EVENT_WORD, EventGlyph } from "@/components/ui/kit";
import { CountUp } from "@/components/ui/CountUp";
import { SessionClock } from "@/components/portal/SessionClock";
import { TourCta } from "@/components/tour/TourCta";
import { HeroTerminal } from "./HeroTerminal";
import { Ticker } from "./Ticker";

const PR_URL = "https://github.com/Limex-com/ziplime/pull/39";

// The hero: a real session from the seed with every kind of mark but skip.
const HERO = { deployment: "priya-growth", date: "2026-10-07" };

export function FrontDoor() {
  const ds = useDataset();
  const n = frontDoorNumbers(ds);
  const session = fileOf(ds, HERO.deployment).sessions.find((s) => s.date === HERO.date)!;
  const hero = heroLine(ds, HERO.deployment, HERO.date);
  const file = deploymentById(ds, HERO.deployment)?.file ?? `${HERO.deployment}.jsonl`;
  const c = session.counts;

  return (
    <div className="-mx-4 -mt-6 lg:-mx-8">
      <Ticker items={tickerItems(ds)} />

      <section className="hero-bg relative overflow-hidden border-b border-rule px-4 pb-12 pt-10 lg:px-8 lg:pb-14 lg:pt-14">
        <div className="relative mx-auto grid max-w-[1180px] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] xl:gap-14">
          <div className="min-w-0">
            <p className="hero-eyebrow">
              <span aria-hidden className="pulse size-1.5 shrink-0 bg-accent" />
              <span>
                Engine <span aria-hidden>→</span> dry run <span aria-hidden>→</span> <strong>console</strong>
              </span>
              <span className="text-ink">{"// nothing sent to Lime"}</span>
            </p>
            <h1 className="t-title text-[38px] leading-[1.06] text-ink sm:text-[48px] xl:text-[56px]">
              Every order <span className="t-highlight">checked</span>.
              <br /> Nothing sent.
              <br /> Now you can <span className="whitespace-nowrap">see <span className="t-pixel flicker">why.</span></span>
            </h1>
            <p className="mt-6 max-w-[56ch] text-[16px] leading-relaxed text-ink-2">
              With{" "}
              <a className="font-semibold text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink" href={PR_URL}>
                ziplime PR #39
              </a>
              , a dry-run file runs every order through the same checks as live trading, then writes it to a file instead of sending it to
              Lime. This console reads those files: a portal that tells a trader{" "}
              <strong className="font-semibold text-ink">why an order didn&apos;t go out</strong>, and a CRM where the Limex team sees who
              needs help and <strong className="font-semibold text-ink">approves every word sent back</strong>.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-3">
              <TourCta />
              <Link
                href="/portal"
                className="press t-btn inline-flex items-center bg-wash px-[22px] py-[14px] text-[14px] text-ink transition-opacity duration-150 hover:opacity-80"
              >
                Open the portal
              </Link>
            </div>
            <p className="mt-4 hidden font-mono text-[11px] text-ink-3 lg:block">
              Press <kbd className="kbd">t</kbd> for the tour, <kbd className="kbd">?</kbd> for shortcuts
            </p>
          </div>

          <HeroTerminal
            hero={hero}
            file={file}
            metrics={
              <dl className="grid grid-cols-1 sm:grid-cols-3">
                <Figure id="front-orders" value={n.orders} label="orders checked" note={`${n.sessions} sessions, ${n.deployments} deployments`} />
                <Figure id="front-refused" value={n.refused} tone="text-refuse" label="refused before Lime" note={`${n.explained} with a fix built in`} />
                <Figure id="front-help" value={n.needHelp} of={n.accounts} tone="text-bad" label="accounts need help" note="from the last 5 sessions" />
              </dl>
            }
          />
        </div>
      </section>

      <div className="px-4 pt-10 lg:px-8">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6">
          <figure className="overflow-hidden border border-rule bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule px-4 py-2.5">
              <span className="t-label bullet text-ink">{sessionLabel(session.date, true)}</span>
              <span className="text-[13px] text-ink-2">Priya Raman, growth rotation</span>
              <span className="ml-auto flex flex-wrap gap-x-4 font-mono text-[11px] text-ink-2">
                {(["place", "refuse", "cancel"] as const).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <EventGlyph kind={k} size={11} />
                    <span className="tabular-nums">{c[k]}</span> {EVENT_WORD[k].toLowerCase()}
                  </span>
                ))}
              </span>
            </div>
            <Link
              href={`/portal?d=${HERO.deployment}&s=${HERO.date}`}
              aria-label={`Open ${sessionLabel(session.date, true)} in the portal`}
              className="block pb-1 hover:bg-sunk"
            >
              <SessionClock session={session} header={false} minWidth={320} />
            </Link>
            <figcaption className="border-t border-rule px-4 py-2 text-[12px] text-ink-3">
              Every mark is a line ziplime&apos;s own <code className="font-mono">LimeTraderSdkExchange</code> wrote, with the test suite&apos;s fake Lime
              client. Red crosses never reached Lime.
            </figcaption>
          </figure>

          <p className="max-w-[80ch] font-mono text-[11px] text-ink-3">
            Seeded on branch <code>{ds.ziplime.branch}</code> at commit <code>{ds.ziplime.commit.slice(0, 7)}</code>, with a simulated clock. No real
            credentials, no live trading, no real clients.
          </p>
        </div>
      </div>
    </div>
  );
}

function Figure({ id, value, of, label, note, tone = "text-ink" }: { id: string; value: number; of?: number; label: string; note: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1 border-rule bg-wash px-4 py-3.5 not-first:border-t sm:not-first:border-t-0 sm:not-first:border-l">
      <dt className="order-2 font-mono text-[10px] tracking-[0.06em] text-ink-2 uppercase">{label}</dt>
      {/* Inline, not flex, so the space before "of" is real text: "5 of 10", not "5of 10". */}
      <dd className="order-1 font-mono leading-none">
        <span className={`text-[30px] font-[700] leading-none tracking-[-0.03em] tabular-nums ${tone}`}>
          <CountUp id={id} value={value} />
        </span>
        {of !== undefined && (
          <>
            {" "}
            <span className="text-[15px] font-[600] text-ink-3">of {of}</span>
          </>
        )}
      </dd>
      <dd className="order-3 font-mono text-[10px] text-ink-3">{note}</dd>
    </div>
  );
}
