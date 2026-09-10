using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace Exql;

public static class QueryStore
{
    public const long MaxBytes = 256 * 1024 * 1024;
    public static async Task<QueryResponse> Run(DatabaseSession session, SqlConnection connection, string sql, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(sql)) throw new InputException("Enter SQL to run.");
        List<string> messages = [];
        connection.InfoMessage += (_, args) => { if (messages.Count < 200) messages.Add(args.Message); };
        await using var command = new SqlCommand(sql, connection) { CommandTimeout = 120 };
        Dictionary<string, StoredResult> pending = [];
        List<QueryResult> results = [];
        long bytes = 0;
        try
        {
            await using var reader = await command.ExecuteReaderAsync(ct);
            do
            {
                if (reader.FieldCount == 0) continue;
                if (results.Count >= 30) throw new InputException("A query can return at most 30 result sets. Split this batch into smaller queries.");
                var columns = SqlValues.ResultColumns(reader);
                var id = Guid.NewGuid().ToString("N");
                var path = Path.Combine(Path.GetTempPath(), $"exql-{id}.jsonl");
                pending[id] = new(path, columns, 0);
                long count = 0;
                List<string?[]> preview = [];
                await using (var writer = new StreamWriter(new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None), new UTF8Encoding(false)))
                {
                    while (await reader.ReadAsync(ct))
                    {
                        var row = SqlValues.ReadRow(reader);
                        var line = JsonSerializer.Serialize(row);
                        bytes += Encoding.UTF8.GetByteCount(line) + 1;
                        if (bytes > MaxBytes) throw new InputException("Query results exceeded the 256 MiB snapshot limit. Narrow the query, or use whole-table export for streaming. SQL already executed may have committed changes.");
                        await writer.WriteLineAsync(line.AsMemory(), ct);
                        if (preview.Count < 200) preview.Add(row);
                        count++;
                    }
                }
                pending[id] = new(path, columns, count);
                results.Add(new(id, columns, count, new(columns, preview, count > 200, count)));
            } while (await reader.NextResultAsync(ct));
            var affected = reader.RecordsAffected;
            session.ClearResults();
            foreach (var item in pending) session.Results.Add(item.Key, item.Value);
            return new(results, affected, messages);
        }
        catch
        {
            foreach (var result in pending.Values) File.Delete(result.Path);
            throw;
        }
    }
    public static StoredResult Get(DatabaseSession session, string id) => session.Results.TryGetValue(id, out var result)
        ? result : throw new InputException("Result snapshot expired. Run the query again.", 404);

    public static async IAsyncEnumerable<string?[]> Rows(StoredResult result, [EnumeratorCancellation] CancellationToken ct)
    {
        using var reader = File.OpenText(result.Path);
        while (await reader.ReadLineAsync(ct) is { } line) yield return JsonSerializer.Deserialize<string?[]>(line)!;
    }
    public static async Task<GridResult> Page(DatabaseSession session, string id, int offset, CancellationToken ct)
    {
        if (offset < 0) throw new InputException("Invalid offset.");
        var result = Get(session, id);
        List<string?[]> rows = [];
        long index = 0;
        await foreach (var row in Rows(result, ct))
        {
            if (index++ < offset) continue;
            rows.Add(row);
            if (rows.Count == 200) break;
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
