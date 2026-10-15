// Run with: npm run test:link-check  (node --test, no network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  USER_AGENT,
  extractLinks,
  parseRobots,
  robotsFor,
  isAllowed,
  fetchRobots,
  parseSitemap,
  guessMoved,
  discordInviteCode,
  checkDiscordInvite,
  checkUrl,
  HostScheduler,
  run,
  renderReport,
} from "./lib.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

// A fake fetch: routes map "METHOD url" (or just url) to a status or a function.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url: String(url), method, headers: init.headers ?? {}, signal: init.signal });
    const route = routes[`${method} ${url}`] ?? routes[String(url)];
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "function") return route();
    // Response() refuses statuses outside 200-599, and LinkedIn answers 999.
    if (typeof route === "number" && route > 599) return { status: route, ok: false, url: "", body: null };
    if (typeof route === "number") return new Response(method === "HEAD" ? null : "x", { status: route });
    return new Response(route.body ?? "", { status: route.status ?? 200, headers: route.headers });
  };
  return { impl, calls };
}

// ---------- link extraction ----------

test("extractLinks resolves against <base>, drops fragments and dedupes", () => {
  const links = extractLinks(fixture("page.html"), "https://example.com/start");
  const urls = links.filter((l) => l.kind === "http").map((l) => l.url);
  assert.deepEqual(urls, [
    "https://example.com/",
    "https://example.com/privacy",
    "https://example.com/app/cookies",
    "https://example.com/terms",
    "https://discord.gg/AbC123",
    "https://github.com/x/y",
    "https://example.com/a?x=1&y=2",
  ]);
});

test("extractLinks ignores comments, scripts, mailto, tel and in-page anchors", () => {
  const links = extractLinks(fixture("page.html"), "https://example.com/start");
  const raws = links.map((l) => l.raw);
  for (const gone of ["/commented-out", "/in-script", "mailto:hi@example.com", "tel:+100", "#features"]) {
    assert.ok(!raws.includes(gone), `${gone} should be ignored`);
  }
  assert.ok(!links.some((l) => l.url?.includes("style.css")), "<link> tags are not page links");
});

test("extractLinks reports '#' and javascript: links as placeholders, with their text", () => {
  const placeholders = extractLinks(fixture("page.html"), "https://example.com/start").filter(
    (l) => l.kind === "placeholder",
  );
  assert.deepEqual(
    placeholders.map((l) => [l.raw, l.text]),
    [
      ["#", "Discord"],
      ["javascript:void(0)", "Menu"],
    ],
  );
});

test("extractLinks takes the visible text, or aria-label when there is none", () => {
  const links = extractLinks(fixture("page.html"), "https://example.com/start");
  assert.equal(links.find((l) => l.url === "https://discord.gg/AbC123").text, "Join us");
  assert.equal(links.find((l) => l.url === "https://github.com/x/y").text, "GitHub");
});

test("extractLinks also reads canonical, og:url and JSON-LD url and sameAs, labelled by where they came from", () => {
  const links = extractLinks(fixture("meta.html"), "https://example.com/start");
  assert.deepEqual(
    links.map((l) => [l.url, l.source]),
    [
      ["https://x.com/example", "link"],
      ["https://example.com/smartdelta", "canonical"],
      ["https://example.com/og", "og:url"],
      ["https://example.com/", "structured data"],
      ["https://discord.gg/STbnBmKnV", "structured data"],
      ["https://example.com/legal/privacy", "structured data"],
    ],
  );
});

// ---------- robots.txt ----------

test("robotsFor picks the group naming our tool over the * group", () => {
  const parsed = parseRobots(fixture("robots.txt"));
  const ours = robotsFor(parsed, "ziplime-link-check/1.0");
  assert.equal(isAllowed(ours.rules, "/tools/secret"), false);
  assert.equal(isAllowed(ours.rules, "/tools/public/page"), true);
  assert.equal(isAllowed(ours.rules, "/private/x"), true, "the * group no longer applies to us");
  assert.deepEqual(parsed.sitemaps, ["https://example.com/sitemap.xml"]);
});

test("robotsFor falls back to *, with longest match, Allow on ties, * and $ wildcards", () => {
  const star = robotsFor(parseRobots(fixture("robots.txt")), "SomeUnlistedBot");
  assert.equal(star.crawlDelay, 3);
  assert.equal(isAllowed(star.rules, "/private/x"), false);
  assert.equal(isAllowed(star.rules, "/private/open/doc"), true);
  assert.equal(isAllowed(star.rules, "/docs/a.pdf"), false);
  assert.equal(isAllowed(star.rules, "/docs/a.pdf?v=2"), true, "$ anchors the end");
  assert.equal(isAllowed(star.rules, "/"), true);
  const tie = robotsFor(parseRobots("User-agent: *\nDisallow: /x\nAllow: /x"), "a");
  assert.equal(isAllowed(tie.rules, "/x"), true);
});

test("Discord's robots.txt lets us call the invite API: the longer Allow beats Disallow: /api/", () => {
  const discord = "User-agent: *\nAllow: /api/v*/invite\nDisallow: /api\nDisallow: /api/\nDisallow: /channels\n";
  const r = robotsFor(parseRobots(discord), "ziplime-link-check/1.0");
  assert.equal(isAllowed(r.rules, "/api/v10/invites/STbnBmKnV"), true);
  assert.equal(isAllowed(r.rules, "/api/v10/users/1"), false);
});

test("an empty Disallow allows everything", () => {
  const r = robotsFor(parseRobots("User-agent: *\nDisallow:"), "a");
  assert.equal(isAllowed(r.rules, "/anything"), true);
});

test("fetchRobots: 404 allows all, 5xx and network errors disallow all", async () => {
  const missing = await fetchRobots("https://a.test", fakeFetch({}).impl);
  assert.equal(missing.unreachable, false);
  assert.equal(isAllowed(missing.rules, "/x"), true);

  const down = await fetchRobots("https://b.test", fakeFetch({ "https://b.test/robots.txt": 503 }).impl);
  assert.equal(down.unreachable, true);
  assert.equal(isAllowed(down.rules, "/x"), false);

  const boom = await fetchRobots("https://c.test", async () => {
    throw new TypeError("fetch failed");
  });
  assert.equal(boom.unreachable, true);
  assert.equal(isAllowed(boom.rules, "/x"), false);
});

test("parseSitemap reads <loc> entries", () => {
  assert.deepEqual(parseSitemap(fixture("sitemap.xml")), [
    "https://example.com/legal/privacy",
    "https://example.com/legal/cookies-policy",
    "https://example.com/products/smartdelta",
  ]);
});

// ---------- moved-page guess ----------

test("guessMoved finds the page under a new folder", () => {
  const known = ["https://example.com/about", "https://example.com/legal/privacy"];
  assert.equal(guessMoved("https://example.com/privacy", known), "https://example.com/legal/privacy");
});

test("guessMoved matches a renamed slug that keeps the word", () => {
  const known = ["https://example.com/legal/cookies-policy", "https://example.com/legal/privacy"];
  assert.equal(guessMoved("https://example.com/cookies", known), "https://example.com/legal/cookies-policy");
});

test("guessMoved looks across subdomains of the same site, not other sites", () => {
  assert.equal(
    guessMoved("https://www.limex.com/smartdelta", ["https://launch.limex.com/smartdelta/"]),
    "https://launch.limex.com/smartdelta/",
  );
  assert.equal(guessMoved("https://example.com/privacy", ["https://other.com/privacy"]), null);
});

test("guessMoved prefers the same host, and never suggests the broken URL itself", () => {
  const known = ["https://x.example.com/privacy", "https://example.com/legal/privacy", "https://example.com/privacy"];
  assert.equal(guessMoved("https://example.com/privacy", known), "https://example.com/legal/privacy");
  assert.equal(guessMoved("https://example.com/privacy", ["https://example.com/privacy/"]), null);
  assert.equal(guessMoved("https://example.com/", ["https://example.com/home"]), null);
});

// ---------- Discord ----------

test("discordInviteCode reads every invite URL form, and nothing else", () => {
  assert.equal(discordInviteCode("https://discord.gg/STbnBmKnV"), "STbnBmKnV");
  assert.equal(discordInviteCode("https://discord.com/invite/AbC123?utm=x"), "AbC123");
  assert.equal(discordInviteCode("https://discordapp.com/invite/Zz-9"), "Zz-9");
  assert.equal(discordInviteCode("https://discord.com/channels/1/2"), null);
  assert.equal(discordInviteCode("https://example.com/invite/abc"), null);
});

test("checkDiscordInvite asks the API, so a dead invite is caught even though its page says 200", async () => {
  const { impl, calls } = fakeFetch({
    "https://discord.com/api/v10/invites/Good1": { status: 200, body: '{"code":"Good1"}' },
    "https://discord.com/api/v10/invites/Dead1": { status: 404, body: '{"message":"Unknown Invite","code":10006}' },
    "https://discord.com/api/v10/invites/Slow1": { status: 429, body: '{"retry_after":5}' },
  });
  assert.equal((await checkDiscordInvite("Good1", impl)).verdict, "ok");
  const dead = await checkDiscordInvite("Dead1", impl);
  assert.equal(dead.verdict, "broken");
  assert.equal(dead.status, 404);
  assert.match(dead.detail, /Unknown Invite/);
  assert.equal((await checkDiscordInvite("Slow1", impl)).verdict, "unverified");
  assert.equal(calls[0].headers["user-agent"], USER_AGENT);
});

// ---------- checking one URL ----------

test("checkUrl sends HEAD with our User-Agent and a timeout signal", async () => {
  const { impl, calls } = fakeFetch({ "HEAD https://a.test/": 200 });
  const r = await checkUrl("https://a.test/", impl);
  assert.equal(r.verdict, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "HEAD");
  assert.equal(calls[0].headers["user-agent"], USER_AGENT);
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test("checkUrl falls back to GET only when HEAD is not allowed", async () => {
  const { impl, calls } = fakeFetch({ "HEAD https://a.test/": 405, "GET https://a.test/": 200 });
  const r = await checkUrl("https://a.test/", impl);
  assert.equal(r.verdict, "ok");
  assert.deepEqual(calls.map((c) => c.method), ["HEAD", "GET"]);
});

test("checkUrl confirms an error status with one GET before calling a link broken", async () => {
  const lying = fakeFetch({ "HEAD https://a.test/x": 404, "GET https://a.test/x": 200 });
  assert.equal((await checkUrl("https://a.test/x", lying.impl)).verdict, "ok");

  const gone = fakeFetch({ "HEAD https://a.test/y": 404, "GET https://a.test/y": 404 });
  const r = await checkUrl("https://a.test/y", gone.impl);
  assert.equal(r.verdict, "broken");
  assert.equal(r.status, 404);
});

test("checkUrl calls 403, 429 and 999 unverified, not broken (bot walls)", async () => {
  for (const status of [401, 403, 429, 999]) {
    const { impl } = fakeFetch({ "https://a.test/": status });
    assert.equal((await checkUrl("https://a.test/", impl)).verdict, "unverified", String(status));
  }
});

test("checkUrl reports a timeout and a network error as broken, with the reason", async () => {
  const slow = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  const r = await checkUrl("https://a.test/", slow);
  assert.equal(r.verdict, "broken");
  assert.equal(r.status, "timeout");

  const dns = async () => {
    throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
  };
  const d = await checkUrl("https://nope.test/", dns);
  assert.equal(d.verdict, "broken");
  assert.equal(d.status, "ENOTFOUND");
});

// ---------- politeness ----------

test("HostScheduler spaces requests to one host by the delay, and leaves other hosts alone", async () => {
  let now = 0;
  const slept = [];
  const sched = new HostScheduler({
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  });
  await sched.wait("a.test", 1000);
  await sched.wait("a.test", 1000);
  await sched.wait("b.test", 1000);
  now += 400;
  await sched.wait("a.test", 3000);
  assert.deepEqual(slept, [1000, 2600]);
});

// ---------- the whole run, offline ----------

test("run checks depth 1 only, obeys robots.txt and reports what it found", async () => {
  const start = "https://site.test/home";
  const html = `
    <a href="/ok">Fine</a>
    <a href="/privacy">Privacy</a>
    <a href="/admin/panel">Admin</a>
    <a href="#">Discord</a>
    <a href="https://discord.gg/Dead1">Discord</a>
    <a href="https://other.test/page">Partner</a>`;
  const { impl, calls } = fakeFetch({
    "https://site.test/robots.txt": { body: "User-agent: *\nDisallow: /admin\nSitemap: https://site.test/sitemap.xml" },
    "https://site.test/sitemap.xml": { body: "<urlset><url><loc>https://site.test/legal/privacy</loc></url></urlset>" },
    "GET https://site.test/home": { body: html, headers: { "content-type": "text/html" } },
    "HEAD https://site.test/ok": 200,
    "https://site.test/privacy": 404,
    "https://other.test/robots.txt": 404,
    "HEAD https://other.test/page": 200,
    "https://discord.com/robots.txt": 404,
    "https://discord.com/api/v10/invites/Dead1": { status: 404, body: '{"message":"Unknown Invite","code":10006}' },
  });
  const result = await run([start], { fetchImpl: impl, sleep: async () => {}, now: () => 0 });

  assert.ok(!calls.some((c) => c.url.includes("/admin")), "robots.txt Disallow is obeyed");
  assert.ok(!calls.some((c) => c.url === "https://other.test/page" && c.method === "GET"), "no crawling past depth 1");
  assert.ok(!calls.some((c) => c.url === "https://discord.gg/Dead1"), "invites go to the API, not the page");

  const broken = result.findings.filter((f) => f.verdict === "broken");
  assert.deepEqual(
    broken.map((f) => [f.url, f.status, f.movedTo ?? null]),
    [
      ["https://site.test/privacy", 404, "https://site.test/legal/privacy"],
      ["https://discord.gg/Dead1", 404, null],
    ],
  );
  assert.deepEqual(result.placeholders.map((p) => [p.page, p.text]), [[start, "Discord"]]);
  assert.deepEqual(result.skipped.map((s) => s.url), ["https://site.test/admin/panel"]);

  const md = renderReport(result, { date: "2026-10-14" });
  assert.match(md, /\| https:\/\/site\.test\/privacy \| https:\/\/site\.test\/home \| 404 \| https:\/\/site\.test\/legal\/privacy \|/);
  assert.match(md, /Unknown Invite/);
  assert.match(md, /`#` .*Discord/);
});

test("run flags a soft 404 when a host answers every path with the same page and the sitemap lacks it", async () => {
  const start = "https://site.test/home";
  const html = `
    <a href="https://spa.test/privacy">Privacy</a>
    <a href="https://spa.test/legal/privacy">Privacy policy</a>
    <a href="https://spa.test/">Home</a>
    <a href="https://landing.test/smartdelta/">SmartDelta</a>`;
  const page = (body) => () => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  const { impl, calls } = fakeFetch({
    "https://site.test/robots.txt": 404,
    "GET https://site.test/home": { body: html },
    "https://spa.test/robots.txt": { body: "User-agent: *\nAllow: /\nSitemap: https://spa.test/sitemap.xml" },
    "https://spa.test/sitemap.xml": { body: "<urlset><url><loc>https://spa.test/legal/privacy</loc></url></urlset>" },
    "https://spa.test/probe": page("APP"),
    "https://spa.test/privacy": page("APP"),
    "https://spa.test/legal/privacy": page("APP"),
    "https://spa.test/": page("APP"),
    "https://landing.test/robots.txt": 404,
    "https://landing.test/probe": page("LANDING"),
    "https://landing.test/smartdelta/": page("SMARTDELTA"),
  });
  const result = await run([start], { fetchImpl: impl, sleep: async () => {}, now: () => 0, probePath: "/probe" });

  // Not "broken": a client-side app can render a path the sitemap leaves out, so a person confirms it.
  assert.deepEqual(result.findings.filter((f) => f.verdict === "broken"), []);
  const soft = result.findings.filter((f) => f.verdict === "soft404");
  assert.deepEqual(
    soft.map((f) => [f.url, f.status, f.movedTo]),
    [["https://spa.test/privacy", 200, "https://spa.test/legal/privacy"]],
  );
  assert.ok(!calls.some((c) => c.url === "https://spa.test/" && c.method === "GET"), "the root is never a soft 404");
  const md = renderReport(result, { date: "2026-10-14" });
  assert.match(md, /## Probably broken \(soft 404\)/);
  assert.match(md, /\| https:\/\/spa\.test\/privacy \| https:\/\/site\.test\/home \| https:\/\/spa\.test\/legal\/privacy \|/);
  assert.match(md, /1 probably broken/);
});

test("run does not probe a host that answers a made-up path with 404", async () => {
  const { impl, calls } = fakeFetch({
    "https://site.test/robots.txt": 404,
    "GET https://site.test/home": { body: '<a href="/ok">ok</a>' },
    "HEAD https://site.test/ok": 200,
  });
  const result = await run(["https://site.test/home"], { fetchImpl: impl, sleep: async () => {}, now: () => 0, probePath: "/probe" });
  assert.equal(result.findings[0].verdict, "ok");
  assert.ok(!calls.some((c) => c.url === "https://site.test/ok" && c.method === "GET"));
});

test("run reports a start page it could not load", async () => {
  const { impl } = fakeFetch({ "https://site.test/robots.txt": 404, "GET https://site.test/home": 500 });
  const result = await run(["https://site.test/home"], { fetchImpl: impl, sleep: async () => {}, now: () => 0 });
  assert.deepEqual(result.pageErrors.map((p) => [p.page, p.status]), [["https://site.test/home", 500]]);
});
