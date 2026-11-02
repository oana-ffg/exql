export interface UpdateState {
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

export interface DesktopMessage {
  data:
    | { type: "updates"; state: UpdateState }
    | { type: "folder-picked"; path: string | null; error: string | null };
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

export function canPickFolder() {
  return !!window.chrome?.webview;
}

/** Opens the native folder picker. Resolves to null when it is cancelled. */
export function pickFolder() {
  return new Promise<string | null>((resolve, reject) => {
    const bridge = window.chrome?.webview;
    if (!bridge) {
      reject(new Error("Choosing a folder requires the ExQL desktop app."));
      return;
    }
    const receive = (event: DesktopMessage) => {
      if (event.data.type !== "folder-picked") return;
      bridge.removeEventListener("message", receive);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.path);
    };
    bridge.addEventListener("message", receive);
    bridge.postMessage("folders.pick");
  });
}
