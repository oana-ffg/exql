using System.IO;
using System.Reflection;
using Velopack;
using Velopack.Sources;

namespace Exql.Desktop;

internal sealed record UpdateState(string Status, string CurrentVersion, string? AvailableVersion = null, int Progress = 0, string? Message = null);

internal sealed class AppUpdates : IDisposable
{
    public const string RepositoryUrl = "https://github.com/oana-ffg/exql";
    private readonly UpdateManager manager;
    private readonly CancellationTokenSource lifetime = new();
    private bool checking;
    private bool disposed;
    public UpdateState State { get; private set; }
    public event Action? Changed;

    public AppUpdates(string? testDirectory)
    {
        IUpdateSource source = testDirectory is null
            ? new GithubSource(RepositoryUrl, null, false)
            : new SimpleFileSource(new DirectoryInfo(testDirectory));
        manager = new UpdateManager(source, new UpdateOptions { ExplicitChannel = "win-x64" });
        var version = manager.CurrentVersion?.ToString() ?? Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "Unknown";
        var pending = manager.IsInstalled ? manager.UpdatePendingRestart : null;
        State = new(!manager.IsInstalled ? "unavailable" : pending is not null ? "ready" : "idle", version, pending?.Version.ToString());
    }

    public async Task CheckAsync()
    {
        if (disposed || checking || !manager.IsInstalled || State.Status == "ready") return;
        checking = true;
        try
        {
            Set(State with { Status = "checking", Message = null, Progress = 0 });
            var update = await manager.CheckForUpdatesAsync();
            if (disposed) return;
            if (update is null)
            {
                Set(State with { Status = "current", AvailableVersion = null });
                return;
            }
            Set(State with { Status = "downloading", AvailableVersion = update.TargetFullRelease.Version.ToString() });
            var progress = new Progress<int>(value =>
            {
                if (State.Status == "downloading") Set(State with { Progress = Math.Clamp(value, 0, 100) });
            });
            await manager.DownloadUpdatesAsync(update, value => ((IProgress<int>)progress).Report(value), lifetime.Token);
            Set(State with { Status = "ready", Progress = 100 });
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception error)
        {
            // Log only the exception type: remote responses can contain sensitive URLs.
            System.Diagnostics.Trace.TraceError("ExQL update failed: {0}", error.GetType().Name);
            Set(State with { Status = "error", Message = "Could not download or verify the update. Check your connection and try again." });
        }
        finally { checking = false; }
    }

    public void RestartBlocked(string message) => Set(State with { Message = message });

    // Called only after the WebView and SQL host have shut down. The updater waits for
    // this process to exit, so it never interrupts a query or the workspace save queue.
    public void ApplyAfterShutdown(string[] restartArgs)
    {
        var pending = manager.UpdatePendingRestart ?? throw new InvalidOperationException("The downloaded update is no longer available. Reopen ExQL and check again.");
        manager.WaitExitThenApplyUpdates(pending, silent: false, restart: true, restartArgs: restartArgs);
    }

    private void Set(UpdateState state)
    {
        if (disposed) return;
        State = state;
        Changed?.Invoke();
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        lifetime.Cancel();
        lifetime.Dispose();
    }
}
