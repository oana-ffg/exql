export type Cell = string | null;
export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  editable: boolean;
  generated: boolean;
}
export interface TableId {
  schema: string;
  name: string;
  kind: "table" | "view";
}
export interface ForeignKey {
  referencedSchema: string;
  referencedTable: string;
  columns: { column: string; referencedColumn: string }[];
}
export interface GridResult {
  columns: Column[];
  rows: Cell[][];
  hasMore: boolean;
  total: number | null;
  // Only table pages have them; a query result's columns are not tied to a table.
  foreignKeys?: ForeignKey[] | null;
}
export interface Filter {
  column: string;
  operator: string;
  value: string;
}
export interface TableRequest {
  schema: string;
  table: string;
  filters: Filter[];
  match: "all" | "any";
  sort: string | null;
  descending: boolean;
  offset: number;
  limit: number;
}
export interface Connection {
  server: string;
  database: string;
  authentication: "windows" | "sql" | "entra" | "connectionString";
  username: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  connectionString?: string | null;
}
export interface ConnectionProfile {
  id: string;
  name: string;
  color: string;
  folder: string;
  connection: Omit<Connection, "password"> & { password: null };
}
export interface Session {
  id: string;
  name: string;
  color: string | null;
  profileId: string | null;
  server: string;
  catalog: TableId[];
  database: string;
  serverVersion: string;
}
export interface QueryResult {
  id: string;
  columns: Column[];
  rowCount: number;
  page: GridResult;
}
export interface QueryResponse {
  results: QueryResult[];
  recordsAffected: number;
  messages: string[];
  error: string | null;
}
export interface SavedQuery {
  id: string;
  name: string;
  folderId: string;
  sql: string;
}
export interface Folder {
  id: string;
  name: string;
  parentId?: string;
}
export interface Library {
  folders: Folder[];
  queries: SavedQuery[];
}
export interface Edit {
  row: number;
  column: string;
  value: Cell;
}
