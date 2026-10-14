// A small Markdown reader for docs/HOW_I_BUILT_THIS.md, so the /about page
// shows that file itself and the two can't drift apart. It knows exactly what
// the file uses: # and ## headings, paragraphs, "- " lists, pipe tables, and
// inline **bold** and `code`. Anything else stays plain text.

export type Inline = { kind: "text" | "bold" | "code"; text: string };

export type Block =
  | { kind: "h1" | "h2"; text: string }
  | { kind: "p"; inline: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "table"; rows: Inline[][][] };

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    out.push(m[1] !== undefined ? { kind: "bold", text: m[1] } : { kind: "code", text: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => inline(c.trim()));

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
    } else if (line.startsWith("## ")) {
      blocks.push({ kind: "h2", text: line.slice(3).trim() });
      i++;
    } else if (line.startsWith("# ")) {
      blocks.push({ kind: "h1", text: line.slice(2).trim() });
      i++;
    } else if (line.startsWith("- ")) {
      const items: Inline[][] = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(inline(lines[i++].slice(2).trim()));
      blocks.push({ kind: "ul", items });
    } else if (line.startsWith("|")) {
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        // Skip the |---| separator row.
        if (!/^\|[\s|:-]+\|?$/.test(lines[i].trim())) rows.push(cells(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", rows });
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !/^(#|- |\|)/.test(lines[i])) para.push(lines[i++].trim());
      blocks.push({ kind: "p", inline: inline(para.join(" ")) });
    }
  }
  return blocks;
}
