# Data and security

ExQL runs as your Windows account and requests no elevation. It contains no telemetry.

## Credentials

- SQL passwords live in **Windows Credential Manager**, under `ExQL/connection/<profile-id>`, scoped to your Windows account. They are never returned by the profiles API or written to JSON files, browser storage, logs or arguments.
- Saved connection strings are stored the same way.
- Entra sign-in uses the driver's interactive authentication flow. Windows authentication uses the current Windows identity.
- Deleting a saved connection deletes its Windows credential.

## Local files

- Non-secret connection metadata and saved queries live in `%LOCALAPPDATA%/ExQL`. SQL text may itself contain sensitive information, and saved SQL is plain text in this directory.
- WebView2 keeps its browser profile under `%LOCALAPPDATA%/ExQL/WebView2`.
- Query results spool into randomly named `exql-*.jsonl` files in your temporary directory. They are deleted when replaced, on disconnect, or when the app exits normally. A forced termination can leave a snapshot behind. Snapshots are not encrypted separately from the filesystem.
- Removing the application files alone leaves your settings and credentials intact.

## Local API

The desktop host listens only on a random loopback port. API requests require a per-launch token injected by the native WebView host, an application header, and an accepted origin and host. External navigation and new windows are blocked.

The development host uses a fixed loopback port and omits the native token, so do not expose it on a network.

## Database permissions

Arbitrary SQL uses your database permissions and is not made read-only by the app. Statements already committed before a cancellation or error remain committed.

## Signing

The app and its releases are currently unsigned. See [Updates](usage.md#updates) for what package hashes do and don't guarantee. Windows code signing requires a separately configured certificate or signing service.
