using System.Globalization;
using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace Exql;

public static class SqlValues
{
    private static readonly HashSet<string> NumericTypes = ["bigint", "int", "smallint", "tinyint", "decimal", "numeric", "money", "smallmoney", "float", "real"];
    public static string? Read(SqlDataReader reader, int index)
    {
        if (reader.IsDBNull(index)) return null;
        if (reader.GetDataTypeName(index) is "decimal" or "numeric") return reader.GetSqlDecimal(index).ToString();
        return reader.GetValue(index) switch
        {
            byte[] bytes => "0x" + Convert.ToHexString(bytes),
            DateTime date => date.ToString("yyyy-MM-ddTHH:mm:ss.fffffff", CultureInfo.InvariantCulture),
            DateTimeOffset date => date.ToString("o", CultureInfo.InvariantCulture),
            bool value => value ? "true" : "false",
            TimeSpan value => value.ToString("c", CultureInfo.InvariantCulture),
            IFormattable value => value.ToString(null, CultureInfo.InvariantCulture),
            object value => value.ToString(),
        };
    }
    public static string?[] ReadRow(SqlDataReader reader) => Enumerable.Range(0, reader.FieldCount).Select(i => Read(reader, i)).ToArray();
    public static void WriteJsonRow(Utf8JsonWriter writer, List<Column> columns, string?[] row)
    {
        writer.WriteStartObject();
        for (var i = 0; i < columns.Count; i++)
        {
            writer.WritePropertyName(columns[i].Name);
            if (row[i] is not { } value) writer.WriteNullValue();
            else if (NumericTypes.Contains(columns[i].Type)) writer.WriteRawValue(value);
            else if (columns[i].Type == "bit") writer.WriteBooleanValue(value == "true");
            else writer.WriteStringValue(value);
        }
        writer.WriteEndObject();
    }
    public static string Csv(string? value) => value is null ? "" : "\"" + value.Replace("\"", "\"\"") + "\"";
    public static List<Column> ResultColumns(SqlDataReader reader)
    {
        // Unique labels keep duplicate/unnamed query columns lossless in JSON objects.
        var used = new HashSet<string>(StringComparer.Ordinal);
        return Enumerable.Range(0, reader.FieldCount).Select(i =>
        {
            var name = string.IsNullOrEmpty(reader.GetName(i)) ? $"Column {i + 1}" : reader.GetName(i);
            var unique = name;
            for (var suffix = 2; !used.Add(unique); suffix++) unique = $"{name} ({suffix})";
            return new Column(unique, reader.GetDataTypeName(i), true);
        }).ToList();
    }
}
