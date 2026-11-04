using System.Text.Json;
using Exql;
using Xunit;

namespace Exql.Server.Tests;

[Collection("Windows credentials")]
public sealed class CredentialTests
{
    [Theory]
    [InlineData("sql")]
    [InlineData("connectionString")]
    public void ClonesCopyCredentialsIntoIndependentEntries(string authentication)
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = Path.Combine(Path.GetTempPath(), "exql-clone-" + Guid.NewGuid().ToString("N"));
        var store = new ConnectionProfiles(new AppPaths(root));
        List<string> ids = [];
        try
        {
            var connection = new ConnectionRequest("localhost", "ExqlDemo", authentication, "test-user", "clone-secret",
                ConnectionString: "Server=localhost;Database=ExqlDemo;User ID=test-user;Password=clone-secret;TrustServerCertificate=True");
            var source = store.Save(new(null, "Source", "Tests", connection));
            ids.Add(source.Id);
            var clone = store.Save(new(null, "Source (copy)", "Tests", source.Connection, KeepPassword: true, CredentialSourceId: source.Id));
            ids.Add(clone.Id);
            Assert.NotEqual(source.Id, clone.Id);
            Assert.Equal(WindowsCredentials.Read(source.Id), WindowsCredentials.Read(clone.Id));
            Assert.Contains("clone-secret", WindowsCredentials.Read(source.Id));
            Assert.Throws<InputException>(() => store.Save(new(null, "Mismatch", "", source.Connection with
            {
                Authentication = authentication == "sql" ? "connectionString" : "sql",
            }, KeepPassword: true, CredentialSourceId: source.Id)));
            Assert.Equal(404, Assert.Throws<InputException>(() => store.Save(new(null, "Missing source", "", source.Connection,
                KeepPassword: true, CredentialSourceId: Guid.NewGuid().ToString("N")))).Status);
            store.Delete(clone.Id);
            Assert.Throws<InputException>(() => WindowsCredentials.Read(clone.Id));
            Assert.Contains("clone-secret", WindowsCredentials.Read(source.Id));
        }
        finally
        {
            foreach (var id in ids) WindowsCredentials.Delete(id);
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    [Fact]
    public void EditsKeepTheirPlaceAndReorderingPersists()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = Path.Combine(Path.GetTempPath(), "exql-order-" + Guid.NewGuid().ToString("N"));
        var store = new ConnectionProfiles(new AppPaths(root));
        try
        {
            var connection = new ConnectionRequest("localhost", "ExqlDemo", "windows", null, null);
            var saved = new[] { "A", "B", "C" }.Select(name => store.Save(new(null, name, "", connection))).ToList();
            string Names(IEnumerable<ConnectionProfile> profiles) => string.Concat(profiles.Select(profile => profile.Name));
            store.Save(new(saved[0].Id, "A2", "", connection));
            Assert.Equal("A2BC", Names(store.List()));
            store.Reorder([saved[2].Id, saved[0].Id, saved[1].Id]);
            Assert.Equal("CA2B", Names(new ConnectionProfiles(new AppPaths(root)).List()));
            // A list that went stale loses nothing and ignores what no longer exists.
            store.Reorder([saved[1].Id, "missing"]);
            Assert.Equal("BCA2", Names(store.List()));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

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
