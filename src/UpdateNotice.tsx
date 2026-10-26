import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";

interface UpdateState {
  status:
    | "unavailable"
    | "idle"
    | "checking"
    | "downloading"
    | "current"
    | "ready"
    | "error";
  currentVersion: string;
  availableVersion: string | null;
  progress: number;
  message: string | null;
}

interface DesktopMessage {
  data: { type: string; state: UpdateState };
}

declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage(message: string): void;
        addEventListener(
          type: "message",
          handler: (event: DesktopMessage) => void,
        ): void;
        removeEventListener(
          type: "message",
          handler: (event: DesktopMessage) => void,
        ): void;
      };
    };
  }
}

export function UpdateNotice() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [manual, setManual] = useState(false);
  const bridge = window.chrome?.webview;
  useEffect(() => {
    if (!bridge) return;
    const receive = (event: DesktopMessage) => {
      if (event.data.type === "updates") {
        setState(event.data.state);
        setDismissed(false);
      }
    };
    bridge.addEventListener("message", receive);
    bridge.postMessage("updates.status");
    return () => bridge.removeEventListener("message", receive);
  }, [bridge]);
  useEffect(() => {
    if (state?.status !== "current" || !manual) return;
    const timeout = setTimeout(() => setManual(false), 5000);
    return () => clearTimeout(timeout);
  }, [state?.status, manual]);

  if (!state || state.status === "unavailable") return null;
  const working = state.status === "checking" || state.status === "downloading";
  const ready = state.status === "ready";
  const text =
    state.message ??
    (ready
      ? `Version ${state.availableVersion} is ready. Restart when convenient.`
      : state.status === "downloading"
        ? `Downloading version ${state.availableVersion} — ${state.progress}%`
        : state.status === "checking"
          ? "Checking for updates…"
          : state.status === "current"
            ? "You’re up to date."
            : "Updates download automatically.");

  const showMessage =
    !dismissed &&
    (working ||
      ready ||
      state.status === "error" ||
      !!state.message ||
      (state.status === "current" && manual));
  return (
    <>
      <div className="update-controls">
        <span className="update-version">ExQL {state.currentVersion}</span>
        <button
          type="button"
          disabled={working}
          onClick={() => {
            setManual(true);
            setDismissed(false);
            bridge?.postMessage(ready ? "updates.restart" : "updates.check");
          }}
        >
          {ready ? <RefreshCw size={13} /> : <Download size={13} />}
          {ready
            ? "Restart to update"
            : state.status === "error"
              ? "Retry update"
              : "Check for updates"}
        </button>
      </div>
      {showMessage && (
        <div
          className={`update-notice ${state.status === "error" || state.message ? "update-warning" : ""}`}
        >
          <span className="update-message" role="status">
            {text}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss update notice"
            onClick={() => {
              setDismissed(true);
              setManual(false);
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
