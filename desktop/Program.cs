using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;
using Velopack;

namespace Exql.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        // Update hooks must run before WPF, SQL hosting, or the single-instance lock.
        VelopackApp.Build().SetAutoApplyOnStartup(false).Run();
        try { Run(args); }
        catch (Exception error) { MessageBox.Show(error.Message, "ExQL could not start", MessageBoxButton.OK, MessageBoxImage.Error); }
    }
    private static void Run(string[] args)
    {
        var options = DesktopOptions.Parse(args);
        var root = Path.GetFullPath(AppContext.BaseDirectory).ToUpperInvariant();
        var mutexName = "Local\\ExQL-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(root)));
        using var instance = new Mutex(true, mutexName, out var firstInstance);
        if (!firstInstance)
        {
            MessageBox.Show("ExQL is already running from this folder. Switch to its existing window.", "ExQL", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        using var updates = new AppUpdates(options.UpdateDirectory);
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var host = ExqlHost.Build(["--DataDirectory", options.DataDirectory], desktop: true, token);
        host.StartAsync().GetAwaiter().GetResult();
        var origin = host.Urls.Single();
        var app = new Application();
        var web = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(0x10, 0x17, 0x22) };
        var window = new Window { Title = "ExQL", Icon = BitmapFrame.Create(new Uri("pack://application:,,,/exql.ico")), Width = 1380, Height = 900, MinWidth = 850, MinHeight = 600, WindowStartupLocation = WindowStartupLocation.CenterScreen, Background = System.Windows.Media.Brushes.Black, Content = web };
        WindowTheme.ApplyDarkTitleBar(window);
        var closing = false;
        var checkingClose = false;
        var restartForUpdate = false;
        var webReady = false;
        var updateTimer = new DispatcherTimer { Interval = TimeSpan.FromHours(6) };
        updateTimer.Tick += async (_, _) => await updates.CheckAsync();
        void SendToPage(object message) =>
            web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        void SendUpdateState()
        {
            if (webReady && !closing) SendToPage(new { type = "updates", state = updates.State });
        }
        void PickFolder()
        {
            string? path = null, error = null;
            try
            {
                var dialog = new OpenFolderDialog { Title = "Add script folder" };
                if (dialog.ShowDialog(window) == true) path = dialog.FolderName;
            }
            catch (Exception failure) { error = $"Could not open the folder picker: {failure.Message}"; }
            if (!closing) SendToPage(new { type = "folder-picked", path, error });
        }
        updates.Changed += SendUpdateState;
        window.Closing += async (_, eventArgs) =>
        {
            if (closing || web.CoreWebView2 is null) return;
            eventArgs.Cancel = true;
            if (checkingClose) return;
            checkingClose = true;
            try
            {
                // A save still in flight finishes by itself, so it is no reason to ask.
                var saveDeadline = DateTime.UtcNow.AddSeconds(5);
                while (DateTime.UtcNow < saveDeadline && await web.CoreWebView2.ExecuteScriptAsync("Boolean(window.exqlPendingWrites)") == "true")
                    await Task.Delay(50);
                var dirty = await web.CoreWebView2.ExecuteScriptAsync("Boolean(window.exqlDirty || window.exqlPendingWrites || window.exqlStorageFailed)");
                if (dirty == "true" && MessageBox.Show(window, "There are unsaved edits, pending or failed saves, or an operation in progress. Close ExQL anyway?", "Close ExQL", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
                closing = true;
                window.Close();
            }
            catch (Exception failure)
            {
                if (MessageBox.Show(window, $"Could not check for unsaved work: {failure.Message}\n\nClose ExQL anyway?", "Close ExQL", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
                closing = true;
                window.Close();
            }
            finally { checkingClose = false; }
        };
        window.Loaded += async (_, _) =>
        {
            try
            {
                var browserArgs = "";
                // Explicit opt-in for the desktop integration tests; no debugging listener in normal runs.
                if (options.AutomationPort is { } port)
                    browserArgs = $"--remote-debugging-port={port} --remote-debugging-address=127.0.0.1";
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(options.DataDirectory, "WebView2"), new CoreWebView2EnvironmentOptions(browserArgs));
                await web.EnsureCoreWebView2Async(environment);
                web.CoreWebView2.Settings.AreDevToolsEnabled = browserArgs.Length > 0;
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
                web.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
                web.CoreWebView2.AddWebResourceRequestedFilter(origin + "/api/*", CoreWebView2WebResourceContext.All);
                web.CoreWebView2.WebResourceRequested += (_, eventArgs) => eventArgs.Request.Headers.SetHeader("X-Exql-Token", token);
                web.CoreWebView2.NavigationStarting += (_, eventArgs) =>
                {
                    if (!eventArgs.Uri.StartsWith(origin + "/", StringComparison.Ordinal)) eventArgs.Cancel = true;
                };
                web.CoreWebView2.NewWindowRequested += (_, eventArgs) => eventArgs.Handled = true;
                web.CoreWebView2.WebMessageReceived += async (_, eventArgs) =>
                {
                    if (closing || !eventArgs.Source.StartsWith(origin + "/", StringComparison.Ordinal)) return;
                    if (eventArgs.WebMessageAsJson is not ("\"updates.status\"" or "\"updates.check\"" or "\"updates.restart\"" or "\"folders.pick\"")) return;
                    switch (eventArgs.TryGetWebMessageAsString())
                    {
                        case "updates.status": webReady = true; SendUpdateState(); break;
                        case "updates.check": await updates.CheckAsync(); break;
                        // WebView2 holds back its events during a nested message loop in a handler, so the modal dialog opens after this handler returns.
                        case "folders.pick": _ = window.Dispatcher.InvokeAsync(PickFolder); break;
                        case "updates.restart":
                            if (updates.State.Status != "ready" || checkingClose) return;
                            checkingClose = true;
                            web.IsEnabled = false;
                            try
                            {
                                var safe = await web.CoreWebView2.ExecuteScriptAsync("Boolean(window.exqlWorkspaceReady && !window.exqlDirty && !window.exqlPendingWrites && !window.exqlStorageFailed && !document.querySelector('dialog[open]'))");
                                if (safe != "true")
                                {
                                    updates.RestartBlocked("Finish running operations, save or discard edits, and close dialogs before restarting. Resolve any workspace save errors first.");
                                    return;
                                }
                                restartForUpdate = true;
                                closing = true;
                                window.Close();
                            }
                            catch (Exception) { updates.RestartBlocked("Could not confirm that the workspace is saved. Please try again."); }
                            finally { checkingClose = false; if (!closing) web.IsEnabled = true; }
                            break;
                    }
                };
                web.CoreWebView2.PermissionRequested += (_, eventArgs) => eventArgs.State = eventArgs.PermissionKind == CoreWebView2PermissionKind.ClipboardRead ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
                web.Source = new Uri(origin);
                updateTimer.Start();
                await updates.CheckAsync();
            }
            catch (Exception error) { MessageBox.Show(window, error.Message, "ExQL could not open its workspace", MessageBoxButton.OK, MessageBoxImage.Error); window.Close(); }
        };
        window.Closed += (_, _) => { closing = true; webReady = false; updateTimer.Stop(); updates.Dispose(); web.Dispose(); };
        try { app.Run(window); }
        // The WPF dispatcher is stopped after Run returns. Complete async host shutdown on
        // the thread pool so continuations cannot deadlock on that dispatcher.
        finally { Task.Run(async () => { await host.StopAsync(); await host.DisposeAsync(); }).GetAwaiter().GetResult(); }
        if (restartForUpdate) updates.ApplyAfterShutdown(args);
    }
}
