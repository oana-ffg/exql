import { useState } from "react";
import { FileCode2, Folder, FolderPlus, Play, RefreshCw } from "lucide-react";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { Modal } from "./Modal";
import { copyText } from "./clipboard";
import {
  scriptFullPath,
  type ScriptFile,
  type ScriptFolder,
  type ScriptFoldersState,
  type OpenScript,
} from "./scriptFolders";

type Target = { folder: ScriptFolder; file?: ScriptFile };

function age(modified: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(modified)) / 60000),
  );
  return minutes < 1
    ? "now"
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / 1440)}d`;
}

export function ScriptFoldersPanel({
  state,
  disabled,
  canRun,
  onOpen,
  onNotice,
}: {
  state: ScriptFoldersState;
  disabled: boolean;
  canRun: boolean;
  onOpen: (script: OpenScript, run?: boolean) => void;
  onNotice: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const context = useContextMenu<Target>();
  function open(folder: ScriptFolder, file: ScriptFile, run = false) {
    onOpen(
      {
        folderId: folder.id,
        path: file.path,
        name: file.path.split("/").at(-1)!,
      },
      run,
    );
  }
  function tree(folder: ScriptFolder, files: ScriptFile[], prefix = "") {
    const children = files.filter((file) => file.path.startsWith(prefix));
    const directories = [
      ...new Set(
        children
          .map((file) => file.path.slice(prefix.length))
          .filter((path) => path.includes("/"))
          .map((path) => path.split("/")[0]),
      ),
    ];
    return (
      <>
        {directories.map((name) => (
          <details key={name} className="tree-folder nested-folders" open>
            <summary>
              <Folder size={15} />
              <span>{name}</span>
            </summary>
            {tree(folder, children, `${prefix}${name}/`)}
          </details>
        ))}
        {children
          .filter((file) => !file.path.slice(prefix.length).includes("/"))
          .map((file) => {
            const name = file.path.slice(prefix.length);
            return (
              <div
                className="saved-query script-file"
                key={file.path}
                {...context.bind({ folder, file })}
              >
                <button
                  className="tree-item"
                  disabled={disabled}
                  onClick={() => open(folder, file)}
                  title={`${file.path}\n${new Date(file.modified).toLocaleString()}`}
                >
                  <FileCode2 size={14} />
                  <span>{name}</span>
                  <small>{age(file.modified)}</small>
                </button>
                <button
                  className="icon-button"
                  aria-label={`Run ${name}`}
                  title={`Run ${name}`}
                  disabled={!canRun}
                  onClick={() => open(folder, file, true)}
                >
                  <Play size={13} />
                </button>
              </div>
            );
          })}
      </>
    );
  }
  const target = context.menu?.target;
  return (
    <>
      <div className="section-heading saved-heading">
        SCRIPT FOLDERS
        <div className="folder-actions-always">
          <button
            className="icon-button"
            aria-label="Add script folder"
            title="Add script folder"
            onClick={() => {
              setAdding(true);
              setPath("");
              setError("");
            }}
          >
            <FolderPlus size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Refresh script folders"
            title="Refresh script folders"
            onClick={() => void state.refresh()}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      {!state.folders.length && (
        <p className="sidebar-hint">
          Add a folder, such as Downloads, to list the .sql files in it.
        </p>
      )}
      {state.folders.map((folder) => {
        const listing = state.listings[folder.id];
        return (
          <details key={folder.id} open className="tree-folder linked-folder">
            <summary title={folder.path} {...context.bind({ folder })}>
              <Folder size={15} />
              <span>{folder.name}</span>
            </summary>
            {listing?.error ? (
              <p className="sidebar-hint form-error" role="alert">
                {listing.error}
              </p>
            ) : (
              <>
                {tree(folder, listing?.scripts ?? [])}
                {!listing?.scripts.length && (
                  <p className="sidebar-hint">No .sql files in this folder.</p>
                )}
                {listing?.truncated && (
                  <p className="sidebar-hint">
                    Showing the first 2,000 .sql files.
                  </p>
                )}
              </>
            )}
          </details>
        );
      })}
      {context.menu && target && (
        <ContextMenu
          position={context.menu}
          label={target.file?.path.split("/").at(-1) ?? target.folder.name}
          onClose={context.close}
          actions={
            target.file
              ? [
                  {
                    label: "Open",
                    disabled,
                    run: () => open(target.folder, target.file!),
                  },
                  {
                    label: "Run",
                    disabled: !canRun,
                    run: () => open(target.folder, target.file!, true),
                  },
                  {
                    label: "Copy path",
                    run: () =>
                      void copyText(
                        scriptFullPath(target.folder, target.file!.path),
                        onNotice,
                      ),
                  },
                ]
              : [
                  { label: "Refresh", run: () => void state.refresh() },
                  {
                    label: "Copy path",
                    run: () => void copyText(target.folder.path, onNotice),
                  },
                  {
                    label: "Remove from ExQL…",
                    separator: true,
                    run: () => void state.remove(target.folder),
                  },
                ]
          }
        />
      )}
      {adding && (
        <Modal
          title="Add script folder"
          onClose={() => {
            if (!pending) setAdding(false);
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setPending(true);
              setError("");
              try {
                await state.add(path);
                setAdding(false);
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setPending(false);
              }
            }}
          >
            <label>
              Folder path
              <input
                autoFocus
                required
                value={path}
                disabled={pending}
                onChange={(event) => setPath(event.target.value)}
              />
            </label>
            <p className="hint">
              Paste a folder path from File Explorer. Environment variables such
              as %USERPROFILE%\Downloads work. ExQL only reads .sql files; it
              never copies or changes them.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <footer className="modal-footer">
              <button
                type="button"
                disabled={pending}
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={pending || !path.trim()}>
                Add folder
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
