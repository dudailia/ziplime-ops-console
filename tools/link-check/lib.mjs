import { createHash, randomBytes } from "node:crypto";

// Link check for a handful of start pages: depth 1, polite, Node standard library and fetch only.
// The CLI is check.mjs; everything here takes an injected fetch so the tests run offline.

export const AGENT_TOKEN = "ziplime-link-check";
export const USER_AGENT = `${AGENT_TOKEN}/1.0 (+https://github.com/dudailia/ziplime-ops-console/tree/main/tools/link-check)`;
export const TIMEOUT_MS = 10_000;
export const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const MAX_SITEMAPS_PER_HOST = 5;

// Statuses that usually mean "a bot wall answered", not "the page is gone".
const UNVERIFIED_STATUSES = new Set([401, 403, 429, 999]);

const headers = (accept = "*/*") => ({ "user-agent": USER_AGENT, accept });

// ---------- HTML ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function parseAttrs(s) {
  const attrs = {};
  for (const m of s.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

const visibleText = (html) =>
  decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/**
 * Every link on the page, in order. kind "http" links are resolved, without fragment, deduped.
 * kind "placeholder" is an <a> that goes nowhere: href "#", "" or javascript:.
 * Ignored: in-page anchors (#section), mailto:, tel: and other schemes, and anything in comments or scripts.
 */
export function extractLinks(html, pageUrl) {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const jsonLd = [...noComments.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(
    (m) => m[1],
  );
  const clean = noComments
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, "");

  let base = pageUrl;
  const baseTag = clean.match(/<base\b([^>]*)>/i);
  if (baseTag) {
    const href = parseAttrs(baseTag[1]).href;
    if (href) {
      try {
        base = new URL(href, pageUrl).href;
      } catch {}
    }
  }

  const links = [];
  const seen = new Set();
  for (const m of clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attrs = parseAttrs(m[1]);
    if (!("href" in attrs)) continue;
    const raw = attrs.href.trim();
    const imgAlt = m[2].match(/<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const text = visibleText(m[2]) || attrs["aria-label"] || attrs.title || (imgAlt && (imgAlt[1] ?? imgAlt[2])) || "";

    if (raw === "" || raw === "#" || raw === "#!" || /^javascript:/i.test(raw)) {
      const key = `placeholder ${raw} ${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ kind: "placeholder", url: null, raw, text });
      }
      continue;
    }
    if (raw.startsWith("#")) continue;

    let url;
    try {
      url = new URL(raw, base);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    links.push({ kind: "http", url: url.href, raw, text, source: "link" });
  }

  // Links a visitor never clicks but search engines follow.
  const extra = [];
  for (const m of clean.matchAll(/<link\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1]);
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical") && a.href) extra.push([a.href, "canonical", "canonical"]);
  }
  for (const m of clean.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1]);
    if ((a.property ?? "").toLowerCase() === "og:url" && a.content) extra.push([a.content, "og:url", "og:url"]);
  }
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "url" || key === "sameAs") {
        for (const v of [value].flat()) if (typeof v === "string" && /^https?:\/\//i.test(v)) extra.push([v, "structured data", `JSON-LD ${key}`]);
      } else walk(value);
    }
  };
  for (const block of jsonLd) {
    try {
      walk(JSON.parse(block));
    } catch {}
  }
  for (const [href, source, text] of extra) {
    let url;
    try {
      url = new URL(href.trim(), base);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    links.push({ kind: "http", url: url.href, raw: href, text, source });
  }
  return links;
}

export function parseSitemap(xml) {
  return [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1].trim()));
}

// ---------- robots.txt (RFC 9309) ----------

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
    } else if (!current) {
      continue;
    } else if (key === "allow" || key === "disallow") {
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups, sitemaps };
}

/** The rules for a user agent: groups naming its product token, else the * groups, else none. */
export function robotsFor(parsed, userAgent) {
  const token = userAgent.split("/")[0].trim().toLowerCase();
  let groups = parsed.groups.filter((g) => g.agents.includes(token));
  if (groups.length === 0) groups = parsed.groups.filter((g) => g.agents.includes("*"));
  const delays = groups.map((g) => g.crawlDelay).filter((d) => d !== null);
  return {
    rules: groups.flatMap((g) => g.rules),
    crawlDelay: delays.length ? Math.max(...delays) : null,
  };
}

function patternRegex(pattern) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Longest matching pattern wins; on a tie Allow wins; no match means allowed. */
export function isAllowed(rules, path) {
  let best = null;
  for (const rule of rules) {
    if (!patternRegex(rule.pattern).test(path)) continue;
    const len = rule.pattern.length;
    if (!best || len > best.len || (len === best.len && rule.allow)) best = { len, allow: rule.allow };
  }
  return best ? best.allow : true;
}

/** A 4xx robots.txt means no rules; a 5xx or no answer means stay out (RFC 9309, 2.3.1). */
export async function fetchRobots(origin, fetchImpl = fetch, timeoutMs = TIMEOUT_MS) {
  const disallowAll = { rules: [{ allow: false, pattern: "/" }], crawlDelay: null, sitemaps: [], unreachable: true };
  let res;
  try {
    res = await fetchImpl(`${origin}/robots.txt`, {
      method: "GET",
      headers: headers("text/plain"),
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return disallowAll;
  }
  if (res.status >= 500) return disallowAll;
  if (res.status >= 400) return { rules: [], crawlDelay: null, sitemaps: [], unreachable: false };
  const parsed = parseRobots(await res.text());
  return { ...robotsFor(parsed, USER_AGENT), sitemaps: parsed.sitemaps, unreachable: false };
}

// ---------- the moved-page guess ----------

const siteOf = (host) => host.split(".").slice(-2).join(".");
const segmentsOf = (url) => url.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
const siteKey = (href) => {
  const u = new URL(href);
  return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
};
const normalized = (url) => `${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`;

/**
 * Where a broken page probably went: a known URL on the same site (any subdomain) whose
 * last path segment is the broken one's (3), contains it as a word (2), or has it as any segment (1).
 * Same host breaks ties upward, a shorter path breaks the rest.
 */
export function guessMoved(brokenUrl, candidates) {
  const broken = new URL(brokenUrl);
  const slug = segmentsOf(broken).at(-1)?.replace(/\.[a-z0-9]+$/, "");
  if (!slug) return null;
  let best = null;
  for (const href of candidates) {
    let c;
    try {
      c = new URL(href);
    } catch {
      continue;
    }
    if (normalized(c) === normalized(broken) || siteOf(c.host) !== siteOf(broken.host)) continue;
    const segs = segmentsOf(c);
    const last = (segs.at(-1) ?? "").replace(/\.[a-z0-9]+$/, "");
    let score = last === slug ? 3 : last.split(/[-_.]/).includes(slug) ? 2 : segs.includes(slug) ? 1 : 0;
    if (score === 0) continue;
    if (c.host === broken.host) score += 0.5;
    if (!best || score > best.score || (score === best.score && c.pathname.length < best.len)) {
      best = { href, score, len: c.pathname.length };
    }
  }
  return best ? best.href : null;
}

// ---------- Discord ----------

export function discordInviteCode(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  const segs = url.pathname.split("/").filter(Boolean);
  let code = null;
  if (host === "discord.gg") code = segs[0];
  else if ((host === "discord.com" || host === "discordapp.com") && segs[0] === "invite") code = segs[1];
  return code && /^[A-Za-z0-9-]+$/.test(code) ? code : null;
}

export const discordApiUrl = (code) => `https://discord.com/api/v10/invites/${code}`;

/** The invite page answers 200 even for a dead invite, so ask the public invite endpoint. */
export async function checkDiscordInvite(code, fetchImpl = fetch, timeoutMs = TIMEOUT_MS) {
  let res;
  try {
    res = await fetchImpl(discordApiUrl(code), {
      method: "GET",
      headers: headers("application/json"),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { verdict: "unverified", status: errorStatus(err), detail: "Discord API did not answer" };
  }
  let message = "";
  try {
    message = (await res.json()).message ?? "";
  } catch {}
  if (res.ok) return { verdict: "ok", status: res.status, detail: "" };
  if (res.status === 404) return { verdict: "broken", status: 404, detail: message || "Unknown Invite" };
  return { verdict: "unverified", status: res.status, detail: message };
}

// ---------- checking one URL ----------

function errorStatus(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timeout";
  return err?.cause?.code ?? err?.code ?? err?.message ?? "network error";
}

const verdictFor = (status) => (status < 400 ? "ok" : UNVERIFIED_STATUSES.has(status) ? "unverified" : "broken");

/**
 * HEAD first. Any error status gets one GET: a 405 or 501 means HEAD is not allowed, and some
 * servers answer HEAD wrongly, so a link is only called broken on what GET says.
 */
export async function checkUrl(url, fetchImpl = fetch, timeoutMs = TIMEOUT_MS) {
  const request = async (method) => {
    const res = await fetchImpl(url, {
      method,
      headers: headers(),
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (method === "GET") await res.body?.cancel().catch(() => {});
    return res;
  };
  try {
    let res = await request("HEAD");
    let method = "HEAD";
    if (res.status >= 400) {
      res = await request("GET");
      method = "GET";
    }
    return { verdict: verdictFor(res.status), status: res.status, method, finalUrl: res.url || url };
  } catch (err) {
    return { verdict: "broken", status: errorStatus(err), method: "HEAD", finalUrl: url };
  }
}

// ---------- politeness ----------

/** Serializes request starts per host, at least delayMs apart. */
export class HostScheduler {
  constructor({ now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.now = now;
    this.sleep = sleep;
    this.last = new Map();
    this.chain = new Map();
  }

  wait(host, delayMs) {
    const prev = this.chain.get(host) ?? Promise.resolve();
    const next = prev.then(async () => {
      const last = this.last.get(host);
      if (last !== undefined) {
        const gap = last + delayMs - this.now();
        if (gap > 0) await this.sleep(gap);
      }
      this.last.set(host, this.now());
    });
    this.chain.set(host, next);
    return next;
  }
}

// ---------- the run ----------

export async function run(
  startPages,
  { fetchImpl = fetch, sleep, now, timeoutMs = TIMEOUT_MS, log = () => {}, probePath = `/${AGENT_TOKEN}-probe-${randomBytes(6).toString("hex")}` } = {},
) {
  const sched = new HostScheduler({ sleep, now });
  const robotsCache = new Map();
  const delayFor = (robots) => Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, (robots.crawlDelay ?? 0) * 1000));

  const robotsOf = (origin) => {
    if (!robotsCache.has(origin)) {
      const host = new URL(origin).host;
      robotsCache.set(
        origin,
        sched.wait(host, MIN_DELAY_MS).then(() => fetchRobots(origin, fetchImpl, timeoutMs)),
      );
    }
    return robotsCache.get(origin);
  };

  const politeGet = async (url, accept) => {
    const u = new URL(url);
    const robots = await robotsOf(u.origin);
    if (!isAllowed(robots.rules, u.pathname + u.search)) return { skipped: true, unreachable: robots.unreachable };
    await sched.wait(u.host, delayFor(robots));
    const res = await fetchImpl(url, {
      method: "GET",
      headers: headers(accept),
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { res };
  };

  const sitemapCache = new Map(); // origin -> Promise<string[]>
  const sitemapsOf = (origin) => {
    if (!sitemapCache.has(origin)) {
      sitemapCache.set(
        origin,
        (async () => {
          const urls = [];
          const queue = [...(await robotsOf(origin)).sitemaps];
          for (let i = 0; i < queue.length && i < MAX_SITEMAPS_PER_HOST; i++) {
            try {
              const sm = await politeGet(queue[i], "application/xml");
              if (sm.skipped || sm.res.status >= 400) continue;
              const xml = await sm.res.text();
              const locs = parseSitemap(xml);
              if (/<sitemapindex\b/i.test(xml)) queue.push(...locs);
              else urls.push(...locs);
            } catch {}
          }
          return urls;
        })(),
      );
    }
    return sitemapCache.get(origin);
  };

  const pages = [];
  const pageErrors = [];
  const placeholders = [];
  const sitemapUrls = [];
  const links = new Map(); // url -> { url, text, pages: [] }

  await Promise.all(
    startPages.map(async (page) => {
      log(`page ${page}`);
      let got;
      try {
        got = await politeGet(page, "text/html");
      } catch (err) {
        pageErrors.push({ page, status: errorStatus(err) });
        return;
      }
      if (got.skipped) {
        pageErrors.push({ page, status: got.unreachable ? "robots.txt unreachable" : "disallowed by robots.txt" });
        return;
      }
      if (got.res.status >= 400) {
        await got.res.body?.cancel().catch(() => {});
        pageErrors.push({ page, status: got.res.status });
        return;
      }
      const found = extractLinks(await got.res.text(), got.res.url || page);
      pages.push({ page, links: found.length });
      for (const link of found) {
        if (link.kind === "placeholder") {
          placeholders.push({ page, raw: link.raw, text: link.text });
          continue;
        }
        const entry = links.get(link.url) ?? { url: link.url, text: link.text, source: link.source, pages: [], order: Infinity };
        entry.pages.push(page);
        links.set(link.url, entry);
      }

      // Sitemaps feed the moved-page guess and the soft-404 check. One level of sitemap index, capped.
      sitemapUrls.push(...(await sitemapsOf(new URL(page).origin)));
    }),
  );

  // First-seen order follows the start page list, then page order.
  let order = 0;
  for (const page of startPages) {
    for (const entry of links.values()) if (entry.pages[0] === page && entry.order === Infinity) entry.order = order++;
  }
  const entries = [...links.values()].sort((a, b) => a.order - b.order);

  const findings = [];
  const skipped = [];
  const byHost = new Map();
  for (const entry of entries) {
    const code = discordInviteCode(entry.url);
    const target = new URL(code ? discordApiUrl(code) : entry.url);
    const list = byHost.get(target.host) ?? [];
    list.push({ entry, code, target });
    byHost.set(target.host, list);
  }

  await Promise.all(
    [...byHost.entries()].map(async ([host, list]) => {
      for (const { entry, code, target } of list) {
        const robots = await robotsOf(target.origin);
        if (!isAllowed(robots.rules, target.pathname + target.search)) {
          skipped.push({
            url: entry.url,
            page: entry.pages[0],
            reason: robots.unreachable ? "robots.txt unreachable" : "disallowed by robots.txt",
            order: entry.order,
          });
          continue;
        }
        await sched.wait(host, delayFor(robots));
        log(`check ${entry.url}`);
        const result = code ? await checkDiscordInvite(code, fetchImpl, timeoutMs) : await checkUrl(entry.url, fetchImpl, timeoutMs);
        findings.push({ ...result, url: entry.url, text: entry.text, source: entry.source, page: entry.pages[0], pages: entry.pages, order: entry.order, discord: Boolean(code) });
      }
    }),
  );

  findings.sort((a, b) => a.order - b.order);
  skipped.sort((a, b) => a.order - b.order);

  // Soft 404s: some hosts answer every path with 200 and the same app shell. Ask each host for a
  // made-up path once. If it answers 200, a link whose body is that same response, and whose path
  // is not in the host's sitemap, is a page that does not exist.
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const okByHost = new Map();
  for (const f of findings) {
    if (f.verdict !== "ok" || f.discord) continue;
    const host = new URL(f.finalUrl).origin;
    okByHost.set(host, [...(okByHost.get(host) ?? []), f]);
  }
  await Promise.all(
    [...okByHost.entries()].map(async ([origin, list]) => {
      let probeHash;
      try {
        const probe = await politeGet(origin + probePath, "text/html");
        if (probe.skipped) return;
        if (probe.res.status >= 400) return void (await probe.res.body?.cancel().catch(() => {}));
        probeHash = hash(await probe.res.text());
      } catch {
        return;
      }
      const listed = new Set((await sitemapsOf(origin)).map(siteKey));
      for (const f of list) {
        const final = new URL(f.finalUrl);
        if (final.pathname === "/" || listed.has(siteKey(f.finalUrl))) continue;
        try {
          const got = await politeGet(f.finalUrl, "text/html");
          if (got.skipped || got.res.status >= 400) continue;
          if (hash(await got.res.text()) === probeHash) {
            f.verdict = "soft404";
            f.detail = "same page as a made-up URL, not in the sitemap";
          }
        } catch {}
      }
    }),
  );

  const alive = [...findings.filter((f) => f.verdict === "ok" && !f.discord).map((f) => f.url), ...sitemapUrls];
  for (const f of findings) {
    if ((f.verdict === "broken" || f.verdict === "soft404") && !f.discord) f.movedTo = guessMoved(f.url, alive) ?? undefined;
  }

  return { startPages, pages, pageErrors, placeholders, findings, skipped, checked: findings.length };
}

// ---------- the report ----------

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");
const foundOn = (f) => (f.pages.length > 1 ? `${f.page} (and ${f.pages.length - 1} more)` : f.page);

export function renderReport(result, { date }) {
  const broken = result.findings.filter((f) => f.verdict === "broken");
  const unverified = result.findings.filter((f) => f.verdict === "unverified");
  const soft = result.findings.filter((f) => f.verdict === "soft404");
  const where = (f) => (f.source && f.source !== "link" ? `${foundOn(f)} (${f.source})` : foundOn(f));
  const out = [];
  out.push(`# Link check, ${date}`, "");
  out.push(
    `${result.checked} links checked from ${result.startPages.length} start pages: ` +
      `${broken.length} broken, ${soft.length} probably broken, ${result.placeholders.length} placeholder, ${unverified.length} could not be verified, ` +
      `${result.skipped.length} not checked because of robots.txt.`,
    "",
  );

  out.push("## Start pages", "");
  for (const page of result.startPages) {
    const ok = result.pages.find((p) => p.page === page);
    const err = result.pageErrors.find((p) => p.page === page);
    out.push(`- ${page}: ${ok ? `${ok.links} links` : `could not load (${err?.status ?? "unknown"})`}`);
  }
  out.push("");

  out.push("## Broken links", "");
  if (broken.length === 0) out.push("None.");
  else {
    out.push("| Broken link | Found on | Status | Seems to have moved to |", "|---|---|---|---|");
    for (const f of broken) {
      const status = f.detail ? `${f.status} ${f.detail}` : f.status;
      out.push(`| ${cell(f.url)} | ${cell(where(f))} | ${cell(status)} | ${cell(f.movedTo ?? "no likely match")} |`);
    }
  }
  out.push("");

  out.push(
    "## Probably broken (soft 404)",
    "",
    "These hosts answer every URL with 200 and the same page, so the status says nothing. Each link below got the very page a made-up URL gets, and its path is not in the host's sitemap. A client-side app can still render such a path, so open each one in a browser before reporting it.",
    "",
  );
  if (soft.length === 0) out.push("None.");
  else {
    out.push("| Link | Found on | Seems to have moved to |", "|---|---|---|");
    for (const f of soft) out.push(`| ${cell(f.url)} | ${cell(where(f))} | ${cell(f.movedTo ?? "no likely match")} |`);
  }
  out.push("");

  out.push("## Placeholder links", "", "Links whose href is `#`, empty or `javascript:`. They go nowhere.", "");
  if (result.placeholders.length === 0) out.push("None.");
  for (const p of result.placeholders) out.push(`- \`${p.raw || '""'}\` "${p.text || "(no text)"}" on ${p.page}`);
  out.push("");

  out.push("## Could not verify", "", "These answered with a status that usually means a bot wall, not a missing page. Check them in a browser.", "");
  if (unverified.length === 0) out.push("None.");
  else {
    out.push("| Link | Found on | Status |", "|---|---|---|");
    for (const f of unverified) out.push(`| ${cell(f.url)} | ${cell(where(f))} | ${cell(f.detail ? `${f.status} ${f.detail}` : f.status)} |`);
  }
  out.push("");

  if (result.skipped.length) {
    out.push("## Not checked", "");
    for (const s of result.skipped) out.push(`- ${s.url} (on ${s.page}): ${s.reason}`);
    out.push("");
  }

  out.push(
    "## How this was checked",
    "",
    "- Depth 1: the links on the start pages, nothing further. Sitemaps named in robots.txt were read to guess where a page moved and to spot soft 404s.",
    `- Every host's robots.txt was read and obeyed. One request per second per host, or the host's Crawl-delay if longer. User-Agent: \`${USER_AGENT}\`.`,
    "- HEAD first. On an error status, one GET decides. Timeout 10 s.",
    "- Each host was asked once for a made-up path. Where that answered 200, a link serving the identical page and missing from the sitemap is listed as probably broken.",
    "- Links come from `<a href>`, `rel=canonical`, `og:url` and JSON-LD `url` and `sameAs`.",
    "- Discord invites were checked with `https://discord.com/api/v10/invites/<code>`, because the invite page answers 200 for a dead invite.",
    "",
  );
  return out.join("\n");
}
