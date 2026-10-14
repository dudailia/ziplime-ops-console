"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAiStatus } from "@/lib/ai/useAiStatus";
import { useStore } from "@/lib/store/StoreProvider";
import { useNavBadges } from "@/lib/store/selectors";
import { TourLayer } from "@/components/tour/TourLayer";
import { Shortcuts } from "./Shortcuts";
import { useTour } from "@/components/tour/tourStore";
import { TOUR } from "@/lib/tour";
import { IconAccounts, IconInbox, IconIntake, IconReview, IconRules } from "./icons";

type NavItem = { href: string; label: string; short: string; icon: () => ReactNode; badge?: "intake" | "inbox" };

const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Portal", items: [{ href: "/portal", label: "Dry-run review", short: "Review", icon: IconReview }] },
  {
    label: "Ops",
    items: [
      { href: "/ops", label: "Accounts", short: "Accounts", icon: IconAccounts },
      { href: "/ops/intake", label: "Beta intake", short: "Intake", icon: IconIntake, badge: "intake" },
      { href: "/ops/inbox", label: "Support inbox", short: "Inbox", icon: IconInbox, badge: "inbox" },
      { href: "/ops/automations", label: "Automations", short: "Rules", icon: IconRules },
    ],
  },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/ops") return pathname === "/ops" || pathname.startsWith("/ops/accounts");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function RailNav() {
  const pathname = usePathname();
  const badges = useNavBadges();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <div className="t-label bullet px-3 pb-2">{group.label}</div>
          <ul className="flex flex-col">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const badge = item.badge ? badges[item.badge] : 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-2.5 px-3 py-1.5 text-[14px] transition-colors duration-150 ${
                      active ? "bg-sunk font-semibold text-ink" : "text-ink-2 hover:bg-sunk hover:text-ink"
                    }`}
                  >
                    {active && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
                    <item.icon />
                    <span className="flex-1">{item.label}</span>
                    {badge > 0 && (
                      <span className="min-w-5 border border-rule-strong px-1 text-center font-mono text-[11px] font-medium text-ink tabular-nums">
                        {badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function PhoneNav() {
  const pathname = usePathname();
  const badges = useNavBadges();
  const items = GROUPS.flatMap((g) => g.items);
  return (
    <nav
      aria-label="Main"
      data-testid="tabbar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const badge = item.badge ? badges[item.badge] : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] ${
                  active ? "font-semibold text-ink" : "text-ink-2"
                }`}
              >
                <span aria-hidden className={`absolute inset-x-4 top-0 h-[3px] ${active ? "bg-accent" : ""}`} />
                <item.icon />
                <span className="t-cond">{item.short}</span>
                {badge > 0 && (
                  <span className="absolute right-[22%] top-1 min-w-4 bg-ink px-1 text-center font-mono text-[10px] font-semibold text-ground">
                    {badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type Theme = "dark" | "light" | "auto";
const THEME_KEY = "ziplime-ops-console:theme";
const THEME_EVENT = "ziplime-theme";

// The inline script in layout.tsx sets data-theme before first paint; this
// reads it back, so the toggle never disagrees with what's on screen.
// Night is the default, so only light and auto are saved.
function readTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "auto" ? t : "dark";
}

function applyTheme(next: Theme) {
  document.documentElement.setAttribute("data-theme", next);
  try {
    if (next === "dark") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, next);
  } catch {}
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribeTheme(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as Theme);
  const choose = applyTheme;
  return (
    <div role="radiogroup" aria-label="Theme" className="flex overflow-hidden border border-rule font-mono text-[11px]">
      {(["dark", "light", "auto"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => choose(t)}
          className={`flex-1 px-2 py-1 capitalize ${theme === t ? "bg-ink text-ground" : "text-ink-2 hover:text-ink"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function ResetDemo({ compact = false }: { compact?: boolean }) {
  const { resetDemo } = useStore();
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(t);
  }, [done]);
  if (asking) {
    return (
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-ink-2">{compact ? "Reset?" : "Clear every change?"}</span>
        <button
          type="button"
          className="rounded-[2px] bg-ink px-2 py-0.5 font-semibold text-ground"
          onClick={() => {
            resetDemo();
            setAsking(false);
            setDone(true);
          }}
        >
          Reset
        </button>
        <button type="button" className="px-1 text-ink-2 underline" onClick={() => setAsking(false)}>
          Keep
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setAsking(true)}
      className="rounded-[2px] border border-rule px-2 py-1 text-[12px] text-ink-2 hover:border-rule-strong hover:text-ink"
    >
      {done ? "Demo reset" : "Reset demo"}
    </button>
  );
}

function ShortcutHint() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}
      className="flex items-center gap-1.5 text-left text-[12px] text-ink-2 hover:text-ink"
    >
      <kbd className="kbd">?</kbd> Keyboard shortcuts
    </button>
  );
}

/** Shown while a tour is paused, so it can be picked up from any page. */
function ResumeTour() {
  const { tour, act } = useTour();
  if (tour.status !== "paused") return null;
  return (
    <button
      type="button"
      onClick={() => act({ type: "resume" })}
      className="press flex items-center gap-2 rounded-[2px] border border-rule-strong bg-surface px-2 py-1 text-left text-[12px] font-semibold text-ink hover:bg-sunk"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-none bg-accent-ink" />
      Resume tour, step {tour.step + 1} of {TOUR.length}
    </button>
  );
}

function AiLine() {
  const status = useAiStatus();
  return (
    <div className="text-[12px] leading-snug text-ink-2">
      <span className={`mr-1.5 inline-block size-1.5 rounded-none align-middle ${status?.enabled ? "bg-ok" : "bg-ink-3"}`} />
      {status === null ? "Checking AI…" : status.enabled ? `AI drafting on (${status.model})` : "AI drafting is off"}
    </div>
  );
}

/** The console's own mark: three session-clock ticks, the last one would send. Not a Limex logo. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <rect x="0.5" y="0.5" width="19" height="19" fill="#0b0a10" stroke="var(--rule-strong)" />
      <rect x="4.5" y="9" width="2.4" height="6.5" fill="#f2f0ff" opacity="0.55" />
      <rect x="8.8" y="6.5" width="2.4" height="9" fill="#f2f0ff" opacity="0.8" />
      <rect x="13.1" y="4" width="2.4" height="11.5" fill="#a6f656" />
    </svg>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 whitespace-nowrap leading-none">
      <BrandMark />
      {/* Lowercase mono on purpose: never ziplime's uppercase wordmark. */}
      <span className="font-mono text-[14px] tracking-[-0.01em]">
        <span className="font-bold text-ink">ziplime</span> <span className="text-ink-2">ops console</span>
      </span>
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      {/* The aside stretches the full grid row, so its background and rule run
          the length of the page; the inner column sticks to the viewport. */}
      <aside data-testid="rail" className="hidden border-r border-rule bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto py-5">
          <div className="px-3">
            <Brand />
            <p className="mt-2 font-mono text-[11px] leading-snug text-ink-3">on ziplime&apos;s Lime dry run</p>
          </div>
          <Suspense fallback={null}>
            <RailNav />
          </Suspense>
          <div className="mt-auto flex flex-col gap-3 px-3">
            <ResumeTour />
            <ShortcutHint />
            <AiLine />
            <ThemeToggle />
            <ResetDemo />
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header>
        <div className="flex items-center gap-3 border-b border-rule bg-surface px-4 py-2.5 lg:hidden">
          <Brand />
          <div className="ml-auto">
            <ResetDemo compact />
          </div>
        </div>
        <div className="flex items-center gap-3 border-b border-rule bg-surface px-4 py-1.5 lg:px-8">
          <p className="font-mono text-[11px] font-medium tracking-[0.04em] text-ink-2">
            <span className="mr-2 inline-block size-2 border border-ink-2 align-[-1px]" />
            Sample data. Fictional accounts.
          </p>
          <div className="ml-auto lg:hidden">
            <ResumeTour />
          </div>
        </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pb-10 pt-6 lg:px-8">{children}</main>
        {/* On a phone the footer clears the fixed tab bar (52 px plus the safe area). */}
        <footer className="border-t border-rule px-4 pb-[calc(76px+env(safe-area-inset-bottom))] pt-4 text-[12px] text-ink-3 lg:px-8 lg:pb-5">
          <p>
            Unofficial concept built on the open-source{" "}
            <a className="underline hover:text-ink" href="https://github.com/Limex-com/ziplime">
              ziplime
            </a>{" "}
            engine. Sample data.{" "}
            <Link className="ml-2 underline hover:text-ink" href="/about">
              How this was built
            </Link>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 lg:hidden">
            <AiLine />
            <div className="w-44">
              <ThemeToggle />
            </div>
          </div>
        </footer>
      </div>

      <Suspense fallback={null}>
        <PhoneNav />
      </Suspense>
      <Suspense fallback={null}>
        <TourLayer />
      </Suspense>
      <Shortcuts />
    </div>
  );
}
