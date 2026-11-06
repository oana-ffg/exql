import type { ReactNode } from "react";
import { Copy, Download } from "lucide-react";
import type { QueryResponse } from "./types";

export function QueryResults({
  response,
  resultIndex,
  hasData,
  busy,
  onSelectResult,
  onCopyAll,
  onExport,
  children,
}: {
  response: QueryResponse;
  resultIndex: number;
  hasData: boolean;
  busy: boolean;
  onSelectResult: (index: number) => void;
  onCopyAll: () => void;
  onExport: () => void;
  children: ReactNode;
}) {
  return (
    <div className={hasData ? "results-pane split" : "results-pane"}>
      {(response.results.length > 0 || response.recordsAffected >= 0) && (
        <div className="results-heading">
          <strong>RESULTS</strong>
          {response.results.map((result, i) => (
            <button
              className={i === resultIndex ? "result-tab active" : "result-tab"}
              disabled={busy}
              key={result.id}
              onClick={() => onSelectResult(i)}
            >
              Result {i + 1}
              <span>{result.rowCount.toLocaleString()}</span>
            </button>
          ))}
          {response.recordsAffected >= 0 && (
            <span className="hint">
              {response.recordsAffected} rows affected
            </span>
          )}
          <div className="spacer" />
          {response.results.length ? (
            <button
              disabled={busy}
              title="Copy every result set, with messages, as text"
              onClick={onCopyAll}
            >
              <Copy size={14} />
              Copy all as text
            </button>
          ) : null}
          {hasData && (
            <button disabled={busy} onClick={onExport}>
              <Download size={14} />
              Export result
            </button>
          )}
        </div>
      )}
      {response.messages.length ? (
        <details className="query-messages">
          <summary>Messages ({response.messages.length})</summary>
          <pre>{response.messages.join("\n")}</pre>
        </details>
      ) : null}
      {children}
    </div>
  );
}
