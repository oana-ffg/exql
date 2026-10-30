import { useState } from "react";
import {
  ChevronDown,
  Code2,
  Database,
  FileCode2,
  Folder,
  FolderPlus,
  Search,
  Table2,
  Trash2,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { ScriptFoldersPanel } from "./ScriptFoldersPanel";
import type { ScriptFoldersState, OpenScript } from "./scriptFolders";
import type { Library, SavedQuery, Session, TableId } from "./types";
import { ContextMenu, useContextMenu, type MenuAction } from "./ContextMenu";
import { copyText } from "./clipboard";
import { quoteIdentifier } from "./format";
import { connectionColorStyle } from "./connectionColors";

type ExplorerMenu =
  | { kind: "table"; table: TableId }
  | { kind: "query"; query: SavedQuery }
  | { kind: "folder"; id: string; name: string };

export function Sidebar({
  session,
  active,
  library,
  onTable,
  onRefresh,
  onQuery,
  onSql,
  onNotice,
  onConnect,
  onNewQuery,
  onFolder,
  scriptFolders,
  onScript,
  onRenameFolder,
  onDeleteFolder,
  onDeleteQuery,
  disabled,
}: {
  session: Session | null;
  active: TableId | null;
  library: Library;
  onTable: (table: TableId) => void;
  onRefresh: () => void;
  onQuery: (query: SavedQuery) => void;
  onSql: (sql: string) => void;
  onNotice: (message: string) => void;
  onConnect: () => void;
  onNewQuery: () => void;
  onFolder: () => void;
  scriptFolders: ScriptFoldersState;
  onScript: (script: OpenScript, run?: boolean) => void;
  onRenameFolder: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteQuery: (id: string) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<"database" | "scripts">("database");
  const context = useContextMenu<ExplorerMenu>();
  function menuActions(target: ExplorerMenu): MenuAction[] {
    if (target.kind === "table") {
      const name = `${quoteIdentifier(target.table.schema)}.${quoteIdentifier(target.table.name)}`;
      return [
        { label: "Open data", disabled, run: () => onTable(target.table) },
        {
          label: "Write SELECT query",
          disabled,
          run: () => onSql(`SELECT TOP (200) *\nFROM ${name};`),
        },
        {
          label: "Copy qualified name",
          run: () => void copyText(name, onNotice),
        },
        {
          label: "Refresh explorer",
          separator: true,
          disabled,
          run: onRefresh,
        },
      ];
    }
    if (target.kind === "query")
      return [
        { label: "Open query", disabled, run: () => onQuery(target.query) },
        {
          label: "Copy SQL",
          run: () => void copyText(target.query.sql, onNotice),
        },
        {
          label: "Delete saved query…",
          separator: true,
          disabled,
          run: () => onDeleteQuery(target.query.id),
        },
      ];
    return [
      { label: "New folder…", disabled, run: onFolder },
      {
        label: "Rename folder…",
        disabled: disabled || !target.id,
        run: () => onRenameFolder(target.id),
      },
      {
        label: "Delete empty folder",
        disabled:
          disabled ||
          !target.id ||
          library.queries.some((query) => query.folderId === target.id) ||
          library.folders.some((folder) => folder.parentId === target.id),
        run: () => onDeleteFolder(target.id),
      },
    ];
  }
  const tables =
    session?.catalog.filter((table) =>
      `${table.schema}.${table.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  const schemas = [...new Set(tables.map((table) => table.schema))];
  return (
    <aside className="sidebar">
      <div className="brand">
        <img
          className="brand-mark"
          src="/exql.png"
          alt=""
          width={34}
          height={34}
        />
        <strong>exql</strong>
      </div>
      <button
        className="connection-card"
        style={connectionColorStyle(session?.color)}
        title={
          session
            ? `${session.name}\n${session.database}\n${session.server}`
            : "Database connections"
        }
        onClick={onConnect}
        disabled={disabled}
      >
        <span className={`connection-dot ${session ? "connected" : ""}`} />
        <div>
          <strong>{session?.name ?? "No connection"}</strong>
          <span>{session ? session.database : "Connect to SQL Server"}</span>
        </div>
        <ChevronDown size={14} />
      </button>
      <button className="new-query" onClick={onNewQuery} disabled={disabled}>
        <Code2 size={16} />
        New query<span>SQL</span>
      </button>
      <div className="sidebar-sections" aria-label="Explorer sections">
        <button
          aria-pressed={panel === "database"}
          onClick={() => setPanel("database")}
        >
          <Database size={14} /> Database
        </button>
        <button
          aria-pressed={panel === "scripts"}
          onClick={() => {
            setPanel("scripts");
            void scriptFolders.refresh();
          }}
        >
          <Folder size={14} /> SQL scripts
        </button>
      </div>
      <div className="sidebar-scroll">
        {panel === "database" ? (
          <>
            <div className="section-heading">
              DATABASE EXPLORER<span>{session?.catalog.length ?? 0}</span>
              <button
                className="icon-button"
                aria-label="Refresh database explorer"
                disabled={!session || disabled}
                onClick={onRefresh}
              >
                <RefreshCw size={13} />
              </button>
            </div>
            <label className="search-box">
              <Search size={14} />
              <input
                aria-label="Find a table"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="search-caption" hidden={search.length > 0}>
                Find a table
              </span>
            </label>
            {!session && (
              <p className="sidebar-hint">
                Tables and views appear here after connecting.
              </p>
            )}
            {session && tables.length === 0 && (
              <p className="sidebar-hint">No tables or views found.</p>
            )}
            {schemas.map((schema) => (
              <details key={schema} open className="tree-folder">
                <summary>
                  <Folder size={15} />
                  <span>{schema}</span>
                  <small>
                    {tables.filter((table) => table.schema === schema).length}
                  </small>
                </summary>
                {tables
                  .filter((table) => table.schema === schema)
                  .map((table) => (
                    <button
                      key={table.name}
                      disabled={disabled}
                      className={`tree-item ${active?.schema === schema && active.name === table.name ? "active" : ""}`}
                      onClick={() => onTable(table)}
                      {...context.bind({ kind: "table", table })}
                    >
                      <Table2 size={14} />
                      <span>{table.name}</span>
                      {table.kind === "view" && <small>view</small>}
                    </button>
                  ))}
              </details>
            ))}
          </>
        ) : (
          <>
            <ScriptFoldersPanel
              state={scriptFolders}
              disabled={disabled}
              canRun={!!session && !disabled}
              onOpen={onScript}
              onNotice={onNotice}
            />
            <div className="section-heading saved-heading">
              SAVED QUERIES
              <button
                className="icon-button"
                aria-label="New query folder"
                onClick={onFolder}
              >
                <FolderPlus size={15} />
              </button>
            </div>
            {renderFolders("")}
          </>
        )}
      </div>
      {context.menu && (
        <ContextMenu
          position={context.menu}
          label={
            context.menu.target.kind === "table"
              ? context.menu.target.table.name
              : context.menu.target.kind === "query"
                ? context.menu.target.query.name
                : context.menu.target.name
          }
          actions={menuActions(context.menu.target)}
          onClose={context.close}
        />
      )}
    </aside>
  );

  function renderFolders(parentId: string) {
    return [
      { id: "", name: "Unfiled" },
      ...library.folders.filter(
        (folder) => (folder.parentId ?? "") === parentId,
      ),
    ]
      .filter(
        (folder) =>
          folder.id ||
          (!parentId && library.queries.some((query) => !query.folderId)),
      )
      .map((folder) => (
        <details key={folder.id} open className="tree-folder">
          <summary
            {...context.bind({
              kind: "folder",
              id: folder.id,
              name: folder.name,
            })}
          >
            <Folder size={15} />
            <span>{folder.name}</span>
            {folder.id && (
              <div className="folder-actions">
                <button
                  className="icon-button"
                  aria-label={`Rename ${folder.name}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onRenameFolder(folder.id);
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete folder ${folder.name}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onDeleteFolder(folder.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </summary>
          {folder.id && (
            <div className="nested-folders">{renderFolders(folder.id)}</div>
          )}
          {library.queries
            .filter((query) => query.folderId === folder.id)
            .map((query) => (
              <div className="saved-query" key={query.id}>
                <button
                  className="tree-item"
                  disabled={disabled}
                  onClick={() => onQuery(query)}
                  {...context.bind({ kind: "query", query })}
                >
                  <FileCode2 size={14} />
                  <span>{query.name}</span>
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete query ${query.name}`}
                  onClick={() => onDeleteQuery(query.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
        </details>
      ));
  }
}
