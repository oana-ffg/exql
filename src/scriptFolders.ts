import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "./api";

export interface ScriptFile {
  path: string;
  size: number;
  modified: string;
}
export interface ScriptFolder {
  id: string;
  path: string;
  name: string;
}
interface Listing {
  scripts: ScriptFile[];
  truncated: boolean;
  unreadable: string[];
  error?: string;
}
export interface OpenScript {
  folderId: string;
  path: string;
  name: string;
}

export function scriptFullPath(folder: ScriptFolder, path: string) {
  return `${folder.path.replace(/[\\/]+$/, "")}\\${path.replaceAll("/", "\\")}`;
}

export async function readScript(script: OpenScript, signal?: AbortSignal) {
  const content = await request<{ sql: string; modified: string }>(
    `/script-folders/${script.folderId}/script?path=${encodeURIComponent(script.path)}`,
    undefined,
    signal,
  );
  // CodeMirror stores LF line breaks; normalize so unchanged CRLF files compare equal to the editor text.
  return { ...content, sql: content.sql.replace(/\r\n?/g, "\n") };
}

export type ScriptFoldersState = ReturnType<typeof useScriptFolders>;

export function useScriptFolders(onError: (message: string) => void) {
  const [folders, setFolders] = useState<ScriptFolder[]>([]);
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const next = await request<ScriptFolder[]>(
        "/script-folders",
        undefined,
        abort.signal,
      );
      const entries = await Promise.all(
        next.map(async (folder) => {
          try {
            const listing = await request<Listing>(
              `/script-folders/${folder.id}/scripts`,
              undefined,
              abort.signal,
            );
            return [folder.id, listing] as const;
          } catch (error) {
            return [
              folder.id,
              {
                scripts: [],
                truncated: false,
                unreadable: [],
                error: (error as Error).message,
              },
            ] as const;
          }
        }),
      );
      if (abort.signal.aborted) return;
      setFolders(next);
      setListings(Object.fromEntries(entries));
    } catch (error) {
      if (!abort.signal.aborted) onError((error as Error).message);
    }
  }, [onError]);
  useEffect(() => {
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      controller.current?.abort();
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);

  async function add(path: string) {
    await request<ScriptFolder>("/script-folders", { path });
    await refresh();
  }
  async function remove(folder: ScriptFolder) {
    if (
      !window.confirm(
        `Remove ${folder.name} from ExQL? Files on disk are not changed.`,
      )
    )
      return;
    try {
      await request(
        `/script-folders/${folder.id}`,
        undefined,
        undefined,
        "DELETE",
      );
      await refresh();
    } catch (error) {
      onError((error as Error).message);
    }
  }
  return { folders, listings, refresh, add, remove };
}
