"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { resolveKey, SHEET, step } from "@/lib/shortcuts";
import { useTour } from "@/components/tour/tourStore";

function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function visible(el: HTMLElement) {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

/** Global shortcuts and the "?" sheet. Keyboard actions never animate. */
export function Shortcuts() {
  const router = useRouter();
  const { tour, act } = useTour();
  const sheet = useRef<HTMLDialogElement>(null);
  const pending = useRef<"g" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const dialog = sheet.current;
      if (dialog?.open && e.key !== "?") return; // the sheet handles Esc itself
      const { command, pending: next } = resolveKey(pending.current, e.key);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      if (next) timer.current = setTimeout(() => (pending.current = null), 1200);
      if (!command) return;
      e.preventDefault();
      switch (command.kind) {
        case "go":
          router.push(command.href);
          break;
        case "help":
          if (dialog?.open) dialog.close();
          else dialog?.showModal();
          break;
        case "tour":
          if (tour.status !== "running") act(tour.status === "paused" ? { type: "resume" } : { type: "start" });
          break;
        case "search":
          document.querySelector<HTMLElement>("[data-search]")?.focus();
          break;
        case "next":
        case "prev": {
          const items = [...document.querySelectorAll<HTMLElement>("[data-nav-item]")].filter(visible);
          const i = step(items.indexOf(document.activeElement as HTMLElement), items.length, command.kind === "next" ? 1 : -1);
          if (i >= 0) {
            items[i].focus({ preventScroll: true });
            items[i].scrollIntoView({ block: "nearest" });
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    // Keys pressed before this listener existed, queued by the script in layout.tsx.
    const w = window as Window & { __earlyKeys?: string[] | null };
    const early = w.__earlyKeys;
    w.__earlyKeys = null;
    for (const key of early ?? []) window.dispatchEvent(new KeyboardEvent("keydown", { key }));
    return () => window.removeEventListener("keydown", onKey);
  }, [router, act, tour.status]);

  return (
    <dialog
      ref={sheet}
      aria-labelledby="shortcuts-title"
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-panel border border-rule-strong bg-surface p-0 text-ink shadow-[var(--lift)] backdrop:bg-[var(--scrim)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className="flex items-center border-b border-rule px-5 py-3">
        <h2 id="shortcuts-title" className="t-semi text-[16px] font-semibold">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          onClick={() => sheet.current?.close()}
          className="press ml-auto rounded-[2px] px-2 py-1 text-[12px] text-ink-2 hover:bg-sunk hover:text-ink"
        >
          Close <kbd className="kbd ml-1">Esc</kbd>
        </button>
      </div>
      <div className="grid gap-x-8 gap-y-5 px-5 py-4 sm:grid-cols-2">
        {SHEET.map((g) => (
          <section key={g.group} className={g.group === "Anywhere" ? "sm:row-span-2" : ""}>
            <h3 className="t-semi mb-1.5 text-[13px] font-semibold text-ink-2">{g.group}</h3>
            <dl className="flex flex-col">
              {g.items.map((item) => (
                <div key={item.label} className="flex items-center gap-3 border-b border-rule py-1.5 text-[13px] last:border-b-0">
                  <dt className="flex w-24 shrink-0 gap-1">
                    {item.keys.map((k, i) => (
                      <span key={i} className="inline-flex items-center gap-1">
                        {i > 0 && <span className="text-[11px] text-ink-3">then</span>}
                        <kbd className="kbd">{k}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd className="text-ink">{item.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
