import {
  ArrowDownAZ,
  ClockArrowDown,
  FileCode2,
  Folder,
  FolderPlus,
  Play,
  RefreshCw,
} from "lucide-react";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { copyText } from "./clipboard";
import { canPickFolder } from "./desktopBridge";
import {
  scriptFullPath,
  type ScriptFile,
  type ScriptFolder,
  type ScriptFoldersState,
  type OpenScript,
} from "./scriptFolders";
import { scriptTree, type ScriptTree } from "./scriptTree";

type Target = { folder: ScriptFolder; file?: ScriptFile };

function age(time: string | null) {
  if (time === null) return "?";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(time)) / 60000),
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
  const picker = canPickFolder();
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
  const byCreated = state.sort === "created";
  function tree(folder: ScriptFolder, { directories, files }: ScriptTree) {
    return (
      <>
        {directories.map(({ name, tree: children }) => (
          <details key={name} className="tree-folder nested-folders" open>
            <summary>
              <Folder size={15} />
              <span>{name}</span>
            </summary>
            {tree(folder, children)}
          </details>
        ))}
        {files.map(({ name, file }) => (
          <div
            className="saved-query script-file"
            key={file.path}
            {...context.bind({ folder, file })}
          >
            <button
              className="tree-item"
              disabled={disabled}
              onClick={() => open(folder, file)}
              title={`${file.path}\nCreated ${file.created === null ? "unknown" : new Date(file.created).toLocaleString()}\nModified ${new Date(file.modified).toLocaleString()}`}
            >
              <FileCode2 size={14} />
              <span>{name}</span>
              {/* The age follows the sort so newest-first order is visible. */}
              <small>{age(byCreated ? file.created : file.modified)}</small>
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
        ))}
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
            aria-label={
              byCreated
                ? "Sort scripts by name"
                : "Sort scripts by newest created"
            }
            title={
              byCreated
                ? "Sorted by newest created. Click to sort by name."
                : "Sorted by name. Click to sort by newest created."
            }
            onClick={() => state.setSort(byCreated ? "name" : "created")}
          >
            {byCreated ? (
              <ClockArrowDown size={14} />
            ) : (
              <ArrowDownAZ size={14} />
            )}
          </button>
          <button
            className="icon-button"
            aria-label="Add script folder"
            title={
              picker
                ? "Add script folder"
                : "Adding a script folder requires the ExQL desktop app"
            }
            disabled={!picker || state.adding}
            onClick={() => void state.addFromPicker()}
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
                {tree(folder, scriptTree(listing?.scripts ?? [], state.sort))}
                {!listing?.scripts.length && (
                  <p className="sidebar-hint">No .sql files in this folder.</p>
                )}
                {listing?.truncated && (
                  <p className="sidebar-hint">
                    Showing the first 2,000 .sql files.
                  </p>
                )}
                {!!listing?.unreadable.length && (
                  <p
                    className="sidebar-hint form-error"
                    role="alert"
                    title={listing.unreadable.join("\n")}
                  >
                    Could not search {listing.unreadable.join(", ")}. Scripts
                    there are not listed.
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
    </>
  );
}
