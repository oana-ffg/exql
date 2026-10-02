import { useEffect, useRef, useState } from "react";
import { request } from "./api";

declare global {
  interface Window {
    exqlDirty?: boolean;
    exqlPendingWrites?: number;
    exqlStorageFailed?: boolean;
    exqlWorkspaceReady?: boolean;
  }
}

// A failed save remains unsafe for restart until that key is successfully saved.
const failedSaves = new Set<string>();

// Disk-backed workspace state is independent of the desktop host's randomly assigned port.
export function useStored<T>(key: "scratch" | "library", fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const changed = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    const abort = new AbortController();
    request<{ value: T | null }>(`/workspace/${key}`, undefined, abort.signal)
      .then((stored) => {
        if (!changed.current && stored.value !== null) setValue(stored.value);
      })
      .catch((error) => {
        if (!abort.signal.aborted) report(error);
      });
    return () => abort.abort();
  }, [key]);
  function update(next: T) {
    changed.current = true;
    setValue(next);
    window.exqlPendingWrites = (window.exqlPendingWrites ?? 0) + 1;
    queue.current = queue.current
      .then(() => request(`/workspace/${key}`, next))
      .then(() => failedSaves.delete(key))
      .catch((error: Error) => {
        failedSaves.add(key);
        report(error);
      })
      .finally(() => {
        window.exqlStorageFailed = failedSaves.size > 0;
        window.exqlPendingWrites = (window.exqlPendingWrites ?? 1) - 1;
      });
  }
  return [value, update] as const;
}
function report(error: Error) {
  window.dispatchEvent(
    new CustomEvent("exql-storage-error", {
      detail: `Workspace could not be saved or loaded: ${error.message}`,
    }),
  );
}
