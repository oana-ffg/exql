using System.Text;
using System.Text.Json;

namespace Exql;

public sealed record ScriptFolder(string Id, string Path)
{
    public string Name => System.IO.Path.GetFileName(Path) is { Length: > 0 } name ? name : Path;
}
public sealed record AddScriptFolderRequest(string Path);
public sealed record ScriptFile(string Path, long Size, DateTime Modified);
public sealed record ScriptListing(List<ScriptFile> Scripts, bool Truncated);
public sealed record ScriptContent(string Sql, DateTime Modified);

public sealed class ScriptFolders(AppPaths paths)
{
    private const int MaxFiles = 2000;
    private const long MaxSize = 4 * 1024 * 1024;
    private readonly string path = Path.Combine(paths.Root, "script-folders.json");
    private readonly object gate = new();
    private readonly JsonSerializerOptions options = new() { WriteIndented = true };

    private List<ScriptFolder> Load() => File.Exists(path)
        ? JsonSerializer.Deserialize<List<ScriptFolder>>(File.ReadAllText(path)) ?? [] : [];

    private void Write(List<ScriptFolder> folders)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(folders.Select(folder => new { folder.Id, folder.Path }), options));
        File.Move(temp, path, true);
    }

    private static T Access<T>(string location, Func<T> action)
    {
        try { return action(); }
        catch (DecoderFallbackException) { throw new InputException($"{location} is not valid UTF-8; save it as UTF-8 or UTF-16 with a BOM."); }
        catch (FileNotFoundException) { throw new InputException($"Script not found: {location}", 404); }
        catch (DirectoryNotFoundException) { throw new InputException($"Script folder not found: {location}", 404); }
        catch (UnauthorizedAccessException) { throw new InputException($"Access denied: {location}"); }
        catch (IOException error) { throw new InputException($"Could not access {location}: {error.Message}"); }
    }

    public List<ScriptFolder> List()
    {
        lock (gate) return Access(path, Load);
    }

    public ScriptFolder Add(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) throw new InputException("Folder path is required.");
        var expanded = Environment.ExpandEnvironmentVariables(input.Trim().Trim('"').Trim());
        if (!Path.IsPathFullyQualified(expanded)) throw new InputException("Enter a fully qualified folder path.");
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(expanded));
        if (!Directory.Exists(root)) throw new InputException($"Script folder does not exist or is inaccessible: {root}");
        lock (gate) return Access(path, () =>
        {
            var folders = Load();
            var existing = folders.Find(folder => string.Equals(folder.Path, root, StringComparison.OrdinalIgnoreCase));
            if (existing is not null) return existing;
            var folder = new ScriptFolder(Guid.NewGuid().ToString("N"), root);
            folders.Add(folder);
            Write(folders);
            return folder;
        });
    }

    public void Delete(string id)
    {
        lock (gate) Access(path, () =>
        {
            var folders = Load();
            if (folders.RemoveAll(folder => folder.Id == id) == 0) throw new InputException("Linked script folder not found.", 404);
            Write(folders);
            return true;
        });
    }

    private string Root(string id)
    {
        var folder = List().Find(folder => folder.Id == id) ?? throw new InputException("Linked script folder not found.", 404);
        if (!Directory.Exists(folder.Path)) throw new InputException($"Script folder not found or inaccessible: {folder.Path}", 404);
        return folder.Path;
    }

    public ScriptListing Scripts(string id)
    {
        var root = Root(id);
        return Access(root, () =>
        {
            var files = Directory.EnumerateFiles(root, "*.sql", new EnumerationOptions
            {
                RecurseSubdirectories = true,
                IgnoreInaccessible = true,
                MatchCasing = MatchCasing.CaseInsensitive,
                AttributesToSkip = FileAttributes.Hidden | FileAttributes.System | FileAttributes.ReparsePoint,
            }).Order(StringComparer.OrdinalIgnoreCase).Take(MaxFiles + 1).ToList();
            return new ScriptListing(files.Take(MaxFiles).Select(file =>
            {
                var info = new FileInfo(file);
                return new ScriptFile(Path.GetRelativePath(root, file).Replace('\\', '/'), info.Length, info.LastWriteTimeUtc);
            }).ToList(), files.Count > MaxFiles);
        });
    }

    public ScriptContent Read(string id, string relative)
    {
        var root = Root(id);
        if (Path.IsPathRooted(relative)) throw new InputException("Choose a relative .sql path inside the linked folder.");
        var file = Path.GetFullPath(Path.Combine(root, relative));
        var prefix = Path.EndsInDirectorySeparator(root) ? root : root + Path.DirectorySeparatorChar;
        if (!file.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !string.Equals(Path.GetExtension(file), ".sql", StringComparison.OrdinalIgnoreCase))
            throw new InputException("Choose a .sql file inside the linked folder.");
        return Access(file, () =>
        {
            // A junction or symlink must not let a relative path escape the linked folder.
            for (var current = file; !string.Equals(current, root, StringComparison.OrdinalIgnoreCase); current = Path.GetDirectoryName(current)!)
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InputException("Scripts through symbolic links or junctions cannot be opened.");
            using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length > MaxSize) throw new InputException($"{relative} exceeds the 4 MiB script limit.");
            using var reader = new StreamReader(stream, new UTF8Encoding(false, true), detectEncodingFromByteOrderMarks: true);
            return new ScriptContent(reader.ReadToEnd(), File.GetLastWriteTimeUtc(file));
        });
    }
}
