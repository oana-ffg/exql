using System.Text.Json;
using System.Text.RegularExpressions;

namespace Exql;

internal static class ConnectionColors
{
    private sealed record ColorOption(string Value);
    private static readonly List<ColorOption> Palette = ReadPalette();

    private static List<ColorOption> ReadPalette()
    {
        using var stream = typeof(ConnectionColors).Assembly.GetManifestResourceStream("Exql.ConnectionColors.json")
            ?? throw new InvalidOperationException("The connection color palette is missing.");
        return JsonSerializer.Deserialize<List<ColorOption>>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("The connection color palette is invalid.");
    }

    public static string Next(IEnumerable<string?> used)
    {
        var colors = used.ToList();
        return Palette.MinBy(option => colors.Count(color => string.Equals(color, option.Value, StringComparison.OrdinalIgnoreCase)))!.Value;
    }

    public static string Normalize(string color)
    {
        if (!Regex.IsMatch(color, "\\A#[0-9a-fA-F]{6}\\z")) throw new InputException("Choose a connection color in #RRGGBB format.");
        return color.ToLowerInvariant();
    }
}
