import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDryRun } from "./dryrun/parse";
import { combineHealth, deploymentHealth, tradingDaysBetween } from "./health";

const manifest = JSON.parse(readFileSync(new URL("../../data/seed/manifest.json", import.meta.url), "utf8"));
const cal = { asOf: manifest.asOf as string, tradingDays: manifest.sessions as string[] };
const seedHealth = (accountId: string) =>
  combineHealth(
    manifest.deployments
      .filter((d: { account: string }) => d.account === accountId)
      .map((d: { id: string; riskEnv: never; validateOrders: boolean }) =>
        deploymentHealth(
          parseDryRun(readFileSync(new URL(`../../data/seed/dryruns/${d.id}.jsonl`, import.meta.url), "utf8"), d.id),
          { riskEnv: d.riskEnv, validateOrders: d.validateOrders },
          cal,
          d.id,
        ),
      ),
  );

// Builds a file with one session per entry: [places, refusals, brokerRefusals].
function file(sessions: [number, number, number?][], days = cal.tradingDays.slice(-sessions.length), extra = "") {
  const lines: string[] = [];
  sessions.forEach(([p, r, b = 0], i) => {
    const day = days[i];
    const common = { account: "LX***17", recorded_at: `${day}T15:00:00+00:00`, order_dt: `${day}T11:00:00-04:00`, symbol: "AAPL" };
    for (let k = 0; k < p; k++)
      lines.push(JSON.stringify({ ...common, event: "place", dry_run_id: `dryrun-${day}-${k}`, ziplime_order_id: `${day}-${k}`, client_order_id: `${day}-${k}`, requested_amount: 1, side: "buy", quantity: "1", order_type: "market", limit_price: null, time_in_force: "day", route: "auto", broker_validated: true }));
    for (let k = 0; k < r; k++)
      lines.push(JSON.stringify({ ...common, event: "refuse", ziplime_order_id: `${day}-r${k}`, requested_amount: 1, reason: "ValueError: Lime order notional exceeds the configured risk limit" }));
    for (let k = 0; k < b; k++)
      lines.push(JSON.stringify({ ...common, event: "refuse", ziplime_order_id: `${day}-b${k}`, requested_amount: 1, reason: "ValueError: Lime rejected order during validation: insufficient buying power" }));
  });
  return parseDryRun(lines.join("\n") + "\n" + extra, "f");
}

describe("deploymentHealth boundaries", () => {
  it("is grey with no sessions", () => {
    expect(deploymentHealth(parseDryRun("", "f"), null, cal).level).toBe("grey");
  });

  it("is green under 5% refused", () => {
    expect(deploymentHealth(file([[20, 1]]), null, cal).level).toBe("green"); // 1/21 = 4.8%
  });

  it("turns amber at 5% and red at 20%", () => {
    expect(deploymentHealth(file([[19, 1]]), null, cal).level).toBe("amber"); // 5%
    expect(deploymentHealth(file([[41, 9]]), null, cal).level).toBe("amber"); // 18%
    expect(deploymentHealth(file([[4, 1]]), null, cal).level).toBe("red"); // 20%
  });

  it("counts broker-validation refusals: 1 is amber, 2 is red", () => {
    expect(deploymentHealth(file([[40, 0, 1]]), null, cal).level).toBe("amber");
    const two = deploymentHealth(file([[60, 0, 2]]), null, cal);
    expect(two.level).toBe("red");
    expect(two.reasons[0].text).toBe("Lime rejected 2 orders in pre-trade validation");
  });

  it("only looks at the last 5 sessions", () => {
    const old = file([[1, 9], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0]], cal.tradingDays.slice(-6));
    expect(deploymentHealth(old, null, cal).level).toBe("green");
  });

  it("turns amber when the last session is more than 3 trading days old", () => {
    const days = cal.tradingDays;
    expect(deploymentHealth(file([[5, 0]], [days[days.length - 4]]), null, cal).level).toBe("green"); // 3 days
    const stale = deploymentHealth(file([[5, 0]], [days[days.length - 5]]), null, cal); // 4 days
    expect(stale.level).toBe("amber");
    expect(stale.reasons[0].text).toBe("No dry run for 4 trading days");
  });

  it("turns amber, not red, for a reason with no built-in explanation", () => {
    const day = cal.asOf;
    const odd = JSON.stringify({ account: "LX***17", event: "refuse", recorded_at: `${day}T15:00:00+00:00`, order_dt: `${day}T11:00:00-04:00`, symbol: "AAPL", ziplime_order_id: "x", requested_amount: 1, reason: "ConnectionError: reset by peer" });
    const h = deploymentHealth(file([[40, 0]], [day], odd + "\n"), null, cal);
    expect(h.level).toBe("amber");
    expect(h.reasons.map((r) => r.text)).toContain("1 refusal with no built-in explanation");
  });
});

describe("tradingDaysBetween", () => {
  it("uses the calendar, then falls back to weekdays", () => {
    expect(tradingDaysBetween("2026-10-05", "2026-10-12", cal.tradingDays)).toBe(5);
    expect(tradingDaysBetween("2026-10-16", "2026-10-19", cal.tradingDays)).toBe(1);
  });
});

describe("health of the seeded accounts", () => {
  it.each([
    ["harbor-lane", "green"],
    ["priya-raman", "red"],
    ["tomas-ibarra", "red"],
    ["wen-li", "red"],
    ["greta-lindqvist", "amber"],
    ["kofi-mensah", "green"],
    ["sofia-marchetti", "red"],
    ["aaron-feld", "amber"],
    ["nadia-haddad", "red"],
    ["jonas-weber", "amber"],
  ])("%s is %s", (id, level) => {
    expect(seedHealth(id).level).toBe(level);
  });

  it("explains Kofi's skips as benign: green despite 23 skips", () => {
    expect(seedHealth("kofi-mensah").reasons[0].level).toBe("green");
  });
});

describe("front door numbers", async () => {
  const { frontDoorNumbers } = await import("./crm");
  const { STATIC_DATASET } = await import("./data/static");
  it("counts orders, refusals and accounts that need help from the seed", () => {
    expect(frontDoorNumbers(STATIC_DATASET)).toEqual({
      orders: 487,
      sessions: 135,
      deployments: 14,
      refused: 69,
      explained: 68,
      needHelp: 5,
      accounts: 10,
    });
  });
});

describe("deploymentHealth and the engine's float-noise skips", () => {
  it("stays green when a rebalance leaves a skip like 2.27374e-13 shares", () => {
    const day = cal.tradingDays.at(-1)!;
    const skip = JSON.stringify({
      account: "LX***17", event: "skip", order_dt: `${day}T11:05:00-04:00`, recorded_at: `${day}T15:05:00+00:00`,
      symbol: "SPY", ziplime_order_id: "noise-1", requested_amount: 2.27374e-13,
      reason: "2.27374e-13 SPY is below one lot (1 share); order not sent",
    });
    const h = deploymentHealth(file([[4, 0], [4, 0], [4, 0], [4, 0], [4, 0]], undefined, skip + "\n"), null, cal);
    expect(h.level).toBe("green");
  });
});
