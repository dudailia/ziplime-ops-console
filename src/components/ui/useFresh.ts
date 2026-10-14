"use client";

import { useState } from "react";

/**
 * True when `at` happened in the last few seconds as this component mounted:
 * an approval the visitor just made, not one restored from storage on a reload.
 */
export function useFresh(at: string | undefined, windowMs = 4000): boolean {
  const [fresh] = useState(() => (at ? Date.now() - Date.parse(at) < windowMs : false));
  return fresh;
}
