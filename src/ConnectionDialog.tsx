import { useEffect, useState } from "react";
import {
  ArrowRight,
  Database,
  Folder,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Modal } from "./Modal";
import { request } from "./api";
import type { Connection, ConnectionProfile } from "./types";

const defaults: Connection = {
  server: "localhost",
  database: "master",
  authentication: "windows",
  username: "",
  password: "",
  encrypt: true,
  trustServerCertificate: false,
};
export function ConnectionDialog({
  busy,
  onConnect,
  onClose,
}: {
  busy: boolean;
  onConnect: (connection: Connection | string) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Connection>(defaults);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [remember, setRemember] = useState(true);
  const [keepPassword, setKeepPassword] = useState(false);
  const [showString, setShowString] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const disabled = busy || pending;
  const stringMode = form.authentication === "connectionString";
  useEffect(() => {
    const abort = new AbortController();
    request<ConnectionProfile[]>("/profiles", undefined, abort.signal)
      .then(setProfiles)
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
      });
    return () => abort.abort();
  }, []);
  function set<K extends keyof Connection>(key: K, value: Connection[K]) {
    setForm({ ...form, [key]: value });
  }
  function newConnection() {
    setId(null);
    setForm(defaults);
    setName("");
    setFolder("");
    setKeepPassword(false);
    setShowString(false);
    setRemember(true);
    setError("");
  }
  async function connectSaved(profile: ConnectionProfile) {
    setError("");
    try {
      await onConnect(profile.id);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function save() {
    const profile = await request<ConnectionProfile>("/profiles", {
      id,
      name,
      folder,
      connection: form,
      keepPassword,
    });
    setProfiles((current) => [
      ...current.filter((item) => item.id !== profile.id),
      profile,
    ]);
    setId(profile.id);
    setKeepPassword(form.authentication === "sql" || stringMode);
    setForm({ ...profile.connection, password: "", connectionString: "" });
    return profile.id;
  }
  return (
    <Modal
      title="Database connections"
      onClose={() => {
        if (!disabled) onClose();
      }}
    >
      <div className="saved-connections">
        {[...new Set(profiles.map((profile) => profile.folder))]
          .sort()
          .map((group) => (
            <div key={group}>
              <div className="connection-group">
                <Folder size={12} />
                {group || "Connections"}
              </div>
              {profiles
                .filter((profile) => profile.folder === group)
                .map((profile) => (
                  <div
                    className={`profile-row ${id === profile.id ? "active" : ""}`}
                    key={profile.id}
                  >
                    <button
                      type="button"
                      disabled={disabled}
                      className="profile-select"
                      onClick={() => {
                        setId(profile.id);
                        setForm({
                          ...profile.connection,
                          username: profile.connection.username ?? "",
                          password: "",
                          connectionString: "",
                        });
                        setName(profile.name);
                        setFolder(profile.folder);
                        setKeepPassword(
                          profile.connection.authentication === "sql" ||
                            profile.connection.authentication ===
                              "connectionString",
                        );
                        setShowString(false);
                        setRemember(true);
                        setError("");
                      }}
                    >
                      <Database size={14} />
                      <span>
                        <strong>{profile.name}</strong>
                        <small>
                          {profile.connection.server} /{" "}
                          {profile.connection.database}
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`Connect to ${profile.name}`}
                      className="icon-button"
                      onClick={() => connectSaved(profile)}
                    >
                      <ArrowRight size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`Delete connection ${profile.name}`}
                      className="icon-button"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Delete ${profile.name} and its saved credential?`,
                          )
                        )
                          return;
                        setPending(true);
                        setError("");
                        try {
                          await request(
                            `/profiles/${profile.id}`,
                            undefined,
                            undefined,
                            "DELETE",
                          );
                          setProfiles(
                            profiles.filter((item) => item.id !== profile.id),
                          );
                          if (id === profile.id) newConnection();
                        } catch (error) {
                          setError((error as Error).message);
                        } finally {
                          setPending(false);
                        }
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
            </div>
          ))}
        <button
          type="button"
          className="new-connection-button"
          disabled={disabled}
          onClick={newConnection}
        >
          <Plus size={14} />
          New connection
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setPending(true);
          try {
            await onConnect(remember ? await save() : form);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="connection-type">
          <Database size={24} />
          <div>
            <strong>{id ? name : "New SQL Server connection"}</strong>
            <span>SQL Server & Azure SQL Database</span>
          </div>
        </div>
        <fieldset disabled={disabled}>
          <label className="check-label">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => {
                setRemember(e.target.checked);
                if (!e.target.checked) setKeepPassword(false);
              }}
            />
            Save this connection
          </label>
          {remember && (
            <div className="form-columns">
              <label>
                Connection name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Folder (optional)
                <input
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                />
              </label>
            </div>
          )}
          <label>
            Connection method
            <select
              aria-label="Connection method"
              value={stringMode ? "connectionString" : "fields"}
              onChange={(event) => {
                setForm({
                  ...form,
                  authentication:
                    event.target.value === "connectionString"
                      ? "connectionString"
                      : "windows",
                  connectionString: "",
                  password: "",
                });
                setKeepPassword(false);
                setShowString(false);
              }}
            >
              <option value="fields">Connection details</option>
              <option value="connectionString">Connection string</option>
            </select>
          </label>
          {stringMode ? (
            <>
              {id && remember && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={keepPassword}
                    onChange={(event) => setKeepPassword(event.target.checked)}
                  />
                  Keep the saved connection string
                </label>
              )}
              {!keepPassword && (
                <>
                  <label>
                    Connection string
                    <input
                      type={showString ? "text" : "password"}
                      required
                      autoComplete="off"
                      spellCheck={false}
                      value={form.connectionString ?? ""}
                      onChange={(event) =>
                        set("connectionString", event.target.value)
                      }
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={showString}
                      onChange={(event) => setShowString(event.target.checked)}
                    />
                    Show connection string
                  </label>
                </>
              )}
              <p className="hint">
                Paste a SQL Server / Azure SQL connection string with a server
                and database. Its authentication, encryption, and advanced
                options are used directly.
              </p>
            </>
          ) : (
            <>
              <label>
                Server
                <input
                  required
                  value={form.server}
                  onChange={(e) => set("server", e.target.value)}
                />
              </label>
              <label>
                Database
                <input
                  required
                  value={form.database}
                  onChange={(e) => set("database", e.target.value)}
                />
              </label>
              <label>
                Authentication
                <select
                  value={form.authentication}
                  onChange={(e) => {
                    set(
                      "authentication",
                      e.target.value as Connection["authentication"],
                    );
                    setKeepPassword(false);
                  }}
                >
                  <option value="windows">Windows integrated</option>
                  <option value="sql">SQL Server login</option>
                  <option value="entra">Microsoft Entra interactive</option>
                </select>
              </label>
              {form.authentication !== "windows" && (
                <label>
                  {form.authentication === "entra"
                    ? "Email (optional)"
                    : "Username"}
                  <input
                    autoComplete="off"
                    required={form.authentication === "sql"}
                    value={form.username}
                    onChange={(e) => set("username", e.target.value)}
                  />
                </label>
              )}
              {form.authentication === "sql" && (
                <>
                  {id && (
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={keepPassword}
                        onChange={(e) => setKeepPassword(e.target.checked)}
                      />
                      Keep the saved password
                    </label>
                  )}
                  {!keepPassword && (
                    <label>
                      Password
                      <input
                        type="password"
                        autoComplete="off"
                        value={form.password}
                        onChange={(e) => set("password", e.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.encrypt}
                  onChange={(e) => set("encrypt", e.target.checked)}
                />
                Encrypt connection
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.trustServerCertificate}
                  onChange={(e) =>
                    set("trustServerCertificate", e.target.checked)
                  }
                />
                Trust server certificate (local development)
              </label>
            </>
          )}
        </fieldset>
        <p className="hint">
          <ShieldCheck size={14} />
          Saved passwords and full connection strings are encrypted in Windows
          Credential Manager for your Windows account. They are never returned
          to the interface.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" onClick={onClose} disabled={disabled}>
            Cancel
          </button>
          {remember && (
            <button
              type="button"
              disabled={disabled || !name.trim()}
              onClick={async () => {
                setPending(true);
                setError("");
                try {
                  await save();
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setPending(false);
                }
              }}
            >
              Save only
            </button>
          )}
          <button className="primary" disabled={disabled}>
            {disabled ? "Connecting…" : remember ? "Save & connect" : "Connect"}
            <ArrowRight size={15} />
          </button>
        </footer>
      </form>
    </Modal>
  );
}
