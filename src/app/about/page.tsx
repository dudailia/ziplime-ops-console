import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/markdown";

export const metadata: Metadata = { title: "How I built this" };

// The page is docs/HOW_I_BUILT_THIS.md itself, read at build time.
const SOURCE = readFileSync(join(process.cwd(), "docs", "HOW_I_BUILT_THIS.md"), "utf8");

function Text({ parts }: { parts: Inline[] }): ReactNode {
  return parts.map((p, i) =>
    p.kind === "bold" ? (
      <strong key={i} className="font-semibold text-ink">
        {p.text}
      </strong>
    ) : p.kind === "code" ? (
      <code key={i} className="font-mono text-[0.9em] text-ink">
        {p.text}
      </code>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}

export default function AboutPage() {
  const blocks = parseMarkdown(SOURCE);
  return (
    <article className="max-w-[72ch] pb-6 text-[14px] leading-relaxed text-ink-2">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h1":
            return (
              <h1 key={i} className="t-title mb-4 text-[26px] text-ink sm:text-[30px]">
                {b.text}
              </h1>
            );
          case "h2":
            return (
              <h2 key={i} className="t-semi mt-8 mb-2 border-t border-rule pt-4 text-[16px] font-semibold text-ink">
                {b.text}
              </h2>
            );
          case "p":
            return (
              <p key={i} className="mb-3">
                <Text parts={b.inline} />
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="mb-3 flex list-disc flex-col gap-1.5 pl-5 marker:text-ink-3">
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Text parts={item} />
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <table key={i} className="mb-3 w-full overflow-hidden rounded-panel border border-rule bg-surface text-[13px]">
                <tbody>
                  {b.rows
                    .filter((row) => row.some((c) => c.some((p) => p.text.trim())))
                    .map((row, j) => (
                      <tr key={j} className="row border-b border-rule last:border-b-0">
                        {row.map((cell, k) => (
                          <td key={k} className={`px-3 py-2 align-top ${k === 0 ? "w-[40%] text-ink-2" : "text-ink"}`}>
                            <Text parts={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            );
        }
      })}
    </article>
  );
}
