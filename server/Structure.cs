using Microsoft.Data.SqlClient;

namespace Exql;

/// <summary>Describes a table's or view's columns as declared, with their extended properties.</summary>
public static class Structure
{
    public static async Task<TableStructure> Read(SqlConnection connection, string schema, string table, CancellationToken ct)
    {
        const string sql = """
            DECLARE @id int = (SELECT o.object_id FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
              WHERE s.name=@schema AND o.name=@table AND o.type IN ('U','V'));
            SELECT @id;
            -- Every CLR type has system_type_id 240, which no system type row describes.
            SELECT c.column_id, c.name, t.name, SCHEMA_NAME(t.schema_id), ISNULL(t.is_user_defined, CAST(1 AS bit)),
              CAST(CASE WHEN c.system_type_id=240 THEN 1 ELSE 0 END AS bit),
              CAST(CASE WHEN c.user_type_id<>c.system_type_id THEN 1 ELSE 0 END AS bit), bt.name,
              c.max_length, c.precision, c.scale, SCHEMA_NAME(x.schema_id), x.name, c.is_xml_document,
              c.is_nullable,
              CAST(CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic
                ON ic.object_id=i.object_id AND ic.index_id=i.index_id
                WHERE i.object_id=c.object_id AND i.is_primary_key=1 AND ic.column_id=c.column_id) THEN 1 ELSE 0 END AS bit),
              CAST(idc.seed_value AS nvarchar(40)), CAST(idc.increment_value AS nvarchar(40)),
              dc.definition, cc.definition, cc.is_persisted, c.collation_name
            FROM sys.columns c
            -- A login may see a table but not a user-defined type it uses; built-in types are always visible.
            LEFT JOIN sys.types t ON t.user_type_id=c.user_type_id
            LEFT JOIN sys.types bt ON bt.user_type_id=c.system_type_id AND c.system_type_id<>240
            LEFT JOIN sys.xml_schema_collections x ON x.xml_collection_id=c.xml_collection_id AND c.xml_collection_id<>0
            LEFT JOIN sys.identity_columns idc ON idc.object_id=c.object_id AND idc.column_id=c.column_id
            LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
            LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id
            WHERE c.object_id=@id ORDER BY c.column_id;
            -- Class 1 is an object or column: minor_id 0 is the object itself, otherwise the column_id.
            SELECT minor_id, name, value FROM sys.extended_properties WHERE class=1 AND major_id=@id ORDER BY minor_id, name;
            """;
        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@schema", schema);
        command.Parameters.AddWithValue("@table", table);
        List<(int Id, DeclaredType Type, StructureColumn Column)> columns = [];
        List<ExtendedProperty> properties = [];
        int objectId;
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            await reader.ReadAsync(ct);
            if (reader.IsDBNull(0)) throw new InputException("Table or view was not found, or is not accessible.", 404);
            objectId = reader.GetInt32(0);
            await reader.NextResultAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                string? Text(int index) => reader.IsDBNull(index) ? null : reader.GetString(index);
                var type = new DeclaredType(Text(2), Text(3), reader.GetBoolean(4), reader.GetBoolean(5),
                    reader.GetBoolean(6), Text(7), reader.GetInt16(8), reader.GetByte(9), reader.GetByte(10),
                    Text(12) is { } collection ? $"{reader.GetString(11)}.{collection}" : null, reader.GetBoolean(13));
                var identity = Text(16) is { } seed ? $"IDENTITY({seed},{reader.GetString(17)})" : null;
                var computed = Text(19) is { } definition ? definition + (reader.GetBoolean(20) ? " PERSISTED" : "") : null;
                columns.Add((reader.GetInt32(0), type, new(reader.GetString(1), "", reader.GetBoolean(14), reader.GetBoolean(15),
                    identity, Text(18), computed, Text(21), [])));
            }
            var byId = columns.ToDictionary(column => column.Id, column => column.Column);
            await reader.NextResultAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var property = new ExtendedProperty(reader.GetString(1), SqlValues.Read(reader, 2));
                var minor = reader.GetInt32(0);
                if (minor == 0) properties.Add(property);
                else byId[minor].Properties.Add(property);
            }
        }
        // vector is a built-in type stored as varbinary, so it is found by its own name.
        var vectors = columns.Any(column => column.Type is { Name: "vector", UserDefined: false })
            ? await Vectors(connection, objectId, ct)
            : [];
        return new([.. columns.Select(column => column.Column with
        {
            Type = TypeName(vectors.TryGetValue(column.Id, out var vector) ? column.Type with { Vector = vector } : column.Type),
        })], properties);
    }

    // These sys.columns columns only exist from SQL Server 2025, the first version with a vector type,
    // so this query only runs for tables that have one.
    private static async Task<Dictionary<int, VectorShape>> Vectors(SqlConnection connection, int objectId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            "SELECT column_id, vector_dimensions, vector_base_type FROM sys.columns WHERE object_id=@id AND vector_dimensions IS NOT NULL",
            connection);
        command.Parameters.AddWithValue("@id", objectId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        Dictionary<int, VectorShape> shapes = [];
        while (await reader.ReadAsync(ct))
            shapes.Add(reader.GetInt32(0), new(reader.GetInt32(1), Convert.ToInt32(reader.GetValue(2)) == 1));
        return shapes;
    }

    internal sealed record VectorShape(int Dimensions, bool HalfPrecision);
    /// <param name="Name">The column's type, or null when this login may not see it.</param>
    /// <param name="BaseName">The system type underneath, or null for CLR types.</param>
    internal sealed record DeclaredType(string? Name, string? Schema, bool UserDefined, bool Assembly, bool Alias, string? BaseName,
        short MaxLength, byte Precision, byte Scale, string? XmlSchemaCollection = null, bool XmlDocument = false, VectorShape? Vector = null);

    /// <summary>The type as it would be declared, such as nvarchar(max), decimal(18,2) or dbo.Phone (nvarchar(20)).</summary>
    internal static string TypeName(DeclaredType type)
    {
        if (type.Vector is { } vector) return $"vector({vector.Dimensions}{(vector.HalfPrecision ? ", float16" : "")})";
        var qualified = type.Name is null ? null : type.UserDefined ? $"{type.Schema}.{type.Name}" : type.Name;
        if (type.Assembly) return qualified ?? "hidden CLR type";
        var size = type.MaxLength == -1 ? "max" : null;
        var declared = type.BaseName switch
        {
            "char" or "varchar" or "binary" or "varbinary" => $"{type.BaseName}({size ?? type.MaxLength.ToString()})",
            // Unicode lengths are stored in bytes, two per character.
            "nchar" or "nvarchar" => $"{type.BaseName}({size ?? (type.MaxLength / 2).ToString()})",
            "decimal" or "numeric" => $"{type.BaseName}({type.Precision},{type.Scale})",
            "datetime2" or "datetimeoffset" or "time" => $"{type.BaseName}({type.Scale})",
            "xml" when type.XmlSchemaCollection is { } collection => $"xml({(type.XmlDocument ? "DOCUMENT" : "CONTENT")} {collection})",
            _ => type.BaseName!,
        };
        // Alias types, including the built-in sysname, name the type they stand for.
        if (!type.Alias) return declared;
        return qualified is null ? $"{declared} (hidden alias type)" : $"{qualified} ({declared})";
    }
}
