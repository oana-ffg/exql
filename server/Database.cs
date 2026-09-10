using System.Data;
using Microsoft.Data.SqlClient;

namespace Exql;

public static class Database
{
    public static string Quote(string identifier) => "[" + identifier.Replace("]", "]]") + "]";
    public static string Name(string schema, string table) => $"{Quote(schema)}.{Quote(table)}";
    private static readonly HashSet<string> EditableTypes = ["bigint", "int", "smallint", "tinyint", "decimal", "numeric", "money", "smallmoney", "float", "real", "bit", "char", "varchar", "nchar", "nvarchar", "date", "datetime", "datetime2", "smalldatetime", "datetimeoffset", "time", "uniqueidentifier", "binary", "varbinary"];

    public static async Task<SqlConnection> Open(DatabaseSession session, CancellationToken ct)
    {
        var connection = new SqlConnection(session.ConnectionString);
        try { await connection.OpenAsync(ct); return connection; }
        catch { await connection.DisposeAsync(); throw; }
    }
    public static async Task<List<TableId>> Catalog(SqlConnection connection, CancellationToken ct)
    {
        await using var command = new SqlCommand("SELECT s.name, o.name, o.type FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id WHERE o.type IN ('U','V') AND o.is_ms_shipped=0 ORDER BY s.name,o.name", connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        List<TableId> tables = [];
        while (await reader.ReadAsync(ct)) tables.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2).Trim() == "V" ? "view" : "table"));
        return tables;
    }
    public static async Task<List<Column>> Columns(SqlConnection connection, string schema, string table, CancellationToken ct, SqlTransaction? transaction = null)
    {
        const string sql = """
            SELECT c.name, TYPE_NAME(c.system_type_id), c.is_nullable,
              CAST(CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic
                ON ic.object_id=i.object_id AND ic.index_id=i.index_id
                WHERE i.object_id=c.object_id AND i.is_primary_key=1 AND ic.column_id=c.column_id) THEN 1 ELSE 0 END AS bit),
              CAST(CASE WHEN c.is_identity=1 OR c.is_computed=1 OR c.generated_always_type<>0 OR o.type='V' THEN 0 ELSE 1 END AS bit),
              CAST(CASE WHEN c.is_identity=1 OR c.is_computed=1 OR c.generated_always_type<>0 OR c.system_type_id=189 THEN 1 ELSE 0 END AS bit)
            FROM sys.columns c JOIN sys.objects o ON o.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id
            WHERE s.name=@schema AND o.name=@table AND o.type IN ('U','V') ORDER BY c.column_id
            """;
        await using var command = new SqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("@schema", schema);
        command.Parameters.AddWithValue("@table", table);
        await using var reader = await command.ExecuteReaderAsync(ct);
        List<Column> columns = [];
        while (await reader.ReadAsync(ct))
        {
            var type = reader.GetString(1);
            columns.Add(new(reader.GetString(0), type, reader.GetBoolean(2), reader.GetBoolean(3), reader.GetBoolean(4) && EditableTypes.Contains(type), reader.GetBoolean(5)));
        }
        if (columns.Count == 0) throw new InputException("Table or view was not found, or is not accessible.", 404);
        if (!columns.Any(c => c.PrimaryKey)) return columns.Select(c => c with { Editable = false }).ToList();
        return columns;
    }

    public static string Parameter(SqlCommand command, Column column, string? value)
    {
        var name = "@p" + command.Parameters.Count;
        command.Parameters.Add(name, SqlDbType.NVarChar, -1).Value = (object?)value ?? DBNull.Value;
        // Types are trusted system metadata, never user-supplied SQL. Conversion happens on the parameter,
        // preserving both exact numeric values and usable indexes on the column.
        var type = column.Type switch
        {
            "decimal" or "numeric" => null, // SQL implicit conversion uses the column's exact precision/scale.
            "binary" or "varbinary" or "timestamp" or "rowversion" => "varbinary(max)",
            "varchar" or "char" or "text" => "varchar(max)",
            "nvarchar" or "nchar" or "ntext" => "nvarchar(max)",
            "datetime2" => "datetime2(7)",
            "datetimeoffset" => "datetimeoffset(7)",
            "time" => "time(7)",
            _ when EditableTypes.Contains(column.Type) => column.Type,
            _ => null,
        };
        if (column.Type == "bit" && value is not null)
        {
            if (value is not ("true" or "false" or "1" or "0")) throw new InputException("Bit values must be true, false, 1, or 0.");
            command.Parameters[name].Value = value is "true" or "1" ? "1" : "0";
        }
        return type is null ? name : $"CONVERT({type}, {name}{(type == "varbinary(max)" ? ", 1" : "")})";
    }

    public static SqlCommand Select(SqlConnection connection, TableRequest request, List<Column> columns, bool paginate)
    {
        if (request.Filters.Count > 30 || request.Match is not ("all" or "any")) throw new InputException("Invalid filters.");
        if (request.Offset < 0 || request.Limit is < 1 or > 500) throw new InputException("Page size must be between 1 and 500.");
        var command = new SqlCommand { Connection = connection, CommandTimeout = 120 };
        List<string> predicates = [];
        foreach (var filter in request.Filters)
        {
            var column = columns.Find(c => c.Name == filter.Column) ?? throw new InputException("Unknown filter column.");
            var name = Quote(column.Name);
            if (filter.Operator is "is null" or "is not null") { predicates.Add($"{name} {filter.Operator}"); continue; }
            var value = filter.Value ?? throw new InputException("A filter value is required; use IS NULL for nulls.");
            if (filter.Operator is "contains" or "starts with")
            {
                if (column.Type is not ("char" or "varchar" or "nchar" or "nvarchar" or "text" or "ntext")) throw new InputException("Text filters require a text column.");
                var escaped = value.Replace("~", "~~").Replace("%", "~%").Replace("_", "~_").Replace("[", "~[");
                predicates.Add($"{name} LIKE {Parameter(command, column, (filter.Operator == "contains" ? "%" : "") + escaped + "%")} ESCAPE '~'");
            }
            else
            {
                if (filter.Operator is not ("=" or "<>" or ">" or ">=" or "<" or "<=")) throw new InputException("Unknown filter operator.");
                predicates.Add($"{name} {filter.Operator} {Parameter(command, column, value)}");
            }
        }
        var order = new List<string>();
        if (request.Sort is not null)
        {
            if (!columns.Any(c => c.Name == request.Sort)) throw new InputException("Unknown sort column.");
            order.Add(Quote(request.Sort) + (request.Descending ? " DESC" : " ASC"));
        }
        order.AddRange(columns.Where(c => c.PrimaryKey && c.Name != request.Sort).Select(c => Quote(c.Name)));
        command.CommandText = $"SELECT {string.Join(",", columns.Select(c => Quote(c.Name)))} FROM {Name(request.Schema, request.Table)}";
        if (predicates.Count > 0) command.CommandText += " WHERE " + string.Join(request.Match == "all" ? " AND " : " OR ", predicates);
        if (paginate || order.Count > 0) command.CommandText += " ORDER BY " + (order.Count > 0 ? string.Join(",", order) : "(SELECT NULL)");
        if (paginate)
        {
            command.CommandText += " OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY";
            command.Parameters.AddWithValue("@offset", request.Offset);
            command.Parameters.AddWithValue("@limit", request.Limit + 1);
        }
        return command;
    }
    public static async Task<GridResult> Page(SqlConnection connection, TableRequest request, CancellationToken ct)
    {
        var columns = await Columns(connection, request.Schema, request.Table, ct);
        await using var command = Select(connection, request, columns, true);
        await using var reader = await command.ExecuteReaderAsync(ct);
        List<string?[]> rows = [];
        while (await reader.ReadAsync(ct)) rows.Add(SqlValues.ReadRow(reader));
        var more = rows.Count > request.Limit;
        if (more) rows.RemoveAt(rows.Count - 1);
        return new(columns, rows, more);
    }

    public static async Task Edit(SqlConnection connection, EditRequest request, CancellationToken ct)
    {
        if (request.Rows.Count is < 1 or > 500) throw new InputException("Save between 1 and 500 rows at a time.");
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(ct);
        var columns = await Columns(connection, request.Schema, request.Table, ct, transaction);
        var keys = columns.Where(c => c.PrimaryKey).ToList();
        if (keys.Count == 0) throw new InputException("Editing requires a primary key to identify rows safely.");
        foreach (var row in request.Rows)
        {
            if (row.Changes.Count == 0 || row.Changes.Select(c => c.Column).Distinct().Count() != row.Changes.Count) throw new InputException("Invalid cell changes.");
            await using var command = new SqlCommand { Connection = connection, Transaction = transaction };
            List<string> assignments = [];
            foreach (var change in row.Changes)
            {
                var column = columns.Find(c => c.Name == change.Column && c.Editable) ?? throw new InputException("This column is read-only.");
                if (change.Value is null && !column.Nullable) throw new InputException($"{column.Name} does not accept NULL.");
                assignments.Add($"{Quote(column.Name)}={Parameter(command, column, change.Value)}");
            }
            // Compare the original editable fields (and rowversion if present) to reject stale writes.
            var compare = columns.Where(c => c.PrimaryKey || c.Editable || c.Type is "timestamp" or "rowversion").ToList();
            List<string> predicates = [];
            foreach (var column in compare)
            {
                if (!row.Original.TryGetValue(column.Name, out var value)) throw new InputException("Original row is incomplete. Refresh the table.");
                var name = Quote(column.Name);
                if (value is null) predicates.Add($"{name} IS NULL");
                else
                {
                    var parameter = Parameter(command, column, value);
                    // Binary comparison also detects casing/trailing-space changes under insensitive collations.
                    predicates.Add(column.Type is "char" or "varchar" or "nchar" or "nvarchar"
                        ? $"CONVERT(varbinary(max), {name})=CONVERT(varbinary(max), {parameter})"
                        : $"{name}={parameter}");
                }
            }
            command.CommandText = $"UPDATE {Name(request.Schema, request.Table)} SET {string.Join(",", assignments)} WHERE {string.Join(" AND ", predicates)}; SELECT @@ROWCOUNT;";
            var affected = Convert.ToInt32(await command.ExecuteScalarAsync(ct));
            if (affected != 1) throw new InputException("A row changed or was deleted since you loaded it. No edits were saved. Refresh and try again.", 409);
        }
        await transaction.CommitAsync(ct);
    }
}
