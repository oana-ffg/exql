import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Code2,
  Database,
  Download,
  LoaderCircle,
  Play,
  PlugZap,
  RefreshCw,
  Save,
  Square,
  Table2,
  X,
} from "lucide-react";
import { request, download, exportText } from "./api";
import { DataGrid } from "./DataGrid";
import { FilterBar } from "./FilterBar";
import { Modal } from "./Modal";
import {
  readScript,
  scriptFullPath,
  type OpenScript,
  type ScriptFoldersState,
} from "./scriptFolders";
import { Sidebar } from "./Sidebar";
import { folderPath } from "./queryLibrary";
import { copyText } from "./clipboard";
import { resultsText } from "./format";
import type {
  Edit,
  Filter,
  GridResult,
  Library,
  QueryResponse,
  SavedQuery,
  Session,
  TableId,
  TableRequest,
} from "./types";

const SqlEditor = lazy(() =>
  import("./SqlEditor").then((module) => ({ default: module.SqlEditor })),
);
export function Workspace({
  id,
  active,
  session,
  onSession,
  sql,
  setSql,
  library,
  scriptFolders,
  setLibrary,
  onConnect,
  onActivity,
}: {
  id: string;
  active: boolean;
  session: Session | null;
  onSession: (session: Session | null) => void;
  sql: string;
  setSql: (sql: string) => void;
  library: Library;
  scriptFolders: ScriptFoldersState;
  setLibrary: (change: Library | ((current: Library) => Library)) => void;
  onConnect: () => void;
  onActivity: (id: string, state: { busy: string; edits: number }) => void;
}) {
  const [mode, setMode] = useState<"table" | "query">(
    sql.trim() ? "query" : "table",
  );
  const [table, setTable] = useState<TableId | null>(null);
  const [tableData, setTableData] = useState<GridResult | null>(null);
  const [tableRequest, setTableRequest] = useState<TableRequest | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [edits, setEdits] = useState<Edit[]>([]);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [selection, setSelection] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [script, setScript] = useState<OpenScript | null>(null);
  const [loadedSql, setLoadedSql] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [queryResponse, setQueryResponse] = useState<QueryResponse | null>(
    null,
  );
  const [resultIndex, setResultIndex] = useState(0);
  const [queryData, setQueryData] = useState<GridResult | null>(null);
  const [queryOffset, setQueryOffset] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const data = mode === "table" ? tableData : queryData;
  const offset = mode === "table" ? (tableRequest?.offset ?? 0) : queryOffset;
  const result = queryResponse?.results[resultIndex];
  const scriptFolder = scriptFolders.folders.find(
    (folder) => folder.id === script?.folderId,
  );
  const scriptTitle =
    script && scriptFolder
      ? scriptFullPath(scriptFolder, script.path)
      : undefined;
  const currentScript = useRef({ script, sql, loadedSql });
  useLayoutEffect(() => {
    currentScript.current = { script, sql, loadedSql };
  });
  const savedQuery = library.queries.find((query) => query.id === savedId);

  useLayoutEffect(() => {
    onActivity(id, { busy, edits: edits.length });
  }, [id, edits.length, busy, onActivity]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!script || busy) return;
    let abort: AbortController | null = null;
    const focus = async () => {
      abort?.abort();
      const next = new AbortController();
      abort = next;
      try {
        const content = await readScript(script, next.signal);
        if (next.signal.aborted) return;
        const current = currentScript.current;
        if (current.script !== script || content.sql === current.loadedSql)
          return;
        if (current.sql === current.loadedSql) {
          setSql(content.sql);
          setLoadedSql(content.sql);
          setSelection("");
          setEditorGeneration((value) => value + 1);
          setNotice("Reloaded " + script.name + " from disk.");
        } else
          setNotice(
            script.name + " changed on disk. Reload from disk to see it.",
          );
      } catch (error) {
        if (!next.signal.aborted) setError((error as Error).message);
      }
    };
    window.addEventListener("focus", focus);
    return () => {
      abort?.abort();
      window.removeEventListener("focus", focus);
    };
  }, [script, busy]);

  const endpoint = (path: string) => `/sessions/${session!.id}${path}`;
  async function perform(
    label: string,
    task: (signal: AbortSignal) => Promise<void>,
  ) {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(label);
    setError("");
    setNotice("");
    const start = performance.now();
    try {
      await task(abort.signal);
    } catch (err) {
      if (abort.signal.aborted)
        setError(
          "Operation cancelled. SQL statements that already completed may have committed changes; refresh before retrying.",
        );
      else setError((err as Error).message);
    } finally {
      setElapsed(performance.now() - start);
      setBusy("");
      controller.current = null;
    }
  }
  function discardEdits() {
    if (edits.length && !window.confirm("Discard your unsaved cell edits?"))
      return false;
    setEdits([]);
    return true;
  }
  async function loadTable(next: TableRequest, nextTable = table!) {
    if (!session || !discardEdits()) return;
    await perform("Loading table", async (signal) => {
      const page = await request<GridResult>(endpoint("/table"), next, signal);
      setTable(nextTable);
      setTableRequest(next);
      setTableData(page);
      setFilters(next.filters);
      setMatch(next.match);
      setMode("table");
      setGeneration((value) => value + 1);
    });
  }
  async function openTable(next: TableId) {
    await loadTable(
      {
        schema: next.schema,
        table: next.name,
        filters: [],
        match: "all",
        sort: null,
        descending: false,
        offset: 0,
        limit: 200,
      },
      next,
    );
  }
  function openQuery(query?: SavedQuery, initialSql = "") {
    if (!discardEdits()) return;
    setMode("query");
    setScript(null);
    setLoadedSql("");
    setSelection("");
    setEditorGeneration((value) => value + 1);
    if (query) {
      setSql(query.sql);
      setSavedId(query.id);
    } else {
      setSavedId(null);
      setSql(initialSql);
    }
    setQueryData(null);
    setQueryResponse(null);
    setGeneration((value) => value + 1);
  }
  async function executeQuery(text: string, signal: AbortSignal) {
    const response = await request<QueryResponse>(
      endpoint("/query"),
      { sql: text },
      signal,
    );
    setQueryResponse(response);
    setResultIndex(0);
    setQueryData(response.results[0]?.page ?? null);
    setQueryOffset(0);
    setGeneration((value) => value + 1);
    if (!response.results.length)
      setNotice(
        `Query completed. ${Math.max(0, response.recordsAffected)} rows affected.`,
      );
  }
  async function runQuery() {
    const text = selection || sql;
    if (!session || !text.trim() || busy) return;
    await perform("Running SQL", (signal) => executeQuery(text, signal));
  }
  async function openScript(next: OpenScript, run = false) {
    if (busy || (run && !session) || !discardEdits()) return;
    await perform(run ? "Running SQL" : "Opening script", async (signal) => {
      const content = await readScript(next, signal);
      setMode("query");
      setSavedId(null);
      setScript(next);
      setLoadedSql(content.sql);
      setSql(content.sql);
      setSelection("");
      setEditorGeneration((value) => value + 1);
      setQueryData(null);
      setQueryResponse(null);
      setGeneration((value) => value + 1);
      if (run && content.sql.trim()) await executeQuery(content.sql, signal);
    });
  }
  async function copyAllResults(response: QueryResponse) {
    await perform("Copying results", async (signal) => {
      // Snapshots hold every row; the grid only has the visible page.
      const results = [];
      for (const result of response.results)
        results.push({
          rowCount: result.rowCount,
          csv: await exportText(
            endpoint("/export"),
            { resultId: result.id, format: "csv" },
            signal,
          ),
        });
      await copyText(
        resultsText(results, response.recordsAffected, response.messages),
        setNotice,
        `Copied ${results.length} ${results.length === 1 ? "result" : "results"} as text.`,
      );
    });
  }
  async function reloadScript() {
    if (!script || busy) return;
    if (
      sql !== loadedSql &&
      !window.confirm(
        "Discard editor changes and reload " + script.name + " from disk?",
      )
    )
      return;
    // The confirmation only covers the text present when it was given.
    const discarded = sql;
    await perform("Reloading script", async (signal) => {
      const content = await readScript(script, signal);
      if (
        currentScript.current.script !== script ||
        currentScript.current.sql !== discarded
      )
        throw new Error(
          `The editor changed while ${script.name} was reloading, so it was kept. Reload from disk again to replace it.`,
        );
      setSql(content.sql);
      setLoadedSql(content.sql);
      setSelection("");
      setEditorGeneration((value) => value + 1);
      setNotice("Reloaded " + script.name + " from disk.");
    });
  }
  async function saveEdits() {
    if (!table || !tableData) return;
    await perform("Saving changes", async (signal) => {
      const rows = [...new Set(edits.map((edit) => edit.row))].map((row) => ({
        original: Object.fromEntries(
          tableData.columns.map((column, i) => [
            column.name,
            tableData.rows[row][i],
          ]),
        ),
        changes: edits
          .filter((edit) => edit.row === row)
          .map(({ column, value }) => ({ column, value })),
      }));
      await request(
        endpoint("/edit"),
        { schema: table.schema, table: table.name, rows },
        signal,
      );
      setEdits([]);
      setNotice(
        `Saved changes to ${rows.length} ${rows.length === 1 ? "row" : "rows"}.`,
      );
      try {
        setTableData(
          await request<GridResult>(endpoint("/table"), tableRequest, signal),
        );
        setGeneration((value) => value + 1);
      } catch (err) {
        setTableData(null);
        throw new Error(
          `Changes were saved, but refreshing failed: ${(err as Error).message}`,
        );
      }
    });
  }
  async function page(nextOffset: number) {
    if (mode === "table" && tableRequest)
      await loadTable({ ...tableRequest, offset: nextOffset });
    else if (result)
      await perform("Loading result", async (signal) => {
        setQueryData(
          await request<GridResult>(
            endpoint(`/results/${result.id}?offset=${nextOffset}`),
            undefined,
            signal,
          ),
        );
        setQueryOffset(nextOffset);
        setGeneration((value) => value + 1);
      });
  }
  function folder(id?: string) {
    const current = library.folders.find((folder) => folder.id === id);
    const name = window
      .prompt(id ? "Rename folder" : "New query folder", current?.name ?? "")
      ?.trim();
    if (!name) return;
    setLibrary({
      ...library,
      folders: id
        ? library.folders.map((folder) =>
            folder.id === id ? { ...folder, name } : folder,
          )
        : [...library.folders, { id: crypto.randomUUID(), name }],
    });
  }
  function deleteFolder(id: string) {
    if (
      library.queries.some((query) => query.folderId === id) ||
      library.folders.some((folder) => folder.parentId === id)
    ) {
      setNotice(
        "Move or delete the queries and subfolders in this folder before deleting it.",
      );
      return;
    }
    setLibrary({
      ...library,
      folders: library.folders.filter((folder) => folder.id !== id),
    });
  }

  return (
    <div
      className="app-shell"
      id={`workspace-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      hidden={!active}
    >
      <Sidebar
        session={session}
        active={mode === "table" ? table : null}
        library={library}
        disabled={!!busy}
        onTable={openTable}
        onRefresh={() =>
          void perform("Refreshing explorer", async (signal) => {
            const catalog = await request<TableId[]>(
              endpoint("/catalog"),
              undefined,
              signal,
            );
            onSession(session ? { ...session, catalog } : null);
          })
        }
        onQuery={openQuery}
        onSql={(text) => openQuery(undefined, text)}
        onNotice={setNotice}
        onNewQuery={() => openQuery()}
        onConnect={onConnect}
        scriptFolders={scriptFolders}
        onScript={openScript}
        onFolder={() => folder()}
        onRenameFolder={folder}
        onDeleteFolder={deleteFolder}
        onDeleteQuery={(id) => {
          if (window.confirm("Delete this saved query?")) {
            setLibrary({
              ...library,
              queries: library.queries.filter((query) => query.id !== id),
            });
            if (savedId === id) setSavedId(null);
          }
        }}
      />
      <main>
        <header className="workspace-header">
          <div className="breadcrumb">
            <Database size={14} />
            <span>{session?.database ?? "Workspace"}</span>
            <span className="slash">/</span>
            <strong title={mode === "query" ? scriptTitle : undefined}>
              {mode === "query"
                ? (script?.name ?? savedQuery?.name ?? "Untitled query")
                : table
                  ? `${table.schema}.${table.name}`
                  : "Overview"}
            </strong>
          </div>
          <div className="connection-status">
            <span className={`connection-dot ${session ? "connected" : ""}`} />
            {session ? "Connected" : "Offline"}
            {session && (
              <button
                className="icon-button"
                title="Disconnect"
                aria-label="Disconnect"
                disabled={!!busy}
                onClick={async () => {
                  if (discardEdits())
                    await perform("Disconnecting", async () => {
                      await request(
                        endpoint(""),
                        undefined,
                        undefined,
                        "DELETE",
                      );
                      onSession(null);
                      setTable(null);
                      setTableData(null);
                      setQueryData(null);
                      setQueryResponse(null);
                    });
                }}
              >
                <PlugZap size={14} />
              </button>
            )}
          </div>
        </header>
        {(table || mode === "query") && (
          <div className="tab-bar">
            <button
              className={mode === "table" ? "tab active" : "tab"}
              disabled={!table || !!busy}
              onClick={() => {
                if (discardEdits()) setMode("table");
              }}
            >
              <Table2 size={14} />
              {table?.name ?? "Table"}
            </button>
            <button
              title={scriptTitle}
              className={mode === "query" ? "tab active" : "tab"}
              disabled={!!busy}
              onClick={() => {
                if (discardEdits()) setMode("query");
              }}
            >
              <Code2 size={14} />
              {script?.name ?? savedQuery?.name ?? "SQL query"}
            </button>
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {notice && (
          <div className="banner notice" role="status">
            <Check size={15} />
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notice"
              onClick={() => setNotice("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {mode === "query" ? (
          <>
            <div className="query-toolbar">
              <div>
                <Code2 size={15} />
                <strong title={scriptTitle}>
                  {script?.name ?? savedQuery?.name ?? "Untitled query"}
                </strong>
                <span className="hint">T-SQL</span>
              </div>
              <div>
                {script && (
                  <button disabled={!!busy} onClick={() => void reloadScript()}>
                    <RefreshCw size={14} />
                    Reload from disk
                  </button>
                )}
                <button
                  onClick={() => setSaveOpen(true)}
                  disabled={!sql.trim()}
                >
                  <Save size={14} />
                  Save query
                </button>
                <button
                  className="primary"
                  disabled={!session || !!busy || !(selection || sql).trim()}
                  onClick={runQuery}
                >
                  <Play size={14} />
                  {selection ? "Run selection" : "Run SQL"}
                  <kbd>Ctrl ↵</kbd>
                </button>
              </div>
            </div>
            <Suspense
              fallback={<div className="sql-editor hint">Loading editor…</div>}
            >
              <SqlEditor
                key={editorGeneration}
                value={sql}
                onChange={setSql}
                onSelection={setSelection}
                onRun={runQuery}
                canRun={!!session && !busy && !!(selection || sql).trim()}
                onNotice={setNotice}
              />
            </Suspense>
            <div className="results-heading">
              <strong>RESULTS</strong>
              {queryResponse?.results.map((result, i) => (
                <button
                  className={
                    i === resultIndex ? "result-tab active" : "result-tab"
                  }
                  disabled={!!busy}
                  key={result.id}
                  onClick={() => {
                    setResultIndex(i);
                    setQueryData(result.page);
                    setQueryOffset(0);
                    setGeneration((value) => value + 1);
                  }}
                >
                  Result {i + 1}
                  <span>{result.rowCount.toLocaleString()}</span>
                </button>
              ))}
              {queryResponse && queryResponse.recordsAffected >= 0 && (
                <span className="hint">
                  {queryResponse.recordsAffected} rows affected
                </span>
              )}
              <div className="spacer" />
              {queryResponse?.results.length ? (
                <button
                  disabled={!!busy}
                  title="Copy every result set, with messages, as text"
                  onClick={() => void copyAllResults(queryResponse)}
                >
                  <Copy size={14} />
                  Copy all as text
                </button>
              ) : null}
              {data && (
                <button disabled={!!busy} onClick={() => setExportOpen(true)}>
                  <Download size={14} />
                  Export result
                </button>
              )}
            </div>
            {queryResponse?.messages.length ? (
              <details className="query-messages">
                <summary>Messages ({queryResponse.messages.length})</summary>
                <pre>{queryResponse.messages.join("\n")}</pre>
              </details>
            ) : null}
          </>
        ) : (
          table && (
            <>
              <div className="table-toolbar">
                <div>
                  <h1>{table.name}</h1>
                  <span className="tag">{table.kind}</span>
                </div>
                <div>
                  <button
                    disabled={!!busy}
                    onClick={() => tableRequest && loadTable(tableRequest)}
                  >
                    <RefreshCw size={14} />
                    Refresh
                  </button>
                  <button
                    disabled={!!busy || !data}
                    onClick={() => setExportOpen(true)}
                  >
                    <Download size={14} />
                    Export
                  </button>
                </div>
              </div>
              <FilterBar
                columns={tableData?.columns ?? []}
                filters={filters}
                match={match}
                onMatch={setMatch}
                onChange={(next) => {
                  setFilters(next);
                  if (!next.length && tableRequest?.filters.length)
                    void loadTable({ ...tableRequest, filters: [], offset: 0 });
                }}
                onApply={() =>
                  tableRequest &&
                  loadTable({ ...tableRequest, filters, match, offset: 0 })
                }
                disabled={!!busy}
              />
            </>
          )
        )}
        {data ? (
          <DataGrid
            key={`${mode}:${generation}`}
            data={data}
            table={mode === "table" ? table : null}
            edits={mode === "table" ? edits : []}
            onEdit={(edit) => {
              const columnIndex = data.columns.findIndex(
                (column) => column.name === edit.column,
              );
              setEdits((current) => [
                ...current.filter(
                  (item) =>
                    item.row !== edit.row || item.column !== edit.column,
                ),
                ...(data.rows[edit.row][columnIndex] === edit.value
                  ? []
                  : [edit]),
              ]);
            }}
            sort={mode === "table" ? (tableRequest?.sort ?? null) : null}
            descending={tableRequest?.descending ?? false}
            onSort={(column, descending) =>
              tableRequest &&
              loadTable({
                ...tableRequest,
                sort: column,
                descending:
                  descending ??
                  (tableRequest.sort === column && !tableRequest.descending),
                offset: 0,
              })
            }
            onFilter={(filter) => {
              setFilters((current) => [...current, filter]);
              setNotice(
                "Filter added. Click Apply filters to update the view.",
              );
            }}
            onNotice={setNotice}
            disabled={!!busy}
          />
        ) : (
          <div className="welcome">
            <p>
              {mode === "query"
                ? session
                  ? "Write SQL above, then run it to explore the results."
                  : "Connect to a database to run your SQL."
                : session
                  ? "Choose a table from the explorer, or open a query."
                  : "Connect to a database, or open SQL scripts from the sidebar."}
            </p>
            {!session && (
              <button className="primary" onClick={onConnect}>
                <PlugZap size={16} />
                Connect to database
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        )}
        {edits.length > 0 && mode === "table" && (
          <div className="edit-bar">
            <span>
              <span className="amber-dot" />
              {edits.length} unsaved {edits.length === 1 ? "cell" : "cells"}
            </span>
            <button disabled={!!busy} onClick={() => discardEdits()}>
              Discard changes
            </button>
            <button className="primary" disabled={!!busy} onClick={saveEdits}>
              <Check size={14} />
              Save changes
            </button>
          </div>
        )}
        <footer className="status-bar">
          <div>
            {busy ? (
              <>
                <LoaderCircle size={13} className="spin" />
                {busy}…
                <button
                  className="cancel-button"
                  onClick={() => controller.current?.abort()}
                  disabled={!controller.current}
                >
                  <Square size={10} />
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span
                  className={`connection-dot ${session ? "connected" : ""}`}
                />
                {data
                  ? `${data.rows.length.toLocaleString()} rows loaded`
                  : "Ready"}
                {elapsed !== null && (
                  <span className="muted">
                    · {(elapsed / 1000).toFixed(2)}s
                  </span>
                )}
              </>
            )}
          </div>
          <div>
            {data && (
              <>
                <span>
                  {data.rows.length ? offset + 1 : 0}–
                  {offset + data.rows.length}
                  {data.total !== null
                    ? ` of ${data.total.toLocaleString()}`
                    : ""}
                </span>
                <button
                  aria-label="Previous page"
                  className="icon-button"
                  disabled={!!busy || offset === 0}
                  onClick={() => page(Math.max(0, offset - 200))}
                >
                  <ArrowLeft size={14} />
                </button>
                <button
                  aria-label="Next page"
                  className="icon-button"
                  disabled={!!busy || !data.hasMore}
                  onClick={() => page(offset + 200)}
                >
                  <ArrowRight size={14} />
                </button>
              </>
            )}
            <span className="keyboard-hint">
              {mode === "table"
                ? "Double-click to edit · Shift + arrows to select · Ctrl C to copy"
                : "Ctrl Enter to run · Ctrl C to copy cells"}
            </span>
          </div>
        </footer>
      </main>
      {saveOpen && (
        <SaveQueryDialog
          library={library}
          existing={savedQuery}
          onClose={() => setSaveOpen(false)}
          onSave={(name, folderId) => {
            const id = savedId ?? crypto.randomUUID();
            setLibrary({
              ...library,
              queries: [
                ...library.queries.filter((query) => query.id !== id),
                { id, name, folderId, sql },
              ],
            });
            setSavedId(id);
            setScript(null);
            setLoadedSql("");
            setSaveOpen(false);
            setNotice("Query saved on this PC.");
          }}
        />
      )}
      {exportOpen && (
        <ExportDialog
          wholeTable={mode === "table"}
          onClose={() => setExportOpen(false)}
          onExport={(format, filtered) => {
            setExportOpen(false);
            void perform("Exporting", async (signal) => {
              const body =
                mode === "table"
                  ? {
                      table: {
                        ...tableRequest!,
                        filters: filtered ? tableRequest!.filters : [],
                      },
                      format,
                    }
                  : { resultId: result!.id, format };
              await download(
                endpoint("/export"),
                body,
                `${mode === "table" ? table!.name : "query-result"}.${format}`,
                signal,
              );
              setNotice("Export downloaded.");
            });
          }}
        />
      )}
    </div>
  );
}

function SaveQueryDialog({
  library,
  existing,
  onClose,
  onSave,
}: {
  library: Library;
  existing?: SavedQuery;
  onClose: () => void;
  onSave: (name: string, folder: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [folder, setFolder] = useState(existing?.folderId ?? "");
  return (
    <Modal title="Save query" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim(), folder);
        }}
      >
        <label>
          Query name
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Folder
          <select
            aria-label="Folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            <option value="">Unfiled</option>
            {library.folders.map((folder) => (
              <option value={folder.id} key={folder.id}>
                {folderPath(library, folder.id)}
              </option>
            ))}
          </select>
        </label>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save query</button>
        </footer>
      </form>
    </Modal>
  );
}
function ExportDialog({
  wholeTable,
  onClose,
  onExport,
}: {
  wholeTable: boolean;
  onClose: () => void;
  onExport: (format: string, filtered: boolean) => void;
}) {
  const [format, setFormat] = useState("csv");
  const [filtered, setFiltered] = useState(false);
  return (
    <Modal
      title={wholeTable ? "Export table" : "Export query result"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onExport(format, filtered);
        }}
      >
        <label>
          Format
          <select
            aria-label="Format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </label>
        {wholeTable && (
          <label>
            Rows
            <select
              value={filtered ? "filtered" : "all"}
              onChange={(e) => setFiltered(e.target.value === "filtered")}
            >
              <option value="all">Whole table — all rows</option>
              <option value="filtered">
                All rows matching applied filters
              </option>
            </select>
          </label>
        )}
        <p className="hint">
          {wholeTable
            ? "Exports every matching row, across all pages. Unsaved cell edits are excluded."
            : "Exports every row in the selected result set from the last successful execution."}{" "}
          CSV preserves raw values; NULL is an unquoted empty field. Use JSON to
          preserve types and nulls.
        </p>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">
            <Download size={14} />
            Download
          </button>
        </footer>
      </form>
    </Modal>
  );
}
