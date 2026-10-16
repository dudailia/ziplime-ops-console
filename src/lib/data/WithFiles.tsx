"use client";

import { use, useMemo, type ReactNode } from "react";
import { ProvideDataset, useDataset } from "./DatasetProvider";

// The dry-run files a subtree reads, loaded for it alone (15 Oct 2026). Every
// page used to carry all 14 files in its first JavaScript chunk. Now:
// - while the static build prerenders, the server reads them from the seed
//   synchronously, so nothing suspends and the HTML is complete in the first
//   flush (a server-side suspension streamed the page in later, and React
//   reveals streamed content on a ~300 ms throttle: a late largest paint);
// - in the browser, the files this subtree needs are fetched from
//   /seed/dryruns/<id>.jsonl (all of them at once from /seed/dryruns.json),
//   starting after the first paint so they never compete with it. There is deliberately no Suspense
//   boundary here: React outlines a boundary over ~12.8 KB of HTML into a
//   later, throttled reveal even when it is complete. Suspending during
//   hydration keeps the server HTML on screen, and a client-side navigation
//   is a transition, so the previous page stays until the files arrive;
// - in database mode the server already put every file in the dataset, so
//   there is nothing to load.

const loads = new Map<string, Promise<Record<string, string>>>();

/** A promise React's use() reads at once, without suspending. */
function fulfilled<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

/** Resolves after the next paint: a file fetch started earlier competed with the page's first paint. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function load(ids: readonly string[], all: boolean): Promise<Record<string, string>> {
  const key = ids.join(",");
  let p = loads.get(key);
  if (!p) {
    // The client build folds typeof window to "object" and drops this branch,
    // with the seed it requires: the files never enter the browser bundle
    // (e2e/payload.spec.ts checks every page's scripts).
    if (typeof window === "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { RAW } = require("../seed/files") as typeof import("../seed/files");
      return fulfilled(Object.fromEntries(ids.map((id) => [id, RAW[id] ?? ""])));
    }
    const get = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't load ${url} (HTTP ${res.status}).`);
      return res;
    };
    p = afterPaint().then(() =>
      all
        ? get("/seed/dryruns.json").then((res) => res.json() as Promise<Record<string, string>>)
        : Promise.all(ids.map(async (id) => [id, await (await get(`/seed/dryruns/${encodeURIComponent(id)}.jsonl`)).text()] as const)).then(
            Object.fromEntries,
          ),
    );
    // A failed fetch isn't kept, so the next render tries again.
    p.catch(() => loads.delete(key));
    loads.set(key, p);
  }
  return p;
}

type Props = { children: ReactNode } & ({ ids: readonly string[]; all?: never } | { all: true; ids?: never });

/** Renders `children` once the dataset holds the dry-run files of `ids`, or of every deployment with `all`. */
export function WithFiles({ ids, all, children }: Props) {
  const ds = useDataset();
  const wanted = all ? ds.deployments.map((d) => d.id) : ids;
  const missing = [...new Set(wanted)].filter((id) => typeof ds.files[id] !== "string").sort();
  if (missing.length === 0) return <>{children}</>;
  return (
    <Loaded ids={missing} all={Boolean(all)}>
      {children}
    </Loaded>
  );
}

function Loaded({ ids, all, children }: { ids: string[]; all: boolean; children: ReactNode }) {
  const ds = useDataset();
  const files = use(load(ids, all));
  // One object per dataset and set of files, so fileOf's parse cache (keyed by dataset) holds.
  const value = useMemo(() => ({ ...ds, files: { ...ds.files, ...files } }), [ds, files]);
  return <ProvideDataset value={value}>{children}</ProvideDataset>;
}
