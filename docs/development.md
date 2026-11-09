# Development

## Layout

- `server/`: SQL access, result storage, exports and Windows credentials
- `desktop/`: the native window and packaging
- `devhost/`: the backend without a window, for development and integration tests
- `src/`: the React UI and pure data formatting functions

No production database credentials or telemetry are included.

## Build from source

Development requires Windows, Node.js (`.node-version` has the recommended version and `package.json` the supported ranges) and the .NET 10 SDK.

```powershell
npm ci
npm run build
dotnet restore desktop --configfile NuGet.Config
dotnet build desktop --no-restore
npm start
```

Or run `./start.ps1`.

For frontend hot reload, build the frontend once so embedded assets exist, then run `npm run server` and `npm run dev` in separate terminals. The frontend is at `http://127.0.0.1:5173` and the dev host at `http://127.0.0.1:5274`. Development builds run without update checks.

To isolate test settings:

```powershell
dotnet run --project devhost -- --DataDirectory "$PWD/artifacts/test-state"
```

`./scripts/seed.ps1` creates the optional ExqlDemo database with `sqlcmd`. To connect to it, use server `localhost`, database `ExqlDemo`, Windows integrated authentication and **Trust server certificate (local development)**, or this connection string:

```
Server=localhost;Database=ExqlDemo;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;
```

## Packaging

`./publish.ps1` builds the portable ZIP and update feed into `dist/releases/`. Extract `ExQL.Desktop-win-x64-Portable.zip` into a writable folder to run it. The script only builds local files and uploads nothing.

The app version comes from `package.json`. `-Version` and `-OutputDirectory` allow isolated test builds. The Velopack CLI version is read from the desktop project and installed under `artifacts/tools`. `publish.ps1` can generate deltas when its output directory contains the previous full package.

## Releasing

1. Update the version with `npm version patch --no-git-tag-version`.
2. Write accurate release notes in `releases/<version>.md`.
3. Run the checks below, then commit and push to `origin/main`.
4. Run `./scripts/release.ps1 -ReleaseNotes releases/<version>.md`.

The release script checks that the working tree is clean and matches GitHub's main branch, runs the local checks, builds in a fresh directory, uploads a draft with all assets, and publishes it. It uses your existing `gh` sign-in and produces full update packages.

If uploading fails, inspect the draft before retrying. Never reuse a version for different binaries, and do not upload experimental test feeds as production releases.

## Testing

### CI

GitHub Actions runs on pull requests and pushes to main:

- **Windows checks:** formatting, TypeScript and frontend build, Vitest, server tests (including Windows Credential Manager) and desktop build.
- **SQL Server 2019, 2022 and 2025 Linux containers:** real API and database journeys against each engine using SQL authentication.
- **Windows SQL Server Express:** the complete Edge UI suite, Windows authentication, SQL login and saved connection strings.
- **Portable desktop:** package, extract and launch the real app, commit a grid edit, run SQL, save a query, restart, reconnect and verify a native download. A separate real portable update verifies integrity rejection, retry, restart guards and persistence through replacement.

The Windows jobs download the Microsoft-maintained Express bootstrap alias (currently SQL Server 2025). Downloads have a two-minute timeout and up to three attempts. Before execution, the bootstrap must be at least 1 MB and carry a valid Microsoft Authenticode signature. Each attempt logs the resolved URL, content type and size; successful validation also logs the product version and SHA-256. The Windows checks job tests rejected payloads, retries and retry exhaustion without installing SQL.

Failed jobs upload traces, screenshots, host logs and diagnostics. Playwright retries are disabled.

### Running locally

With Node.js, .NET, Edge and a local SQL Server available:

```powershell
npm ci
npm run check
npm run format:check
npm run test:e2e
```

`test:e2e` builds the frontend and manages the host and disposable databases. Defaults are `localhost` and Windows authentication, and the account needs permission to create and drop its test databases.

| Variable                                       | Purpose                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `EXQL_TEST_SERVER`                             | Another test server, optionally `hostname,port`                                                         |
| `EXQL_TEST_AUTH`                               | `windows` or `sql`                                                                                      |
| `EXQL_TEST_USER`, `EXQL_TEST_PASSWORD`         | Login for `sql` authentication                                                                          |
| `EXQL_TEST_SQL_USER`, `EXQL_TEST_SQL_PASSWORD` | Login for the SQL-login persistence journeys, which are skipped locally without it and always run in CI |

The Windows observer uses the built-in .NET SQL client, and SQL-authenticated runs use the independent tedious driver.

### Isolation

- SQL-backed tests create uniquely named `ExqlTest_` databases from `scripts/fixture.sql`, and each test drops only the database it created. They never use ExqlDemo.
- Playwright runs start their own devhost on a free port with fresh settings, so they can run alongside the dev host and each other.
- Database assertions use an independent SQL client, including exact numeric and date values, committed mutations, rollback, cancellation, exports and executable clipboard SQL.
- Credential tests create randomly named Windows vault entries and remove them.
- Workspace-loading regressions intercept workspace responses to check delayed loads and failed-load retries.

### Packaged app

`npm run test:desktop` runs the self-contained packaged desktop journeys, and `./scripts/test-updates.ps1` runs the real portable `0.0.1` to `0.0.2` update. Both build into fresh directories under `artifacts`, launch real windows, use isolated settings and disposable databases, clean up saved test credentials, and never publish a release.

Desktop debugging ports 9223 and 9224 must be free. The test-only `--automation-update-directory` requires an automation port and an explicit isolated `--data-directory`. Normal launches always use the fixed GitHub release feed.

### Not covered

Live Azure SQL and interactive Entra sign-in need an Azure account and database, and are not exercised by these tests. Azure SQL offers a free allowance, subject to eligibility and service limits: see [Microsoft's free-offer documentation](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql).

## Screenshots and social preview

`npm run screenshots` regenerates `docs/screenshots/` and `docs/social-preview.png` from the real UI, using `tests/screenshots/`. It needs a local SQL Server, and creates and drops a database named `Bookshop`, filled with fictional data. If a database with that name already exists, the run fails without touching it. The card's mascot, `tests/screenshots/social-mascot.png`, was created with built-in imagegen from `public/exql.png`.

Upload `docs/social-preview.png` under the repository's **Settings > General > Social preview** after changing it, because GitHub has no API for this.

## App icon

`public/exql.png` is the source, created with built-in imagegen and shared by the sidebar and browser tab. After replacing it, run `npm run icon` (requires Edge) to regenerate the multi-size `public/exql.ico` used by the Windows executable, native window and portable launcher. Both are checked in, and normal builds do not regenerate them.
