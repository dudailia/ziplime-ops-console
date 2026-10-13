"use client";

import Link from "next/link";
import { stampET } from "@/lib/format";
import { ticketStatus, TICKET_STATUS_LABEL } from "@/lib/inbox/status";
import { useStore } from "@/lib/store/StoreProvider";
import { useTickets } from "@/lib/store/selectors";
import { Panel } from "@/components/ui/kit";

export function AccountTickets({ accountId }: { accountId: string }) {
  const { state } = useStore();
  const tickets = useTickets().filter((t) => t.accountId === accountId);
  return (
    <Panel title="Tickets" aside={tickets.length ? <Link className="underline" href={`/ops/inbox?account=${accountId}`}>Open in inbox</Link> : undefined}>
      {tickets.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-ink-2">No tickets.</p>
      ) : (
        <ul>
          {tickets.map((t) => {
            const status = ticketStatus(state, t);
            return (
              <li key={t.id} className="border-b border-rule last:border-b-0">
                <Link href={`/ops/inbox?account=${accountId}&t=${t.id}`} className="block px-4 py-2 hover:bg-sunk">
                  <span className="block text-[13px] font-semibold text-ink">{t.subject}</span>
                  <span className="block text-[11px] text-ink-3">
                    {t.id}, {stampET(t.createdAt)}.{" "}
                    <span className={status === "flagged" ? "font-semibold text-refuse" : status === "needs-reply" ? "font-semibold text-ink" : ""}>
                      {TICKET_STATUS_LABEL[status]}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
