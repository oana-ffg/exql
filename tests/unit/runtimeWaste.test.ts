// @vitest-environment jsdom
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../../src/App";
import { DataGrid } from "../../src/DataGrid";
import { Workspace } from "../../src/Workspace";
import type { ScriptFoldersState } from "../../src/scriptFolders";
import type { GridResult, Session } from "../../src/types";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const noop = () => {};
const library = { folders: [], queries: [] };
const folders: ScriptFoldersState = {
  folders: [],
  listings: {},
  refresh: async () => {},
  adding: false,
  addFromPicker: async () => {},
  remove: async () => {},
};
function grid(rows = 200, columns = 10): GridResult {
  return {
    columns: Array.from({ length: columns }, (_, i) => ({
      name: `c${i}`,
      type: "nvarchar",
      nullable: true,
      editable: true,
      primaryKey: i === 0,
      generated: false,
    })),
    rows: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, col) => `${row}:${col}`),
    ),
    hasMore: false,
    total: rows,
  };
}
function response(value: unknown) {
  // Retain fixture identity so rows.map can count executions of the real grid body.
  return { ok: true, status: 200, json: async () => value } as Response;
}
function button(scope: ParentNode, text: string) {
  const found = [...scope.querySelectorAll("button")].find((button) =>
    button.textContent?.trim().startsWith(text),
  );
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
async function click(scope: ParentNode, text: string) {
  await act(async () => button(scope, text).click());
}
function session(id: string): Session {
  return {
    id,
    name: id,
    database: "Synthetic",
    server: "test",
    serverVersion: "test",
    profileId: null,
    color: null,
    catalog: [{ schema: "dbo", name: "Example", kind: "table" }],
  };
}

it("does not render an unchanged grid when unrelated parent state changes", async () => {
  const data = grid(500, 40);
  const renders = vi.spyOn(data.rows, "map");
  const props = {
    data,
    table: null,
    edits: [],
    onEdit: noop,
    sort: null,
    descending: false,
    onSort: noop,
    onFilter: noop,
    onNotice: noop,
    disabled: false,
  };
  function Parent() {
    const [tick, setTick] = useState(0);
    return createElement(
      Fragment,
      null,
      createElement(
        "button",
        { onClick: () => setTick((value) => value + 1) },
        `Tick ${tick}`,
      ),
      createElement(DataGrid, props),
    );
  }
  await act(async () => root.render(createElement(Parent)));
  for (let i = 0; i < 12; i++) await click(host, "Tick");
  expect(renders).toHaveBeenCalledTimes(1);
  // The grid must still respond to its own state changes through memo.
  await act(async () =>
    host.querySelector<HTMLElement>('[data-cell="1:1"]')!.click(),
  );
  expect(host.querySelector('[data-cell="1:1"]')!.className).toContain(
    "active-cell",
  );
});

it("keeps visible and hidden Workspace grids out of real CodeMirror typing and selection updates", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await import("../../src/SqlEditor");
  const pages = [grid(), grid()];
  const renders = pages.map((page) => vi.spyOn(page.rows, "map"));
  const sessions = [session("first"), session("second")];
  const drafts = sessions.map((session, i) => ({
    id: session.id,
    name: session.name,
    profileId: session.id,
    sql: `SELECT '${i === 0 ? "first" : "second"}';`,
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/workspace/") && init?.method === "POST")
        return new Response(null, { status: 204 });
      if (path === "/api/workspace/settings") return response({ value: null });
      if (path === "/api/workspace/scratch") return response({ value: drafts });
      if (path === "/api/workspace/library")
        return response({ value: library });
      if (path === "/api/script-folders") return response([]);
      if (path === "/api/profiles")
        return response(
          sessions.map((session) => ({
            id: session.id,
            name: session.name,
            color: "#89b4fa",
            folder: "Tests",
            connection: {
              server: "test",
              database: "Synthetic",
              authentication: "windows",
              username: "",
              password: null,
              encrypt: true,
              trustServerCertificate: false,
            },
          })),
        );
      const index = path.includes("first") ? 0 : 1;
      if (path.endsWith("/connect")) return response(sessions[index]);
      if (path.endsWith("/query"))
        return response({
          results: [
            {
              id: "result",
              columns: pages[index].columns,
              rowCount: 200,
              page: pages[index],
            },
          ],
          recordsAffected: 0,
          messages: [],
        });
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  await act(async () => root.render(createElement(App)));
  const workspaces = [
    ...host.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
  ];
  for (const workspace of workspaces) await click(workspace, "Run SQL");
  expect(workspaces[1].hidden).toBe(true);
  const view = EditorView.findFromDOM(
    workspaces[0].querySelector<HTMLElement>(".cm-editor")!,
  )!;
  expect(view).toBeTruthy();
  const before = renders.map((render) => render.mock.calls.length);
  for (let i = 0; i < 12; i++)
    await act(async () =>
      view.dispatch({ changes: { from: view.state.doc.length, insert: "x" } }),
    );
  const typing = renders.map(
    (render, i) => render.mock.calls.length - before[i],
  );
  const beforeSelection = renders.map((render) => render.mock.calls.length);
  for (let i = 1; i <= 12; i++)
    await act(async () => view.dispatch({ selection: { anchor: 0, head: i } }));
  const selection = renders.map(
    (render, i) => render.mock.calls.length - beforeSelection[i],
  );
  expect(view.state.doc.toString()).toBe("SELECT 'first';xxxxxxxxxxxx");
  expect(button(workspaces[0], "Run selection")).toBeTruthy();
  expect(typing).toEqual([0, 0]);
  expect(selection).toEqual([0, 0]);
  // Finish the real App save queue before restoring the mocked fetch.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}, 30_000);

it("refreshes script listings on focus only for the visible scripts panel", async () => {
  const linked = Array.from({ length: 3 }, (_, i) => ({
    id: String(i),
    name: `Scripts ${i}`,
    path: `C:\\scripts-${i}`,
  }));
  const fetch = vi.fn(async (path: string) => {
    if (path === "/api/workspace/settings") return response({ value: null });
    if (path === "/api/workspace/scratch")
      return response({
        value: [
          { id: "one", name: "One", sql: "" },
          { id: "two", name: "Two", sql: "" },
        ],
      });
    if (path === "/api/workspace/library") return response({ value: library });
    if (path === "/api/script-folders") return response(linked);
    if (path.endsWith("/scripts"))
      return response({ scripts: [], truncated: false, unreadable: [] });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(createElement(App)));
  fetch.mockClear();
  for (let i = 0; i < 12; i++)
    await act(async () => window.dispatchEvent(new Event("focus")));
  const closedRequests = fetch.mock.calls.length;
  const workspaces = [
    ...host.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
  ];
  await click(workspaces[0], "SQL scripts");
  expect(fetch).toHaveBeenCalledTimes(closedRequests + 4);
  fetch.mockClear();
  await act(async () => window.dispatchEvent(new Event("focus")));
  const visibleRequests = fetch.mock.calls.length;
  await act(async () =>
    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click(),
  );
  expect(workspaces[0].hidden).toBe(true);
  fetch.mockClear();
  await act(async () => window.dispatchEvent(new Event("focus")));
  const hiddenRequests = fetch.mock.calls.length;
  expect(closedRequests).toBe(0);
  expect(visibleRequests).toBe(4);
  expect(hiddenRequests).toBe(0);
  await click(workspaces[1], "SQL scripts");
  fetch.mockClear();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(fetch).toHaveBeenCalledTimes(4);
  await click(workspaces[1], "Database");
  fetch.mockClear();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(fetch).not.toHaveBeenCalled();
});

async function cellMenu(row: number, col: number, action: string) {
  await act(async () =>
    host
      .querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)!
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
  );
  await click(document, action);
}

it("grid callbacks keep current rows, edits, filters, sort direction, and session", async () => {
  const initial = grid(2, 2);
  const updated = grid(2, 2);
  updated.rows = [
    ["new:0", "new:1"],
    ["new:2", "new:3"],
  ];
  let complete: (() => void) | undefined;
  let hold = false;
  const fetch = vi.fn(async (path: string, _init?: RequestInit) => {
    if (!path.endsWith("/table"))
      throw new Error(`Unexpected request: ${path}`);
    const page = fetch.mock.calls.length === 1 ? initial : updated;
    if (hold)
      return new Promise<Response>((resolve) => {
        complete = () => resolve(response(page));
      });
    return response(page);
  });
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  function Parent() {
    const [connection, setConnection] = useState(session("first"));
    return createElement(
      Fragment,
      null,
      createElement(
        "button",
        { onClick: () => setConnection(session("second")) },
        "Switch session",
      ),
      createElement(Workspace, {
        id: "table",
        active: true,
        closing: false,
        session: connection,
        onSession: noop,
        sql: "",
        setSql: noop,
        library,
        scriptFolders: folders,
        setLibrary: noop,
        savedConnection: null,
        reconnecting: false,
        reconnectError: "",
        onConnect: noop,
        onChooseConnection: noop,
        onActivity: noop,
        onPaneResize: noop,
        defaultTimeoutSeconds: 120,
      }),
    );
  }
  await act(async () => root.render(createElement(Parent)));
  await click(host.querySelector("aside")!, "Example");
  await click(host.querySelector(".grid-scroll thead")!, "c1");
  expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string)).toMatchObject(
    { sort: "c1", descending: false },
  );
  expect(host.querySelector('[data-cell="0:1"]')!.textContent).toBe("new:1");
  await cellMenu(0, 1, "Set cell to NULL");
  await cellMenu(1, 1, "Set cell to NULL");
  expect(host.querySelectorAll(".edited-cell").length).toBe(2);
  await cellMenu(0, 1, "Revert cell edit");
  expect(host.querySelectorAll(".edited-cell").length).toBe(1);
  await cellMenu(1, 1, "Revert cell edit");
  expect(host.querySelector(".edit-bar")).toBeNull();
  await cellMenu(0, 1, "Add filter for this value");
  await cellMenu(1, 1, "Add filter for this value");
  expect(host.querySelectorAll(".filter-condition").length).toBe(2);
  await click(host, "Apply filters");
  const filters = [
    { column: "c1", operator: "=", value: "new:1" },
    { column: "c1", operator: "=", value: "new:3" },
  ];
  expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string)).toMatchObject(
    { filters },
  );
  await click(host, "Switch session");
  hold = true;
  await click(host.querySelector(".grid-scroll thead")!, "c1");
  expect(
    host.querySelector<HTMLButtonElement>(".grid-tools button")!.disabled,
  ).toBe(true);
  await act(async () => complete!());
  expect(
    host.querySelector<HTMLButtonElement>(".grid-tools button")!.disabled,
  ).toBe(false);
  expect(fetch.mock.calls.at(-1)![0]).toBe("/api/sessions/second/table");
  expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string)).toMatchObject(
    { sort: "c1", descending: true, filters },
  );
  await cellMenu(0, 1, "Set cell to NULL");
  vi.mocked(window.confirm).mockReturnValue(false);
  const requests = fetch.mock.calls.length;
  await click(host.querySelector(".grid-scroll thead")!, "c1");
  expect(window.confirm).toHaveBeenCalledWith(
    "Discard your unsaved cell edits?",
  );
  expect(fetch).toHaveBeenCalledTimes(requests);
  expect(host.querySelectorAll(".edited-cell").length).toBe(1);
});
