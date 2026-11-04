# Using ExQL

## Browsing data

- Open tables and views from schema folders in the explorer. Refresh the explorer after schema changes.
- Click cells and navigate with the arrow keys, Tab, Home and End. Shift-click or Shift+arrow selects a rectangular range.
- Hover over row numbers to select rows. Ctrl+A selects the loaded page.
- Click a column header to sort. Primary keys break ties. Tables without a primary key have no guaranteed order unless you choose a sort column.
- Tables and query results display 200 rows per page.

## Filters

Add column filters, choose all conditions (AND) or any condition (OR), then click **Apply filters**. Filters are drafts until you apply them. Text contains and prefix filters match literal characters, including `%` and `_`.

## Copying

- Ctrl+C copies the cell or range as tab-separated text. NULL is displayed and copied as `NULL`.
- The copy toolbar outputs one or more rows as JSON, CSV or SQL.
- SQL from table rows uses INSERT statements, omitting identity, computed and rowversion columns. SQL from query results uses executable SELECT statements with column aliases.

## Right-click menus

Shift+F10 opens a menu from the keyboard. Arrow keys navigate and Escape closes it. Right-clicking inside a selection keeps it.

- **Cells and row numbers:** copy a cell, selection or rows as JSON, CSV or SQL, edit, set NULL, revert a cell edit, or add a filter for the value.
- **Column headers:** copy the name or loaded values, sort either way, or add a filter.
- **Explorer:** open data, write a SELECT query, copy qualified names or saved SQL, and manage query folders.
- **SQL editor:** run, undo, redo, copy, paste and select all.

## Editing cells

Double-click a cell, press Enter or press F2 to edit. **Apply to grid** stages the value. **Save changes** commits the batch in a transaction, and **Discard changes** restores the loaded values. NULL is a separate choice from empty text.

Table edits require a primary key. Views, query results, generated columns and unsupported SQL types are read-only. Original column values, and rowversion when present, detect concurrent changes. A conflict rolls back the complete batch.

## Foreign keys

In table data, cells of a foreign key column show an arrow that opens the referenced table filtered to that row, using every column of a composite key.

- A column in more than one key asks which to follow.
- A cell whose key has a NULL has no arrow.
- The same choices are in the right-click menu.
- **Back to …** returns to the previous table with its filters, sort and page.
- Query results have no arrows, because their columns are not tied to a table.

## Running SQL

Ctrl+Enter runs the T-SQL script, or only the selected text. Multiple result sets get separate tabs. Saved queries can be named, moved between folders through **Save query**, and reopened from the sidebar.

**Copy all as text** copies every result set from the last run, including rows beyond the loaded page, plus any messages and error, as one plain-text block. Each result is labelled and its rows are CSV in a fenced block, ready to paste into an AI chat or a note.

### Batches

- `GO` on its own line separates batches, and `GO n` repeats the preceding batch a positive integer number of times.
- Separators are case-insensitive and may have trailing line comments, or block comments that close on that line. Strings, quoted identifiers and comments can contain `GO` without splitting a batch.
- All batches in a run use the same SQL connection, preserving temporary tables, SET options, the current database and open transactions. This also applies to selections and to Play on linked scripts.
- Unlike SSMS, ExQL stops at the first failed batch. Earlier results, messages and affected-row totals stay visible alongside the error, and any changes already committed remain. Errors in multi-batch scripts identify the failed batch and its line in the submitted script.

### Limits and timeouts

- Query snapshots are limited to 256 MiB and 30 result sets per run, across all batches and repetitions. A run keeps its first 200 messages. Completed results stay available when a run reaches a limit. An incomplete result set is discarded.
- Each batch execution, including each `GO n` repetition, times out after 2 minutes by default. Change the default in **Settings** (the gear button), or use **Timeout** next to **Run SQL** to change it for one tab until you change it back or close the app. Options include **No limit** and a custom number of minutes up to 24 hours. A timeout says which batch stopped.
- Each table load and table export times out after 120 seconds.
- While anything is running, the status bar shows how long it has been going.
- Cancel aborts the request and closes its SQL connection. Statements committed before a cancellation or a later error remain committed.

## Exporting

**Export** downloads the whole table or all rows matching the applied filters, across every page, and excludes unsaved edits. Query exports read the completed result snapshot and never run the query again.

Whole-table export streams from SQL Server without the snapshot limit. Downloads currently buffer in the WebView before saving, so available memory limits very large exports.

- **JSON** preserves numeric digits, booleans, NULL, Unicode and empty strings. Exported numbers keep their exact decimal representation, though a consumer using ordinary JavaScript numbers may round them.
- **CSV** quotes non-null fields, doubles embedded quotes, and leaves NULL unquoted and empty. Formula-like text is kept as is, so spreadsheet software may interpret such values when opening the file.

## SQL script folders

**SQL scripts > Add script folder** links an existing folder and lists its `.sql` files, including subfolders, above the saved query library. The Windows folder picker also accepts a pasted path, including quoted paths and environment variables such as `%USERPROFILE%\Downloads`.

- ExQL only reads these files. It never copies, changes or uploads them, and removing a folder from ExQL only unlinks it.
- Listings refresh on app start, window focus, opening SQL scripts, and the refresh button.
- Click a filename to read it into the editor. Play reads the latest disk content and immediately runs it on the current connection.
- Unmodified open scripts reload on focus. Edited scripts show a notice when disk content changes, with **Reload from disk** available.
- **Save query** creates an explicit library copy.
- Each folder listing shows up to 2,000 files, and each opened script may be at most 4 MiB. UTF-8 and UTF-16 with a byte-order mark are supported.
- Hidden, system and linked files or subfolders are skipped. Subfolders ExQL cannot search, for example because access is denied, are named under the folder so missing scripts are never silent.

## Layout

Drag the divider beside the sidebar, or between the SQL editor and its results, to resize them. Double-click a divider to reset it. With a divider focused, the arrow keys, Home and End also resize. Sizes are saved between restarts and shared by all workspaces. The results pane appears once a run has something to show.

## Connections

### Saving and connecting

- **Save only** stores a profile without connecting. **Save & connect** stores it and opens a session.
- Click a saved connection to connect with its saved credential. Right-click it to **Edit**, **Delete** or **Clone…**.
- A clone gets the same settings and a distinct default color. You can keep its password or connection string, which is copied into the clone's own Windows Credential Manager entry.
- Group connections into folders by setting a folder name.

Azure SQL should use its server hostname, encryption enabled and certificate trust disabled, and needs suitable firewall or network rules.

### Colors

Each connection has a color, shown on its tab, connection card and saved profile. The open connection's color also tints its tab and the top bar, and underlines the top bar. Choose a preset or custom **Connection color** in Database connections. **Save only** updates colors in open workspaces immediately.

The six presets pair light and dark green, amber and red. Use green for Dev, amber for QA and red for Prod, with light shades for regular access and dark shades for admin connections. Colors are visual labels, so keep the environment and access role in the connection name too.

### Connection strings

Choose **Connection method → Connection string** to paste a SQL Server or Azure SQL connection string. Advanced driver options are preserved. ExQL overrides the application name, disables connection pooling, and disables persistence of security information.

The complete saved string lives in Windows Credential Manager, and only server, database and display metadata is written to the profile file. Saved strings stay hidden when reopening a profile: keep the stored string or replace it. Windows limits each credential to 1,280 UTF-16 characters. Longer strings can be used without saving.

### Tabs and workspaces

**Add connection** opens another workspace and keeps existing ones open, unless the only thing open is the empty starting tab. Tabs show the saved connection name, or the database name for unsaved connections. Hover to see the database and server.

- Each workspace keeps its table, filters, staged edits, SQL editor and results when you switch tabs, and queries can run in different workspaces at the same time.
- Drag tabs to reorder them, or drag saved connections to reorder them within their folder. With one focused, Shift+arrow keys do the same. Both orders are kept across restarts.
- Disconnect affects only the selected workspace.
- Closing a workspace disconnects its session and asks only if it has staged edits. Its SQL is saved as a `.sql` file in `%LOCALAPPDATA%/ExQL/temp_queries`, named with the date, time and tab name, unless it matches a saved query. If that save fails, the tab stays open and shows the error. ExQL links that folder under **SQL scripts** and never deletes its files.

### Restarts and sessions

Open workspaces and their SQL drafts survive a restart. Tabs for saved connections reconnect by themselves, unless you disconnected them or they use Microsoft Entra sign-in, which waits for a click because it opens a browser window. A tab that cannot reconnect shows why and offers a retry. Unsaved connections have no stored credential, so their tabs stay offline until you connect again.

ExQL does not hold a SQL connection open. **Connected** means the session has working credentials, and each action opens its own connection and closes it afterwards. Temporary tables, `USE`, `SET` options and open transactions therefore last only for a single run.

## Updates

ExQL checks this repository's public GitHub Releases at startup and every six hours while open. **Check for updates** runs a manual check. New stable versions download in the background, and **Restart to update** applies a verified package after the workspace and SQL host shut down. Updates never restart the app automatically, and a downloaded update stays available after you close and reopen ExQL.

- Restarting is blocked while queries are running, cell edits are staged, workspace writes are pending or have failed, or a dialog is open. This includes inactive workspaces.
- Updates preserve `%LOCALAPPDATA%/ExQL` and Windows Credential Manager entries. SQL scratch text and saved queries are stored separately from the application files.
- Only one instance may run from each application folder, so its updater cannot interrupt another instance.
- A failed download or integrity check leaves the current app running and offers **Retry update**. The next scheduled check also retries.
- Application files must be writable by your account.
- Standalone `dist/ExQL.exe` builds predate the updater, so switch to the portable ZIP once.

Package hashes detect corrupt downloads, but they are not publisher signatures. Releases are unsigned, so authenticity relies on HTTPS and control of the GitHub repository. Updates use the pinned, MIT-licensed [Velopack](https://github.com/velopack/velopack) SDK and CLI, with no paid service or client-side GitHub token.
