"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
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
                    className={`flex items-center gap-2.5 border-l-2 px-3 py-1.5 text-[14px] ${
                      active ? "border-ink bg-sunk font-semibold text-ink" : "border-transparent text-ink-2 hover:bg-sunk hover:text-ink"
                    }`}
                  >
                    <item.icon />
                    <span className="flex-1">{item.label}</span>
                    {badge > 0 && (
                      <span className="t-cond min-w-5 rounded-sm bg-ink px-1 text-center text-[12px] font-semibold text-surface tabular-nums">
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
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface lg:hidden">
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const badge = item.badge ? badges[item.badge] : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-0.5 pb-2 pt-2 text-[11px] ${
                  active ? "font-semibold text-ink" : "text-ink-2"
                }`}
              >
                <span className={`absolute inset-x-3 top-0 h-0.5 ${active ? "bg-ink" : ""}`} />
                <item.icon />
                <span className="t-cond">{item.short}</span>
                {badge > 0 && (
                  <span className="t-cond absolute right-[22%] top-1 min-w-4 rounded-sm bg-ink px-1 text-center text-[10px] font-semibold text-surface">
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

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("auto");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {}
  }, []);
  const choose = (next: Theme) => {
    setTheme(next);
    if (next === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === "auto") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {}
  };
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-sm border border-rule text-[12px]">
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
          className="rounded-sm bg-ink px-2 py-0.5 font-semibold text-surface"
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
      className="rounded-sm border border-rule px-2 py-1 text-[12px] text-ink-2 hover:border-rule-strong hover:text-ink"
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

function Brand() {
  return (
    <Link href="/" className="block leading-none">
      <span className="t-wide text-[19px] font-[800] tracking-tight text-ink">ziplime</span>
      <span className="t-cond ml-1.5 text-[15px] font-medium text-ink-2">Ops Console</span>
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-rule bg-surface py-5 lg:flex">
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
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <div className="flex items-center gap-3 border-b border-rule bg-sunk px-4 py-1.5 lg:px-8">
          <div className="lg:hidden">
            <Brand />
          </div>
          <p className="t-semi text-[12px] font-semibold text-ink-2">
            <span className="mr-1.5 inline-block size-2 rounded-[1px] border border-ink-2 align-[-1px]" />
            Sample data. Fictional accounts.
          </p>
          <div className="ml-auto lg:hidden">
            <ResetDemo compact />
          </div>
        </div>
        <main className="min-w-0 flex-1 px-4 pb-28 pt-6 lg:px-8 lg:pb-10">{children}</main>
        <footer className="border-t border-rule px-4 pb-24 pt-4 text-[12px] text-ink-3 lg:px-8 lg:pb-5">
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
