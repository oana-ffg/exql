import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DataGrid } from "../../src/DataGrid";
import type { Edit, GridResult } from "../../src/types";

it("indexes staged edits once rather than scanning them for every rendered cell", () => {
  const data: GridResult = {
    columns: Array.from({ length: 40 }, (_, i) => ({
      name: `c${i}`,
      type: "nvarchar",
      nullable: true,
      editable: true,
      primaryKey: false,
      generated: false,
    })),
    rows: Array.from({ length: 500 }, () =>
      Array.from({ length: 40 }, () => "original"),
    ),
    hasMore: false,
    total: 500,
  };
  let comparisons = 0;
  const edits: Edit[] = Array.from({ length: 1000 }, (_, i) => ({
    get row() {
      comparisons++;
      return i % 500;
    },
    column: `c${Math.floor(i / 500)}`,
    value: i === 0 ? null : i === 500 ? "" : `edited-${i}`,
  }));
  const html = renderToStaticMarkup(
    createElement(DataGrid, {
      data,
      edits,
      table: { schema: "dbo", name: "Example", kind: "table" },
      disabled: false,
      sort: null,
      descending: false,
      onEdit: vi.fn(),
      onSort: vi.fn(),
      onFilter: vi.fn(),
      onNotice: vi.fn(),
    }),
  );
  expect(html).toContain("edited-999");
  expect(html).toContain("original");
  expect(html).toContain('title="NULL"');
  expect(html).toContain('<i class="empty-value">empty</i>');
  expect((html.match(/class="[^"]*edited-cell/g) ?? []).length).toBe(1000);
  expect(comparisons).toBeLessThanOrEqual(edits.length);
});
