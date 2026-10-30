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
- The SQL editor runs a T-SQL batch, or only selected text, with Ctrl+Enter. Multiple result sets have separate tabs. **Copy all as text** copies every result set from the last run, including rows beyond the loaded page, plus any messages, as one plain-text block: each result is labelled and its rows are CSV in a fenced block, ready to paste into an AI chat or a note. Saved queries can be named, moved between folders through Save query, and reopened from the sidebar. `GO` is a client-side SSMS command and is not supported; send T-SQL batches without it.
- Query exports read the completed result snapshot; they never execute the query again. Snapshots are limited to 256 MiB per execution and 30 result sets. Whole-table export streams from SQL Server without that snapshot limit. Downloads currently buffer in the WebView before saving, so available memory limits very large exports.
- **SQL scripts > Add script folder** links an existing disk folder and shows its current `.sql` files, including subfolders, above the saved query library. Paste a path from File Explorer (quoted paths and environment variables such as `%USERPROFILE%\Downloads` work). ExQL only reads these files; it never copies, changes, or uploads them. Listings refresh on app start, window focus, opening SQL scripts, and the refresh button. Click a filename to read it into the editor; Play reads the latest disk content and immediately runs it on the current connection. Unmodified open scripts reload on focus; edited scripts show a notice when disk content changes, with **Reload from disk** available. Save query creates an explicit library copy. Each folder listing shows up to 2,000 files; each opened script may be at most 4 MiB. UTF-8 and UTF-16 with a byte-order mark are supported. Hidden, system, and linked files or subfolders are skipped. Subfolders ExQL cannot search, for example because access is denied, are named under the folder so missing scripts are never silent. Removing a folder from ExQL only unlinks it.
- Queries and table exports time out after 120 seconds. Cancel aborts the request and closes its SQL connection. Statements already committed before cancellation or a later error remain committed. Arbitrary SQL uses your database permissions and is not made read-only by the app.

JSON exports preserve numeric digits, booleans, NULL, Unicode, and empty strings. Large integers and decimals stay as text on the internal wire so JavaScript does not round them. Exported JSON numbers retain their exact decimal representation, though a consumer using ordinary JavaScript numbers may round them. CSV quotes non-null fields, doubles embedded quotes, and leaves NULL unquoted and empty. CSV retains original formula-like text; spreadsheet software may interpret such values when opening a CSV.

## Saved connections and local data

Multiple connections can be named and grouped into folders in the connection manager. Each connection has a color shown on its tab, connection card, and saved profile. Choose a preset or custom **Connection color** in Database connections; **Save only** updates colors in open workspaces immediately. Existing profiles receive distinct defaults, and colors are retained across restarts. Save only stores a profile without connecting; Save & connect stores it and opens a session. Edit an existing profile to change settings or its password, or use its arrow to reconnect with its saved credential. Right-click a saved connection and choose **Clone…** to create a new profile with the same settings and a distinct default color. You can keep its password or connection string; the credential is copied into the clone's own Windows Credential Manager entry.

The six presets pair light and dark green, amber, and red. Use green for Dev, amber for QA, and red for Prod, with light shades for regular access and dark shades for admin connections. Colors are visual labels; choose them per connection, and keep the environment and access role in the connection name. Existing saved colors and custom colors are preserved.

**Add connection** opens another database workspace while keeping existing connections open. Tabs and connection cards show the saved connection name, or the database name for unsaved connections; hover to see the database and server. Each workspace keeps its table, filters, staged cell edits, SQL editor, and results when you switch tabs; queries can run in different workspaces at the same time. Disconnect affects only the selected workspace. Closing a workspace disconnects its session and asks before discarding a SQL draft or staged edits. SQL drafts in all open workspaces survive an app restart; database sessions must be reconnected after restarting. Update restart guards include running work and staged edits in inactive workspaces.

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

GitHub Actions runs on pull requests and pushes to main:

- Windows checks: formatting, TypeScript/frontend build, Vitest, server tests (including Windows Credential Manager), and desktop build.
- SQL Server 2019, 2022 and 2025 Linux containers: real API/database journeys against each engine using SQL authentication.
- Windows SQL Server Express: the complete Edge UI suite, Windows authentication, SQL login and saved connection strings.
- Portable desktop: package, extract and launch the real app, commit a grid edit, run SQL, save a query, restart, reconnect and verify a native download. A separate real portable update verifies integrity rejection, retry, restart guards and persistence through replacement.

SQL-backed tests create uniquely named `ExqlTest_?` databases from `scripts/fixture.sql`, also used by the optional ExqlDemo seed. Each test drops only the database it created. They never use ExqlDemo. Playwright starts its own devhost with fresh isolated settings and refuses to reuse an already running host. Database assertions use an independent SQL client, including exact numeric and date values, committed mutations, rollback, cancellation, exports and executable clipboard SQL.

With Node.js, .NET, Edge and a local SQL Server available:

```powershell
npm ci
npm run check
npm run format:check
npm run test:e2e
```

The single E2E command builds the frontend and manages the host and disposable databases. Defaults are `localhost` and Windows authentication. The account needs permission to create and drop its test databases. To target another test server, set `EXQL_TEST_SERVER` (optionally `hostname,port`), `EXQL_TEST_AUTH` (`windows` or `sql`), `EXQL_TEST_USER` and `EXQL_TEST_PASSWORD`. The Windows observer uses the built-in .NET SQL client; SQL-authenticated runs use the independent tedious driver. The SQL-login persistence journeys additionally need `EXQL_TEST_SQL_USER` and `EXQL_TEST_SQL_PASSWORD`; they are explicitly skipped locally when that login is absent and always configured in CI.

The credential tests create randomly named Windows vault entries and remove them. Workspace-loading regressions intercept workspace responses to check delayed loads and failed-load retries. Failed CI jobs upload traces, screenshots, host logs and diagnostics; Playwright retries are disabled.

Run `npm run test:desktop` for the self-contained packaged desktop journeys, or `./scripts/test-updates.ps1` for the real portable `0.0.1 ? 0.0.2` update. Both build into fresh directories under `artifacts`, launch real windows, use isolated settings and disposable databases, and clean up saved test credentials. They never publish a release. Desktop debugging ports 9223 and 9224 must be free. The test-only `--automation-update-directory` requires an automation port and an explicit isolated `--data-directory`; normal launches always use the fixed GitHub release feed.

`./scripts/seed.ps1` remains available to create the separate ExqlDemo demonstration database with `sqlcmd`; it is not required for tests.

Azure SQL offers a free allowance, subject to subscription eligibility and service limits: [Microsoft's current free-offer documentation](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql). Local SQL Server is sufficient for the included integration suite. Live Azure and interactive Entra sign-in require an Azure account/database and are not exercised by local tests.
