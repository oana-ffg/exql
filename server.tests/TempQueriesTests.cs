using Exql;
using Xunit;

namespace Exql.Server.Tests;

public sealed class TempQueriesTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "exql-temp-queries-" + Guid.NewGuid().ToString("N"));
    private readonly ScriptFolders folders;
    private readonly TempQueries store;

    public TempQueriesTests()
    {
        var paths = new AppPaths(root);
        folders = new ScriptFolders(paths);
        store = new TempQueries(paths, folders);
    }

    public void Dispose() => Directory.Delete(root, true);

    [Fact]
    public void SavesDatedFileWithExactTextAndLinksTheFolderOnce()
    {
        const string sql = "SELECT N'æøå 日本語';\r\nGO\n";
        var path = store.Save("Prod admin", sql).Path;
        store.Save("Prod admin", "SELECT 2;");

        Assert.Equal(Path.Combine(root, "temp_queries"), Path.GetDirectoryName(path));
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_Prod admin\.sql$", Path.GetFileName(path));
        Assert.Equal(sql, File.ReadAllText(path));
        Assert.Equal("temp_queries", Assert.Single(folders.List()).Name);
    }

    [Fact]
    public void SameNameInTheSameSecondNeverOverwrites()
    {
        var paths = Enumerable.Range(0, 5).Select(index => (Index: index, store.Save("Same", $"SELECT {index};").Path)).ToList();

        Assert.Equal(5, paths.Select(item => item.Path).Distinct().Count());
        foreach (var (index, path) in paths) Assert.Equal($"SELECT {index};", File.ReadAllText(path));
    }

    [Theory]
    [InlineData("Dev/QA: \"new\" <db>?", "Dev-QA- -new- -db--")]
    [InlineData("..\\..\\escape", "-..-escape")]
    [InlineData(" trailing. ", "trailing")]
    [InlineData("", "query")]
    [InlineData(" . ", "query")]
    public void TabNamesBecomeSafeFileNamesInsideTheFolder(string name, string expected)
    {
        var path = store.Save(name, "SELECT 1;").Path;

        Assert.Equal(Path.Combine(root, "temp_queries"), Path.GetDirectoryName(path));
        Assert.EndsWith($"_{expected}.sql", Path.GetFileName(path));
    }

    [Fact]
    public void LongTabNamesAreShortened()
    {
        var path = store.Save(new string('x', 500), "SELECT 1;").Path;

        Assert.EndsWith($"_{new string('x', 60)}.sql", Path.GetFileName(path));
    }
}
