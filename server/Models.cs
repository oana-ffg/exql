namespace Exql;

public sealed record ConnectionRequest(string Server, string Database, string Authentication,
    string? Username, string? Password, bool TrustServerCertificate = false, bool Encrypt = true, string? ConnectionString = null);
public sealed record TableId(string Schema, string Name, string Kind);
public sealed record Column(string Name, string Type, bool Nullable, bool PrimaryKey = false, bool Editable = false, bool Generated = false);
public sealed record Filter(string Column, string Operator, string? Value);
public sealed record TableRequest(string Schema, string Table, List<Filter> Filters, string Match = "all",
    string? Sort = null, bool Descending = false, int Offset = 0, int Limit = 200);
public sealed record GridResult(List<Column> Columns, List<string?[]> Rows, bool HasMore, long? Total = null);
public sealed record CellChange(string Column, string? Value);
public sealed record RowChange(Dictionary<string, string?> Original, List<CellChange> Changes);
public sealed record EditRequest(string Schema, string Table, List<RowChange> Rows);
public sealed record QueryRequest(string Sql);
public sealed record QueryResult(string Id, List<Column> Columns, long RowCount, GridResult Page);
public sealed record QueryResponse(List<QueryResult> Results, int RecordsAffected, List<string> Messages);
public sealed record ExportRequest(TableRequest? Table, string? ResultId, string Format);
public sealed class InputException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}
