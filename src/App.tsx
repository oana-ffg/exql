import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Database, LoaderCircle, Plus, X } from "lucide-react";
import { request } from "./api";
import { ConnectionDialog } from "./ConnectionDialog";
import { UpdateNotice } from "./UpdateNotice";
import { Workspace } from "./Workspace";
import { useStored } from "./storage";
import type { Connection, Library, Session } from "./types";

interface Draft {
  id: string;
  name: string;
  sql: string;
}
interface Activity {
  busy: string;
  edits: number;
}
type Scratch = string | Draft[];
const emptyLibrary: Library = { folders: [], queries: [] };
const draftsFrom = (scratch: Scratch): Draft[] =>
  typeof scratch === "string" || !scratch.length
    ? [
        {
          id: "scratch",
          name: "Workspace",
          sql: typeof scratch === "string" ? scratch : "",
        },
      ]
    : scratch;

export default function App() {
  // Read the legacy single SQL draft without rewriting saved work on load.
  const [scratch, setScratch, scratchReady] = useStored<Scratch>("scratch", "");
  const [library, setLibrary, libraryReady] = useStored(
    "library",
    emptyLibrary,
  );
  const [sessions, setSessions] = useState<Record<string, Session | null>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const activeTab = useRef<HTMLButtonElement>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const drafts = draftsFrom(scratch);
  const active = drafts.find((draft) => draft.id === activeId) ?? drafts[0];
  const ready = scratchReady && libraryReady;
  useLayoutEffect(() => {
    const revealActiveTab = () =>
      activeTab.current?.parentElement?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    revealActiveTab();
    if (!tabList.current) return;
    const observer = new ResizeObserver(revealActiveTab);
    observer.observe(tabList.current);
    return () => observer.disconnect();
  }, [active.id, ready]);
  const dirty =
    connecting ||
    !!closing ||
    Object.values(activity).some((item) => item.busy || item.edits);

  useLayoutEffect(() => {
    window.exqlWorkspaceReady = ready;
    window.exqlDirty = dirty;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.exqlWorkspaceReady = false;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [ready, dirty]);
  useEffect(() => {
    const handler = (event: Event) =>
      setError((event as CustomEvent<string>).detail);
    window.addEventListener("exql-storage-error", handler);
    return () => window.removeEventListener("exql-storage-error", handler);
  }, []);
  const reportActivity = useCallback((id: string, next: Activity) => {
    setActivity((current) => ({ ...current, [id]: next }));
  }, []);

  async function connect(connection: Connection | string) {
    setConnecting(true);
    try {
      const session =
        typeof connection === "string"
          ? await request<Session>(`/profiles/${connection}/connect`, {})
          : await request<Session>("/connect", connection);
      const id = sessions[active.id] ? crypto.randomUUID() : active.id;
      setScratch((current) => {
        const tabs = draftsFrom(current);
        const name = session.name;
        return id === active.id
          ? tabs.map((tab) => (tab.id === id ? { ...tab, name } : tab))
          : [...tabs, { id, name, sql: "" }];
      });
      setSessions((current) => ({ ...current, [id]: session }));
      setActiveId(id);
      setConnectionOpen(false);
    } finally {
      setConnecting(false);
    }
  }
  async function closeWorkspace(draft: Draft) {
    if (activity[draft.id]?.busy || closing) return;
    if (
      (draft.sql.trim() || activity[draft.id]?.edits) &&
      !window.confirm(
        `Close ${draft.name}? Its SQL draft and staged cell edits will be discarded. Saved queries are kept.`,
      )
    )
      return;
    setClosing(draft.id);
    setError("");
    try {
      const session = sessions[draft.id];
      if (session)
        await request(
          `/sessions/${session.id}`,
          undefined,
          undefined,
          "DELETE",
        );
      setScratch((current) => {
        const remaining = draftsFrom(current).filter(
          (tab) => tab.id !== draft.id,
        );
        return remaining.length
          ? remaining
          : [{ id: crypto.randomUUID(), name: "Workspace", sql: "" }];
      });
      setSessions((current) => {
        const next = { ...current };
        delete next[draft.id];
        return next;
      });
      setActivity((current) => {
        const next = { ...current };
        delete next[draft.id];
        return next;
      });
    } catch (error) {
      setError(`Could not close workspace: ${(error as Error).message}`);
    } finally {
      setClosing(null);
    }
  }

  if (!ready)
    return (
      <main className="sql-editor hint" role="status">
        <p>{error || "Loading saved workspace…"}</p>
        {error && (
          <button onClick={() => window.location.reload()}>Retry</button>
        )}
      </main>
    );

  return (
    <div className="application">
      <header className="app-toolbar">
        <nav className="connection-tabs" aria-label="Database workspaces">
          <div ref={tabList} role="tablist" aria-label="Database connections">
            {drafts.map((draft) => (
              <div
                className={`connection-tab ${active.id === draft.id ? "active" : ""}`}
                key={draft.id}
              >
                <button
                  role="tab"
                  ref={active.id === draft.id ? activeTab : undefined}
                  id={`tab-${draft.id}`}
                  aria-controls={`workspace-${draft.id}`}
                  aria-selected={active.id === draft.id}
                  tabIndex={active.id === draft.id ? 0 : -1}
                  onClick={() => setActiveId(draft.id)}
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const index = drafts.indexOf(draft);
                    const next =
                      drafts[
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? drafts.length - 1
                            : (index +
                                (event.key === "ArrowLeft" ? -1 : 1) +
                                drafts.length) %
                              drafts.length
                      ];
                    setActiveId(next.id);
                    document.getElementById(`tab-${next.id}`)?.focus();
                  }}
                  title={[
                    draft.name,
                    sessions[draft.id] &&
                      `${sessions[draft.id]!.database} · ${sessions[draft.id]!.server}`,
                    activity[draft.id]?.busy,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                >
                  {activity[draft.id]?.busy ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <Database size={14} />
                  )}
                  <span className="connection-tab-name">{draft.name}</span>
                  {!!activity[draft.id]?.edits && (
                    <span title="Unsaved cell edits">●</span>
                  )}
                  <span
                    className={`connection-dot ${sessions[draft.id] ? "connected" : ""}`}
                  />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Close workspace ${draft.name}`}
                  disabled={!!activity[draft.id]?.busy || !!closing}
                  onClick={() => void closeWorkspace(draft)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="add-connection"
            onClick={() => setConnectionOpen(true)}
            disabled={connecting || !!closing}
          >
            <Plus size={15} /> Add connection
          </button>
        </nav>
        <UpdateNotice />
      </header>
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
      {drafts.map((draft) => (
        <Workspace
          key={draft.id}
          id={draft.id}
          active={active.id === draft.id}
          session={sessions[draft.id] ?? null}
          onSession={(session) =>
            setSessions((current) => ({ ...current, [draft.id]: session }))
          }
          sql={draft.sql}
          setSql={(sql) =>
            setScratch((current) =>
              draftsFrom(current).map((tab) =>
                tab.id === draft.id ? { ...tab, sql } : tab,
              ),
            )
          }
          library={library}
          setLibrary={setLibrary}
          onConnect={() => setConnectionOpen(true)}
          onActivity={reportActivity}
        />
      ))}
      {connectionOpen && (
        <ConnectionDialog
          busy={connecting}
          onConnect={connect}
          onClose={() => {
            if (!connecting) setConnectionOpen(false);
          }}
        />
      )}
    </div>
  );
}
