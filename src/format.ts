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
function parseBit(value: string): boolean {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error("Bit values must be true, false, 1, or 0.");
}
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
                  : column.type === "bit"
                    ? String(parseBit(value))
                    : numeric.has(column.type)
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
  if (column.type === "bit") return parseBit(value) ? "1" : "0";
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
            .map((column, i) => {
              const value = sqlValue(column, row[i]);
              const expression =
                column.type === "bit" ? `CAST(${value} AS bit)` : value;
              return `${expression} AS ${quoteIdentifier(column.name)}`;
            })
            .join(", "),
      )
      .join("\nUNION ALL\n") + ";"
  );
}
// Fences one backtick longer than any run in the content keep embedded backticks literal.
function fenced(content: string, language: string) {
  let longest = 0;
  for (const [run] of content.matchAll(/`+/g))
    longest = Math.max(longest, run.length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}
export function resultsText(
  results: { rowCount: number; csv: string }[],
  recordsAffected: number,
  messages: string[],
): string {
  return [
    ...results.map(
      ({ rowCount, csv }, index) =>
        `Result ${index + 1} of ${results.length} · ${rowCount.toLocaleString("en-US")} ${rowCount === 1 ? "row" : "rows"}\n` +
        fenced(csv.replace(/\r?\n$/, ""), "csv"),
    ),
    ...(messages.length
      ? [`Messages\n${fenced(messages.join("\n"), "text")}`]
      : []),
    ...(recordsAffected >= 0 ? [`${recordsAffected} rows affected`] : []),
  ].join("\n\n");
}
