// Plan names and prices, exactly as the live limex.com pricing section showed
// them on 2026-10-13 at 15:03 ET (bundle PricingV2-BxfS9ZEr.js). Only Beta is
// open; the other tiers are locked and have no published price. Change them
// here and nowhere else.

export type PlanKey = "beta" | "bronze" | "silver" | "gold";

export type Plan = {
  key: PlanKey;
  name: string;
  /** null: no published price. Never fill one in. */
  priceLabel: string | null;
  locked: boolean;
  status: string;
  features: readonly string[];
};

export const PLANS: readonly Plan[] = [
  {
    key: "beta",
    name: "Beta",
    priceLabel: "$0",
    locked: false,
    status: "Open",
    features: ["Full access during the US beta", "No card required"],
  },
  { key: "bronze", name: "Bronze", priceLabel: null, locked: true, status: "Coming soon. Available after beta", features: [] },
  { key: "silver", name: "Silver", priceLabel: null, locked: true, status: "Coming soon. Available after beta", features: [] },
  { key: "gold", name: "Gold", priceLabel: null, locked: true, status: "Coming soon. Available after beta", features: [] },
];

export const PLANS_SOURCE = {
  url: "https://limex.com/#pricing",
  checkedAt: "2026-10-13T15:03:00-04:00",
} as const;

export function planByKey(key: PlanKey): Plan {
  const plan = PLANS.find((p) => p.key === key);
  if (!plan) throw new Error(`Unknown plan ${key}`);
  return plan;
}
