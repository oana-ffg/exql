using System.Globalization;
using Exql;
using Xunit;

namespace Exql.Server.Tests;

public sealed class SqlValuesTests
{
    [Theory]
    [InlineData("date", "2026-10-11")]
    [InlineData("datetime", "2026-10-11T12:34:56.123")]
    [InlineData("smalldatetime", "2026-10-11T12:34:56.123")]
    [InlineData("datetime2", "2026-10-11T12:34:56.1234567")]
    public void DateTimeTextUsesPrecisionAcceptedByTheSqlType(string sqlType, string expected)
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("da-DK");
            var value = new DateTime(2026, 10, 11, 12, 34, 56).AddTicks(1234567);
            Assert.Equal(expected, SqlValues.DateTimeText(value, sqlType));
        }
        finally { CultureInfo.CurrentCulture = original; }
    }
}
