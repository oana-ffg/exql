using System.Globalization;

namespace Exql;

internal sealed record SqlBatch(string Text, int StartLine, int RepeatCount);

internal static class SqlBatches
{
    public static List<SqlBatch> Split(string sql)
    {
        List<SqlBatch> batches = [];
        var batchStart = 0;
        var batchLine = 1;
        var lineNumber = 1;
        var blockDepth = 0;
        var quote = '\0';
        for (var lineStart = 0; lineStart < sql.Length; lineNumber++)
        {
            var newline = sql.IndexOf('\n', lineStart);
            var nextLine = newline < 0 ? sql.Length : newline + 1;
            var lineEnd = newline < 0 ? sql.Length : newline;
            if (lineEnd > lineStart && sql[lineEnd - 1] == '\r') lineEnd--;
            var line = sql.AsSpan(lineStart, lineEnd - lineStart);
            if (quote == '\0' && blockDepth == 0 && SeparatorCount(line, lineNumber) is { } count)
            {
                AddBatch(lineStart, count);
                batchStart = nextLine;
                batchLine = lineNumber + 1;
            }
            else ScanLine(line, ref quote, ref blockDepth);
            lineStart = nextLine;
        }
        AddBatch(sql.Length, 1);
        return batches;

        void AddBatch(int end, int count)
        {
            var text = sql[batchStart..end];
            if (!string.IsNullOrWhiteSpace(text)) batches.Add(new(text, batchLine, count));
        }
    }

    private static int? SeparatorCount(ReadOnlySpan<char> line, int lineNumber)
    {
        var position = 0;
        SkipWhitespace(line, ref position);
        if (!line[position..].StartsWith("GO", StringComparison.OrdinalIgnoreCase)) return null;
        position += 2;
        var afterGo = position;
        SkipWhitespace(line, ref position);
        var countStart = position;
        if (position > afterGo)
            while (position < line.Length && char.IsAsciiDigit(line[position])) position++;
        var countEnd = position;
        while (position < line.Length)
        {
            SkipWhitespace(line, ref position);
            if (position == line.Length || line[position..].StartsWith("--")) break;
            if (!line[position..].StartsWith("/*")) return null;
            position += 2;
            var depth = 1;
            SkipBlockComment(line, ref position, ref depth);
            if (depth != 0) return null;
        }
        if (countStart == countEnd) return 1;
        if (!int.TryParse(line[countStart..countEnd], NumberStyles.None, CultureInfo.InvariantCulture, out var count) || count == 0)
            throw new InputException($"GO count on line {lineNumber} must be a positive integer between 1 and {int.MaxValue}.");
        return count;
    }

    private static void ScanLine(ReadOnlySpan<char> line, ref char quote, ref int blockDepth)
    {
        var position = 0;
        while (position < line.Length)
        {
            if (blockDepth > 0)
            {
                SkipBlockComment(line, ref position, ref blockDepth);
                continue;
            }
            var current = line[position++];
            if (quote != '\0')
            {
                if (current != quote) continue;
                if (position < line.Length && line[position] == quote) position++;
                else quote = '\0';
                continue;
            }
            if (current is '\'' or '"' or '[') quote = current == '[' ? ']' : current;
            else if (current == '-' && position < line.Length && line[position] == '-') return;
            else if (current == '/' && position < line.Length && line[position] == '*')
            {
                blockDepth = 1;
                position++;
            }
        }
    }

    // Called just after an opening /*, or at the start of a line inside a comment.
    private static void SkipBlockComment(ReadOnlySpan<char> line, ref int position, ref int depth)
    {
        while (position < line.Length && depth > 0)
        {
            var current = line[position++];
            if (position == line.Length) continue;
            if (current == '/' && line[position] == '*') { depth++; position++; }
            else if (current == '*' && line[position] == '/') { depth--; position++; }
        }
    }

    private static void SkipWhitespace(ReadOnlySpan<char> line, ref int position)
    {
        while (position < line.Length && char.IsWhiteSpace(line[position])) position++;
    }
}
