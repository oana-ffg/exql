using System.Collections.Concurrent;
using Microsoft.Data.SqlClient;

namespace Exql;

public sealed class DatabaseSession(string connectionString) : IDisposable
{
    public string ConnectionString { get; } = connectionString;
    public SemaphoreSlim Gate { get; } = new(1, 1);
    public Dictionary<string, StoredResult> Results { get; } = [];
    public void ClearResults()
    {
        foreach (var result in Results.Values) File.Delete(result.Path);
        Results.Clear();
    }
    public void Dispose() => ClearResults();
}

public sealed record StoredResult(string Path, List<Column> Columns, long RowCount);

public sealed class Sessions : IDisposable
{
    private readonly ConcurrentDictionary<string, DatabaseSession> sessions = new();
    public string Add(string connectionString)
    {
        if (sessions.Count >= 20) throw new InputException("Disconnect an existing session before opening another.");
        var id = Guid.NewGuid().ToString("N");
        sessions[id] = new DatabaseSession(connectionString);
        return id;
    }
    public DatabaseSession Get(string id) => sessions.TryGetValue(id, out var session)
        ? session : throw new InputException("Connection expired. Please reconnect.", 404);
    public void Remove(string id)
    {
        if (sessions.TryRemove(id, out var session)) session.Dispose();
    }
    public void Dispose() { foreach (var session in sessions.Values) session.Dispose(); }

    public static string BuildConnectionString(ConnectionRequest request)
    {
        if (request.Authentication == "connectionString")
        {
            SqlConnectionStringBuilder parsed;
            try { parsed = new SqlConnectionStringBuilder(request.ConnectionString ?? ""); }
            catch (ArgumentException) { throw new InputException("Invalid SQL Server connection string. Check its keywords, values, and quoting."); }
            if (string.IsNullOrWhiteSpace(parsed.DataSource) || string.IsNullOrWhiteSpace(parsed.InitialCatalog))
                throw new InputException("The connection string must include Server (Data Source) and Database (Initial Catalog).");
            parsed.ApplicationName = "ExQL";
            parsed.Pooling = false;
            parsed.PersistSecurityInfo = false;
            return parsed.ConnectionString;
        }
        if (string.IsNullOrWhiteSpace(request.Server) || string.IsNullOrWhiteSpace(request.Database))
            throw new InputException("Server and database are required.");
        var builder = new SqlConnectionStringBuilder
        {
            DataSource = request.Server.Trim(),
            InitialCatalog = request.Database.Trim(),
            ConnectTimeout = 20,
            TrustServerCertificate = request.TrustServerCertificate,
            Encrypt = request.Encrypt ? SqlConnectionEncryptOption.Mandatory : SqlConnectionEncryptOption.Optional,
            ApplicationName = "ExQL",
            Pooling = false,
        };
        switch (request.Authentication)
        {
            case "windows": builder.IntegratedSecurity = true; break;
            case "sql":
                if (string.IsNullOrWhiteSpace(request.Username)) throw new InputException("Username is required.");
                builder.UserID = request.Username; builder.Password = request.Password ?? ""; break;
            case "entra":
                builder.Authentication = SqlAuthenticationMethod.ActiveDirectoryInteractive;
                if (!string.IsNullOrWhiteSpace(request.Username)) builder.UserID = request.Username;
                break;
            default: throw new InputException("Choose Windows, SQL Server, or Microsoft Entra authentication.");
        }
        return builder.ConnectionString;
    }
}
