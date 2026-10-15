// Every AI route, called the way a browser or curl would (pre-ship review, 14 Oct
// 2026). access.test.ts covers the helpers; this checks each route still calls them,
// before it reads the body and before it builds a Claude client.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATIC_DATASET as ds } from "@/lib/data/static";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

// Building a client is the line the gate must stop short of. No test here may reach it.
const constructed = vi.hoisted(() => ({ count: 0 }));
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    static APIError = class extends Error {};
    constructor() {
      constructed.count++;
      throw new Error("a Claude client was built");
    }
  }
  return { default: Anthropic };
});

const { POST: explain } = await import("./explain/route");
const { POST: draft } = await import("./draft/route");
const { POST: triage } = await import("./triage/route");
const { GET: aiStatus } = await import("./ai-status/route");

const account = ds.accounts[0];
const ROUTES = [
  { name: "explain", handler: explain, body: { reason: "some reason the console has no rule for" } },
  { name: "draft", handler: draft, body: { ticket: { accountId: account.id, subject: "Hi", messages: [{ from: "client", body: "Why?" }], links: [] } } },
  { name: "triage", handler: triage, body: { id: ds.signups[0].id } },
] as const;

const post = (body: unknown, headers: Record<string, string>) =>
  new Request("https://console.example/api/x", { method: "POST", headers, body: JSON.stringify(body) });
const SAME_ORIGIN_JSON = { "sec-fetch-site": "same-origin", "content-type": "application/json" };

beforeEach(() => {
  constructed.count = 0;
  vi.stubEnv("CONSOLE_DATA_MODE", "static");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-not-a-real-key");
  vi.stubEnv("ZIPLIME_ALLOW_PUBLIC_AI", "");
});
afterEach(() => vi.unstubAllEnvs());

describe.each(ROUTES)("POST /api/$name", ({ handler, body }) => {
  it("refuses another site with 403", async () => {
    const res = await handler(post(body, { "sec-fetch-site": "cross-site", "content-type": "application/json" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cross_site" });
  });

  it("refuses a text/plain form post with 415", async () => {
    const res = await handler(post(body, { "sec-fetch-site": "same-origin", "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("stays off on the static demo on Vercel, with a key set", async () => {
    vi.stubEnv("VERCEL", "1");
    const res = await handler(post(body, SAME_ORIGIN_JSON));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/off on the public demo/);
    expect(constructed.count).toBe(0);
  });

  it("stays off on a static production build on another host, with a key set", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "production");
    const res = await handler(post(body, SAME_ORIGIN_JSON));
    expect(res.status).toBe(503);
    expect(constructed.count).toBe(0);
  });
});

describe("GET /api/ai-status", () => {
  it("says public_demo on a static production build with a key, and never returns the key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await aiStatus();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ enabled: false, model: null, reason: "public_demo" });
    expect(text).not.toContain("sk-ant");
  });
});
