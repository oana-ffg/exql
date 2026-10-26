using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace Exql;

public sealed record ConnectionProfile(string Id, string Name, string Folder, ConnectionRequest Connection);
public sealed record SaveProfileRequest(string? Id, string Name, string Folder, ConnectionRequest Connection, bool KeepPassword = false);

public sealed class ConnectionProfiles(AppPaths paths)
{
    private readonly string path = Path.Combine(paths.Root, "connections.json");
    private readonly object gate = new();
    private readonly JsonSerializerOptions options = new() { WriteIndented = true };

    public List<ConnectionProfile> List()
    {
        lock (gate) return Load();
    }
    public ConnectionProfile Get(string id)
    {
        lock (gate) return Load().Find(p => p.Id == id) ?? throw new InputException("Saved connection not found.", 404);
    }
    private List<ConnectionProfile> Load() => File.Exists(path)
        ? JsonSerializer.Deserialize<List<ConnectionProfile>>(File.ReadAllText(path)) ?? [] : [];
    private void Write(List<ConnectionProfile> profiles)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(profiles, options));
        File.Move(temp, path, true);
    }
    public ConnectionProfile Save(SaveProfileRequest request)
    {
        if (!OperatingSystem.IsWindows()) throw new InputException("Saved credentials require Windows.");
        if (string.IsNullOrWhiteSpace(request.Name)) throw new InputException("Connection name is required.");
        lock (gate)
        {
            var profiles = Load();
            var existing = request.Id is null ? null : profiles.Find(p => p.Id == request.Id) ?? throw new InputException("Saved connection not found.", 404);
            var id = existing?.Id ?? Guid.NewGuid().ToString("N");
            var connection = request.Connection;
            if (connection.Authentication == "connectionString")
            {
                if (request.KeepPassword)
                {
                    if (existing?.Connection.Authentication != "connectionString") throw new InputException("No saved connection string is available.");
                    connection = connection with { ConnectionString = WindowsCredentials.Read(id) };
                }
                var value = Sessions.BuildConnectionString(connection);
                var parsed = new SqlConnectionStringBuilder(value);
                WindowsCredentials.Write(id, parsed.UserID, value);
                connection = new(parsed.DataSource, parsed.InitialCatalog, "connectionString", parsed.UserID, null,
                    parsed.TrustServerCertificate, parsed.Encrypt != SqlConnectionEncryptOption.Optional);
            }
            else
            {
                _ = Sessions.BuildConnectionString(connection);
                if (connection.Authentication == "sql")
                {
                    if (request.KeepPassword && existing?.Connection.Authentication == "sql") _ = WindowsCredentials.Read(id);
                    else WindowsCredentials.Write(id, connection.Username ?? "", connection.Password ?? "");
                }
                else if (existing?.Connection.Authentication is "sql" or "connectionString") WindowsCredentials.Delete(id);
            }
            var profile = new ConnectionProfile(id, request.Name.Trim(), request.Folder.Trim(), connection with { Password = null, ConnectionString = null });
            profiles.RemoveAll(p => p.Id == id);
            profiles.Add(profile);
            Write(profiles);
            return profile;
        }
    }
    public ConnectionRequest Resolve(string id)
    {
        lock (gate)
        {
            var profile = Get(id);
            return profile.Connection with
            {
                Password = profile.Connection.Authentication == "sql" ? WindowsCredentials.Read(id) : null,
                ConnectionString = profile.Connection.Authentication == "connectionString" ? WindowsCredentials.Read(id) : null,
            };
        }
    }
    public void Delete(string id)
    {
        lock (gate)
        {
            var profiles = Load();
            if (profiles.All(p => p.Id != id)) throw new InputException("Saved connection not found.", 404);
            WindowsCredentials.Delete(id);
            profiles.RemoveAll(p => p.Id == id);
            Write(profiles);
        }
    }
}
