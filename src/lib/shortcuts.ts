// Keyboard shortcuts. Pure: a key (plus a pending "g") resolves to a command,
// so the keymap is testable without a browser. None of them animate.

export const GO_TO: Record<string, { href: string; label: string }> = {
  h: { href: "/", label: "Front page" },
  r: { href: "/portal", label: "Dry-run review" },
  a: { href: "/ops", label: "Accounts" },
  i: { href: "/ops/intake", label: "Beta intake" },
  s: { href: "/ops/inbox", label: "Support inbox" },
  u: { href: "/ops/automations", label: "Automations" },
};

export type Command =
  | { kind: "go"; href: string }
  | { kind: "help" }
  | { kind: "tour" }
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "search" };

export type Resolved = { command: Command | null; pending: "g" | null };

/** `pending` is "g" right after g was pressed; the next key picks the page. */
export function resolveKey(pending: "g" | null, key: string): Resolved {
  if (pending === "g") {
    const go = GO_TO[key.toLowerCase()];
    return { command: go ? { kind: "go", href: go.href } : null, pending: null };
  }
  switch (key) {
    case "g":
      return { command: null, pending: "g" };
    case "?":
      return { command: { kind: "help" }, pending: null };
    case "t":
      return { command: { kind: "tour" }, pending: null };
    case "j":
      return { command: { kind: "next" }, pending: null };
    case "k":
      return { command: { kind: "prev" }, pending: null };
    case "/":
      return { command: { kind: "search" }, pending: null };
    default:
      return { command: null, pending: null };
  }
}

/** Index to focus after j or k, in a list of `count` items, from `current` (-1 when none is focused). */
export function step(current: number, count: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, current + dir));
}

export const SHEET: { group: string; items: { keys: string[]; label: string }[] }[] = [
  {
    group: "Anywhere",
    items: [
      { keys: ["?"], label: "Show or hide these shortcuts" },
      { keys: ["t"], label: "Start or resume the tour" },
      ...Object.entries(GO_TO).map(([k, v]) => ({ keys: ["g", k], label: `Go to ${v.label}` })),
    ],
  },
  {
    group: "In a list",
    items: [
      { keys: ["j"], label: "Next row" },
      { keys: ["k"], label: "Previous row" },
      { keys: ["Enter"], label: "Open the focused row" },
      { keys: ["/"], label: "Search, where the page has a search box" },
    ],
  },
  {
    group: "During the tour",
    items: [
      { keys: ["→"], label: "Next step" },
      { keys: ["←"], label: "Previous step" },
      { keys: ["Esc"], label: "Pause the tour" },
    ],
  },
];
