import { describe, expect, it } from "vitest";
import { aiAccess, aiRequestProblem } from "./access";

const KEY = "sk-ant-test";

describe("aiAccess", () => {
  it("is off without a key", () => {
    expect(aiAccess({})).toEqual({ enabled: false, reason: "no_key" });
    expect(aiAccess({ ANTHROPIC_API_KEY: "  " })).toEqual({ enabled: false, reason: "no_key" });
  });

  it("is on with a key on your own machine, static or database", () => {
    expect(aiAccess({ ANTHROPIC_API_KEY: KEY })).toEqual({ enabled: true });
    expect(aiAccess({ ANTHROPIC_API_KEY: KEY, CONSOLE_DATA_MODE: "database" })).toEqual({ enabled: true });
  });

  it("stays off on the public static demo even when someone adds a key", () => {
    expect(aiAccess({ ANTHROPIC_API_KEY: KEY, VERCEL: "1" })).toEqual({ enabled: false, reason: "public_demo" });
    expect(aiAccess({ ANTHROPIC_API_KEY: KEY, VERCEL: "1", CONSOLE_DATA_MODE: "static" })).toEqual({ enabled: false, reason: "public_demo" });
  });

  it("is on for a database deployment on Vercel, which sits behind Basic auth", () => {
    expect(aiAccess({ ANTHROPIC_API_KEY: KEY, VERCEL: "1", CONSOLE_DATA_MODE: "database" })).toEqual({ enabled: true });
  });

  it("can be opened on purpose, and only with the exact word", () => {
    expect(aiAccess({ ANTHROPIC_API_KEY: KEY, VERCEL: "1", ZIPLIME_ALLOW_PUBLIC_AI: "true" })).toEqual({ enabled: true });
    expect(aiAccess({ ANTHROPIC_API_KEY: KEY, VERCEL: "1", ZIPLIME_ALLOW_PUBLIC_AI: "1" }).enabled).toBe(false);
  });
});

describe("aiRequestProblem", () => {
  const req = (headers: Record<string, string>) => new Request("https://console.example/api/explain", { method: "POST", headers });

  it("accepts the console's own JSON fetch", () => {
    expect(aiRequestProblem(req({ "sec-fetch-site": "same-origin", "content-type": "application/json" }))).toBeNull();
  });

  it("refuses another site, and a form post dressed as text", () => {
    expect(aiRequestProblem(req({ "sec-fetch-site": "cross-site", "content-type": "application/json" }))).toEqual({ status: 403, error: "cross_site" });
    expect(aiRequestProblem(req({ "sec-fetch-site": "same-origin", "content-type": "text/plain" }))).toEqual({ status: 415, error: "json_only" });
  });

  it("refuses a request that says nothing about where it came from", () => {
    expect(aiRequestProblem(req({ "content-type": "application/json" }))?.status).toBe(403);
  });
});
