"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [uploads, setUploads] = useState<ParsedFile[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const skipSave = useRef(true);

  useEffect(() => {
    const saved = load();
    if (saved) dispatch({ type: "hydrate", state: saved });
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    save(state);
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
  }, []);

  const value = useMemo(
    () => ({ state, dispatch, uploads, addUpload, resetDemo, hydrated }),
    [state, uploads, addUpload, resetDemo, hydrated],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside StoreProvider");
  return store;
}
