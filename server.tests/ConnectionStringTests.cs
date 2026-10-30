using System.Text.Json;
using Exql;
using Microsoft.Data.SqlClient;
using Xunit;

namespace Exql.Server.Tests;

[Collection("Windows credentials")]
public sealed class ConnectionStringTests
{
    private static ConnectionRequest Request(string? value) => new("", "", "connectionString", null, null, ConnectionString: value);

    [Fact]
    public void ParsesAliasesQuotedPasswordsAndAdvancedOptions()
    {
        var parsed = new SqlConnectionStringBuilder(Sessions.BuildConnectionString(Request(
            "Data Source=tcp:localhost,1433;Initial Catalog=ExqlDemo;UID=test;PWD=\"a;b=c\";Encrypt=Strict;Connect Timeout=42;Application Intent=ReadOnly;MultipleActiveResultSets=true;Persist Security Info=true;")));
        Assert.Equal("a;b=c", parsed.Password);
        Assert.Equal(SqlConnectionEncryptOption.Strict, parsed.Encrypt);
        Assert.Equal(ApplicationIntent.ReadOnly, parsed.ApplicationIntent);
        Assert.True(parsed.MultipleActiveResultSets);
        Assert.Equal(42, parsed.ConnectTimeout);
        Assert.False(parsed.PersistSecurityInfo);
        Assert.False(parsed.Pooling);
    }

    [Theory]
    [InlineData("Server=localhost;")]
    [InlineData("Database=ExqlDemo;")]
    [InlineData("Server=localhost;Database=ExqlDemo;Password=\"private-unclosed")]
    [InlineData("Server=localhost;Database=ExqlDemo;private-key=value")]
    public void InvalidStringsHaveSafeErrors(string value)
    {
        var error = Assert.Throws<InputException>(() => Sessions.BuildConnectionString(Request(value)));
        Assert.DoesNotContain("private", error.Message);
    }

    [Fact]
    public void FullStringLivesOnlyInVaultAndSurvivesRenameAndReplacement()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = Path.Combine(Path.GetTempPath(), "exql-test-" + Guid.NewGuid().ToString("N"));
        var store = new ConnectionProfiles(new AppPaths(root));
        string? id = null;
        var secret = Guid.NewGuid().ToString("N");
        try
        {
            var profile = store.Save(new(null, "String test", "Tests", Request($"Server=localhost;Database=ExqlDemo;User ID=test;Password={secret};Application Intent=ReadOnly")));
            id = profile.Id;
            Assert.Equal("localhost", profile.Connection.Server);
            Assert.Equal("ExqlDemo", profile.Connection.Database);
            Assert.Null(profile.Connection.ConnectionString);
            Assert.DoesNotContain(secret, JsonSerializer.Serialize(store.List()));
            Assert.DoesNotContain(secret, File.ReadAllText(Path.Combine(root, "connections.json")));
            var fresh = new ConnectionProfiles(new AppPaths(root));
            fresh.Save(new(id, "Renamed", "Other", profile.Connection, KeepPassword: true));
            Assert.Equal(secret, new SqlConnectionStringBuilder(Sessions.BuildConnectionString(fresh.Resolve(id))).Password);
            fresh.Save(new(id, "Replaced", "Other", Request("Server=localhost;Database=ExqlDemo;Integrated Security=true;TrustServerCertificate=true;")));
            Assert.True(new SqlConnectionStringBuilder(Sessions.BuildConnectionString(fresh.Resolve(id))).IntegratedSecurity);
            Assert.DoesNotContain(secret, fresh.Resolve(id).ConnectionString!);
            fresh.Save(new(id, "Fields", "Other", new("localhost", "ExqlDemo", "windows", null, null)));
            Assert.Throws<InputException>(() => WindowsCredentials.Read(id));
        }
        finally
        {
            if (id is not null) store.Delete(id);
            File.Delete(Path.Combine(root, "connections.json"));
            if (Directory.Exists(root)) Directory.Delete(root);
        }
    }
}
