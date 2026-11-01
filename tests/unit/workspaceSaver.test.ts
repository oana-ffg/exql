import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWorkspaceSaver } from "../../src/workspaceSaver";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("coalesces a typing burst into one save of the latest large workspace", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const report = vi.fn();
  const save = createWorkspaceSaver("scratch", report);
  const drafts = Array.from({ length: 16 }, (_, i) => ({
    id: String(i),
    sql: "x".repeat(16384),
  }));
  for (let i = 0; i < 400; i++)
    save([...drafts, { id: "typing", sql: String(i) }]);
  expect(window.exqlPendingWrites).toBeGreaterThan(0);
  await vi.runAllTimersAsync();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(Buffer.byteLength(fetch.mock.calls[0][1].body)).toBe(262499);
  expect(JSON.parse(fetch.mock.calls[0][1].body).at(-1).sql).toBe("399");
  expect(window.exqlPendingWrites).toBe(0);
  expect(report).not.toHaveBeenCalled();
});

it("keeps one active request and only the newest pending state", async () => {
  const completions: Array<(value: Response) => void> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(
    () => new Promise<Response>((resolve) => completions.push(resolve)),
  );
  vi.stubGlobal("fetch", fetch);
  const save = createWorkspaceSaver("scratch", vi.fn());
  save("first");
  await vi.advanceTimersByTimeAsync(250);
  expect(fetch).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 400; i++) save(`pending-${i}`);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(window.exqlPendingWrites).toBe(1);
  completions[0](new Response(null, { status: 204 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toBe(
    "pending-399",
  );
  expect(window.exqlPendingWrites).toBe(1);
  completions[1](new Response(null, { status: 204 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(window.exqlPendingWrites).toBe(0);
});

it("reports failed saves and clears the restart block only after recovery", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("disk unavailable"))
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const report = vi.fn();
  const save = createWorkspaceSaver("scratch", report);
  save("first");
  await vi.runAllTimersAsync();
  expect(report).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ message: "disk unavailable" }),
  );
  expect(window.exqlStorageFailed).toBe(true);
  expect(window.exqlPendingWrites).toBe(0);
  const library = createWorkspaceSaver("library", vi.fn());
  library({ queries: [] });
  await vi.runAllTimersAsync();
  expect(window.exqlStorageFailed).toBe(true);
  save("recovered");
  expect(window.exqlStorageFailed).toBe(true);
  expect(window.exqlPendingWrites).toBe(1);
  await vi.runAllTimersAsync();
  expect(window.exqlStorageFailed).toBe(false);
  expect(window.exqlPendingWrites).toBe(0);
});

it("tracks scratch and library writes independently and does no idle writes", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const scratch = createWorkspaceSaver("scratch", vi.fn());
  const library = createWorkspaceSaver("library", vi.fn());
  scratch("SQL");
  library({ queries: [] });
  expect(window.exqlPendingWrites).toBe(2);
  await vi.runAllTimersAsync();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(window.exqlPendingWrites).toBe(0);
  await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
  expect(fetch).toHaveBeenCalledTimes(2);
});
