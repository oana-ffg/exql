using System.Text;

namespace Exql;

public sealed record SaveTempQueryRequest(string Name, string Sql);
public sealed record TempQuery(string Path);

/// <summary>Keeps the SQL of closed tabs as files, listed like any linked script folder.</summary>
public sealed class TempQueries(AppPaths paths, ScriptFolders folders)
{
    private const int MaxNameLength = 60;
    private readonly string directory = Path.Combine(paths.Root, "temp_queries");

    public TempQuery Save(string name, string sql)
    {
        Directory.CreateDirectory(directory);
        var stem = $"{DateTime.Now:yyyy-MM-dd_HH-mm-ss}_{FileNamePart(name)}";
        var path = Write(stem, sql);
        folders.Add(directory);
        return new(path);
    }

    private string Write(string stem, string sql)
    {
        for (var attempt = 1; ; attempt++)
        {
            var path = Path.Combine(directory, attempt == 1 ? $"{stem}.sql" : $"{stem}_{attempt}.sql");
            try
            {
                // CreateNew makes "the name is free" and "the file is ours" one atomic step.
                using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                file.Write(new UTF8Encoding(false).GetBytes(sql));
                return path;
            }
            catch (IOException) when (File.Exists(path)) { }
        }
    }

    private static string FileNamePart(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var safe = new string(name.Select(character => invalid.Contains(character) ? '-' : character).ToArray()).Trim(' ', '.');
        if (safe.Length > MaxNameLength) safe = safe[..MaxNameLength].Trim(' ', '.');
        return safe.Length > 0 ? safe : "query";
    }
}
