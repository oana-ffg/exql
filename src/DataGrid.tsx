import {
  memo,
  useMemo,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  LockKeyhole,
} from "lucide-react";
import type {
  Cell,
  Column,
  Edit,
  Filter,
  ForeignKey,
  GridResult,
  TableId,
} from "./types";
import {
  csvRows,
  jsonRows,
  querySqlRows,
  sqlRows,
  quoteIdentifier,
} from "./format";
import { Modal } from "./Modal";
import { ContextMenu, useContextMenu, type MenuAction } from "./ContextMenu";
import { copyText } from "./clipboard";

type Position = { row: number; col: number };
type GridMenu =
  | { kind: "cell"; position: Position }
  | { kind: "row"; row: number }
  | { kind: "column"; col: number }
  | { kind: "keys"; position: Position };
const noKeys: ForeignKey[] = [];
const keyLabel = (key: ForeignKey) =>
  `Go to ${key.referencedSchema}.${key.referencedTable} (${key.columns.map((column) => `${column.referencedColumn} = ${column.column}`).join(", ")})`;
export const DataGrid = memo(function DataGrid({
  data,
  table,
  edits,
  onEdit,
  sort,
  descending,
  onSort,
  onFilter,
  onFollowKey,
  onNotice,
  disabled,
}: {
  data: GridResult;
  table: TableId | null;
  edits: Edit[];
  onEdit: (edit: Edit) => void;
  sort: string | null;
  descending: boolean;
  onSort: (column: string, descending?: boolean) => void;
  onFilter: (filter: Filter) => void;
  onFollowKey: (key: ForeignKey, values: string[]) => void;
  onNotice: (notice: string) => void;
  disabled: boolean;
}) {
  const [active, setActive] = useState<Position>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<Position>({ row: 0, col: 0 });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastRow, setLastRow] = useState(0);
  const [editing, setEditing] = useState<Position | null>(null);
  const [copyFormat, setCopyFormat] = useState("json");
  const context = useContextMenu<GridMenu>();
  const inRange = (row: number, col: number) =>
    row >= Math.min(active.row, anchor.row) &&
    row <= Math.max(active.row, anchor.row) &&
    col >= Math.min(active.col, anchor.col) &&
    col <= Math.max(active.col, anchor.col);
  function menuBindings(target: GridMenu) {
    const bindings = context.bind(target);
    function selectTarget() {
      if (target.kind === "cell") {
        const { row, col } = target.position;
        if (!selected.has(row) && (selected.size > 0 || !inRange(row, col))) {
          setActive(target.position);
          setAnchor(target.position);
          setSelected(new Set());
        }
      } else if (target.kind === "row" && !selected.has(target.row)) {
        setSelected(new Set([target.row]));
        setLastRow(target.row);
      }
    }
    return {
      onContextMenu(event: React.MouseEvent<HTMLElement>) {
        selectTarget();
        bindings.onContextMenu(event);
      },
      onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
        if (
          event.key === "ContextMenu" ||
          (event.shiftKey && event.key === "F10")
        )
          selectTarget();
        bindings.onKeyDown(event);
      },
    };
  }
  const editIndex = useMemo(() => {
    const index = new Map<number, Map<string, Edit>>();
    for (const edit of edits) {
      const row = edit.row;
      let columns = index.get(row);
      if (!columns) index.set(row, (columns = new Map()));
      columns.set(edit.column, edit);
    }
    return index;
  }, [edits]);
  const editAt = (row: number, column: string) =>
    editIndex.get(row)?.get(column);
  const valueAt = (row: number, col: number): Cell => {
    const edit = editAt(row, data.columns[col].name);
    return edit ? edit.value : data.rows[row][col];
  };
  const keysByColumn = useMemo(() => {
    const index = new Map<string, ForeignKey[]>();
    if (table)
      for (const key of data.foreignKeys ?? noKeys)
        for (const { column } of key.columns)
          index.set(column, [...(index.get(column) ?? []), key]);
    return index;
  }, [data.foreignKeys, table]);
  const columnIndex = useMemo(
    () => new Map(data.columns.map((column, col) => [column.name, col])),
    [data.columns],
  );
  function followableKeys({ row, col }: Position) {
    return (keysByColumn.get(data.columns[col].name) ?? noKeys).flatMap(
      (key) => {
        const values = key.columns.map(({ column }) =>
          valueAt(row, columnIndex.get(column)!),
        );
        // With a NULL in it, a foreign key references nothing.
        return values.includes(null)
          ? []
          : [{ key, values: values as string[] }];
      },
    );
  }
  const indices = selected.size
    ? [...selected].sort((a, b) => a - b)
    : data.rows.length
      ? Array.from(
          { length: Math.abs(active.row - anchor.row) + 1 },
          (_, i) => Math.min(active.row, anchor.row) + i,
        )
      : [];
  function openEditor(position: Position) {
    if (
      !disabled &&
      table &&
      data.columns[position.col]?.editable &&
      data.rows[position.row]
    )
      setEditing(position);
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      // Closing the key chooser returns focus to its arrow, which is part of the cell.
      (event.target instanceof HTMLButtonElement &&
        !event.target.classList.contains("key-link"))
    )
      return;
    if (!data.rows.length) return;
    let next = { ...active };
    switch (event.key) {
      case "ArrowDown":
        next.row++;
        break;
      case "ArrowUp":
        next.row--;
        break;
      case "ArrowLeft":
        next.col--;
        break;
      case "ArrowRight":
        next.col++;
        break;
      case "Tab":
        next.col += event.shiftKey ? -1 : 1;
        break;
      case "Home":
        next.col = 0;
        if (event.ctrlKey) next.row = 0;
        break;
      case "End":
        next.col = data.columns.length - 1;
        if (event.ctrlKey) next.row = data.rows.length - 1;
        break;
      case "Enter":
      case "F2":
        event.preventDefault();
        openEditor(active);
        return;
      case "Escape":
        setSelected(new Set());
        setAnchor(active);
        return;
      case "a":
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          setSelected(new Set(data.rows.map((_, i) => i)));
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    next = {
      row: Math.max(0, Math.min(data.rows.length - 1, next.row)),
      col: Math.max(0, Math.min(data.columns.length - 1, next.col)),
    };
    setActive(next);
    setSelected(new Set());
    if (!event.shiftKey || event.key === "Tab") setAnchor(next);
    event.currentTarget
      .querySelector<HTMLElement>(`[data-cell="${next.row}:${next.col}"]`)
      ?.focus();
  }
  function copyCells(event: ClipboardEvent<HTMLDivElement>) {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      !data.rows.length
    )
      return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selectionText());
  }
  function selectionText() {
    const columnNumbers = selected.size
      ? data.columns.map((_, i) => i)
      : Array.from(
          { length: Math.abs(active.col - anchor.col) + 1 },
          (_, i) => Math.min(active.col, anchor.col) + i,
        );
    return indices
      .map((row) =>
        columnNumbers.map((col) => valueAt(row, col) ?? "NULL").join("\t"),
      )
      .join("\n");
  }
  async function copyRows(format = copyFormat) {
    try {
      const rows = indices.map((row) =>
        data.columns.map((_, col) => valueAt(row, col)),
      );
      const text =
        format === "json"
          ? jsonRows(data.columns, rows)
          : format === "csv"
            ? csvRows(data.columns, rows)
            : table
              ? sqlRows(data.columns, rows, table.schema, table.name)
              : querySqlRows(data.columns, rows);
      await copyText(
        text,
        onNotice,
        `Copied ${rows.length} ${rows.length === 1 ? "row" : "rows"} as ${format.toUpperCase()}.`,
      );
    } catch (error) {
      onNotice(`Copy failed: ${(error as Error).message}`);
    }
  }
  function menuActions(target: GridMenu): MenuAction[] {
    if (target.kind === "keys")
      return followableKeys(target.position).map(({ key, values }) => ({
        label: keyLabel(key),
        disabled,
        run: () => onFollowKey(key, values),
      }));
    if (target.kind === "column") {
      const column = data.columns[target.col];
      return [
        {
          label: "Copy column name",
          run: () => void copyText(quoteIdentifier(column.name), onNotice),
        },
        {
          label: "Copy column values",
          disabled: !data.rows.length,
          run: () =>
            void copyText(
              data.rows
                .map((_, row) => valueAt(row, target.col) ?? "NULL")
                .join("\n"),
              onNotice,
            ),
        },
        {
          label: "Sort ascending",
          separator: true,
          disabled: !table || disabled,
          run: () => onSort(column.name, false),
        },
        {
          label: "Sort descending",
          disabled: !table || disabled,
          run: () => onSort(column.name, true),
        },
        {
          label: "Add column filter",
          disabled: !table || disabled,
          run: () =>
            onFilter({ column: column.name, operator: "=", value: "" }),
        },
      ];
    }
    const actions: MenuAction[] = [
      {
        label: "Copy selection",
        run: () => void copyText(selectionText(), onNotice),
      },
      ...["json", "csv", "sql"].map((format) => ({
        label: `Copy ${indices.length > 1 ? `${indices.length} rows` : "row"} as ${format.toUpperCase()}`,
        run: () => void copyRows(format),
      })),
      {
        label: "Select all rows on page",
        run: () => setSelected(new Set(data.rows.map((_, row) => row))),
      },
    ];
    if (target.kind === "cell") {
      const { row, col } = target.position;
      const column = data.columns[col];
      const value = valueAt(row, col);
      actions.unshift({
        label: "Copy cell",
        run: () => void copyText(value ?? "NULL", onNotice),
      });
      actions.push(
        {
          label: "Edit cell…",
          separator: true,
          disabled: disabled || !table || !column.editable,
          run: () => openEditor(target.position),
        },
        {
          label: "Set cell to NULL",
          disabled:
            disabled ||
            !table ||
            !column.editable ||
            !column.nullable ||
            value === null,
          run: () => onEdit({ row, column: column.name, value: null }),
        },
        {
          label: "Revert cell edit",
          disabled: disabled || !editAt(row, column.name),
          run: () =>
            onEdit({ row, column: column.name, value: data.rows[row][col] }),
        },
        {
          label: "Add filter for this value",
          separator: true,
          disabled: disabled || !table,
          run: () =>
            onFilter({
              column: column.name,
              operator: value === null ? "is null" : "=",
              value: value ?? "",
            }),
        },
        ...followableKeys(target.position).map(({ key, values }, index) => ({
          label: keyLabel(key),
          separator: index === 0,
          disabled,
          run: () => onFollowKey(key, values),
        })),
      );
    }
    return actions;
  }
  return (
    <div className="grid-pane" onKeyDown={keyDown} onCopy={copyCells}>
      <div className="grid-tools">
        <span>
          {selected.size
            ? `${selected.size} rows selected`
            : data.rows.length
              ? `Cell ${data.columns[active.col]?.name}`
              : "No rows"}
          {edits.length > 0 && (
            <span className="pending-label"> · includes unsaved edits</span>
          )}
        </span>
        <div className="button-group">
          <select
            aria-label="Copy format"
            value={copyFormat}
            onChange={(e) => setCopyFormat(e.target.value)}
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
            <option value="sql">SQL</option>
          </select>
          <button
            disabled={!indices.length || disabled}
            onClick={() => void copyRows()}
          >
            <Copy size={14} />
            Copy {indices.length > 1 ? `${indices.length} rows` : "row"}
          </button>
        </div>
      </div>
      <div
        className="grid-scroll"
        {...(data.rows.length && data.columns.length
          ? menuBindings({ kind: "cell", position: active })
          : {})}
        tabIndex={0}
        role="grid"
        aria-label="Data grid"
        aria-rowcount={data.rows.length + 1}
      >
        <table>
          <thead>
            <tr>
              <th className="row-number">
                <input
                  type="checkbox"
                  aria-label="Select all rows on page"
                  checked={
                    data.rows.length > 0 && selected.size === data.rows.length
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(data.rows.map((_, i) => i))
                        : new Set(),
                    )
                  }
                />
              </th>
              {data.columns.map((column, col) => (
                <th
                  key={column.name}
                  tabIndex={-1}
                  {...menuBindings({
                    kind: "column",
                    col,
                  })}
                  aria-sort={
                    sort === column.name
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <div className="column-header">
                    <button
                      disabled={!table || disabled}
                      title={table ? `Sort by ${column.name}` : column.name}
                      onClick={() => onSort(column.name)}
                    >
                      {column.primaryKey && (
                        <KeyRound size={12} className="key-icon" />
                      )}
                      <strong>{column.name}</strong>
                      {sort === column.name && (
                        <ChevronDown
                          size={12}
                          className={descending ? "" : "rotate"}
                        />
                      )}
                    </button>
                    <span>
                      {column.type}
                      {!column.editable && <LockKeyhole size={10} />}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((_, row) => (
              <tr key={row} className={selected.has(row) ? "selected-row" : ""}>
                <td
                  className="row-number"
                  tabIndex={-1}
                  {...menuBindings({ kind: "row", row })}
                >
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Select row ${row + 1}`}
                      checked={selected.has(row)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        const shift = (e.nativeEvent as MouseEvent).shiftKey;
                        const from = shift ? Math.min(row, lastRow) : row;
                        const to = shift ? Math.max(row, lastRow) : row;
                        for (let i = from; i <= to; i++) {
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                        }
                        setSelected(next);
                        setLastRow(row);
                      }}
                    />
                    <span>{row + 1}</span>
                  </label>
                </td>
                {data.columns.map((column, col) => {
                  const value = valueAt(row, col);
                  const isInRange = inRange(row, col);
                  const changed = !!editAt(row, column.name);
                  const keys = keysByColumn.has(column.name)
                    ? followableKeys({ row, col })
                    : [];
                  return (
                    <td
                      key={column.name}
                      role="gridcell"
                      aria-selected={isInRange || selected.has(row)}
                      tabIndex={-1}
                      data-cell={`${row}:${col}`}
                      className={`${isInRange ? "range-cell" : ""} ${active.row === row && active.col === col ? "active-cell" : ""} ${changed ? "edited-cell" : ""} ${value === null ? "null-cell" : ""} ${keys.length ? "key-cell" : ""}`}
                      {...menuBindings({
                        kind: "cell",
                        position: { row, col },
                      })}
                      title={value ?? "NULL"}
                      onClick={(event) => {
                        setActive({ row, col });
                        if (!event.shiftKey) setAnchor({ row, col });
                        setSelected(new Set());
                        event.currentTarget.focus();
                      }}
                      onDoubleClick={() => openEditor({ row, col })}
                    >
                      <span>
                        {value === null ? (
                          "NULL"
                        ) : value === "" ? (
                          <i className="empty-value">empty</i>
                        ) : (
                          value
                        )}
                      </span>
                      {keys.length > 0 && (
                        <button
                          type="button"
                          className="key-link"
                          tabIndex={-1}
                          disabled={disabled}
                          aria-label={
                            keys.length === 1
                              ? keyLabel(keys[0].key)
                              : `Choose from ${keys.length} referenced tables`
                          }
                          title={keys
                            .map(({ key }) => keyLabel(key))
                            .join("\n")}
                          onClick={(event) => {
                            event.stopPropagation();
                            setActive({ row, col });
                            setAnchor({ row, col });
                            setSelected(new Set());
                            if (keys.length === 1)
                              onFollowKey(keys[0].key, keys[0].values);
                            else
                              context
                                .bind({
                                  kind: "keys",
                                  position: { row, col },
                                })
                                .onContextMenu(event);
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                        >
                          <ArrowRight size={12} />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {data.rows.length === 0 && (
          <div className="empty-grid">No rows match this view.</div>
        )}
      </div>
      {context.menu && (
        <ContextMenu
          position={context.menu}
          label={
            context.menu.target.kind === "column"
              ? data.columns[context.menu.target.col].name
              : context.menu.target.kind === "row"
                ? "Row actions"
                : context.menu.target.kind === "keys"
                  ? "Referenced tables"
                  : "Cell actions"
          }
          actions={menuActions(context.menu.target)}
          onClose={context.close}
        />
      )}
      {editing && (
        <CellEditor
          column={data.columns[editing.col]}
          value={valueAt(editing.row, editing.col)}
          onClose={() => setEditing(null)}
          onSave={(value) => {
            onEdit({
              row: editing.row,
              column: data.columns[editing.col].name,
              value,
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
});

function CellEditor({
  column,
  value,
  onClose,
  onSave,
}: {
  column: Column;
  value: Cell;
  onClose: () => void;
  onSave: (value: Cell) => void;
}) {
  const [text, setText] = useState(value ?? "");
  const [isNull, setIsNull] = useState(value === null);
  return (
    <Modal title={`Edit ${column.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(isNull ? null : text);
        }}
      >
        <p className="hint">
          {column.type} · Changes are staged until you click Save changes.
        </p>
        <label>
          Cell value
          <textarea
            autoFocus
            rows={5}
            disabled={isNull}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {column.nullable && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={isNull}
              onChange={(e) => setIsNull(e.target.checked)}
            />
            Set to NULL
          </label>
        )}
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">
            <Check size={14} />
            Apply to grid
          </button>
        </footer>
      </form>
    </Modal>
  );
}
