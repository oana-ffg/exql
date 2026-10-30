import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import sql from "mssql";
import type { Connection } from "../../src/types.ts";

const run = promisify(execFile);
export const databaseName = process.env.EXQL_TEST_DATABASE!;
export const settings = {
  server: process.env.EXQL_TEST_SERVER ?? "localhost",
  authentication: process.env.EXQL_TEST_AUTH ?? "windows",
  username: process.env.EXQL_TEST_USER ?? "",
  password: process.env.EXQL_TEST_PASSWORD ?? "",
};
if (!["windows", "sql"].includes(settings.authentication))
  throw new Error("EXQL_TEST_AUTH must be windows or sql.");

export function connectionFor(database: string): Connection {
  return {
    ...settings,
    database,
    authentication: settings.authentication as "windows" | "sql",
    encrypt: true,
    trustServerCertificate: true,
  };
}
export const connection = connectionFor(databaseName);

export function connectionString(database = databaseName) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return `Server=${quote(settings.server)};Database=${quote(database)};${
    settings.authentication === "windows"
      ? "Integrated Security=True;"
      : `User ID=${quote(settings.username)};Password=${quote(settings.password)};`
  }Encrypt=True;TrustServerCertificate=True;Connect Timeout=25;`;
}

// Independent of ExQL: the Windows framework SQL client uses the current identity;
// tedious connects directly on either OS for the SQL-authenticated CI matrix.
export async function execute(
  database: string,
  command: string,
): Promise<string> {
  if (settings.authentication === "windows") {
    const directory = await mkdtemp(join(tmpdir(), "exql-sql-"));
    try {
      const file = join(directory, "command.sql");
      await writeFile(file, `SET NOCOUNT ON;\n${command}`, "utf8");
      const { stdout } = await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-File",
          fileURLToPath(new URL("./sql.ps1", import.meta.url)),
          "-Server",
          settings.server,
          "-Database",
          database,
          "-InputFile",
          file,
        ],
        { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
      );
      return stdout;
    } finally {
      await rm(directory, { recursive: true });
    }
  }
  const [server, port] = settings.server.replace(/^tcp:/, "").split(",");
  const pool = await new sql.ConnectionPool({
    server,
    port: Number(port ?? 1433),
    database,
    user: settings.username,
    password: settings.password,
    options: { encrypt: true, trustServerCertificate: true },
    connectionTimeout: 10_000,
    requestTimeout: 60_000,
  }).connect();
  try {
    const result = await pool.request().batch(command);
    return (result.recordset ?? [])
      .map((row) => Object.values(row)[0])
      .join("");
  } finally {
    await pool.close();
  }
}

export async function rows<T = Record<string, unknown>>(
  database: string,
  select: string,
): Promise<T[]> {
  const json = await execute(
    database,
    `SELECT COALESCE(NULLIF((${select} FOR JSON PATH, INCLUDE_NULL_VALUES), N''), N'[]') AS Json;`,
  );
  return JSON.parse(json.trim().split(/\r?\n/).join(""));
}

export async function tableRows(
  database: string,
  table: string,
  suffix = "ORDER BY [Id]",
) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(table))
    throw new Error("Invalid fixture table.");
  const columns = await rows<{ name: string; type: string }>(
    database,
    `SELECT c.name, t.name AS type FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.${table}') ORDER BY c.column_id`,
  );
  const expressions = columns.map(({ name, type }) => {
    const identifier = `[${name.replaceAll("]", "]]")}]`;
    let expression = `CONVERT(nvarchar(max), ${identifier})`;
    if (["binary", "varbinary", "timestamp", "rowversion"].includes(type))
      expression = `CONVERT(varchar(max), CONVERT(varbinary(max), ${identifier}), 1)`;
    if (
      [
        "date",
        "datetime",
        "smalldatetime",
        "datetime2",
        "datetimeoffset",
      ].includes(type)
    )
      expression = `CONVERT(nvarchar(50), ${identifier}, 126)`;
    if (["datetime", "smalldatetime"].includes(type))
      expression = `REPLACE(CONVERT(nvarchar(23), CONVERT(datetime, ${identifier}), 121), N' ', N'T')`;
    if (type === "uniqueidentifier")
      expression = `LOWER(CONVERT(nvarchar(36), ${identifier}))`;
    if (type === "money")
      expression = `CONVERT(nvarchar(30), CONVERT(decimal(19,4), ${identifier}))`;
    if (type === "bit")
      expression = `CASE WHEN ${identifier} IS NULL THEN NULL WHEN ${identifier}=1 THEN N'true' ELSE N'false' END`;
    return `${expression} AS ${identifier}`;
  });
  return rows<Record<string, string | null>>(
    database,
    `SELECT ${expressions.join(",")} FROM dbo.[${table}] AS source ${suffix.replace(/ORDER BY \[?Id\]?/i, "ORDER BY source.[Id]")}`,
  );
}

export class DisposableDatabase {
  private created = false;
  readonly name: string;
  constructor(name = `ExqlTest_${randomUUID().replaceAll("-", "")}`) {
    this.name = name;
    if (!/^ExqlTest_[a-f0-9]{32}$/.test(name))
      throw new Error(`Refusing non-test database name: ${name}`);
  }
  async create() {
    // CREATE fails if the name already exists. Ownership is recorded only on success.
    await execute("master", `CREATE DATABASE [${this.name}];`);
    this.created = true;
    try {
      const fixture = await readFile(
        new URL("../../scripts/fixture.sql", import.meta.url),
        "utf8",
      );
      for (const batch of fixture.split(/^\s*GO\s*$/gim))
        if (batch.trim()) await execute(this.name, batch);
      return this;
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }
  async dispose() {
    if (!this.created) return;
    await execute(
      "master",
      `ALTER DATABASE [${this.name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${this.name}];`,
    );
    this.created = false;
  }
}
