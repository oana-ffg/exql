import type { Library } from "./types";

export function folderPath(library: Library, id: string): string {
  const names: string[] = [];
  const visited = new Set<string>();
  let folder = library.folders.find((item) => item.id === id);
  while (folder && !visited.has(folder.id)) {
    visited.add(folder.id);
    names.unshift(folder.name);
    folder = library.folders.find((item) => item.id === folder!.parentId);
  }
  return names.join(" / ");
}

export async function importSqlFolder(
  files: File[],
  signal?: AbortSignal,
): Promise<Library> {
  signal?.throwIfAborted();
  const scripts = files
    .filter((file) => /\.sql$/i.test(file.name))
    .sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath));
  if (!scripts.length)
    throw new Error("The selected folder contains no .sql files.");
  if (scripts.reduce((size, file) => size + file.size, 0) > 4 * 1024 * 1024)
    throw new Error(
      "SQL scripts exceed the 4 MiB workspace limit. Import a smaller folder.",
    );
  const library: Library = { folders: [], queries: [] };
  const folders = new Map<string, string>();
  // Complete every read before adding anything to the saved library.
  for (const file of scripts) {
    signal?.throwIfAborted();
    const parts = (file.webkitRelativePath || file.name).split("/");
    let parentId = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let id = folders.get(path);
      if (!id) {
        id = crypto.randomUUID();
        folders.set(path, id);
        library.folders.push({ id, name: parts[i], parentId });
      }
      parentId = id;
    }
    let sql: string;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const encoding =
        bytes[0] === 0xff && bytes[1] === 0xfe
          ? "utf-16le"
          : bytes[0] === 0xfe && bytes[1] === 0xff
            ? "utf-16be"
            : "utf-8";
      sql = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch (error) {
      throw new Error(
        `Could not import ${file.webkitRelativePath || file.name}: ${(error as Error).message}. Use UTF-8 or UTF-16 with a byte-order mark.`,
      );
    }
    library.queries.push({
      id: crypto.randomUUID(),
      name: file.name,
      folderId: parentId,
      sql,
    });
  }
  signal?.throwIfAborted();
  return library;
}
