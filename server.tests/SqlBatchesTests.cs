using Exql;
using Microsoft.Data.SqlClient;
using Xunit;

namespace Exql.Server.Tests;

public sealed class SqlBatchesTests
{
    [Theory]
    [InlineData("GO", 1)]
    [InlineData("go", 1)]
    [InlineData(" \tgO\t ", 1)]
    [InlineData("GO 3", 3)]
    [InlineData("GO\t0002 ", 2)]
    [InlineData("GO 2147483647", int.MaxValue)]
    [InlineData("GO -- comment ' [ /*", 1)]
    [InlineData("GO--comment", 1)]
    [InlineData("GO /* comment */", 1)]
    [InlineData("GO/* comment */ /* another */ -- end", 1)]
    [InlineData("GO 3 /* outer /* nested */ outer */ /* '' */ -- end", 3)]
    public void SeparatorsPreserveSurroundingTextAndRepeatCount(string separator, int count)
    {
        var batches = SqlBatches.Split($"  SELECT 1;  \n{separator}\n\tSELECT 2; ");
        Assert.Equal(2, batches.Count);
        Assert.Equal(new SqlBatch("  SELECT 1;  \n", 1, count), batches[0]);
        Assert.Equal(new SqlBatch("\tSELECT 2; ", 3, 1), batches[1]);
    }

    [Theory]
    [InlineData("GOTO label")]
    [InlineData("GO;")]
    [InlineData("GO foo")]
    [InlineData("SELECT 1 GO")]
    [InlineData("GOAL")]
    [InlineData("GO3")]
    [InlineData("GO -1")]
    [InlineData("GO +1")]
    [InlineData("GO 1.5")]
    [InlineData("GO 0 foo")]
    [InlineData("GO /* comment */ 3")]
    [InlineData("GO 3 /* comment */ extra")]
    [InlineData("/* comment */ GO")]
    [InlineData("-- GO")]
    public void NonSeparatorsArePassedThroughByteForByte(string line)
    {
        var sql = $" \tSELECT N'\u00e6';\r\n{line}\r\nSELECT 2;  ";
        Assert.Equal(new SqlBatch(sql, 1, 1), Assert.Single(SqlBatches.Split(sql)));
    }

    [Theory]
    [InlineData("SELECT 'before\nGO\nafter';")]
    [InlineData("SELECT N'before ''escaped\r\ngo 3\r\nafter';")]
    [InlineData("SELECT \"before\nGO\nafter\";")]
    [InlineData("SELECT \"before \"\"escaped\nGO 2\nafter\";")]
    [InlineData("SELECT [before\nGO\nafter];")]
    [InlineData("SELECT [before ]]escaped\nGO\nafter];")]
    [InlineData("/* before\nGO\nafter */ SELECT 1;")]
    [InlineData("/* outer /* nested\nGO\n*/ still outer\nGO 0\n*/ SELECT 1;")]
    [InlineData("-- ' \" [ /*\nSELECT 1;")]
    [InlineData("SELECT '-- /* ['; SELECT [/* ']; SELECT \"-- '\";")]
    public void ProtectedContextsDoNotSplitAndResumeAfterClosing(string sql)
    {
        var batches = SqlBatches.Split(sql + "\nGO\nSELECT 2;");
        Assert.Equal(2, batches.Count);
        Assert.Equal(sql + "\n", batches[0].Text);
        Assert.Equal("SELECT 2;", batches[1].Text);
    }

    [Theory]
    [InlineData("SELECT 'unterminated\nGO\nSELECT 2;")]
    [InlineData("SELECT N'escaped ''\nGO 0")]
    [InlineData("SELECT \"unterminated\nGO 0")]
    [InlineData("SELECT [unterminated\nGO 0")]
    [InlineData("/* unterminated\nGO 0")]
    [InlineData("/* outer /* inner */\nGO 0")]
    [InlineData("SELECT 1;\nGO /* unclosed\nGO 0")]
    [InlineData("SELECT 1;\nGO /* outer /* closed inner */\nGO 0")]
    [InlineData("SELECT 1;\nGO /* spans\nlines */\nSELECT 2;")]
    public void UnterminatedContextsAndMultilineSeparatorCommentsGoToSqlServer(string sql)
    {
        Assert.Equal(new SqlBatch(sql, 1, 1), Assert.Single(SqlBatches.Split(sql)));
    }

    [Theory]
    [InlineData("GO 0")]
    [InlineData("GO 000 -- zero")]
    [InlineData("go 2147483648")]
    [InlineData("GO 99999999999999999999999999999999999 /* overflow */")]
    public void InvalidCountsRejectTheWholeScript(string separator)
    {
        var error = Assert.Throws<InputException>(() => SqlBatches.Split($"SELECT 1;\nGO\nSELECT 2;\n{separator}"));
        Assert.Contains("GO count on line 4", error.Message);
        Assert.Contains("positive integer", error.Message);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" \t\r\n")]
    [InlineData("GO")]
    [InlineData("GO\r\nGO 2\n \t\nGO -- end")]
    public void EmptyBatchesAreSkipped(string sql) => Assert.Empty(SqlBatches.Split(sql));

    [Fact]
    public void LeadingTrailingAndConsecutiveSeparatorsKeepScriptLines()
    {
        var batches = SqlBatches.Split("GO\r\n \t\r\nGO\r\nSELECT 1;\r\nGO 2\r\nGO\r\n\r\n SELECT 2;\r\nGO");
        Assert.Equal(2, batches.Count);
        Assert.Equal(new SqlBatch("SELECT 1;\r\n", 4, 2), batches[0]);
        Assert.Equal(new SqlBatch("\r\n SELECT 2;\r\n", 7, 1), batches[1]);
    }

    [Fact]
    public void BareGoInAColumnListStillSeparatesBatches()
    {
        var batches = SqlBatches.Split("SELECT\n go\nFROM dbo.Items;");
        Assert.Equal(new SqlBatch("SELECT\n", 1, 1), batches[0]);
        Assert.Equal(new SqlBatch("FROM dbo.Items;", 3, 1), batches[1]);
    }

    [Theory]
    [InlineData(1, null, "script line 7")]
    [InlineData(3, "", "script line 9")]
    [InlineData(3, "dbo.Fails", "starting on script line 7, at line 3 of dbo.Fails")]
    [InlineData(0, null, "starting on script line 7")]
    [InlineData(0, "dbo.Fails", "starting on script line 7")]
    public void ErrorLocationOnlyOffsetsLinesRaisedByTheBatchItself(int errorLine, string? procedure, string expected)
    {
        Assert.Equal(expected, new SqlBatch("SELECT 1;", 7, 1).ErrorLocation(errorLine, procedure));
    }

    [Theory]
    [InlineData("SELECT 1;\nGO\nINSERT dbo.Items VALUES (1);\nGO 0", "GO count on line 4")]
    [InlineData("GO", "Enter SQL to run.")]
    [InlineData(null, "Enter SQL to run.")]
    public async Task RunValidatesBeforeExecutingAnySql(string? sql, string message)
    {
        using var session = new DatabaseSession("");
        await using var connection = new SqlConnection();
        var error = await Assert.ThrowsAsync<InputException>(() => QueryStore.Run(session, connection, sql!, QueryStore.DefaultTimeoutSeconds, CancellationToken.None));
        Assert.Contains(message, error.Message);
    }

    [Fact]
    public async Task RunChecksCancellationBeforeExecutingABatch()
    {
        using var session = new DatabaseSession("");
        await using var connection = new SqlConnection();
        using var abort = new CancellationTokenSource();
        abort.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => QueryStore.Run(session, connection, "SELECT 1;\nGO 3", QueryStore.DefaultTimeoutSeconds, abort.Token));
    }
}
