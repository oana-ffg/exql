using System.IO;
using System.Security.Cryptography;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Exql.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        try { Run(args); }
        catch (Exception error) { MessageBox.Show(error.Message, "ExQL could not start", MessageBoxButton.OK, MessageBoxImage.Error); }
    }
    private static void Run(string[] args)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var host = ExqlHost.Build([], desktop: true, token);
        host.StartAsync().GetAwaiter().GetResult();
        var origin = host.Urls.Single();
        var app = new Application();
        var web = new WebView2();
        var window = new Window { Title = "ExQL", Width = 1380, Height = 900, MinWidth = 850, MinHeight = 600, WindowStartupLocation = WindowStartupLocation.CenterScreen, Background = System.Windows.Media.Brushes.Black, Content = web };
        var closing = false;
        window.Closing += async (_, eventArgs) =>
        {
            if (closing || web.CoreWebView2 is null) return;
            eventArgs.Cancel = true;
            var dirty = await web.CoreWebView2.ExecuteScriptAsync("Boolean(window.exqlDirty || window.exqlPendingWrites)");
            if (dirty == "true" && MessageBox.Show(window, "There are unsaved edits, pending saves, or an operation in progress. Close ExQL anyway?", "Close ExQL", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            closing = true;
            window.Close();
        };
        window.Loaded += async (_, _) =>
        {
            try
            {
                var browserArgs = "";
                // Explicit opt-in for the desktop integration tests; no debugging listener in normal runs.
                if (args.Length == 2 && args[0] == "--automation-port" && int.TryParse(args[1], out var port) && port is >= 1024 and <= 65535)
                    browserArgs = $"--remote-debugging-port={port} --remote-debugging-address=127.0.0.1";
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ExQL", "WebView2"), new CoreWebView2EnvironmentOptions(browserArgs));
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
                web.CoreWebView2.PermissionRequested += (_, eventArgs) => eventArgs.State = eventArgs.PermissionKind == CoreWebView2PermissionKind.ClipboardRead ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
                web.Source = new Uri(origin);
            }
            catch (Exception error) { MessageBox.Show(window, error.Message, "ExQL could not open its workspace", MessageBoxButton.OK, MessageBoxImage.Error); window.Close(); }
        };
        window.Closed += (_, _) => web.Dispose();
        try { app.Run(window); }
        // The WPF dispatcher is stopped after Run returns. Complete async host shutdown on
        // the thread pool so continuations cannot deadlock on that dispatcher.
        finally { Task.Run(async () => { await host.StopAsync(); await host.DisposeAsync(); }).GetAwaiter().GetResult(); }
    }
}
