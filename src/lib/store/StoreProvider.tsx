"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { ParsedFile } from "../dryrun/types";
import { initialState, reducer, revive, STORAGE_KEY, type Action, type State } from "./state";

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

function load(): State | null {
  try {
    return revive(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function save(state: State) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or storage full: the demo still works, it just won't remember.
  }
}

type Box = { state: State; hydrated: boolean };
type BoxAction = Action | { type: "loaded"; saved: State | null };

// Wraps the pure reducer with whether saved state has been read yet. The
// server and the first client render both use the seed, so hydration matches.
function boxReducer(box: Box, action: BoxAction): Box {
  if (action.type === "loaded") return { state: action.saved ?? box.state, hydrated: true };
  return { ...box, state: reducer(box.state, action) };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [box, dispatchBox] = useReducer(boxReducer, undefined, () => ({ state: initialState(), hydrated: false }));
  const { state, hydrated } = box;
  const dispatch = useCallback((action: Action) => dispatchBox(action), []);
  const [uploads, setUploads] = useState<ParsedFile[]>([]);

  useEffect(() => {
    dispatchBox({ type: "loaded", saved: load() });
  }, []);

  useEffect(() => {
    if (hydrated) save(state);
  }, [state, hydrated]);

  const addUpload = useCallback((file: ParsedFile) => {
    setUploads((list) => [...list.filter((f) => f.source !== file.source), file]);
  }, []);

  const resetDemo = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setUploads([]);
    dispatch({ type: "reset" });
  }, [dispatch]);

  const value = useMemo(
    () => ({ state, dispatch, uploads, addUpload, resetDemo, hydrated }),
    [state, dispatch, uploads, addUpload, resetDemo, hydrated],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside StoreProvider");
  return store;
}
