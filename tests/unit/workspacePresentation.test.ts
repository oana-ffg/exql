// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/Workspace";
import { download } from "../../src/api";
import type {
  GridResult,
  Library,
  QueryResponse,
  Session,
} from "../../src/types";

vi.mock("../../src/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api")>()),
  download: vi.fn(),
}));

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const session: Session = {
  id: "presentation",
  name: "Presentation",
  database: "Synthetic",
  server: "test",
  serverVersion: "test",
  profileId: null,
  color: null,
  catalog: [{ schema: "dbo", name: "Example", kind: "table" }],
};
const library: Library = {
  folders: [
    { id: "parent", name: "Parent" },
    { id: "child", name: "Child", parentId: "parent" },
  ],
  queries: [
    {
      id: "saved",
      name: "Saved query",
      folderId: "child",
      sql: "SELECT saved;",
    },
  ],
};
const page = (value: string): GridResult => ({
  columns: [
    {
      name: "Value",
      type: "nvarchar",
      nullable: true,
      editable: false,
      primaryKey: false,
      generated: false,
    },
  ],
  rows: [[value]],
  total: 1,
  hasMore: false,
});
function response(value: unknown) {
  return new Response(JSON.stringify(value));
}
async function render(sql = "SELECT draft;", onLibrary = vi.fn()) {
  function Parent() {
    const [text, setText] = useState(sql);
    const [queries, setQueries] = useState(library);
    return createElement(Workspace, {
      id: "presentation",
      active: true,
      closing: false,
      session,
      onSession: () => {},
      sql: text,
      setSql: setText,
      library: queries,
      scriptFolders: {
        folders: [],
        listings: {},
        adding: false,
        refresh: async () => {},
        addFromPicker: async () => {},
        remove: async () => {},
        sort: "name",
        setSort: () => {},
      },
      setLibrary: (change) => {
        onLibrary(change);
        setQueries(change);
      },
      savedConnection: null,
      reconnecting: false,
      reconnectError: "",
      onConnect: () => {},
      onChooseConnection: () => {},
      onActivity: () => {},
      onPaneResize: () => {},
      defaultTimeoutSeconds: 120,
    });
  }
  await import("../../src/SqlEditor");
  await act(async () => root.render(createElement(Parent)));
}
function button(text: string, scope: ParentNode = host) {
  const match = [...scope.querySelectorAll("button")].find((button) =>
    button.textContent?.trim().startsWith(text),
  );
  if (!match) throw new Error(`Button not found: ${text}`);
  return match;
}
async function click(text: string, scope: ParentNode = host) {
  await act(async () => button(text, scope).click());
}
async function select(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector("dialog form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

it("keeps results hidden until execution and shows statement counts and messages without a grid", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response({
        results: [],
        recordsAffected: 3,
        messages: ["Statement complete"],
      }),
    ),
  );
  await render();
  expect(host.querySelector(".results-pane")).toBeNull();
  await click("Run SQL");
  expect(host.querySelector(".results-heading")!.textContent).toContain(
    "3 rows affected",
  );
  expect(host.querySelector(".query-messages pre")!.textContent).toBe(
    "Statement complete",
  );
  expect(host.querySelector(".grid-scroll")).toBeNull();
  expect(host.querySelector(".results-heading")!.textContent).not.toContain(
    "Copy all as text",
  );
  expect(host.querySelector(".results-heading")!.textContent).not.toContain(
    "Export result",
  );
});

it("keeps partial results and messages visible and exports the selected result with a fresh dialog", async () => {
  const result: QueryResponse = {
    results: ["first", "second"].map((id) => ({
      id,
      rowCount: 1,
      columns: page(id).columns,
      page: page(id),
    })),
    recordsAffected: -1,
    messages: ["Before failure", "After first result"],
    error: "A later statement failed",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(result)),
  );
  await render();
  await click("Run SQL");
  expect(host.querySelector('[role="alert"]')!.textContent).toContain(
    result.error,
  );
  expect(host.querySelector(".query-messages pre")!.textContent).toBe(
    result.messages.join("\n"),
  );
  expect(host.querySelector('[data-cell="0:0"]')!.textContent).toBe("first");
  await click("Result 2");
  expect(host.querySelector('[data-cell="0:0"]')!.textContent).toBe("second");
  await click("Export result");
  expect(host.querySelector("dialog h2")!.textContent).toBe(
    "Export query result",
  );
  expect(host.querySelectorAll("dialog select")).toHaveLength(1);
  await select(host.querySelector("dialog select")!, "json");
  await submit();
  expect(download).toHaveBeenLastCalledWith(
    "/sessions/presentation/export",
    { resultId: "second", format: "json" },
    "query-result.json",
    expect.any(AbortSignal),
  );
  expect(host.querySelector("dialog")).toBeNull();
  await click("Export result");
  expect(host.querySelector<HTMLSelectElement>("dialog select")!.value).toBe(
    "csv",
  );
  await click("Cancel", host.querySelector("dialog")!);
  expect(download).toHaveBeenCalledTimes(1);
});

it("disables result actions while a new query runs and cancels through the workspace controller", async () => {
  let running = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init: RequestInit) => {
      if (!running)
        return response({
          results: [
            {
              id: "first",
              rowCount: 1,
              columns: page("first").columns,
              page: page("first"),
            },
          ],
          recordsAffected: -1,
          messages: [],
        });
      return new Promise<Response>((_resolve, reject) =>
        init.signal!.addEventListener("abort", () =>
          reject(new Error("Aborted")),
        ),
      );
    }),
  );
  await render();
  await click("Run SQL");
  running = true;
  await click("Run SQL");
  for (const action of host.querySelectorAll<HTMLButtonElement>(
    ".results-heading button",
  ))
    expect(action.disabled).toBe(true);
  await click("Cancel");
  expect(host.querySelector('[role="alert"]')!.textContent).toContain(
    "Operation cancelled.",
  );
  expect(button("Export result").disabled).toBe(false);
  expect(host.querySelector('[data-cell="0:0"]')!.textContent).toBe("first");
});

it("saves an existing query in its nested folder and discards cancelled dialog edits", async () => {
  const onLibrary = vi.fn();
  await render("", onLibrary);
  await click("SQL scripts");
  await click("Saved query");
  await click("Save query");
  expect(host.querySelector<HTMLInputElement>("dialog input")!.value).toBe(
    "Saved query",
  );
  expect(host.querySelector<HTMLSelectElement>("dialog select")!.value).toBe(
    "child",
  );
  expect(host.querySelector('dialog option[value="child"]')!.textContent).toBe(
    "Parent / Child",
  );
  await select(host.querySelector("dialog select")!, "");
  await click("Cancel", host.querySelector("dialog")!);
  expect(onLibrary).not.toHaveBeenCalled();
  await click("Save query");
  expect(host.querySelector<HTMLSelectElement>("dialog select")!.value).toBe(
    "child",
  );
  await submit();
  expect(onLibrary).toHaveBeenCalledExactlyOnceWith(library);
  expect(host.querySelector("dialog")).toBeNull();
  expect(host.querySelector(".banner.notice")!.textContent).toContain(
    "Query saved on this PC.",
  );
});

it("exports a table with the chosen format and applied filters, or all rows by default", async () => {
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) =>
    response(page("row")),
  );
  vi.stubGlobal("fetch", fetch);
  await render("");
  await click("Example");
  await act(async () =>
    host
      .querySelector<HTMLElement>('[data-cell="0:0"]')!
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
  );
  await click("Add filter for this value", document);
  await click("Apply filters");
  const request = JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string);
  expect(request.filters).toEqual([
    { column: "Value", operator: "=", value: "row" },
  ]);
  await click("Export");
  expect(host.querySelector("dialog h2")!.textContent).toBe("Export table");
  await submit();
  expect(download).toHaveBeenLastCalledWith(
    "/sessions/presentation/export",
    { table: { ...request, filters: [] }, format: "csv" },
    "Example.csv",
    expect.any(AbortSignal),
  );
  await click("Export");
  const selects = host.querySelectorAll<HTMLSelectElement>("dialog select");
  await select(selects[0], "json");
  await select(selects[1], "filtered");
  await submit();
  expect(download).toHaveBeenLastCalledWith(
    "/sessions/presentation/export",
    { table: request, format: "json" },
    "Example.json",
    expect.any(AbortSignal),
  );
});
