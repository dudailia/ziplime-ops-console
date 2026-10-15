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
    calls.push({ url: String(url), method, headers: init.headers ?? {}, signal: init.signal, init });
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

// ---------- pre-ship review, 15 Oct: politeness on every request, redirects, edge cases ----------

// Virtual time: a sleep resolves when the clock reaches its deadline, and the clock moves to the
// next deadline only once everything else has settled (setImmediate runs after the microtasks).
// So hosts sleeping side by side don't add up, the way they don't in real time.
function virtualClock() {
  let t = 0;
  const timers = [];
  const tick = () => {
    if (timers.length) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers.shift();
      t = Math.max(t, next.at);
      next.resolve();
    }
    if (!clock.stopped) setImmediate(tick);
  };
  const clock = { now: () => t, sleep: (ms) => new Promise((resolve) => timers.push({ at: t + ms, resolve })), stopped: false };
  setImmediate(tick);
  return clock;
}

// A fetch that stamps every request with the virtual time it started at.
function timed(routes) {
  const vc = virtualClock();
  const t = () => vc.now();
  const clock = { now: vc.now, sleep: vc.sleep };
  const { impl, calls } = fakeFetch(routes);
  // Stamped when the request starts: fakeFetch records the call before its first await.
  const stamped = (url, init) => {
    const res = impl(url, init);
    calls.at(-1).at = t();
    return res;
  };
  return { clock, impl: stamped, calls, stop: () => (vc.stopped = true) };
}

function assertSpaced(calls, minMs) {
  const byHost = new Map();
  for (const c of calls) {
    const host = new URL(c.url).host;
    const prev = byHost.get(host);
    if (prev !== undefined) assert.ok(c.at - prev >= minMs(host), `${c.method} ${c.url} came ${c.at - prev} ms after the previous request to ${host}`);
    byHost.set(host, c.at);
  }
}

test("every request to one host waits for the delay, the GET retry and Crawl-delay included", async () => {
  const { clock, impl, calls, stop } = timed({
    "https://site.test/robots.txt": 404,
    "GET https://site.test/home": { body: '<a href="/gone">x</a><a href="/ok">y</a><a href="https://slow.test/a">z</a><a href="https://slow.test/b">w</a>' },
    "https://site.test/gone": 404,
    "HEAD https://site.test/ok": 200,
    "https://slow.test/robots.txt": { body: "User-agent: *\nCrawl-delay: 3" },
    "HEAD https://slow.test/a": 200,
    "HEAD https://slow.test/b": 200,
  });
  await run(["https://site.test/home"], { fetchImpl: impl, ...clock, probePath: "/probe" });
  stop();
  assert.ok(calls.some((c) => c.method === "GET" && c.url === "https://site.test/gone"), "the GET retry happened");
  assertSpaced(calls, (host) => (host === "slow.test" ? 3000 : 1000));
});

test("a redirect is followed by hand: robots.txt and the delay apply to every hop", async () => {
  const { clock, impl, calls, stop } = timed({
    "https://a.test/robots.txt": 404,
    "https://c.test/robots.txt": { body: "User-agent: *\nDisallow: /private" },
    "GET https://a.test/home": { body: '<a href="/x">1</a><a href="/y">2</a><a href="/moved">3</a>' },
    "https://a.test/x": { status: 302, headers: { location: "https://c.test/private" } },
    "https://a.test/y": { status: 301, headers: { location: "https://c.test/private/2" } },
    "https://a.test/moved": { status: 308, headers: { location: "/new" } },
    "HEAD https://a.test/new": 200,
  });
  const result = await run(["https://a.test/home"], { fetchImpl: impl, ...clock, probePath: "/probe" });
  stop();
  assert.ok(calls.every((c) => !c.url.startsWith("https://c.test/private")), "c.test disallows /private");
  assert.ok(calls.every((c) => c.init?.redirect !== "follow"));
  assert.deepEqual(
    result.skipped.map((s) => [s.url, s.reason]),
    [
      ["https://a.test/x", "redirects to https://c.test/private, which robots.txt disallows"],
      ["https://a.test/y", "redirects to https://c.test/private/2, which robots.txt disallows"],
    ],
  );
  const moved = result.findings.find((f) => f.url === "https://a.test/moved");
  assert.equal(moved.verdict, "ok");
  assert.equal(moved.finalUrl, "https://a.test/new");
  assertSpaced(calls, () => 1000);
});

test("a redirect loop stops after 5 hops and is reported broken", async () => {
  const { clock, impl, calls, stop } = timed({
    "https://a.test/robots.txt": 404,
    "GET https://a.test/home": { body: '<a href="/loop">1</a>' },
    "https://a.test/loop": { status: 302, headers: { location: "/loop" } },
  });
  const result = await run(["https://a.test/home"], { fetchImpl: impl, ...clock, probePath: "/probe" });
  stop();
  const loop = result.findings.find((f) => f.url === "https://a.test/loop");
  assert.equal(loop.verdict, "broken");
  assert.equal(loop.status, "too many redirects");
  assert.ok(calls.filter((c) => c.url === "https://a.test/loop").length <= 12);
});

test("a HEAD that throws gets one GET before the link is called broken", async () => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(init.method);
    if (init.method === "HEAD") throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    return new Response("ok");
  };
  const r = await checkUrl("https://a.test/page", impl);
  assert.equal(r.verdict, "ok");
  assert.deepEqual(calls, ["HEAD", "GET"]);
});

test("robots.txt patterns are percent-encoded before matching (RFC 9309, 2.2.2)", () => {
  const r = robotsFor(parseRobots("User-agent: *\nDisallow: /café\nDisallow: /a%3cb"), "ziplime-link-check/1.0");
  assert.equal(isAllowed(r.rules, new URL("https://a.test/café/menu").pathname), false);
  assert.equal(isAllowed(r.rules, "/a%3Cb"), false, "hex case does not matter");
  assert.equal(isAllowed(r.rules, "/cafe"), true);
});

test("private, loopback and link-local addresses are never requested, directly or by redirect", async () => {
  const { clock, impl, calls, stop } = timed({
    "https://a.test/robots.txt": 404,
    "GET https://a.test/home": {
      body: [
        "http://169.254.169.254/latest/meta-data/",
        "http://127.0.0.1:8080/admin",
        "http://localhost/x",
        "http://10.1.2.3/",
        "http://192.168.0.1/",
        "http://172.20.0.1/",
        "http://[::1]/",
        "http://[fd00::1]/",
        "http://[fe80::1]/",
        "/hop",
      ]
        .map((h) => `<a href="${h}">x</a>`)
        .join(""),
    },
    "https://a.test/hop": { status: 302, headers: { location: "http://169.254.169.254/latest/" } },
  });
  const result = await run(["https://a.test/home"], { fetchImpl: impl, ...clock, probePath: "/probe" });
  stop();
  assert.deepEqual(calls.map((c) => new URL(c.url).host).filter((h) => h !== "a.test"), []);
  assert.equal(result.skipped.filter((s) => /private address/.test(s.reason)).length, 10);
});

test("guessMoved keeps tenants of a shared suffix apart", () => {
  assert.equal(guessMoved("https://limex.github.io/privacy", ["https://someone-else.github.io/legal/privacy"]), null);
  assert.equal(guessMoved("https://a.vercel.app/privacy", ["https://b.vercel.app/privacy-policy"]), null);
  assert.equal(guessMoved("https://www.example.co.uk/privacy", ["https://other.co.uk/privacy"]), null);
  assert.equal(guessMoved("https://www.example.co.uk/privacy", ["https://shop.example.co.uk/legal/privacy"]), "https://shop.example.co.uk/legal/privacy");
});

test("extractLinks reads a tag with > inside a quoted attribute", () => {
  const links = extractLinks(`<a title="2 > 1" href="/x">x</a><a data-x='a>b' href="/y">y</a>`, "https://a.test/");
  assert.deepEqual(links.map((l) => l.url), ["https://a.test/x", "https://a.test/y"]);
});

test("'Found on' follows the start page list, not which page answered first", async () => {
  let t = 0;
  const impl = async (url, init) => {
    const u = String(url);
    if (u === "https://a.test/robots.txt") {
      await new Promise((r) => setTimeout(r, 30)); // a.test answers late
      return new Response("", { status: 404 });
    }
    if (u.endsWith("/robots.txt")) return new Response("", { status: 404 });
    if (u.endsWith("/home")) return new Response('<a href="https://shared.test/page">x</a>');
    if (u === "https://shared.test/page" && init.method === "HEAD") return new Response(null, { status: 200 });
    return new Response("", { status: 404 });
  };
  const result = await run(["https://a.test/home", "https://b.test/home"], { fetchImpl: impl, now: () => t, sleep: async (ms) => void (t += ms), probePath: "/probe" });
  const f = result.findings.find((x) => x.url === "https://shared.test/page");
  assert.equal(f.page, "https://a.test/home");
  assert.deepEqual(f.pages, ["https://a.test/home", "https://b.test/home"]);
});

test("a robots.txt redirect is followed by hand, and never to a private address", async () => {
  const { impl, calls } = fakeFetch({
    "https://a.test/robots.txt": { status: 301, headers: { location: "https://b.test/robots.txt" } },
    "https://b.test/robots.txt": { body: "User-agent: *\nDisallow: /x" },
    "https://c.test/robots.txt": { status: 302, headers: { location: "http://127.0.0.1/robots.txt" } },
  });
  const a = await fetchRobots("https://a.test", impl);
  assert.equal(isAllowed(a.rules, "/x"), false);
  const hops = [];
  const c = await fetchRobots("https://c.test", impl, 1000, { beforeHop: async (u) => (hops.push(u), !u.includes("127.0.0.1")) });
  assert.equal(c.unreachable, true);
  assert.deepEqual(hops, ["https://c.test/robots.txt", "http://127.0.0.1/robots.txt"]);
  assert.ok(calls.every((x) => x.init.redirect === "manual" && !x.url.includes("127.0.0.1")));
});
