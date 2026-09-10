import type { Cell, Column } from "./types";
const numeric = new Set([
  "bigint",
  "int",
  "smallint",
  "tinyint",
  "decimal",
  "numeric",
  "money",
  "smallmoney",
  "float",
  "real",
]);
export const quoteIdentifier = (name: string) =>
  `[${name.replaceAll("]", "]]")}]`;
const csvCell = (value: Cell) =>
  value === null ? "" : `"${value.replaceAll('"', '""')}"`;
export function jsonRows(columns: Column[], rows: Cell[][]): string {
  return (
    "[\n" +
    rows
      .map(
        (row) =>
          "  {" +
          columns
            .map((column, i) => {
              const value = row[i];
              const encoded =
                value === null
                  ? "null"
                  : numeric.has(column.type) || column.type === "bit"
                    ? value
                    : JSON.stringify(value);
              return `${JSON.stringify(column.name)}: ${encoded}`;
            })
            .join(", ") +
          "}",
      )
      .join(",\n") +
    "\n]"
  );
}
export function csvRows(columns: Column[], rows: Cell[][]): string {
  return [
    columns.map((c) => csvCell(c.name)).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n");
}
export function sqlValue(column: Column, value: Cell): string {
  if (value === null) return "NULL";
  if (column.type === "bit") return value === "true" ? "1" : "0";
  if (
    numeric.has(column.type) ||
    ["binary", "varbinary", "timestamp", "rowversion"].includes(column.type)
  )
    return value;
  return `N'${value.replaceAll("'", "''")}'`;
}
export function sqlRows(
  columns: Column[],
  rows: Cell[][],
  schema: string,
  table: string,
): string {
  // Let SQL Server generate identity, computed, and rowversion values in the destination.
  const selected = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !column.generated);
  const target = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  return rows
    .map((row) =>
      selected.length
        ? `INSERT INTO ${target} (${selected.map(({ column }) => quoteIdentifier(column.name)).join(", ")}) VALUES (${selected.map(({ column, index }) => sqlValue(column, row[index])).join(", ")});`
        : `INSERT INTO ${target} DEFAULT VALUES;`,
    )
    .join("\n");
}
export function querySqlRows(columns: Column[], rows: Cell[][]): string {
  return (
    rows
      .map(
        (row) =>
          "SELECT " +
          columns
            .map(
              (column, i) =>
                `${sqlValue(column, row[i])} AS ${quoteIdentifier(column.name)}`,
            )
            .join(", "),
      )
      .join("\nUNION ALL\n") + ";"
  );
}
