import { describe, expect, it } from "vitest";
import type { ScriptFile } from "../../src/scriptFolders";
import {
  scriptTree,
  type ScriptSort,
  type ScriptTree,
} from "../../src/scriptTree";

const file = (path: string, created: string | null): ScriptFile => ({
  path,
  size: 1,
  created: created && `2026-01-${created}T00:00:00Z`,
  modified: "2026-02-01T00:00:00Z",
});

// Flattens a tree into the labels the panel shows, in display order.
function outline(tree: ScriptTree, depth = 0): string[] {
  const indent = "  ".repeat(depth);
  return [
    ...tree.directories.flatMap(({ name, tree: children }) => [
      `${indent}${name}/`,
      ...outline(children, depth + 1),
    ]),
    ...tree.files.map(({ name }) => `${indent}${name}`),
  ];
}

const files = [
  file("10.sql", "05"),
  file("b.sql", "02"),
  file("2.sql", "01"),
  file("A.sql", "03"),
  file("zeta/old.sql", "01"),
  file("Alpha/new.sql", "04"),
  file("zeta/deep/newest.sql", "09"),
];

describe("scriptTree", () => {
  it("sorts folders and files by natural, case-insensitive name", () => {
    expect(outline(scriptTree(files, "name"))).toEqual([
      "Alpha/",
      "  new.sql",
      "zeta/",
      "  deep/",
      "    newest.sql",
      "  old.sql",
      "2.sql",
      "10.sql",
      "A.sql",
      "b.sql",
    ]);
  });

  it("sorts files newest first and places folders by their newest script", () => {
    expect(outline(scriptTree(files, "created"))).toEqual([
      "zeta/",
      "  deep/",
      "    newest.sql",
      "  old.sql",
      "Alpha/",
      "  new.sql",
      "10.sql",
      "A.sql",
      "b.sql",
      "2.sql",
    ]);
  });

  it("orders scripts created at the same time by name", () => {
    const tied = [file("b.sql", "01"), file("a.sql", "01")];
    expect(outline(scriptTree(tied, "created"))).toEqual(["a.sql", "b.sql"]);
  });

  it("puts scripts without a known creation time last", () => {
    const listing = [
      file("b-unknown.sql", null),
      file("old.sql", "01"),
      file("a-unknown.sql", null),
    ];
    expect(outline(scriptTree(listing, "created"))).toEqual([
      "old.sql",
      "a-unknown.sql",
      "b-unknown.sql",
    ]);
  });

  it("sorts by name when the saved preference is not a known order", () => {
    const listing = [file("a-b/z.sql", "02"), file("a/z.sql", "01")];
    const saved = "garbage" as ScriptSort;
    expect(outline(scriptTree(listing, saved))).toEqual(
      outline(scriptTree(listing, "name")),
    );
  });

  it("does not reorder the listing it was given", () => {
    const listing = [file("b.sql", "01"), file("a.sql", "02")];
    scriptTree(listing, "created");
    expect(listing.map((script) => script.path)).toEqual(["b.sql", "a.sql"]);
  });
});
