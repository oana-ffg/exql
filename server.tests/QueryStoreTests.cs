using Exql;
using Xunit;
using Xunit.Abstractions;

namespace Exql.Server.Tests;

public sealed class QueryStoreTests(ITestOutputHelper output)
{
    [Fact]
    public async Task LatePageReadsOnlyOnePageOfALargeSnapshot()
    {
        var path = Path.Combine(Path.GetTempPath(), "exql-test-" + Guid.NewGuid().ToString("N") + ".jsonl");
        try
        {
            var snapshot = await QueryStore.Store(path,
                [new("id", "nvarchar", false), new("text", "nvarchar", false), new("value", "nvarchar", false)],
                FixtureRows(100_000), QueryStore.MaxBytes, CancellationToken.None);
            var result = snapshot.Result;
            Assert.Equal(500, result.PageOffsets.Count);
            Assert.Equal(200, snapshot.Preview.Count);
            Assert.Equal(new FileInfo(path).Length, snapshot.Bytes);
            await using var stream = new CountingStream(File.OpenRead(path));
            var page = await QueryStore.Page(result, 99_800, stream, CancellationToken.None);
            output.WriteLine($"File bytes read: {stream.BytesRead}, snapshot bytes: {stream.Length}");
            Assert.Equal(200, page.Rows.Count);
            Assert.Equal("099800", page.Rows[0][0]);
            Assert.Equal("099999", page.Rows[^1][0]);
            Assert.False(page.HasMore);
            Assert.Equal(100_000, page.Total);
            Assert.True(stream.BytesRead < stream.Length / 100);
        }
        finally { File.Delete(path); }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(199)]
    [InlineData(200)]
    [InlineData(201)]
    [InlineData(999)]
    [InlineData(1001)]
    [InlineData(int.MaxValue)]
    public async Task IndexedPagesPreserveArbitraryOffsetsAndExport(int offset)
    {
        var path = Path.Combine(Path.GetTempPath(), "exql-test-" + Guid.NewGuid().ToString("N") + ".jsonl");
        using var session = new DatabaseSession("");
        try
        {
            var snapshot = await QueryStore.Store(path, [new("id", "nvarchar", false)], FixtureRows(1001), QueryStore.MaxBytes, CancellationToken.None);
            session.Results.Add("result", snapshot.Result);
            var page = await QueryStore.Page(session, "result", offset, CancellationToken.None);
            var expected = Math.Min(200, Math.Max(0, 1001 - offset));
            Assert.Equal(expected, page.Rows.Count);
            Assert.Equal(1001, page.Total);
            Assert.Equal(offset < 801, page.HasMore);
            for (var i = 0; i < expected; i++) Assert.Equal((offset + i).ToString("D6"), page.Rows[i][0]);
            var count = 0;
            await foreach (var row in QueryStore.Rows(snapshot.Result, CancellationToken.None))
                Assert.Equal((count++).ToString("D6"), row[0]);
            Assert.Equal(1001, count);
        }
        finally { session.ClearResults(); File.Delete(path); }
    }

    [Fact]
    public async Task EmptyAndOutOfRangePagesDoNotReadSnapshotData()
    {
        var path = Path.Combine(Path.GetTempPath(), "exql-test-" + Guid.NewGuid().ToString("N") + ".jsonl");
        try
        {
            var snapshot = await QueryStore.Store(path, [], FixtureRows(0), QueryStore.MaxBytes, CancellationToken.None);
            Assert.Empty(snapshot.Result.PageOffsets);
            Assert.Empty(snapshot.Preview);
            await using var stream = new CountingStream(File.OpenRead(path));
            var page = await QueryStore.Page(snapshot.Result, 0, stream, CancellationToken.None);
            Assert.Empty(page.Rows);
            Assert.False(page.HasMore);
            Assert.Equal(0, stream.BytesRead);
            await Assert.ThrowsAsync<InputException>(() => QueryStore.Page(snapshot.Result, -1, stream, CancellationToken.None));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task SnapshotBudgetAndCancellationStillStopWriting()
    {
        var path = Path.Combine(Path.GetTempPath(), "exql-test-" + Guid.NewGuid().ToString("N") + ".jsonl");
        try
        {
            await Assert.ThrowsAsync<InputException>(() => QueryStore.Store(path, [], FixtureRows(1000), 104, CancellationToken.None));
            Assert.Equal(0, new FileInfo(path).Length);
            File.Delete(path);
            using var abort = new CancellationTokenSource();
            abort.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => QueryStore.Store(path, [], FixtureRows(1000), QueryStore.MaxBytes, abort.Token));
            Assert.Equal(0, new FileInfo(path).Length);
        }
        finally { File.Delete(path); }
    }

    private static async IAsyncEnumerable<string?[]> FixtureRows(int count)
    {
        for (var i = 0; i < count; i++) yield return [i.ToString("D6"), "æ日本語", new string('x', 64)];
        await Task.CompletedTask;
    }

    private sealed class CountingStream(Stream inner) : Stream
    {
        public long BytesRead { get; private set; }
        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => inner.CanSeek;
        public override bool CanWrite => false;
        public override long Length => inner.Length;
        public override long Position { get => inner.Position; set => inner.Position = value; }
        public override int Read(byte[] buffer, int offset, int count)
        {
            var read = inner.Read(buffer, offset, count);
            BytesRead += read;
            return read;
        }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            var read = await inner.ReadAsync(buffer, ct);
            BytesRead += read;
            return read;
        }
        public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);
        public override void Flush() => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
    }
}
