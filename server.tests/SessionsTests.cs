using Exql;
using Xunit;

namespace Exql.Server.Tests;

public sealed class SessionsTests
{
    private readonly Sessions sessions = new();

    [Fact]
    public async Task ANewPageRetiresEarlierPagesButNotUnownedSessions()
    {
        await sessions.Claim("first", CancellationToken.None);
        var old = sessions.Add("old", "first");
        var unowned = sessions.Add("unowned");

        await sessions.Claim("second", CancellationToken.None);
        var current = sessions.Add("current", "second");

        Assert.Equal(404, Assert.Throws<InputException>(() => sessions.Get(old)).Status);
        Assert.Equal("unowned", sessions.Get(unowned).ConnectionString);
        Assert.Equal("current", sessions.Get(current).ConnectionString);
    }

    [Fact]
    public async Task ClaimingAgainKeepsThatPagesSessions()
    {
        await sessions.Claim("first", CancellationToken.None);
        var kept = sessions.Add("kept", "first");

        await sessions.Claim("first", CancellationToken.None);

        Assert.Equal("kept", sessions.Get(kept).ConnectionString);
    }

    [Fact]
    public async Task AConnectFinishingAfterItsPageWasReplacedIsRefused()
    {
        await sessions.Claim("first", CancellationToken.None);
        await sessions.Claim("second", CancellationToken.None);

        Assert.Throws<InputException>(() => sessions.Add("late", "first"));

        for (var index = 0; index < 20; index++) sessions.Add($"current {index}", "second");
    }

    [Fact]
    public async Task EarlierPagesDoNotCountTowardsTheSessionLimit()
    {
        await sessions.Claim("first", CancellationToken.None);
        for (var index = 0; index < 20; index++) sessions.Add($"old {index}", "first");
        Assert.Contains("Disconnect", Assert.Throws<InputException>(() => sessions.Add("over", "first")).Message);

        await sessions.Claim("second", CancellationToken.None);

        for (var index = 0; index < 20; index++) sessions.Add($"current {index}", "second");
    }

    [Fact]
    public async Task RetiringWaitsForAnOperationInProgress()
    {
        await sessions.Claim("first", CancellationToken.None);
        var session = sessions.Get(sessions.Add("busy", "first"));
        await session.Gate.WaitAsync();

        var claim = sessions.Claim("second", CancellationToken.None);
        await Task.Delay(50);
        Assert.False(claim.IsCompleted);

        session.Gate.Release();
        await claim;
    }
}
