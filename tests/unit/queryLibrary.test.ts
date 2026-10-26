import { describe, expect, it } from "vitest";
import { folderPath, importSqlFolder } from "../../src/queryLibrary";

function file(path: string, contents: BlobPart) {
  const result = new File([contents], path.split("/").at(-1)!);
  Object.defineProperty(result, "webkitRelativePath", { value: path });
  return result;
}

describe("SQL folder import", () => {
  it("preserves nested paths, filenames, Unicode and UTF-16 while ignoring other files", async () => {
    const library = await importSqlFolder([
      file(
        "Scripts/Reports/query.SQL",
        new Uint8Array([0xff, 0xfe, 83, 0, 81, 0, 76, 0]),
      ),
      file("Scripts/root.sql", "SELECT N'æøå 日本語';"),
      file("Scripts/readme.txt", "ignored"),
    ]);
    expect(library.queries).toHaveLength(2);
    expect(
      library.queries.find((query) => query.name === "root.sql")?.sql,
    ).toBe("SELECT N'æøå 日本語';");
    const query = library.queries.find((query) => query.name === "query.SQL")!;
    expect(query.sql).toBe("SQL");
    expect(folderPath(library, query.folderId)).toBe("Scripts / Reports");
  });
  it("rejects folders with no SQL scripts", async () => {
    await expect(
      importSqlFolder([file("Scripts/notes.txt", "notes")]),
    ).rejects.toThrow("no .sql files");
  });
  it("rejects invalid encoding instead of importing replacement characters", async () => {
    await expect(
      importSqlFolder([
        file("Scripts/first.sql", "SELECT 1;"),
        file("Scripts/second.sql", new Uint8Array([0xff])),
      ]),
    ).rejects.toThrow("Could not import Scripts/second.sql");
  });
  it("rejects oversized imports before reading their contents", async () => {
    await expect(
      importSqlFolder([
        file("Scripts/huge.sql", "x".repeat(4 * 1024 * 1024 + 1)),
      ]),
    ).rejects.toThrow("4 MiB");
  });
  it("supports cancellation without returning a partial library", async () => {
    const abort = new AbortController();
    const pending = importSqlFolder(
      [file("Scripts/query.sql", "SELECT 1;")],
      abort.signal,
    );
    abort.abort();
    await expect(pending).rejects.toThrow();
  });
});
