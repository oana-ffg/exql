import { Filter as FilterIcon, Plus, X } from "lucide-react";
import type { Column, Filter } from "./types";
export function FilterBar({
  columns,
  filters,
  match,
  onChange,
  onMatch,
  onApply,
  disabled,
}: {
  columns: Column[];
  filters: Filter[];
  match: "all" | "any";
  onChange: (filters: Filter[]) => void;
  onMatch: (match: "all" | "any") => void;
  onApply: () => void;
  disabled: boolean;
}) {
  function update(index: number, patch: Partial<Filter>) {
    onChange(
      filters.map((filter, i) =>
        i === index ? { ...filter, ...patch } : filter,
      ),
    );
  }
  return (
    <form
      className="filter-bar"
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
    >
      <div className="filter-intro">
        <FilterIcon size={14} />
        <span>Match</span>
        <select
          aria-label="Filter match"
          value={match}
          onChange={(e) => onMatch(e.target.value as "all" | "any")}
          disabled={disabled}
        >
          <option value="all">all conditions</option>
          <option value="any">any condition</option>
        </select>
        <button
          type="button"
          disabled={disabled || !columns.length}
          onClick={() =>
            onChange([
              ...filters,
              { column: columns[0].name, operator: "=", value: "" },
            ])
          }
        >
          <Plus size={13} />
          Add filter
        </button>
        {filters.length > 0 && (
          <button className="primary compact" disabled={disabled}>
            Apply filters
          </button>
        )}
      </div>
      {filters.map((filter, i) => (
        <div className="filter-condition" key={i}>
          <select
            aria-label={`Filter ${i + 1} column`}
            disabled={disabled}
            value={filter.column}
            onChange={(e) => update(i, { column: e.target.value })}
          >
            {columns.map((column) => (
              <option key={column.name}>{column.name}</option>
            ))}
          </select>
          <select
            aria-label={`Filter ${i + 1} operator`}
            disabled={disabled}
            value={filter.operator}
            onChange={(e) => update(i, { operator: e.target.value })}
          >
            {[
              "=",
              "<>",
              ">",
              ">=",
              "<",
              "<=",
              "contains",
              "starts with",
              "is null",
              "is not null",
            ].map((operator) => (
              <option key={operator}>{operator}</option>
            ))}
          </select>
          {!filter.operator.includes("null") && (
            <input
              aria-label={`Filter ${i + 1} value`}
              disabled={disabled}
              value={filter.value}
              onChange={(e) => update(i, { value: e.target.value })}
            />
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove filter ${i + 1}`}
            disabled={disabled}
            onClick={() => onChange(filters.filter((_, index) => index !== i))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {filters.length === 0 && (
        <span className="hint">
          Filter one or more columns to narrow your view.
        </span>
      )}
    </form>
  );
}
