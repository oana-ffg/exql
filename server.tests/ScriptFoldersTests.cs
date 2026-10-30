using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Exql;
using Xunit;

namespace Exql.Server.Tests;

public sealed class ScriptFoldersTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "exql-scripts-" + Guid.NewGuid().ToString("N"));
    private readonly ScriptFolders store;
    private readonly string scripts;

    public ScriptFoldersTests()
    {
        scripts = Path.Combine(root, "Scripts");
        Directory.CreateDirectory(scripts);
        store = new ScriptFolders(new AppPaths(Path.Combine(root, "State")));
    }

    public void Dispose() => Directory.Delete(root, true);

    [Fact]
    public void NormalizesDeduplicatesAndPersistsFoldersWithoutChangingFiles()
    {
        var variable = "EXQL_TEST_" + Guid.NewGuid().ToString("N");
        Environment.SetEnvironmentVariable(variable, scripts);
        try
        {
            var folder = store.Add($"  \"%{variable}%{Path.DirectorySeparatorChar}\"  ");
            Assert.Equal(scripts, folder.Path);
            Assert.Equal("Scripts", folder.Name);
            Assert.Equal(folder, store.Add(scripts.ToUpperInvariant()));
            var fresh = new ScriptFolders(new AppPaths(Path.Combine(root, "State")));
            Assert.Equal(folder, Assert.Single(fresh.List()));
            var file = Path.Combine(scripts, "keep.sql");
            File.WriteAllText(file, "SELECT 1;");
            fresh.Delete(folder.Id);
            Assert.Empty(store.List());
            Assert.Equal("SELECT 1;", File.ReadAllText(file));
        }
        finally { Environment.SetEnvironmentVariable(variable, null); }
    }

    [Fact]
    public void RejectsRelativeAndMissingFolders()
    {
        Assert.Contains("fully qualified", Assert.Throws<InputException>(() => store.Add("Scripts")).Message);
        Assert.Contains("does not exist", Assert.Throws<InputException>(() => store.Add(Path.Combine(root, "missing"))).Message);
    }

    [Fact]
    public void ListsNestedSqlFilesInOrderAndSkipsHiddenAndOtherFiles()
    {
        Directory.CreateDirectory(Path.Combine(scripts, "Nested"));
        File.WriteAllText(Path.Combine(scripts, "top.SQL"), "SELECT 1;");
        File.WriteAllText(Path.Combine(scripts, "Nested", "inner.sql"), "SELECT 2;");
        File.WriteAllText(Path.Combine(scripts, "notes.txt"), "notes");
        var hidden = Path.Combine(scripts, "hidden.sql");
        File.WriteAllText(hidden, "SELECT 3;");
        File.SetAttributes(hidden, FileAttributes.Hidden);
        var folder = store.Add(scripts);
        var listing = store.Scripts(folder.Id);
        Assert.Equal(["Nested/inner.sql", "top.SQL"], listing.Scripts.Select(file => file.Path));
        Assert.All(listing.Scripts, file => { Assert.True(file.Size > 0); Assert.Equal(DateTimeKind.Utc, file.Modified.Kind); });
        Assert.False(listing.Truncated);
        Assert.Empty(listing.Unreadable);
        Directory.Delete(Path.Combine(scripts, "Nested"), true);
        File.Delete(hidden);
        File.Delete(Path.Combine(scripts, "top.SQL"));
        File.Delete(Path.Combine(scripts, "notes.txt"));
        Directory.Delete(scripts);
        var error = Assert.Throws<InputException>(() => store.Scripts(folder.Id));
        Assert.Equal(404, error.Status);
        Assert.Contains(scripts, error.Message);
    }

    [Theory]
    [InlineData("..\\x.sql")]
    [InlineData("sub/../../x.sql")]
    [InlineData("notes.txt")]
    public void RejectsTraversalAndNonSqlPaths(string relative)
    {
        var folder = store.Add(scripts);
        Assert.Equal(400, Assert.Throws<InputException>(() => store.Read(folder.Id, relative)).Status);
        Assert.Equal(400, Assert.Throws<InputException>(() => store.Read(folder.Id, Path.Combine(scripts, "top.sql"))).Status);
    }

    [Fact]
    public void ReadsUtf16BomAndRejectsInvalidUtf8OversizeAndMissingFiles()
    {
        var folder = store.Add(scripts);
        File.WriteAllText(Path.Combine(scripts, "unicode.sql"), "SELECT N'æøå 日本語';", Encoding.Unicode);
        Assert.Equal("SELECT N'æøå 日本語';", store.Read(folder.Id, "unicode.sql").Sql);
        File.WriteAllBytes(Path.Combine(scripts, "invalid.sql"), [0xff]);
        Assert.Contains("not valid UTF-8", Assert.Throws<InputException>(() => store.Read(folder.Id, "invalid.sql")).Message);
        using (var file = File.Create(Path.Combine(scripts, "large.sql"))) file.SetLength(4 * 1024 * 1024 + 1);
        Assert.Contains("4 MiB", Assert.Throws<InputException>(() => store.Read(folder.Id, "large.sql")).Message);
        Assert.Equal(404, Assert.Throws<InputException>(() => store.Read(folder.Id, "missing.sql")).Status);
    }

    [Fact]
    public void CapsSortedListingsAtTwoThousandFiles()
    {
        for (var i = 2000; i >= 0; i--) File.WriteAllText(Path.Combine(scripts, $"{i:D4}.sql"), "");
        var listing = store.Scripts(store.Add(scripts).Id);
        Assert.True(listing.Truncated);
        Assert.Equal(2000, listing.Scripts.Count);
        Assert.Equal("0000.sql", listing.Scripts[0].Path);
        Assert.Equal("1999.sql", listing.Scripts[^1].Path);
    }

    [Fact]
    public void ReportsUnreadableSubfoldersAndKeepsReadableScripts()
    {
        if (!OperatingSystem.IsWindows()) return;
        File.WriteAllText(Path.Combine(scripts, "open.sql"), "SELECT 1;");
        var locked = Directory.CreateDirectory(Path.Combine(scripts, "Locked"));
        File.WriteAllText(Path.Combine(locked.FullName, "denied.sql"), "SELECT 2;");
        var deny = new FileSystemAccessRule(WindowsIdentity.GetCurrent().User!, FileSystemRights.ListDirectory, AccessControlType.Deny);
        var security = locked.GetAccessControl();
        security.AddAccessRule(deny);
        locked.SetAccessControl(security);
        try
        {
            var listing = store.Scripts(store.Add(scripts).Id);
            Assert.Equal(["open.sql"], listing.Scripts.Select(file => file.Path));
            Assert.Equal(["Locked"], listing.Unreadable);
        }
        finally
        {
            security.RemoveAccessRule(deny);
            locked.SetAccessControl(security);
        }
    }
}
