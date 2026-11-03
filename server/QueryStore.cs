using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace Exql;

public static class QueryStore
{
    public const int PageSize = 200;
    public const long MaxBytes = 256 * 1024 * 1024;
    public const int DefaultTimeoutSeconds = 120;
    // Zero is SqlCommand's "no limit".
    private const int MaxTimeoutSeconds = 86_400;
    private const int SqlClientTimeoutNumber = -2;
    public static async Task<QueryResponse> Run(DatabaseSession session, SqlConnection connection, string sql, int timeoutSeconds, CancellationToken ct)
    {
        if (timeoutSeconds is < 0 or > MaxTimeoutSeconds) throw new InputException("The script timeout must be at most 24 hours, or no limit.");
        // A request that omits the text binds null despite the non-nullable model property.
        List<SqlBatch> batches = string.IsNullOrWhiteSpace(sql) ? [] : SqlBatches.Split(sql);
        if (batches.Count == 0) throw new InputException("Enter SQL to run.");
        List<string> messages = [];
        void OnInfoMessage(object sender, SqlInfoMessageEventArgs args) { if (messages.Count < 200) messages.Add(args.Message); }
        connection.InfoMessage += OnInfoMessage;
        Dictionary<string, StoredResult> pending = [];
        List<QueryResult> results = [];
        long bytes = 0;
        long affected = -1;
        try
        {
            string? failureMessage = null;
            try
            {
                for (var batchIndex = 0; batchIndex < batches.Count; batchIndex++)
                {
                    var batch = batches[batchIndex];
                    await using var command = new SqlCommand(batch.Text, connection) { CommandTimeout = timeoutSeconds };
                    for (var repetition = 0; repetition < batch.RepeatCount; repetition++)
                    {
                        ct.ThrowIfCancellationRequested();
                        try
                        {
                            await using var reader = await command.ExecuteReaderAsync(ct);
                            try
                            {
                                do
                                {
                                    if (reader.FieldCount == 0) continue;
                                    if (results.Count >= 30) throw new InputException("A query can return at most 30 result sets. Split this script into smaller queries. SQL already executed may have committed changes.");
                                    var columns = SqlValues.ResultColumns(reader);
                                    var id = Guid.NewGuid().ToString("N");
                                    var path = Path.Combine(Path.GetTempPath(), $"exql-{id}.jsonl");
                                    var snapshot = await Store(path, columns, ReadRows(reader, ct), MaxBytes - bytes, ct);
                                    bytes += snapshot.Bytes;
                                    pending[id] = snapshot.Result;
                                    results.Add(new(id, columns, snapshot.Result.RowCount,
                                        new(columns, snapshot.Preview, snapshot.Result.RowCount > PageSize, snapshot.Result.RowCount)));
                                } while (await reader.NextResultAsync(ct));
                            }
                            finally
                            {
                                if (reader.RecordsAffected >= 0) affected = Math.Max(0, affected) + reader.RecordsAffected;
                            }
                        }
                        catch (SqlException error) when ((error.Number == SqlClientTimeoutNumber || batches.Count > 1 || batch.RepeatCount > 1) && !ct.IsCancellationRequested)
                        {
                            var cause = error.Number == SqlClientTimeoutNumber
                                ? $"The batch timed out after {timeoutSeconds} sec. Choose a longer Timeout next to Run SQL to give it more time."
                                : $"SQL Server error: {error.Message}";
                            var repeat = batch.RepeatCount > 1 ? $" (execution {repetition + 1} of {batch.RepeatCount})" : "";
                            var stopped = batches.Count > 1 || batch.RepeatCount > 1
                                ? $"Stopped at batch {batchIndex + 1} of {batches.Count}{repeat}, {batch.ErrorLocation(error.LineNumber, error.Procedure)}."
                                : "Stopped.";
                            throw new InputException($"{stopped} Any changes committed before the error remain. {cause}", innerException: error);
                        }
                    }
                }
            }
            catch (Exception failure) when (!ct.IsCancellationRequested
                && failure is SqlException or InputException
                && (results.Count > 0 || messages.Count > 0 || affected >= 0))
            {
                failureMessage = failure.Message;
            }
            ct.ThrowIfCancellationRequested();
            session.ClearResults();
            foreach (var item in pending) session.Results.Add(item.Key, item.Value);
            return new(results, affected, messages, failureMessage);
        }
        catch
        {
            foreach (var result in pending.Values) File.Delete(result.Path);
            throw;
        }
        finally { connection.InfoMessage -= OnInfoMessage; }
    }
    internal static async Task<(StoredResult Result, List<string?[]> Preview, long Bytes)> Store(
        string path, List<Column> columns, IAsyncEnumerable<string?[]> rows, long maxBytes, CancellationToken ct)
    {
        long count = 0, bytes = 0;
        List<long> pageOffsets = [];
        List<string?[]> preview = [];
        // Only delete files we created, and dispose the writer before deleting on failure.
        var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        try
        {
            await using var ownedStream = stream;
            await using var writer = new StreamWriter(stream, new UTF8Encoding(false));
            // Fixed LF endings make the byte index independent of the host platform.
            writer.NewLine = "\n";
            await foreach (var row in rows.WithCancellation(ct))
            {
                var line = JsonSerializer.Serialize(row);
                var lineBytes = Encoding.UTF8.GetByteCount(line) + 1;
                if (bytes + lineBytes > maxBytes) throw new InputException("Query results exceeded the 256 MiB snapshot limit. Narrow the query, or use whole-table export for streaming. SQL already executed may have committed changes.");
                if (count % PageSize == 0) pageOffsets.Add(bytes);
                bytes += lineBytes;
                await writer.WriteLineAsync(line.AsMemory(), ct);
                if (preview.Count < PageSize) preview.Add(row);
                count++;
            }
            return (new(path, columns, count, pageOffsets), preview, bytes);
        }
        catch
        {
            File.Delete(path);
            throw;
        }
    }
    public static StoredResult Get(DatabaseSession session, string id) => session.Results.TryGetValue(id, out var result)
        ? result : throw new InputException("Result snapshot expired. Run the query again.", 404);

    public static async IAsyncEnumerable<string?[]> Rows(StoredResult result, [EnumeratorCancellation] CancellationToken ct)
    {
        using var stream = File.OpenRead(result.Path);
        await foreach (var row in Rows(stream, ct)) yield return row;
    }
    private static async IAsyncEnumerable<string?[]> Rows(Stream stream, [EnumeratorCancellation] CancellationToken ct)
    {
        using var reader = new StreamReader(stream, leaveOpen: true);
        while (await reader.ReadLineAsync(ct) is { } line) yield return JsonSerializer.Deserialize<string?[]>(line)!;
    }
    public static async Task<GridResult> Page(DatabaseSession session, string id, int offset, CancellationToken ct)
    {
        var result = Get(session, id);
        using var stream = File.OpenRead(result.Path);
        return await Page(result, offset, stream, ct);
    }
    internal static async Task<GridResult> Page(StoredResult result, int offset, Stream stream, CancellationToken ct)
    {
        if (offset < 0) throw new InputException("Invalid offset.");
        List<string?[]> rows = [];
        if (offset >= result.RowCount) return new(result.Columns, rows, false, result.RowCount);
        var page = offset / PageSize;
        stream.Seek(result.PageOffsets[page], SeekOrigin.Begin);
        var skip = offset % PageSize;
        await foreach (var row in Rows(stream, ct))
        {
            if (skip-- > 0) continue;
            rows.Add(row);
            if (rows.Count == PageSize) break;
        }
        return new(result.Columns, rows, offset + rows.Count < result.RowCount, result.RowCount);
    }
    public static async IAsyncEnumerable<string?[]> ReadRows(SqlDataReader reader, [EnumeratorCancellation] CancellationToken ct)
    {
        while (await reader.ReadAsync(ct)) yield return SqlValues.ReadRow(reader);
    }
    public static async Task Export(HttpResponse response, string format, List<Column> columns, IAsyncEnumerable<string?[]> rows, CancellationToken ct)
    {
        if (format is not ("csv" or "json")) throw new InputException("Choose CSV or JSON.");
        response.ContentType = format == "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";
        response.Headers.ContentDisposition = $"attachment; filename=exql-export.{format}";
        if (format == "csv")
        {
            await using var writer = new StreamWriter(response.Body, new UTF8Encoding(true), leaveOpen: true);
            await writer.WriteLineAsync(string.Join(",", columns.Select(c => SqlValues.Csv(c.Name))).AsMemory(), ct);
            await foreach (var row in rows.WithCancellation(ct))
                await writer.WriteLineAsync(string.Join(",", row.Select(SqlValues.Csv)).AsMemory(), ct);
            await writer.FlushAsync(ct);
        }
        else
        {
            await using var writer = new Utf8JsonWriter(response.Body);
            writer.WriteStartArray();
            await foreach (var row in rows.WithCancellation(ct))
            {
                SqlValues.WriteJsonRow(writer, columns, row);
                if (writer.BytesPending > 65536) await writer.FlushAsync(ct);
            }
            writer.WriteEndArray();
            await writer.FlushAsync(ct);
        }
    }
}
