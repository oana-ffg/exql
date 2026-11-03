import { useEffect, useRef, useState } from "react";
import { request } from "./api";
import { createWorkspaceSaver } from "./workspaceSaver";

declare global {
  interface Window {
    exqlDirty?: boolean;
    exqlPendingWrites?: number;
    exqlStorageFailed?: boolean;
    exqlWorkspaceReady?: boolean;
  }
}

// Disk-backed workspace state is independent of the desktop host's randomly assigned port.
export function useStored<T>(
  key: "scratch" | "library" | "settings",
  fallback: T,
) {
  const [value, setValue] = useState<T>(fallback);
  const latest = useRef(value);
  const [ready, setReady] = useState(false);
  const saver = useRef<{ key: string; save: (value: T) => void } | null>(null);
  if (saver.current?.key !== key)
    saver.current = { key, save: createWorkspaceSaver<T>(key, report) };
  useEffect(() => {
    setReady(false);
    const abort = new AbortController();
    request<{ value: T | null }>(`/workspace/${key}`, undefined, abort.signal)
      .then((stored) => {
        if (abort.signal.aborted) return;
        latest.current = stored.value ?? fallback;
        setValue(latest.current);
        setReady(true);
      })
      .catch((error) => {
        if (!abort.signal.aborted) report(error);
      });
    return () => abort.abort();
  }, [key]);
  function update(change: T | ((current: T) => T)) {
    if (!ready) {
      report(
        new Error("Saved workspace has not loaded. Retry before editing."),
      );
      return;
    }
    const next =
      typeof change === "function"
        ? (change as (current: T) => T)(latest.current)
        : change;
    latest.current = next;
    setValue(next);
    saver.current!.save(next);
  }
  return [value, update, ready] as const;
}
function report(error: Error) {
  window.dispatchEvent(
    new CustomEvent("exql-storage-error", {
      detail: `Workspace could not be saved or loaded: ${error.message}`,
    }),
  );
}
