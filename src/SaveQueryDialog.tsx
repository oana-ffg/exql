import { useState } from "react";
import { Modal } from "./Modal";
import { folderPath } from "./queryLibrary";
import type { Library, SavedQuery } from "./types";

export function SaveQueryDialog({
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
