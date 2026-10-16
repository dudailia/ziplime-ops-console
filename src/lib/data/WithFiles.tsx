"use client";

import { useMemo, type ReactNode } from "react";
import { ProvideDataset, useDataset } from "./DatasetProvider";

// The dry-run files a page reads, passed down from its server component
// (pageFiles) and merged into the dataset for that page (15 Oct 2026). Every
// page used to carry all 14 files in its first JavaScript chunk; now a page
// gets only its own, in its own payload. An earlier version fetched them in
// the browser after the first paint; the pre-ship review showed what that
// costs: hydration waited on the fetch, so clicks were lost, a failed fetch
// retried every frame, and a client navigation showed the wrong deployment
// until the file arrived (e2e/files.spec.ts). Props arrive with the page.

/** Renders `children` with `files` merged into the dataset. `null` (database mode) passes through. */
export function WithFiles({ files, children }: { files: Record<string, string> | null; children: ReactNode }) {
  const ds = useDataset();
  // One object per dataset and set of files, so fileOf's parse cache (keyed by dataset) holds.
  const value = useMemo(() => (files ? { ...ds, files: { ...ds.files, ...files } } : ds), [ds, files]);
  return files ? <ProvideDataset value={value}>{children}</ProvideDataset> : <>{children}</>;
}
