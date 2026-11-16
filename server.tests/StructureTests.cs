using Exql;
using Xunit;
using static Exql.Structure;

namespace Exql.Server.Tests;

public sealed class StructureTests
{
    private static DeclaredType System(string name, short maxLength = 0, byte precision = 0, byte scale = 0) =>
        new(name, "sys", false, false, false, name, maxLength, precision, scale);

    [Theory]
    [InlineData("nvarchar", -1, 0, 0, "nvarchar(max)")]
    [InlineData("nvarchar", 100, 0, 0, "nvarchar(50)")]
    [InlineData("nchar", 20, 0, 0, "nchar(10)")]
    [InlineData("varchar", -1, 0, 0, "varchar(max)")]
    [InlineData("varchar", 50, 0, 0, "varchar(50)")]
    [InlineData("char", 2, 0, 0, "char(2)")]
    [InlineData("varbinary", -1, 0, 0, "varbinary(max)")]
    [InlineData("binary", 16, 0, 0, "binary(16)")]
    [InlineData("decimal", 9, 18, 2, "decimal(18,2)")]
    [InlineData("numeric", 5, 5, 0, "numeric(5,0)")]
    [InlineData("datetime2", 8, 27, 7, "datetime2(7)")]
    [InlineData("datetimeoffset", 9, 26, 2, "datetimeoffset(2)")]
    [InlineData("time", 3, 8, 0, "time(0)")]
    [InlineData("int", 4, 10, 0, "int")]
    [InlineData("float", 8, 53, 0, "float")]
    [InlineData("datetime", 8, 23, 3, "datetime")]
    [InlineData("xml", -1, 0, 0, "xml")]
    public void SystemTypesShowTheirDeclaredSize(string name, short maxLength, byte precision, byte scale, string expected) =>
        Assert.Equal(expected, TypeName(System(name, maxLength, precision, scale)));

    [Fact]
    public void AliasTypesNameTheTypeTheyStandFor()
    {
        Assert.Equal("dbo.Phone (nvarchar(20))", TypeName(new("Phone", "dbo", true, false, true, "nvarchar", 40, 0, 0)));
        Assert.Equal("sysname (nvarchar(128))", TypeName(new("sysname", "sys", false, false, true, "nvarchar", 256, 0, 0)));
    }

    [Fact]
    public void ClrTypesAreNamedWithoutASize()
    {
        Assert.Equal("hierarchyid", TypeName(new("hierarchyid", "sys", false, true, true, "hierarchyid", 892, 0, 0)));
        Assert.Equal("app.Point", TypeName(new("Point", "app", true, true, true, "Point", 8000, 0, 0)));
    }

    [Fact]
    public void TypedXmlNamesItsSchemaCollection()
    {
        Assert.Equal("xml(CONTENT dbo.Orders)", TypeName(System("xml", -1) with { XmlSchemaCollection = "dbo.Orders" }));
        Assert.Equal("xml(DOCUMENT dbo.Orders)",
            TypeName(System("xml", -1) with { XmlSchemaCollection = "dbo.Orders", XmlDocument = true }));
    }

    [Fact]
    public void VectorsShowDimensionsAndHalfPrecision()
    {
        Assert.Equal("vector(3)", TypeName(System("vector") with { Vector = new(3, false) }));
        Assert.Equal("vector(1536, float16)", TypeName(System("vector") with { Vector = new(1536, true) }));
    }
}
