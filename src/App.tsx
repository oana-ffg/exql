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
import { request, download } from "./api";
import { ConnectionDialog } from "./ConnectionDialog";
import { DataGrid } from "./DataGrid";
import { FilterBar } from "./FilterBar";
import { Modal } from "./Modal";
import { Sidebar } from "./Sidebar";
import { UpdateNotice } from "./UpdateNotice";
import { useStored } from "./storage";
import type {
  Connection,
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

const emptyLibrary: Library = { folders: [], queries: [] };
const SqlEditor = lazy(() =>
  import("./SqlEditor").then((module) => ({ default: module.SqlEditor })),
);
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [mode, setMode] = useState<"table" | "query">("table");
  const [table, setTable] = useState<TableId | null>(null);
  const [tableData, setTableData] = useState<GridResult | null>(null);
  const [tableRequest, setTableRequest] = useState<TableRequest | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [edits, setEdits] = useState<Edit[]>([]);
  const [sql, setSql] = useStored("scratch", "");
  const [selection, setSelection] = useState("");
  const [library, setLibrary] = useStored("library", emptyLibrary);
  const [savedId, setSavedId] = useState<string | null>(null);
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
  const savedQuery = library.queries.find((query) => query.id === savedId);

  useLayoutEffect(() => {
    window.exqlWorkspaceReady = true;
    window.exqlDirty = edits.length > 0 || !!busy;
    const handler = (event: BeforeUnloadEvent) => {
      if (edits.length || busy) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.exqlWorkspaceReady = false;
      window.removeEventListener("beforeunload", handler);
    };
  }, [edits.length, busy]);
  useEffect(() => {
    const handler = (event: Event) =>
      setError((event as CustomEvent<string>).detail);
    window.addEventListener("exql-storage-error", handler);
    return () => window.removeEventListener("exql-storage-error", handler);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timeout);
  }, [notice]);

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
  async function connect(connection: Connection | string) {
    setBusy("Connecting");
    try {
      const next =
        typeof connection === "string"
          ? await request<Session>(`/profiles/${connection}/connect`, {})
          : await request<Session>("/connect", connection);
      if (session)
        await request(endpoint(""), undefined, undefined, "DELETE").catch(
          () => {},
        );
      setSession(next);
      setTable(null);
      setTableData(null);
      setTableRequest(null);
      setQueryData(null);
      setQueryResponse(null);
      setEdits([]);
      setConnectionOpen(false);
      setError("");
    } finally {
      setBusy("");
    }
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
    setSelection("");
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
  async function runQuery() {
    if (!session || !(selection || sql).trim() || busy) return;
    await perform("Running SQL", async (signal) => {
      const response = await request<QueryResponse>(
        endpoint("/query"),
        { sql: selection || sql },
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
    if (library.queries.some((query) => query.folderId === id)) {
      setNotice(
        "Move or delete the queries in this folder before deleting it.",
      );
      return;
    }
    setLibrary({
      ...library,
      folders: library.folders.filter((folder) => folder.id !== id),
    });
  }

  return (
    <div className="app-shell">
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
            setSession((current) => (current ? { ...current, catalog } : null));
          })
        }
        onQuery={openQuery}
        onSql={(text) => openQuery(undefined, text)}
        onNotice={setNotice}
        onNewQuery={() => openQuery()}
        onConnect={() => {
          if (discardEdits()) setConnectionOpen(true);
        }}
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
            <strong>
              {mode === "query"
                ? (savedQuery?.name ?? "Untitled query")
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
                      setSession(null);
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
        <UpdateNotice />
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
              className={mode === "query" ? "tab active" : "tab"}
              disabled={!!busy}
              onClick={() => {
                if (discardEdits()) setMode("query");
              }}
            >
              <Code2 size={14} />
              {savedQuery?.name ?? "SQL query"}
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
                <strong>{savedQuery?.name ?? "Untitled query"}</strong>
                <span className="hint">T-SQL</span>
              </div>
              <div>
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
            <div className="welcome-icon">
              {mode === "query" ? <Code2 size={32} /> : <Table2 size={32} />}
            </div>
            <span className="eyebrow">YOUR SQL WORKSPACE</span>
            <h1>
              {mode === "query"
                ? "A question starts with a query."
                : "Get closer to your data."}
            </h1>
            <p>
              {mode === "query"
                ? session
                  ? "Write SQL above, then run it to explore the results."
                  : "Connect to a database to run your SQL."
                : session
                  ? "Choose a table from the explorer, or open a query."
                  : "Browse, filter, and edit SQL Server data in a focused, spreadsheet-style workspace."}
            </p>
            {!session && (
              <button
                className="primary"
                onClick={() => setConnectionOpen(true)}
              >
                <PlugZap size={16} />
                Connect to database
                <ArrowRight size={16} />
              </button>
            )}
            <div className="welcome-features">
              <span>
                <Table2 size={16} />
                Explore tables
              </span>
              <span>
                <Code2 size={16} />
                Write SQL
              </span>
              <span>
                <Download size={16} />
                Take your data with you
              </span>
            </div>
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
                <span className="connection-dot connected" />
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
      {connectionOpen && (
        <ConnectionDialog
          busy={!!busy}
          onConnect={connect}
          onClose={() => {
            if (!busy) setConnectionOpen(false);
          }}
        />
      )}
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
                {folder.name}
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
