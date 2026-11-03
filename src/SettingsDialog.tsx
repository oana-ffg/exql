import { Modal } from "./Modal";
import { TimeoutSelect } from "./TimeoutSelect";

export function SettingsDialog({
  scriptTimeoutSeconds,
  onScriptTimeout,
  onClose,
}: {
  scriptTimeoutSeconds: number;
  onScriptTimeout: (seconds: number) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Settings" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <label>
          Default script timeout
          <TimeoutSelect
            value={scriptTimeoutSeconds}
            // Without a default option, this select never reports null.
            onChange={(seconds) => onScriptTimeout(seconds!)}
          />
        </label>
        <p className="hint">
          The limit applies to each batch separated by GO, and to each GO n
          repetition. To change it for one script, use Timeout next to Run SQL.
          Table loads and exports keep their 120-second limit.
        </p>
        <footer className="modal-footer">
          <button className="primary">Done</button>
        </footer>
      </form>
    </Modal>
  );
}
