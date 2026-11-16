import { describe, expect, test } from "vitest";
import { jsonRows } from "../../src/format";
import { structureGrid } from "../../src/structure";
import type { StructureColumn } from "../../src/types";

const column = (
  name: string,
  properties: StructureColumn["properties"] = [],
): StructureColumn => ({
  name,
  type: "nvarchar(50)",
  nullable: true,
  primaryKey: false,
  identity: null,
  default: null,
  computed: null,
  collation: "Latin1_General_CI_AS",
  properties,
});
const leading = ["Column", "Data type", "Nullable", "Primary key"];
const trailing = ["Identity", "Default", "Computed", "Collation"];
const properties = (row: unknown[]) => row.slice(4, -4);

describe("structure grid", () => {
  test("MS_Description always comes first, then the other properties by name", () => {
    const grid = structureGrid({
      columns: [
        column("Id", [{ name: "zeta", value: "z" }]),
        column("Title", [
          { name: "MS_Description", value: "The title" },
          { name: "Alpha", value: "" },
        ]),
      ],
      properties: [],
    });
    expect(grid.columns.map((c) => c.name)).toEqual([
      ...leading,
      "MS_Description",
      "Alpha",
      "zeta",
      ...trailing,
    ]);
    // NULL is a missing property; an empty value is kept as empty.
    expect(grid.rows.map(properties)).toEqual([
      [null, null, "z"],
      ["The title", "", null],
    ]);
    expect(grid.columns.every((c) => !c.editable)).toBe(true);
    expect(grid).toMatchObject({ hasMore: false, total: 2 });
  });

  test("columns keep their declared details", () => {
    const grid = structureGrid({
      columns: [
        {
          ...column("Id"),
          type: "int",
          nullable: false,
          primaryKey: true,
          identity: "IDENTITY(1,1)",
          collation: null,
        },
        { ...column("Total"), computed: "([A]+[B]) PERSISTED" },
        { ...column("CreatedAt"), default: "(sysutcdatetime())" },
      ],
      properties: [],
    });
    expect(grid.rows).toEqual([
      ["Id", "int", "false", "true", null, "IDENTITY(1,1)", null, null, null],
      [
        "Total",
        "nvarchar(50)",
        "true",
        "false",
        null,
        null,
        null,
        "([A]+[B]) PERSISTED",
        "Latin1_General_CI_AS",
      ],
      [
        "CreatedAt",
        "nvarchar(50)",
        "true",
        "false",
        null,
        null,
        "(sysutcdatetime())",
        null,
        "Latin1_General_CI_AS",
      ],
    ]);
    // Copied as JSON, the flags are booleans.
    expect(JSON.parse(jsonRows(grid.columns, grid.rows))[0]).toMatchObject({
      Nullable: false,
      "Primary key": true,
    });
  });

  test("a property named like a fixed column gets a distinct label", () => {
    const grid = structureGrid({
      columns: [
        column("Id", [
          { name: "Default", value: "custom" },
          { name: "Default (2)", value: "other" },
        ]),
      ],
      properties: [],
    });
    expect(properties(grid.columns.map((c) => c.name))).toEqual([
      "MS_Description",
      "Default (3)",
      "Default (2)",
    ]);
    expect(properties(grid.rows[0])).toEqual([null, "custom", "other"]);
  });
});
