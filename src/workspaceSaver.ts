import { request } from "./api";

// A failed save remains unsafe for restart until that key is successfully saved.
const failedSaves = new Set<string>();

export function createWorkspaceSaver<T>(
  key: string,
  report: (error: Error) => void,
) {
  let pending: { value: T } | null = null;
  let saving = false;
  let scheduled = false;

  async function flush() {
    scheduled = false;
    saving = true;
    // Keep only the newest state while a write is in flight. Never abort a write:
    // it may already have reached disk, so replacements must remain ordered.
    while (pending) {
      const { value } = pending;
      pending = null;
      try {
        await request(`/workspace/${key}`, value);
        failedSaves.delete(key);
      } catch (error) {
        failedSaves.add(key);
        report(error as Error);
      } finally {
        window.exqlStorageFailed = failedSaves.size > 0;
      }
    }
    saving = false;
    window.exqlPendingWrites = (window.exqlPendingWrites ?? 1) - 1;
  }

  return (value: T) => {
    pending = { value };
    if (saving || scheduled) return;
    scheduled = true;
    // Count scheduled work immediately so closing/restarting cannot lose a draft.
    window.exqlPendingWrites = (window.exqlPendingWrites ?? 0) + 1;
    // A fixed window coalesces bursts without starving saves during continuous typing.
    setTimeout(() => void flush(), 250);
  };
}
