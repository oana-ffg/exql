using System.IO;

namespace Exql.Desktop;

internal sealed record DesktopOptions(int? AutomationPort, string DataDirectory, string? UpdateDirectory)
{
    public static DesktopOptions Parse(string[] args)
    {
        int? port = null;
        string? data = null, updates = null;
        for (var i = 0; i < args.Length; i += 2)
        {
            if (i + 1 == args.Length) throw new ArgumentException($"Missing value for {args[i]}.");
            switch (args[i])
            {
                case "--automation-port" when int.TryParse(args[i + 1], out var value) && value is >= 1024 and <= 65535:
                    port = value;
                    break;
                case "--data-directory": data = Path.GetFullPath(args[i + 1]); break;
                case "--automation-update-directory": updates = Path.GetFullPath(args[i + 1]); break;
                default: throw new ArgumentException($"Unknown or invalid option: {args[i]}.");
            }
        }
        if (updates is not null && (port is null || data is null || !Directory.Exists(updates)))
            throw new ArgumentException("A test update directory requires an automation port, an isolated data directory, and an existing local feed.");
        return new(port, data ?? AppPaths.DefaultRoot, updates);
    }
}
