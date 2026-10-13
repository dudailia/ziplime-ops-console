"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAiStatus } from "@/lib/ai/useAiStatus";
import { useStore } from "@/lib/store/StoreProvider";
import { useNavBadges } from "@/lib/store/selectors";
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
          <div className="t-semi px-3 pb-1.5 text-[12px] font-semibold text-ink-3">{group.label}</div>
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
                    {active && <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-r-sm bg-accent-ink" />}
                    <item.icon />
                    <span className="flex-1">{item.label}</span>
                    {badge > 0 && (
                      <span className="t-cond min-w-5 rounded-[4px] bg-ink px-1 text-center text-[12px] font-semibold text-surface tabular-nums">
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
                <span aria-hidden className={`absolute inset-x-4 top-0 h-[3px] rounded-b-sm ${active ? "bg-accent-ink" : ""}`} />
                <item.icon />
                <span className="t-cond">{item.short}</span>
                {badge > 0 && (
                  <span className="t-cond absolute right-[22%] top-1 min-w-4 rounded-[4px] bg-ink px-1 text-center text-[10px] font-semibold text-surface">
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

type Theme = "auto" | "light" | "dark";
const THEME_KEY = "ziplime-ops-console:theme";
const THEME_EVENT = "ziplime-theme";

// The inline script in layout.tsx sets data-theme before first paint; this
// reads it back, so the toggle never disagrees with what's on screen.
function readTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "auto";
}

function applyTheme(next: Theme) {
  const root = document.documentElement;
  if (next === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);
  try {
    if (next === "auto") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, next);
  } catch {}
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribeTheme(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "auto" as Theme);
  const choose = applyTheme;
  return (
    <div role="radiogroup" aria-label="Theme" className="flex overflow-hidden rounded-[4px] border border-rule text-[12px]">
      {(["auto", "light", "dark"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => choose(t)}
          className={`t-cond flex-1 px-2 py-1 capitalize ${theme === t ? "bg-ink text-surface" : "text-ink-2 hover:text-ink"}`}
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
          className="rounded-[4px] bg-ink px-2 py-0.5 font-semibold text-surface"
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
      className="rounded-[4px] border border-rule px-2 py-1 text-[12px] text-ink-2 hover:border-rule-strong hover:text-ink"
    >
      {done ? "Demo reset" : "Reset demo"}
    </button>
  );
}

function AiLine() {
  const status = useAiStatus();
  return (
    <div className="text-[12px] leading-snug text-ink-2">
      <span className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${status?.enabled ? "bg-ok" : "bg-ink-3"}`} />
      {status === null ? "Checking AI…" : status.enabled ? `AI drafting on (${status.model})` : "AI drafting is off"}
    </div>
  );
}

/** The console's own mark: three session-clock ticks, the last one would send. Not a Limex logo. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <rect x="0.5" y="0.5" width="19" height="19" rx="4" fill="#12181c" stroke="var(--rule-strong)" strokeOpacity="0.6" />
      <rect x="4.5" y="9" width="2.4" height="6.5" rx="0.6" fill="#e4e9ec" opacity="0.55" />
      <rect x="8.8" y="6.5" width="2.4" height="9" rx="0.6" fill="#e4e9ec" opacity="0.8" />
      <rect x="13.1" y="4" width="2.4" height="11.5" rx="0.6" fill="#c5ef3a" />
    </svg>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 whitespace-nowrap leading-none">
      <BrandMark />
      <span>
        <span className="t-wide text-[17px] font-[800] tracking-[-0.01em] text-ink">ziplime</span>
        <span className="t-cond ml-1 text-[15px] font-medium text-ink-2">Ops Console</span>
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
            <p className="mt-1.5 text-[12px] leading-snug text-ink-3">On ziplime&apos;s Lime dry run</p>
          </div>
          <Suspense fallback={null}>
            <RailNav />
          </Suspense>
          <div className="mt-auto flex flex-col gap-3 px-3">
            <AiLine />
            <ThemeToggle />
            <ResetDemo />
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <div className="flex items-center gap-3 border-b border-rule bg-surface px-4 py-2.5 lg:hidden">
          <Brand />
          <div className="ml-auto">
            <ResetDemo compact />
          </div>
        </div>
        <div className="border-b border-rule bg-sunk px-4 py-1.5 lg:px-8">
          <p className="t-semi text-[12px] font-semibold text-ink-2">
            <span className="mr-1.5 inline-block size-2 rounded-[1px] border border-ink-2 align-[-1px]" />
            Sample data. Fictional accounts.
          </p>
        </div>
        <main className="min-w-0 flex-1 px-4 pb-10 pt-6 lg:px-8">{children}</main>
        {/* On a phone the footer clears the fixed tab bar (52 px plus the safe area). */}
        <footer className="border-t border-rule px-4 pb-[calc(76px+env(safe-area-inset-bottom))] pt-4 text-[12px] text-ink-3 lg:px-8 lg:pb-5">
          <p>
            Unofficial concept built on the open-source{" "}
            <a className="underline hover:text-ink" href="https://github.com/Limex-com/ziplime">
              ziplime
            </a>{" "}
            engine. Sample data.
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
    </div>
  );
}
