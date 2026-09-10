using System.Text.Json;
using Exql;
using Xunit;

namespace Exql.Server.Tests;

public sealed class CredentialTests
{
    [Fact]
    public void WindowsVaultRoundTripAndDeletion()
    {
        if (!OperatingSystem.IsWindows()) return;
        var id = Guid.NewGuid().ToString("N");
        var value = "ExQL test " + Guid.NewGuid() + " æøå 日本語";
        try
        {
            WindowsCredentials.Write(id, "exql-test", value);
            Assert.Equal(value, WindowsCredentials.Read(id));
            WindowsCredentials.Write(id, "exql-test", "replacement");
            Assert.Equal("replacement", WindowsCredentials.Read(id));
        }
        finally { WindowsCredentials.Delete(id); }
        Assert.Throws<InputException>(() => WindowsCredentials.Read(id));
    }

    [Fact]
    public void MultipleProfilesPersistWithoutPasswordsAndKeepCredentialsWhenRenamed()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = Path.Combine(Path.GetTempPath(), "exql-test-" + Guid.NewGuid().ToString("N"));
        var store = new ConnectionProfiles(new AppPaths(root));
        List<string> ids = [];
        var password = Guid.NewGuid().ToString("N");
        try
        {
            var connection = new ConnectionRequest("localhost", "ExqlDemo", "sql", "test-user", password);
            var first = store.Save(new(null, "Test one", "Development", connection)); ids.Add(first.Id);
            var second = store.Save(new(null, "Test two", "Development", connection with { Database = "master" })); ids.Add(second.Id);
            Assert.Null(first.Connection.Password);
            Assert.DoesNotContain(password, File.ReadAllText(Path.Combine(root, "connections.json")));
            Assert.DoesNotContain(password, JsonSerializer.Serialize(store.List()));
            var fresh = new ConnectionProfiles(new AppPaths(root));
            Assert.Equal(2, fresh.List().Count);
            Assert.Equal(password, fresh.Resolve(first.Id).Password);
            fresh.Save(new(first.Id, "Renamed", "Other", connection with { Password = null }, KeepPassword: true));
            Assert.Equal(password, fresh.Resolve(first.Id).Password);
            Assert.Equal("Renamed", fresh.List().Single(profile => profile.Id == first.Id).Name);
        }
        finally
        {
            foreach (var id in ids) store.Delete(id);
            File.Delete(Path.Combine(root, "connections.json"));
            Directory.Delete(root);
        }
    }
}
