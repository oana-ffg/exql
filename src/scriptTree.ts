import type { ScriptFile } from "./scriptFolders";

export type ScriptSort = "name" | "created";

export interface ScriptTree {
  directories: { name: string; tree: ScriptTree }[];
  files: { name: string; file: ScriptFile }[];
}

interface Entry {
  rest: string;
  file: ScriptFile;
}

// Natural, case-insensitive order like Windows Explorer, so 2.sql comes before 10.sql.
const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function byName(a: ScriptFile, b: ScriptFile) {
  return collator.compare(a.path, b.path);
}

// Scripts without a known creation time go last.
const createdTime = (file: ScriptFile) =>
  file.created === null ? -Infinity : Date.parse(file.created);

function byNewest(a: ScriptFile, b: ScriptFile) {
  return createdTime(b) - createdTime(a) || byName(a, b);
}

/**
 * Groups a folder listing into its subfolders. By name, subfolders and files are
 * alphabetical. By creation time, files are newest first and each subfolder is
 * placed by the newest script it contains.
 */
export function scriptTree(files: ScriptFile[], sort: ScriptSort): ScriptTree {
  const sorted = [...files].sort(sort === "created" ? byNewest : byName);
  return build(
    sorted.map((file) => ({ rest: file.path, file })),
    sort,
  );
}

function build(entries: Entry[], sort: ScriptSort): ScriptTree {
  const directories = new Map<string, Entry[]>();
  const files: ScriptTree["files"] = [];
  for (const { rest, file } of entries) {
    const slash = rest.indexOf("/");
    if (slash < 0) {
      files.push({ name: rest, file });
      continue;
    }
    const name = rest.slice(0, slash);
    const children = directories.get(name) ?? [];
    children.push({ rest: rest.slice(slash + 1), file });
    directories.set(name, children);
  }
  // Map keys keep first-seen order, which is newest-first for creation time.
  const names = [...directories.keys()];
  if (sort !== "created") names.sort(collator.compare);
  return {
    directories: names.map((name) => ({
      name,
      tree: build(directories.get(name)!, sort),
    })),
    files,
  };
}
