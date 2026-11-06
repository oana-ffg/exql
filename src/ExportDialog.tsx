import { useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "./Modal";

export function ExportDialog({
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
