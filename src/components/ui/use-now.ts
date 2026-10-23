"use client";

import { useSyncExternalStore } from "react";

/**
 * Current time (ms) refreshed every `intervalMs`, rounded to the interval so snapshots are
 * stable. Returns `null` during server rendering / hydration to avoid mismatches.
 */
export function useNow(intervalMs = 1000): number | null {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, intervalMs);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => null,
  );
}
