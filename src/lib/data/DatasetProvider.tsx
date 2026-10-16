"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { STATIC_BASE } from "./staticBase";
import type { Dataset } from "./types";

const DatasetContext = createContext<Dataset>(STATIC_BASE);

/**
 * Hands every page the dataset. The static demo passes nothing and uses the
 * bundled seed without its dry-run files (STATIC_BASE); a page that reads
 * files wraps itself in WithFiles. Database mode passes what the server
 * loaded, files included, and pageFiles hands WithFiles null there.
 */
export function DatasetProvider({ dataset, children }: { dataset: Dataset | null; children: ReactNode }) {
  const value = dataset ?? STATIC_BASE;
  return (
    <DatasetContext.Provider value={value}>
      {value.source === "postgres" && <RefreshOnNavigate />}
      {children}
    </DatasetContext.Provider>
  );
}

// A layout doesn't re-render on client navigation, so the dataset it loaded
// would go stale. In database mode, each navigation asks the server again.
function RefreshOnNavigate() {
  const pathname = usePathname();
  const router = useRouter();
  // Compare the path itself: the router object can change after a refresh,
  // and refreshing on that would loop.
  const shown = useRef(pathname);
  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    router.refresh();
  }, [pathname, router]);
  return null;
}

export function useDataset(): Dataset {
  return useContext(DatasetContext);
}

/** The same dataset with more of it filled in, for one subtree (WithFiles). */
export function ProvideDataset({ value, children }: { value: Dataset; children: ReactNode }) {
  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}
