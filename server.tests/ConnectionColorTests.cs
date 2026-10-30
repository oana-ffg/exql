using System.Text.Json;
using Exql;
using Xunit;

namespace Exql.Server.Tests;

[Collection("Windows credentials")]
public sealed class ConnectionColorTests
{
    [Fact]
    public void LegacyProfilesGetDistinctStableColorsAndCustomColorsSurviveRename()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = Directory.CreateTempSubdirectory("exql-colors-").FullName;
        var store = new ConnectionProfiles(new AppPaths(root));
        var connection = new ConnectionRequest("localhost", "ExqlDemo", "windows", null, null);
        var firstId = Guid.NewGuid().ToString("N");
        var secondId = Guid.NewGuid().ToString("N");
        try
        {
            File.WriteAllText(Path.Combine(root, "connections.json"), JsonSerializer.Serialize(new[] {
                new ConnectionProfile(firstId, "First", "", connection),
                new ConnectionProfile(secondId, "Second", "", connection)
            }));
            var profiles = store.List();
            Assert.NotNull(profiles[0].Color);
            Assert.NotEqual(profiles[0].Color, profiles[1].Color);
            var secondColor = profiles[1].Color;
            Assert.Equal(profiles[0].Color, store.Get(firstId).Color);
            store.Save(new(firstId, "First", "", connection, Color: "#AB12CD"));
            var fresh = new ConnectionProfiles(new AppPaths(root));
            Assert.Equal("#ab12cd", fresh.Get(firstId).Color);
            Assert.Equal(secondColor, fresh.Get(secondId).Color);
            fresh.Save(new(firstId, "Renamed", "", connection));
            Assert.Equal("#ab12cd", fresh.Get(firstId).Color);
        }
        finally
        {
            store.Delete(firstId);
            store.Delete(secondId);
            File.Delete(Path.Combine(root, "connections.json"));
            Directory.Delete(root);
        }
    }

    [Fact]
    public void InvalidColorUpdatesLeaveTheSavedProfileUnchanged()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = Directory.CreateTempSubdirectory("exql-colors-").FullName;
        var store = new ConnectionProfiles(new AppPaths(root));
        var connection = new ConnectionRequest("localhost", "ExqlDemo", "windows", null, null);
        var profile = store.Save(new(null, "Color check", "", connection, Color: "#89b4fa"));
        try
        {
            var before = File.ReadAllText(Path.Combine(root, "connections.json"));
            foreach (var color in new[] { "red", "#fff", "#aabbcc00", "#ffffff\n", "var(--accent)" })
            {
                Assert.Throws<InputException>(() => store.Save(new(profile.Id, "Changed", "", connection, Color: color)));
                Assert.Equal(before, File.ReadAllText(Path.Combine(root, "connections.json")));
            }
        }
        finally
        {
            store.Delete(profile.Id);
            File.Delete(Path.Combine(root, "connections.json"));
            Directory.Delete(root);
        }
    }
}
