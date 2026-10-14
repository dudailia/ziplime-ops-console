import { afterEach, describe, expect, it } from "vitest";
import { basicAuthUser, checkOpsWrite, sameOrigin } from "./auth";

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("basic auth", () => {
  it("accepts the right password and returns the user name", () => {
    expect(basicAuthUser(basic("dana", "s3cret:with:colons"), "s3cret:with:colons")).toBe("dana");
    expect(basicAuthUser(basic("", "pw"), "pw")).toBe("ops");
  });

  it("refuses a wrong password, a malformed header and an empty configured password", () => {
    expect(basicAuthUser(basic("dana", "nope"), "pw")).toBeNull();
    expect(basicAuthUser("Bearer abc", "pw")).toBeNull();
    expect(basicAuthUser("Basic !!!", "pw")).toBeNull();
    expect(basicAuthUser(`Basic ${Buffer.from("nocolon").toString("base64")}`, "pw")).toBeNull();
    expect(basicAuthUser(null, "pw")).toBeNull();
    expect(basicAuthUser(basic("dana", ""), "")).toBeNull();
  });
});

describe("same origin", () => {
  const req = (headers: Record<string, string>) => new Request("http://console.test/api/ops/x", { method: "POST", headers });

  it("trusts Sec-Fetch-Site first", () => {
    expect(sameOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameOrigin(req({ "sec-fetch-site": "cross-site", origin: "http://console.test" }))).toBe(false);
    expect(sameOrigin(req({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("falls back to Origin, and refuses a request with neither", () => {
    expect(sameOrigin(req({ origin: "http://console.test" }))).toBe(true);
    expect(sameOrigin(req({ origin: "http://evil.test" }))).toBe(false);
    expect(sameOrigin(req({}))).toBe(false);
  });
});

describe("ops writes", () => {
  afterEach(() => {
    delete process.env.OPS_PASSWORD;
  });
  const req = (headers: Record<string, string>) => new Request("http://console.test/api/ops/x", { method: "POST", headers });
  const status = (r: ReturnType<typeof checkOpsWrite>) => (r.ok ? 200 : r.response.status);
  const good = { authorization: basic("dana", "pw"), "sec-fetch-site": "same-origin", "content-type": "application/json" };

  it("need a database build and a configured password", () => {
    process.env.OPS_PASSWORD = "pw";
    expect(status(checkOpsWrite(req(good), "static"))).toBe(503);
    delete process.env.OPS_PASSWORD;
    expect(status(checkOpsWrite(req(good), "database"))).toBe(503);
  });

  it("refuse no credentials, a cross-site request and a form post", () => {
    process.env.OPS_PASSWORD = "pw";
    expect(status(checkOpsWrite(req({ ...good, authorization: basic("dana", "x") }), "database"))).toBe(401);
    expect(status(checkOpsWrite(req({ ...good, "sec-fetch-site": "cross-site" }), "database"))).toBe(403);
    expect(status(checkOpsWrite(req({ ...good, "content-type": "application/x-www-form-urlencoded" }), "database"))).toBe(415);
    expect(checkOpsWrite(req(good), "database")).toEqual({ ok: true, user: "dana" });
  });
});
