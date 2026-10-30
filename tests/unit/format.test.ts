import { describe, expect, test } from "vitest";
import {
  csvRows,
  jsonRows,
  quoteIdentifier,
  querySqlRows,
  resultsText,
  sqlRows,
} from "../../src/format";
import type { Column } from "../../src/types";
const column = (name: string, type: string, generated = false): Column => ({
  name,
  type,
  nullable: true,
  primaryKey: false,
  editable: !generated,
  generated,
});
describe("lossless copy formats", () => {
  test("JSON preserves 64-bit integers, full decimals, booleans, nulls and Unicode", () => {
    const output = jsonRows(
      [
        column("id", "bigint"),
        column("amount", "decimal"),
        column("active", "bit"),
        column("text", "nvarchar"),
        column("empty", "nvarchar"),
      ],
      [
        [
          "9223372036854775807",
          "12345678901234567890.123456789012345678",
          "true",
          null,
          '日本語 "æøå"\n',
        ],
      ],
    );
    expect(output).toContain("9223372036854775807");
    expect(output).toContain("12345678901234567890.123456789012345678");
    expect(output).toContain('"active": true');
    expect(output).toContain('"text": null');
    expect(JSON.parse(output)[0].empty).toBe('日本語 "æøå"\n');
  });
  test("CSV escapes quotes, commas, newlines and distinguishes NULL from empty text", () => {
    expect(
      csvRows(
        [column("a", "nvarchar"), column("b", "nvarchar")],
        [
          ['a,"b"\nc', null],
          ["", "=1+1"],
        ],
      ),
    ).toBe('"a","b"\r\n"a,""b""\nc",\r\n"","=1+1"');
  });
  test("SQL quotes names and text, omits generated columns, preserves binary and NULL", () => {
    expect(quoteIdentifier("a]b")).toBe("[a]]b]");
    expect(
      sqlRows(
        [
          column("Id", "int", true),
          column("text", "nvarchar"),
          column("b", "varbinary"),
          column("n", "int"),
        ],
        [["1", "O'Brien", "0x00FF", null]],
        "dbo",
        "a]b",
      ),
    ).toBe(
      "INSERT INTO [dbo].[a]]b] ([text], [b], [n]) VALUES (N'O''Brien', 0x00FF, NULL);",
    );
  });
  test("query results copy as executable SELECT without invented table names", () => {
    expect(querySqlRows([column("n", "int")], [["1"], ["2"]])).toBe(
      "SELECT 1 AS [n]\nUNION ALL\nSELECT 2 AS [n];",
    );
  });
});
describe("copy all results as text", () => {
  test("labels each result, keeps fences literal, and appends messages and affected rows", () => {
    expect(
      resultsText(
        [
          { rowCount: 1, csv: '"a"\r\n"1"\r\n' },
          { rowCount: 1200, csv: '"code"\r\n"``` x ````"\r\n' },
        ],
        3,
        ["first", "second"],
      ),
    ).toBe(
      'Result 1 of 2 · 1 row\n```csv\n"a"\r\n"1"\n```\n\n' +
        'Result 2 of 2 · 1,200 rows\n`````csv\n"code"\r\n"``` x ````"\n`````\n\n' +
        "Messages\n```text\nfirst\nsecond\n```\n\n" +
        "3 rows affected",
    );
  });
  test("omits messages and affected rows when absent", () => {
    expect(resultsText([{ rowCount: 0, csv: '"a"\r\n' }], -1, [])).toBe(
      'Result 1 of 1 · 0 rows\n```csv\n"a"\n```',
    );
  });
});
