"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, useSyncExternalStore, type ReactNode } from "react";
import { useDataset } from "../data/DatasetProvider";
import type { Dataset } from "../data/types";
import type { ParsedFile } from "../dryrun/types";
import { DB_STORAGE_KEY, initialState, reducer, revive, STORAGE_KEY, type Action, type State } from "./state";

type Store = {
  state: State;
  dispatch: (action: Action) => void;
  /** Uploaded files stay in memory for this tab only. */
  uploads: ParsedFile[];
  addUpload: (file: ParsedFile) => void;
  resetDemo: () => void;
  hydrated: boolean;
};

const StoreContext = createContext<Store | null>(null);

function load(key: string): State | null {
  try {
    return revive(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

// Set while saved state differs from the seed. The inline script in layout.tsx
// reads it before the first paint: a server-rendered default view shows the
// seed, so for such a visitor it is swapped for a skeleton (DefaultView).
const CHANGED = ":changed";
const SEED_JSON = JSON.stringify(initialState());

function save(key: string, state: State) {
  try {
    const json = JSON.stringify(state);
    window.localStorage.setItem(key, json);
    if (json === SEED_JSON) window.localStorage.removeItem(key + CHANGED);
    else window.localStorage.setItem(key + CHANGED, "1");
  } catch {
    // Private mode or storage full: the demo still works, it just won't remember.
  }
}

type Box = { state: State; hydrated: boolean };
type BoxAction = Action | { type: "loaded"; saved: State | null };

// Wraps the pure reducer with whether saved state has been read yet. The
// server and the first client render both use the seed, so hydration matches.
function boxReducer(ds: Dataset, box: Box, action: BoxAction): Box {
  if (action.type === "loaded") return { state: action.saved ?? box.state, hydrated: true };
  return { ...box, state: reducer(box.state, action, ds) };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const ds = useDataset();
  const key = ds.source === "postgres" ? DB_STORAGE_KEY : STORAGE_KEY;
  // React calls the reducer from the latest render, so it always sees the current dataset.
  const [box, dispatchBox] = useReducer((b: Box, a: BoxAction) => boxReducer(ds, b, a), undefined, () => ({ state: initialState(), hydrated: false }));
  const { state, hydrated } = box;
  const dispatch = useCallback((action: Action) => dispatchBox(action), []);
  const [uploads, setUploads] = useState<ParsedFile[]>([]);

  useEffect(() => {
    dispatchBox({ type: "loaded", saved: load(key) });
  }, [key]);

  useEffect(() => {
    if (hydrated) save(key, state);
  }, [key, state, hydrated]);

  const addUpload = useCallback((file: ParsedFile) => {
    setUploads((list) => [...list.filter((f) => f.source !== file.source), file]);
  }, []);

  const resetDemo = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
      window.localStorage.removeItem(key + CHANGED);
    } catch {}
    setUploads([]);
    dispatch({ type: "reset" });
  }, [dispatch, key]);

  const value = useMemo(
    () => ({ state, dispatch, uploads, addUpload, resetDemo, hydrated }),
    [state, dispatch, uploads, addUpload, resetDemo, hydrated],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

const SEED_STATE = initialState();
const noop = () => () => {};

/**
 * False while this component is hydrating, true after. A Suspense boundary can
 * hydrate after saved state has loaded; reading the seed until then keeps its
 * first render identical to the server HTML.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside StoreProvider");
  const here = useHydrated();
  const seedView = useMemo(() => ({ ...store, state: SEED_STATE, hydrated: false }), [store]);
  return here ? store : seedView;
}
