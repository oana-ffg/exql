# ExQL

A portable Windows workspace for Microsoft SQL Server and Azure SQL Database. Built around a spreadsheet-style data grid, a SQL editor, and organized saved queries. MIT licensed; independent of TablePlus.

## Run the portable app

Open `dist/ExQL.exe`. No installer, administrator rights, Node.js, or .NET installation is needed for the published app. It includes the .NET runtime and uses the Microsoft WebView2 runtime already installed on this PC. Other Windows machines need WebView2 available. The build targets Windows x64.

The app is currently unsigned. No elevation is requested. It runs as your Windows account.

Create a connection from **Connect to database**. For the included local test database use server `localhost`, database `ExqlDemo`, Windows integrated authentication, and **Trust server certificate (local development)**. Azure SQL should use its server hostname, encryption enabled, and certificate trust disabled. SQL login and Microsoft Entra interactive authentication are supported by Microsoft.Data.SqlClient. Azure connectivity requires an accessible server and suitable firewall/network rules.

## Working with data

- Open tables and views from schema folders in the explorer. Refresh the explorer after schema changes.
- Right-click cells or row numbers to copy a cell, selection, or rows as JSON/CSV/SQL. Existing selections are preserved when right-clicking inside them. Cell menus also offer staged editing, setting NULL, reverting a cell edit, and adding a filter for its value. Filters are drafts until you click Apply filters.
- Right-click column headers to copy names/loaded values, sort in either direction, or add a filter. Explorer menus open data, write a SELECT query, copy qualified names or saved SQL, and manage query folders. SQL editor menus offer run, undo/redo, copy/paste, and select all. Shift+F10 opens a menu from the keyboard; arrow keys navigate and Escape closes it.
- Click cells; navigate with arrows, Tab, Home, and End. Shift-click or Shift-arrow selects a rectangular cell range. Ctrl+C copies the cell/range as tab-separated text. NULL is displayed and copied as `NULL`.
- Hover over row numbers to select rows. Ctrl+A selects the loaded page. The copy toolbar outputs one or more rows as JSON, CSV, or SQL. SQL from table rows uses INSERT statements, omitting identity, computed, and rowversion columns. SQL from query results uses executable SELECT statements with column aliases.
- Double-click a cell, press Enter, or press F2 to edit. Apply stages the value in the grid. **Save changes** commits the batch in a transaction; Discard restores the loaded values. NULL is a separate choice from empty text.
- Table edits require a primary key. Views, query results, generated columns, and unsupported SQL types are read-only. Original column values and rowversion (when present) detect concurrent changes. A conflict rolls back the complete edit batch.
- Add column filters and choose all conditions (AND) or any condition (OR), then Apply. Text contains/prefix filters match literal characters, including `%` and `_`. Click a column header to sort; primary keys break ties. Tables without a primary key have no guaranteed ordering unless you choose a sort column.
- Tables and query snapshots display 200 rows per page. **Export** downloads the whole table or all rows matching the applied filters, across every page. Export excludes unsaved edits.
- The SQL editor runs a T-SQL batch, or only selected text, with Ctrl+Enter. Multiple result sets have separate tabs. Saved queries can be named, moved between folders through Save query, and reopened from the sidebar. `GO` is a client-side SSMS command and is not supported; send T-SQL batches without it.
- Query exports read the completed result snapshot; they never execute the query again. Snapshots are limited to 256 MiB per execution and 30 result sets. Whole-table export streams from SQL Server without that snapshot limit. Downloads currently buffer in the WebView before saving, so available memory limits very large exports.
- Queries and table exports time out after 120 seconds. Cancel aborts the request and closes its SQL connection. Statements already committed before cancellation or a later error remain committed. Arbitrary SQL uses your database permissions and is not made read-only by the app.

JSON exports preserve numeric digits, booleans, NULL, Unicode, and empty strings. Large integers and decimals stay as text on the internal wire so JavaScript does not round them. Exported JSON numbers retain their exact decimal representation, though a consumer using ordinary JavaScript numbers may round them. CSV quotes non-null fields, doubles embedded quotes, and leaves NULL unquoted and empty. CSV retains original formula-like text; spreadsheet software may interpret such values when opening a CSV.

## Saved connections and local data

Multiple connections can be named and grouped into folders in the connection manager. Save only stores a profile without connecting; Save & connect stores it and opens a session. Edit an existing profile to change settings or its password, or use its arrow to reconnect with its saved credential.

Choose **Connection method → Connection string** to paste a SQL Server or Azure SQL connection string. For the local demo, use `Server=localhost;Database=ExqlDemo;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;`. Advanced driver options are preserved; ExQL overrides application name, disables connection pooling, and disables persistence of security information. The complete saved string lives in Windows Credential Manager; only server/database/display metadata is written to the profile file. Saved strings remain hidden when reopening a profile: keep the stored string or replace it. Windows limits each credential to 1,280 UTF-16 characters; longer strings can be used without saving.

- SQL passwords live in **Windows Credential Manager**, under `ExQL/connection/<profile-id>`, scoped to your Windows account. Passwords are never returned by the profiles API or written to JSON files, browser storage, logs, or arguments. Entra sign-in uses the driver's interactive authentication flow. Windows authentication uses the current Windows identity.
- Non-secret connection metadata and saved queries live in `%LOCALAPPDATA%/ExQL`. SQL text may itself contain sensitive information; saved SQL is plain text in this user directory.
- WebView2 keeps its browser profile under `%LOCALAPPDATA%/ExQL/WebView2`.
- Query results spool into randomly named `exql-*.jsonl` files in your temporary directory. They are deleted when replaced, disconnected, or the app exits normally. A forced termination can leave a snapshot behind. Snapshots are not encrypted separately from the filesystem.
- Deleting a saved connection deletes its associated Windows credential. Removing the EXE alone leaves your settings and credentials intact.

The desktop host listens only on a random loopback port. API requests require a per-launch token injected by the native WebView host, an application header, and an accepted origin/host. External navigation and new windows are blocked. The development host uses a fixed loopback port and omits the native token; do not expose it on a network.

## Build from source

Development requires Windows, Node.js 22.12+ (or a newer supported Node release), and the .NET 10 SDK. The portable output requires neither Node nor .NET to be installed.

```powershell
npm ci
npm run build
dotnet restore desktop --configfile NuGet.Config
dotnet build desktop --no-restore
npm start
```

Or run `./start.ps1`. Build a self-contained single EXE with `./publish.ps1`. Output goes to `dist/ExQL.exe`.

For frontend hot reload, first build the frontend once so embedded assets exist, then run `npm run server` and `npm run dev` in separate terminals. The frontend dev URL is `http://127.0.0.1:5173`; the standalone test host is `http://127.0.0.1:5274`. To isolate test settings, run:

```powershell
dotnet run --project devhost -- --DataDirectory "$PWD/artifacts/test-state"
```

`server/` contains SQL access, result storage, exports, and Windows credentials. `desktop/` provides the native window and packaging. `devhost/` runs the backend without a window for development and integration tests. `src/` contains the React UI and pure data formatting functions. No production database credentials or telemetry are included.

## Verify

The SQL seed creates only the separate `ExqlDemo` database and its demonstration tables, and does not reset existing databases. Integration tests use this database, temporarily edit its fixture rows, and restore their original values.

```powershell
./scripts/seed.ps1
npm run build
npm test
dotnet restore server.tests --configfile NuGet.Config
dotnet test server.tests --no-restore
# With the devhost running and Edge installed:
npm run test:e2e
npm run format:check
```

The Windows credential tests create randomly named test entries, verify write/read/update/delete and password-free profile persistence, then remove their entries. The browser tests exercise the real SQL Server; no database API is mocked.

Optional packaged-desktop checks: launch `dist/ExQL.exe --automation-port 9223`, then run `node scripts/verify-desktop.mjs`. It saves the Local development demo connection and Browse work items query. Restart the EXE with that flag and run `node scripts/verify-desktop-restart.mjs` to verify persistence and a native download. The debugging port is disabled during normal launches.

Azure SQL offers a free allowance, subject to subscription eligibility and service limits: [Microsoft's current free-offer documentation](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql). Local SQL Server is sufficient for the included integration suite. Live Azure and interactive Entra sign-in require an Azure account/database and are not exercised by local tests.
