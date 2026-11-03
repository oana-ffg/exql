using System.Net;
using System.Net.Sockets;
using Exql;
using Xunit;

namespace Exql.Server.Tests;

public sealed class ExqlHostTests : IDisposable
{
    private readonly string dataDirectory = Path.Combine(Path.GetTempPath(), "exql-host-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(dataDirectory))
            Directory.Delete(dataDirectory, true);
    }

    [Fact]
    public async Task StandaloneHostListensOnTheRequestedPort()
    {
        var port = FreePort();
        await using var host = ExqlHost.Build(["--DataDirectory", dataDirectory, "--DevHostPort", port.ToString()]);

        await host.StartAsync();

        Assert.Equal([$"http://127.0.0.1:{port}"], host.Urls);
        await host.StopAsync();
    }

    [Fact]
    public async Task DesktopHostIgnoresTheDevHostPort()
    {
        using var occupied = new TcpListener(IPAddress.Loopback, 0);
        occupied.Start();
        var port = ((IPEndPoint)occupied.LocalEndpoint).Port;
        await using var host = ExqlHost.Build(["--DataDirectory", dataDirectory, "--DevHostPort", port.ToString()], desktop: true, "token");

        await host.StartAsync();

        Assert.DoesNotContain($"http://127.0.0.1:{port}", host.Urls);
        await host.StopAsync();
    }

    [Fact]
    public void InvalidPortFailsInsteadOfFallingBackToTheDefault()
    {
        Assert.Throws<InvalidOperationException>(() => ExqlHost.Build(["--DataDirectory", dataDirectory, "--DevHostPort", "not-a-port"]));
    }

    private static int FreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }
}
