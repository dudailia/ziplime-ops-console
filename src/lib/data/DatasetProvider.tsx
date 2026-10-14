"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { STATIC_DATASET } from "./static";
import type { Dataset } from "./types";

const DatasetContext = createContext<Dataset>(STATIC_DATASET);

/**
 * Hands every page the dataset. The static demo passes nothing and uses the
 * bundled seed, so its HTML and bundle are what they always were. Database
 * mode passes what the server loaded.
 */
export function DatasetProvider({ dataset, children }: { dataset: Dataset | null; children: ReactNode }) {
  const value = dataset ?? STATIC_DATASET;
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
