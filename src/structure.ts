import type { Column, GridResult, TableStructure } from "./types";

/** SQL Server's conventional extended property for descriptions, as SSMS edits it. */
const descriptionProperty = "MS_Description";

const text = (name: string): Column => ({
  name,
  type: "nvarchar",
  nullable: true,
  primaryKey: false,
  editable: false,
  generated: false,
});
const flag = (name: string): Column => ({ ...text(name), type: "bit" });
// Extended properties go between these, next to the types they describe.
const leadingColumns = [
  text("Column"),
  text("Data type"),
  flag("Nullable"),
  flag("Primary key"),
];
const trailingColumns = [
  text("Identity"),
  text("Default"),
  text("Computed"),
  text("Collation"),
];

/**
 * One row per column. After its type and key come one grid column per extended
 * property name, MS_Description always and then the others by name, and then the
 * remaining details. NULL means the column does not have that property.
 */
export function structureGrid(structure: TableStructure): GridResult {
  const others = [
    ...new Set(
      structure.columns.flatMap((column) =>
        column.properties.map((property) => property.name),
      ),
    ),
  ]
    .filter((name) => name !== descriptionProperty)
    .sort((a, b) => a.localeCompare(b));
  const properties = [descriptionProperty, ...others];
  // A property may share a name with a fixed column, and the grid finds columns by name.
  const fixedNames = new Set(
    [...leadingColumns, ...trailingColumns].map((column) => column.name),
  );
  const used = new Set([...fixedNames, ...properties]);
  const labels = properties.map((name) => {
    if (!fixedNames.has(name)) return name;
    let suffix = 2;
    while (used.has(`${name} (${suffix})`)) suffix++;
    const label = `${name} (${suffix})`;
    used.add(label);
    return label;
  });
  return {
    columns: [...leadingColumns, ...labels.map(text), ...trailingColumns],
    rows: structure.columns.map((column) => {
      const values = new Map(
        column.properties.map((property) => [property.name, property.value]),
      );
      return [
        column.name,
        column.type,
        String(column.nullable),
        String(column.primaryKey),
        ...properties.map((name) => values.get(name) ?? null),
        column.identity,
        column.default,
        column.computed,
        column.collation,
      ];
    }),
    hasMore: false,
    total: structure.columns.length,
  };
}
