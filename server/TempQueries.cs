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
        // Link first: a failed link then leaves no file for a retry to duplicate.
        folders.Add(directory);
        var stem = $"{DateTime.Now:yyyy-MM-dd_HH-mm-ss}_{FileNamePart(name)}";
        return new(Write(stem, sql));
    }

    private string Write(string stem, string sql)
    {
        for (var attempt = 1; ; attempt++)
        {
            var path = Path.Combine(directory, attempt == 1 ? $"{stem}.sql" : $"{stem}_{attempt}.sql");
            FileStream file;
            // CreateNew makes "the name is free" and "the file is ours" one atomic step.
            try { file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None); }
            catch (IOException) when (File.Exists(path)) { continue; }
            try
            {
                using (file) file.Write(new UTF8Encoding(false).GetBytes(sql));
                return path;
            }
            catch
            {
                File.Delete(path);
                throw;
            }
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
