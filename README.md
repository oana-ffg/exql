# ExQL

A portable Windows workspace for Microsoft SQL Server and Azure SQL Database. Built around a spreadsheet-style data grid, a SQL editor, and organized saved queries. MIT licensed; independent of TablePlus.

## Run the portable app

Download the portable ZIP from [GitHub Releases](https://github.com/oana-ffg/exql/releases), extract the **entire ZIP** into a folder you can write to, and open the root `ExQL.exe`. Keep the updater and `current` folder beside it. No installer, administrator rights, Node.js, or .NET installation is needed. It includes the .NET runtime and uses Microsoft WebView2; other Windows machines need WebView2 available. The build targets Windows x64.

The app is currently unsigned. No elevation is requested. It runs as your Windows account.

## Automatic updates

The desktop app checks this repository's public GitHub Releases at startup and every six hours while open. **Check for updates** runs a manual check. New stable versions download in the background; **Restart to update** applies a verified package after the workspace and SQL host shut down. Updates never restart the app automatically. A downloaded update remains available after you close and reopen ExQL.

Restarting for an update is blocked while queries are running, cell edits are staged, workspace writes are pending or have failed, or a dialog is open. Save or discard edits and finish those operations first. SQL scratch text and saved queries are persisted independently of the application files. Updates preserve `%LOCALAPPDATA%/ExQL` and Windows Credential Manager entries. Only one instance may run from each application folder so another instance cannot be interrupted by its updater.

A failed download or integrity check leaves the current app running and offers **Retry update**. The next scheduled check also retries. Application files must be writable by your account. Package hashes detect corrupt downloads; they are not publisher signatures. Releases currently remain unsigned, so authenticity relies on HTTPS and control of the GitHub repository. Windows code signing requires a separately configured certificate or signing service.

Existing standalone `dist/ExQL.exe` builds predate this updater: switch to the new portable ZIP once. Development builds run without update checks. The update implementation uses the pinned, MIT-licensed [Velopack](https://github.com/velopack/velopack) SDK and CLI; it requires no paid Velopack service or client-side GitHub token.

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

Or run `./start.ps1`. Build the portable ZIP and update feed with `./publish.ps1`. Output goes to `dist/releases/`; extract `ExQL.Desktop-win-x64-Portable.zip` into a writable folder to run it. `publish.ps1` only builds local files and does not upload anything. The app version comes from `package.json`; `-Version` and `-OutputDirectory` allow isolated test builds. The Velopack CLI version is read from the desktop project and installed under `artifacts/tools`.

To publish a release, update the version with `npm version patch --no-git-tag-version`, write accurate release notes, run the checks below, and commit and push to `origin/main`. For the initial release, run `./scripts/release.ps1 -ReleaseNotes releases/0.1.0.md`. This separate command checks that the working tree is clean and matches GitHub's main branch, runs the local gate, builds in a fresh directory, uploads a draft with all assets, and publishes it. It uses your existing `gh` sign-in. If uploading fails, inspect the draft before retrying. A version must never be reused for different binaries.

The release script currently produces full update packages. `publish.ps1` can also generate deltas when its output directory contains the previous full package. Do not upload experimental test feeds as production releases.

For frontend hot reload, first build the frontend once so embedded assets exist, then run `npm run server` and `npm run dev` in separate terminals. The frontend dev URL is `http://127.0.0.1:5173`; the standalone test host is `http://127.0.0.1:5274`. To isolate test settings, run:

```powershell
dotnet run --project devhost -- --DataDirectory "$PWD/artifacts/test-state"
```

`server/` contains SQL access, result storage, exports, and Windows credentials. `desktop/` provides the native window and packaging. `devhost/` runs the backend without a window for development and integration tests. `src/` contains the React UI and pure data formatting functions. No production database credentials or telemetry are included.

The app icon's source is `public/exql.png`, created with built-in imagegen and shared by the sidebar and browser tab. After replacing it, run `npm run icon` (requires Edge) to regenerate the multi-size `public/exql.ico` used by the Windows executable, native window, and portable launcher. Both assets are checked in; normal builds do not need to regenerate them.

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

The Windows credential tests create randomly named test entries, verify write/read/update/delete and password-free profile persistence, then remove their entries. The SQL integration tests exercise the real SQL Server. Workspace-loading browser regressions intercept workspace responses to verify delayed loads and failed-load retries without changing saved work.

Optional packaged-desktop checks: launch the extracted portable app with `--automation-port 9223`, then run `node scripts/verify-desktop.mjs`. It saves the Local development demo connection and Browse work items query. Restart the EXE with that flag and run `node scripts/verify-desktop-restart.mjs` to verify persistence and a native download. The debugging port is disabled during normal launches.

Run `./scripts/test-updates.ps1` to build and test a real portable `0.0.1 → 0.0.2` update. It uses a fresh directory under `artifacts`, port 9224, and the existing `ExqlDemo` database. It rejects a corrupt package, retries successfully, verifies restart guards against failed/pending saves, a running SQL query and uncommitted grid edits, and checks persisted SQL and connection profiles after replacement and relaunch. It never commits the staged database edit or publishes a release. Screenshots remain in the test directory. The test-only `--automation-update-directory` option accepts a local directory and requires both an automation port and an explicit isolated `--data-directory`; normal builds always use the fixed GitHub repository.

Azure SQL offers a free allowance, subject to subscription eligibility and service limits: [Microsoft's current free-offer documentation](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql). Local SQL Server is sufficient for the included integration suite. Live Azure and interactive Entra sign-in require an Azure account/database and are not exercised by local tests.
