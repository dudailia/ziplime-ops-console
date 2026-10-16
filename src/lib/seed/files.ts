// The seed's dry-run files, the engine's own output (scripts/generate_seed.py).
// Server only: the static data source, the /seed/dryruns route and WithFiles'
// server branch import this. Kept out of the browser bundle (15 Oct 2026):
// every page used to download all 14 files before its first paint.

import harborMomentum from "../../../data/seed/dryruns/harbor-momentum.jsonl?raw";
import harborEtfCore from "../../../data/seed/dryruns/harbor-etf-core.jsonl?raw";
import priyaGrowth from "../../../data/seed/dryruns/priya-growth.jsonl?raw";
import tomasMeanrev from "../../../data/seed/dryruns/tomas-meanrev.jsonl?raw";
import tomasPairs from "../../../data/seed/dryruns/tomas-pairs.jsonl?raw";
import wenRebalance from "../../../data/seed/dryruns/wen-rebalance.jsonl?raw";
import gretaSector from "../../../data/seed/dryruns/greta-sector.jsonl?raw";
import kofiRebal from "../../../data/seed/dryruns/kofi-rebal.jsonl?raw";
import sofiaSwing from "../../../data/seed/dryruns/sofia-swing.jsonl?raw";
import aaronTrend from "../../../data/seed/dryruns/aaron-trend.jsonl?raw";
import nadiaIntraday from "../../../data/seed/dryruns/nadia-intraday.jsonl?raw";
import nadiaIndexTest from "../../../data/seed/dryruns/nadia-index-test.jsonl?raw";
import jonasBreakout from "../../../data/seed/dryruns/jonas-breakout.jsonl?raw";
import jonasEtf from "../../../data/seed/dryruns/jonas-etf.jsonl?raw";

// One static import per seed file. A test checks this list against the manifest.
export const RAW: Record<string, string> = {
  "harbor-momentum": harborMomentum,
  "harbor-etf-core": harborEtfCore,
  "priya-growth": priyaGrowth,
  "tomas-meanrev": tomasMeanrev,
  "tomas-pairs": tomasPairs,
  "wen-rebalance": wenRebalance,
  "greta-sector": gretaSector,
  "kofi-rebal": kofiRebal,
  "sofia-swing": sofiaSwing,
  "aaron-trend": aaronTrend,
  "nadia-intraday": nadiaIntraday,
  "nadia-index-test": nadiaIndexTest,
  "jonas-breakout": jonasBreakout,
  "jonas-etf": jonasEtf,
};

