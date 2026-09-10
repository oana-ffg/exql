namespace Exql;

public sealed record AppPaths(string Root)
{
    public static string DefaultRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ExQL");
}
