import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATIC_DATASET } from "./data/static";
import { parseDryRun } from "./dryrun/parse";
import { inline, parseMarkdown } from "./markdown";

const DOC = readFileSync(new URL("../../docs/HOW_I_BUILT_THIS.md", import.meta.url), "utf8");

describe("markdown", () => {
  it("reads bold and code inline", () => {
    expect(inline("a **b** `c` d")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " " },
      { kind: "code", text: "c" },
      { kind: "text", text: " d" },
    ]);
  });

  it("reads headings, paragraphs, lists and tables", () => {
    const blocks = parseMarkdown("# T\n\nOne\ntwo.\n\n- a\n- b\n\n| | |\n|---|---|\n| x | **y** |\n");
    expect(blocks.map((b) => b.kind)).toEqual(["h1", "p", "ul", "table"]);
    expect(blocks[1]).toEqual({ kind: "p", inline: [{ kind: "text", text: "One two." }] });
  });
});

describe("docs/HOW_I_BUILT_THIS.md", () => {
  const blocks = parseMarkdown(DOC);

  it("has the six sections, in order", () => {
    expect(blocks.filter((b) => b.kind === "h2").map((b) => b.kind === "h2" && b.text)).toEqual([
      "What I built and why",
      "How I worked with AI",
      "How I verified it",
      "What AI got wrong, and how it was caught",
      "What I would do differently",
      "Numbers",
    ]);
  });

  it("has no em dashes", () => {
    expect(DOC).not.toContain("—");
  });

  it("states the seed numbers the seed actually has", () => {
    const ds = STATIC_DATASET;
    const lines = Object.values(ds.files).reduce((n, t) => n + t.split("\n").filter(Boolean).length, 0);
    const sessions = ds.deployments.reduce((n, d) => n + parseDryRun(ds.files[d.id], d.id).sessions.length, 0);
    expect(DOC).toContain(
      `${lines} dry-run lines written by the engine, ${ds.deployments.length} deployments, ${sessions} sessions, ${ds.accounts.length} accounts, ${ds.signups.length} signups, ${ds.tickets.length} tickets`,
    );
  });
});
