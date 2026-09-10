using System.Text.Json;

namespace Exql;

public sealed class WorkspaceStore(AppPaths paths)
{
    private readonly string directory = Path.Combine(paths.Root, "workspace");
    private readonly object gate = new();
    private string PathFor(string key) => key is "scratch" or "library" ? Path.Combine(directory, key + ".json") : throw new InputException("Unknown workspace document.");
    public JsonElement? Read(string key)
    {
        lock (gate)
        {
            var path = PathFor(key);
            return File.Exists(path) ? JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(path)) : null;
        }
    }
    public void Write(string key, JsonElement value)
    {
        if (value.GetRawText().Length > 4 * 1024 * 1024) throw new InputException("Workspace document exceeds 4 MiB. Save large SQL scripts in a file.");
        lock (gate)
        {
            var path = PathFor(key);
            Directory.CreateDirectory(directory);
            File.WriteAllText(path + ".tmp", value.GetRawText());
            File.Move(path + ".tmp", path, true);
        }
    }
}
