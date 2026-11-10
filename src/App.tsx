import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Database, LoaderCircle, Plus, Settings, X } from "lucide-react";
import { useScriptFolders } from "./scriptFolders";
import { request } from "./api";
import { ConnectionDialog } from "./ConnectionDialog";
import { UpdateNotice } from "./UpdateNotice";
import { Workspace } from "./Workspace";
import { useStored } from "./storage";
import { applyPaneLayout, type Pane } from "./paneLayout";
import { defaultSettings, type AppSettings } from "./settings";
import { SettingsDialog } from "./SettingsDialog";
import type { Connection, ConnectionProfile, Library, Session } from "./types";
import {
  connectionColors,
  connectionColorStyle,
  nextConnectionColor,
} from "./connectionColors";
import { moveById, useDragReorder, type DropSide } from "./reorder";

interface Draft {
  id: string;
  name: string;
  sql: string;
  color?: string;
  profileId?: string | null;
  disconnected?: boolean;
}
interface Activity {
  busy: string;
  edits: number;
}
interface Reconnect {
  pending: boolean;
  error: string;
}
type Scratch = string | Draft[];
const emptyLibrary: Library = { folders: [], queries: [] };
const blankTabName = "Workspace";
const draftsFrom = (scratch: Scratch): Draft[] =>
  (typeof scratch === "string" || !scratch.length
    ? [
        {
          id: "scratch",
          name: blankTabName,
          sql: typeof scratch === "string" ? scratch : "",
        },
      ]
    : scratch
  ).map((draft, index) => ({
    ...draft,
    color:
      draft.color ?? connectionColors[index % connectionColors.length].value,
  }));

export default function App() {
  // Read the legacy single SQL draft without rewriting saved work on load.
  const [scratch, setScratch, scratchReady] = useStored<Scratch>("scratch", "");
  const [library, setLibrary, libraryReady] = useStored(
    "library",
    emptyLibrary,
  );
  const [storedSettings, setSettings, settingsReady] = useStored<
    Partial<AppSettings>
  >("settings", {});
  const settings = { ...defaultSettings, ...storedSettings };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessions, setSessions] = useState<Record<string, Session | null>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  // A target is the offline tab whose own button opened the dialog.
  const [connectionDialog, setConnectionDialog] = useState<{
    target: string | null;
  } | null>(null);
  const [reconnects, setReconnects] = useState<Record<string, Reconnect>>({});
  const [connecting, setConnecting] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const scriptFolders = useScriptFolders(
    setError,
    settings.scriptSort,
    (scriptSort) => setSettings((current) => ({ ...current, scriptSort })),
  );
  const activeTab = useRef<HTMLButtonElement>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const drafts = draftsFrom(scratch);
  const active = drafts.find((draft) => draft.id === activeId) ?? drafts[0];
  const ready = scratchReady && libraryReady && settingsReady;
  useLayoutEffect(
    () => applyPaneLayout(settings),
    [settings.sidebarWidth, settings.editorHeight],
  );
  const resizePane = (pane: Pane, size: number | null) =>
    setSettings((current) => ({ ...current, [pane]: size }));
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
    scriptFolders.adding ||
    Object.values(activity).some((item) => item.busy || item.edits);

  useLayoutEffect(() => {
    window.exqlWorkspaceReady = ready;
    window.exqlDirty = dirty;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || window.exqlPendingWrites || window.exqlStorageFailed)
        event.preventDefault();
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

  function clearReconnect(id: string) {
    setReconnects((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }
  function attachSession(id: string, session: Session) {
    setScratch((current) => {
      const tabs = draftsFrom(current);
      const details = {
        name: session.name,
        color: session.color ?? undefined,
        profileId: session.profileId,
        disconnected: false,
      };
      return tabs.some((tab) => tab.id === id)
        ? tabs.map((tab) => (tab.id === id ? { ...tab, ...details } : tab))
        : [...tabs, { id, sql: "", ...details }];
    });
    setSessions((current) => ({ ...current, [id]: session }));
    clearReconnect(id);
  }
  async function reconnect(draft: Draft) {
    setReconnects((current) => ({
      ...current,
      [draft.id]: { pending: true, error: "" },
    }));
    try {
      const connected = await request<Session>(
        `/profiles/${draft.profileId}/connect`,
        {},
      );
      attachSession(draft.id, {
        ...connected,
        color: connected.color ?? draft.color ?? null,
      });
    } catch (error) {
      setReconnects((current) => ({
        ...current,
        [draft.id]: { pending: false, error: (error as Error).message },
      }));
    }
  }
  // Tabs are saved across restarts, so their saved connections come back with them.
  const restoring = useRef(false);
  useEffect(() => {
    if (!ready || restoring.current) return;
    restoring.current = true;
    const tabs = drafts.filter((tab) => tab.profileId && !tab.disconnected);
    if (!tabs.length) return;
    setReconnects(
      Object.fromEntries(
        tabs.map((tab) => [tab.id, { pending: true, error: "" }]),
      ),
    );
    request<ConnectionProfile[]>("/profiles").then(
      (profiles) => {
        for (const tab of tabs) {
          const profile = profiles.find((item) => item.id === tab.profileId);
          // Entra sign-in opens a browser window, so it waits for a click.
          if (profile?.connection.authentication === "entra")
            clearReconnect(tab.id);
          else void reconnect(tab);
        }
      },
      (error: Error) => {
        setReconnects(
          Object.fromEntries(
            tabs.map((tab) => [
              tab.id,
              { pending: false, error: error.message },
            ]),
          ),
        );
      },
    );
    // Only the tabs loaded at startup are restored; later tabs connect explicitly.
  }, [ready]);

  async function connect(
    connection: Connection | string,
    preferredColor?: string,
  ) {
    setConnecting(true);
    try {
      const connected =
        typeof connection === "string"
          ? await request<Session>(`/profiles/${connection}/connect`, {})
          : await request<Session>("/connect", connection);
      const session = {
        ...connected,
        color:
          connected.color ??
          preferredColor ??
          nextConnectionColor(drafts.map((draft) => draft.color)),
      };
      // Only the untouched starting tab is filled; anything else keeps its tab.
      const blank =
        active.name === blankTabName &&
        !sessions[active.id] &&
        !active.profileId &&
        !active.sql.trim();
      const id =
        connectionDialog?.target ?? (blank ? active.id : crypto.randomUUID());
      attachSession(id, session);
      setActiveId(id);
      setConnectionDialog(null);
    } finally {
      setConnecting(false);
    }
  }
  function connectTab(draft: Draft) {
    // A second attempt could finish after, and overwrite, a connection chosen later.
    if (reconnects[draft.id]?.pending) return;
    if (sessions[draft.id]) setConnectionDialog({ target: null });
    else if (draft.profileId) void reconnect(draft);
    else setConnectionDialog({ target: draft.id });
  }
  function updateProfile(profile: ConnectionProfile) {
    if (drafts.some((draft) => draft.profileId === profile.id))
      setScratch((current) =>
        draftsFrom(current).map((draft) =>
          draft.profileId === profile.id
            ? { ...draft, name: profile.name, color: profile.color }
            : draft,
        ),
      );
    setSessions((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, session]) => [
          id,
          session?.profileId === profile.id
            ? { ...session, name: profile.name, color: profile.color }
            : session,
        ]),
      ),
    );
  }
  function moveTab(id: string, targetId: string, side: DropSide) {
    setScratch((current) => moveById(draftsFrom(current), id, targetId, side));
  }
  const tabDrag = useDragReorder({ axis: "x", onMove: moveTab });
  const keptSql = useRef(new Map<string, string>());
  async function closeWorkspace(draft: Draft) {
    if (activity[draft.id]?.busy || reconnects[draft.id]?.pending || closing)
      return;
    // Staged cell edits are not SQL text, so they cannot be kept in temp_queries.
    if (
      activity[draft.id]?.edits &&
      !window.confirm(
        `Close ${draft.name}? Its staged cell edits will be discarded.`,
      )
    )
      return;
    setClosing(draft.id);
    setError("");
    try {
      const keepSql =
        draft.sql.trim() &&
        !library.queries.some((query) => query.sql === draft.sql);
      // Save first: if this fails the tab stays open with its text.
      if (keepSql && keptSql.current.get(draft.id) !== draft.sql) {
        await request("/temp-queries", { name: draft.name, sql: draft.sql });
        // Retrying a close that failed later on must not save a second copy.
        keptSql.current.set(draft.id, draft.sql);
        void scriptFolders.refresh();
      }
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
          : [{ id: crypto.randomUUID(), name: blankTabName, sql: "" }];
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
      clearReconnect(draft.id);
      keptSql.current.delete(draft.id);
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
    <div className="application" style={connectionColorStyle(active.color)}>
      <header className="app-toolbar">
        <nav className="connection-tabs" aria-label="Database workspaces">
          <div ref={tabList} role="tablist" aria-label="Database connections">
            {drafts.map((draft) => (
              <div
                className={`connection-tab ${active.id === draft.id ? "active" : ""}`}
                style={connectionColorStyle(draft.color)}
                key={draft.id}
                {...tabDrag.bind(draft.id)}
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
                    if (event.shiftKey) {
                      const toStart =
                        event.key === "ArrowLeft" || event.key === "Home";
                      const target =
                        drafts[
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? drafts.length - 1
                              : index + (toStart ? -1 : 1)
                        ];
                      if (target)
                        moveTab(
                          draft.id,
                          target.id,
                          toStart ? "before" : "after",
                        );
                      return;
                    }
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
                  disabled={
                    !!activity[draft.id]?.busy ||
                    !!reconnects[draft.id]?.pending ||
                    !!closing
                  }
                  onClick={() => void closeWorkspace(draft)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="add-connection"
            onClick={() => setConnectionDialog({ target: null })}
            disabled={connecting || !!closing}
          >
            <Plus size={15} /> Add connection
          </button>
          <button
            className="icon-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={15} />
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
      {/* A stable order, because moving a panel in the DOM would reset its scroll
          positions. Only one panel shows, so this order is never visible. */}
      {[...drafts]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((draft) => (
          <Workspace
            key={draft.id}
            id={draft.id}
            active={active.id === draft.id}
            closing={closing === draft.id}
            session={sessions[draft.id] ?? null}
            onSession={(session) => {
              setSessions((current) => ({ ...current, [draft.id]: session }));
              if (!session)
                setScratch((current) =>
                  draftsFrom(current).map((tab) =>
                    tab.id === draft.id ? { ...tab, disconnected: true } : tab,
                  ),
                );
            }}
            sql={draft.sql}
            setSql={(sql) =>
              setScratch((current) =>
                draftsFrom(current).map((tab) =>
                  tab.id === draft.id ? { ...tab, sql } : tab,
                ),
              )
            }
            scriptFolders={scriptFolders}
            library={library}
            setLibrary={setLibrary}
            savedConnection={draft.profileId ? draft.name : null}
            reconnecting={!!reconnects[draft.id]?.pending}
            reconnectError={reconnects[draft.id]?.error ?? ""}
            onConnect={() => connectTab(draft)}
            onChooseConnection={() => setConnectionDialog({ target: draft.id })}
            onActivity={reportActivity}
            onPaneResize={resizePane}
            defaultTimeoutSeconds={settings.scriptTimeoutSeconds}
          />
        ))}
      {settingsOpen && (
        <SettingsDialog
          scriptTimeoutSeconds={settings.scriptTimeoutSeconds}
          onScriptTimeout={(scriptTimeoutSeconds) =>
            setSettings((current) => ({ ...current, scriptTimeoutSeconds }))
          }
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {connectionDialog && (
        <ConnectionDialog
          busy={connecting}
          onConnect={connect}
          usedColors={drafts.map((draft) => draft.color)}
          onProfileSaved={updateProfile}
          onClose={() => {
            if (!connecting) setConnectionDialog(null);
          }}
        />
      )}
    </div>
  );
}
