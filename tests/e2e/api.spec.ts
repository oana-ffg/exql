import { test, expect, type APIRequestContext } from "@playwright/test";
import type {
  GridResult,
  Session,
  TableRequest,
  QueryResponse,
} from "../../src/types";

const headers = { "X-Exql-Client": "1" };
const connection = {
  server: "localhost",
  database: "ExqlDemo",
  authentication: "windows",
  encrypt: true,
  trustServerCertificate: true,
};
const tableRequest = (table = "WorkItems"): TableRequest => ({
  schema: "dbo",
  table,
  filters: [],
  match: "all",
  sort: null,
  descending: false,
  offset: 0,
  limit: 200,
});
let session: Session;
let api: APIRequestContext;
const url = (path: string) => `/api/sessions/${session.id}${path}`;
test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5274",
    extraHTTPHeaders: headers,
  });
  const response = await api.post("/api/connect", { data: connection });
  expect(response.ok(), await response.text()).toBeTruthy();
  session = await response.json();
});
test.afterAll(async () => {
  if (session) await api.delete(url(""));
  await api?.dispose();
});
async function page(body = tableRequest()): Promise<GridResult> {
  const response = await api.post(url("/table"), { data: body });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function query(sql: string): Promise<QueryResponse> {
  const response = await api.post(url("/query"), { data: { sql } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test("real catalog, pagination and complete table exports", async () => {
  expect(session.catalog).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "WorkItems" }),
      expect.objectContaining({ name: "OpenWorkItems", kind: "view" }),
    ]),
  );
  const first = await page();
  expect(first.rows).toHaveLength(200);
  expect(first.hasMore).toBe(true);
  const second = await page({ ...tableRequest(), offset: 200 });
  expect(second.rows).toHaveLength(45);
  expect(second.hasMore).toBe(false);
  const json = await api.post(url("/export"), {
    data: { table: tableRequest(), format: "json" },
  });
  expect((await json.json()).length).toBe(245);
  const csv = await api.post(url("/export"), {
    data: { table: tableRequest(), format: "csv" },
  });
  expect(await csv.text()).toContain("Pagination fixture 240");
  const view = await page(tableRequest("OpenWorkItems"));
  expect(view.columns.every((column) => !column.editable)).toBe(true);
});
test("AND, OR, NULL, parameterized values and rejected identifiers", async () => {
  const filtered = await page({
    ...tableRequest(),
    filters: [
      { column: "Status", operator: "=", value: "Open" },
      { column: "Priority", operator: "=", value: "1" },
    ],
  });
  expect(filtered.rows).toHaveLength(1);
  const any = await page({
    ...tableRequest(),
    match: "any",
    filters: [
      { column: "Status", operator: "=", value: "Done" },
      { column: "Priority", operator: "=", value: "3" },
    ],
  });
  expect(any.rows).toHaveLength(2);
  const nulls = await page({
    ...tableRequest(),
    filters: [{ column: "Estimate", operator: "is null", value: "" }],
  });
  expect(nulls.rows).toHaveLength(1);
  const escaped = await page({
    ...tableRequest(),
    filters: [{ column: "Title", operator: "contains", value: "%" }],
  });
  expect(escaped.rows).toHaveLength(0);
  const injection = await page({
    ...tableRequest(),
    filters: [{ column: "Status", operator: "=", value: "Open' OR 1=1--" }],
  });
  expect(injection.rows).toHaveLength(0);
  const bad = await api.post(url("/table"), {
    data: { ...tableRequest(), sort: "Id]; DROP TABLE x;--" },
  });
  expect(bad.status()).toBe(400);
});
test("exact SQL values survive the grid and exports", async () => {
  const unicode = await page({
    ...tableRequest(),
    filters: [{ column: "Id", operator: "=", value: "4" }],
  });
  expect(unicode.rows[0][1]).toBe("Unicode round trip — æøå 日本語");
  const data = await page(tableRequest("TypeSamples"));
  expect(data.rows[0]).toEqual(
    expect.arrayContaining([
      "9223372036854775807",
      "12345678901234567890.123456789012345678",
      "2026-09-08T12:34:56.1234567+02:00",
      "0x00FF1080",
      null,
      "",
    ]),
  );
  const output = await api.post(url("/export"), {
    data: { table: tableRequest("TypeSamples"), format: "json" },
  });
  const text = await output.text();
  expect(text).toContain("9223372036854775807");
  expect(text).toContain("12345678901234567890.123456789012345678");
  expect(
    data.columns.find((column) => column.name === "Derived")?.generated,
  ).toBe(true);
});
test("edits commit atomically and stale writes roll back the entire batch", async () => {
  const originalPage = await page();
  const original = (row: number) =>
    Object.fromEntries(
      originalPage.columns.map((column, i) => [
        column.name,
        originalPage.rows[row][i],
      ]),
    );
  const before = original(0);
  const other = original(1);
  const edit = (
    original: Record<string, string | null>,
    value: string | null,
  ) => ({ original, changes: [{ column: "Notes", value }] });
  try {
    const changed = await api.post(url("/edit"), {
      data: {
        schema: "dbo",
        table: "WorkItems",
        rows: [edit(before, "Test edit æøå ' \"\nline")],
      },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const conflict = await api.post(url("/edit"), {
      data: {
        schema: "dbo",
        table: "WorkItems",
        rows: [edit(other, "Must roll back"), edit(before, "Stale edit")],
      },
    });
    expect(conflict.status()).toBe(409);
    const current = await page();
    const index = current.columns.findIndex(
      (column) => column.name === "Notes",
    );
    expect(current.rows[0][index]).toBe("Test edit æøå ' \"\nline");
    expect(current.rows[1][index]).toBe(other.Notes);
    const refreshed = Object.fromEntries(
      current.columns.map((column, i) => [column.name, current.rows[0][i]]),
    );
    const nulled = await api.post(url("/edit"), {
      data: {
        schema: "dbo",
        table: "WorkItems",
        rows: [edit(refreshed, null)],
      },
    });
    expect(nulled.status(), await nulled.text()).toBe(200);
    expect((await page()).rows[0][index]).toBeNull();
  } finally {
    const current = await page();
    const refreshed = Object.fromEntries(
      current.columns.map((column, i) => [column.name, current.rows[0][i]]),
    );
    const restored = await api.post(url("/edit"), {
      data: {
        schema: "dbo",
        table: "WorkItems",
        rows: [edit(refreshed, before.Notes)],
      },
    });
    expect(restored.status(), await restored.text()).toBe(200);
  }
});
test("legacy date values survive an edit round trip through SQL Server", async () => {
  const request = tableRequest("TypeSamples");
  const before = await page(request);
  const row = (grid: GridResult) =>
    Object.fromEntries(
      grid.columns.map((column, i) => [column.name, grid.rows[0][i]]),
    );
  const original = row(before);
  expect(original.LegacyDateTime).toBe("2026-09-08T12:34:56.123");
  expect(original.LegacyMinuteTime).toBe("2026-09-08T12:34:00.000");
  expect(original.CalendarDate).toBe("2026-09-08");
  async function edit(
    current: Record<string, string | null>,
    value: string | null,
  ) {
    return api.post(url("/edit"), {
      data: {
        schema: "dbo",
        table: "TypeSamples",
        rows: [
          { original: current, changes: [{ column: "EmptyText", value }] },
        ],
      },
    });
  }
  try {
    // Optimistic concurrency uses all original values, including both legacy
    // date types. An over-precise string fails SQL datetime conversion here.
    const changed = await edit(original, "Legacy date round trip");
    expect(changed.status(), await changed.text()).toBe(200);
    const current = row(await page(request));
    expect(current.EmptyText).toBe("Legacy date round trip");
    expect(current.LegacyDateTime).toBe(original.LegacyDateTime);
    expect(current.LegacyMinuteTime).toBe(original.LegacyMinuteTime);
    expect(current.CalendarDate).toBe(original.CalendarDate);
  } finally {
    const restored = await edit(row(await page(request)), original.EmptyText);
    expect(restored.status(), await restored.text()).toBe(200);
  }
});
test("query results support multiple sets, pagination and export without re-execution", async () => {
  const before = await page({
    ...tableRequest(),
    filters: [{ column: "Id", operator: "=", value: "3" }],
  });
  const priority =
    before.rows[0][
      before.columns.findIndex((column) => column.name === "Priority")
    ]!;
  try {
    const response = await query(
      "UPDATE dbo.WorkItems SET Priority=Priority+1 WHERE Id=3; SELECT * FROM dbo.WorkItems ORDER BY Id; SELECT 1 AS Same, 2 AS Same, 3;",
    );
    expect(response.results).toHaveLength(2);
    expect(response.results[0].rowCount).toBe(245);
    expect(response.results[1].columns.map((column) => column.name)).toEqual([
      "Same",
      "Same (2)",
      "Column 3",
    ]);
    const resultPage = await api.get(
      url(`/results/${response.results[0].id}?offset=200`),
    );
    expect((await resultPage.json()).rows).toHaveLength(45);
    const exported = await api.post(url("/export"), {
      data: { resultId: response.results[0].id, format: "json" },
    });
    expect((await exported.json()).length).toBe(245);
    const current = await page({
      ...tableRequest(),
      filters: [{ column: "Id", operator: "=", value: "3" }],
    });
    expect(
      current.rows[0][
        current.columns.findIndex((column) => column.name === "Priority")
      ],
    ).toBe(String(Number(priority) + 1));
  } finally {
    await query(
      `UPDATE dbo.WorkItems SET Priority=${Number(priority)} WHERE Id=3;`,
    );
  }
});
test("the loopback API rejects cross-origin and missing-header requests", async () => {
  expect(
    (
      await api.get("/api/profiles", { headers: { "X-Exql-Client": "" } })
    ).status(),
  ).toBe(403);
  expect(
    (
      await api.get("/api/profiles", {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(403);
});
