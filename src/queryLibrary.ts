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
