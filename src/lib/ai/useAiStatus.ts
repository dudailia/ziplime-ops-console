"use client";

import { useEffect, useState } from "react";

export type AiStatus = { enabled: boolean; model: string | null } | null;

let cached: Promise<AiStatus> | null = null;

function fetchStatus(): Promise<AiStatus> {
  cached ??= fetch("/api/ai-status")
    .then((r) => (r.ok ? (r.json() as Promise<AiStatus>) : { enabled: false, model: null }))
    .catch(() => ({ enabled: false, model: null }));
  return cached;
}

/** null while loading. */
export function useAiStatus(): AiStatus {
  const [status, setStatus] = useState<AiStatus>(null);
  useEffect(() => {
    let live = true;
    fetchStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);
  return status;
}
