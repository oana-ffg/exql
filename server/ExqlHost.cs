using System.Globalization;
using System.Net;
using Exql;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.FileProviders;
using System.Reflection;

namespace Exql;

public static class ExqlHost
{
    public static WebApplication Build(string[] args, bool desktop = false, string? token = null)
    {
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        var builder = WebApplication.CreateBuilder(args);
        builder.WebHost.UseUrls(desktop ? "http://127.0.0.1:0" : "http://127.0.0.1:5274");
        builder.Services.AddSingleton<Sessions>();
        builder.Services.AddSingleton(new AppPaths(builder.Configuration["DataDirectory"] ?? AppPaths.DefaultRoot));
        builder.Services.AddSingleton<ConnectionProfiles>();
        builder.Services.AddSingleton<WorkspaceStore>();
        builder.Environment.WebRootFileProvider = new ManifestEmbeddedFileProvider(Assembly.GetExecutingAssembly(), "wwwroot");
        builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
        var app = builder.Build();

        // This is a local database tool, not a network service. Block DNS rebinding and cross-origin requests.
        app.Use(async (context, next) =>
        {
            if (context.Connection.RemoteIpAddress is not { } address || !IPAddress.IsLoopback(address)
                || context.Request.Host.Host is not ("127.0.0.1" or "localhost" or "[::1]"))
            { context.Response.StatusCode = 403; return; }
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.Headers.CacheControl = "no-store";
                var origin = context.Request.Headers.Origin.ToString();
                var allowed = origin.Length == 0 || origin == $"http://{context.Request.Host}" || (!desktop && origin is "http://127.0.0.1:5173" or "http://localhost:5173");
                if (!allowed || context.Request.Headers["X-Exql-Client"] != "1" || (desktop && context.Request.Headers["X-Exql-Token"] != token))
                { context.Response.StatusCode = 403; return; }
            }
            try { await next(context); }
            catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
            catch (Exception error) when (error is InputException or SqlException or ArgumentException or System.Text.Json.JsonException)
            {
                if (context.Response.HasStarted) { context.Abort(); return; }
                context.Response.StatusCode = error is InputException input ? input.Status : 400;
                await context.Response.WriteAsJsonAsync(new { error = error.Message });
            }
        });

        app.MapGet("/api/profiles", (ConnectionProfiles profiles) => profiles.List());
        app.MapGet("/api/workspace/{key}", (string key, WorkspaceStore workspace) => new { value = workspace.Read(key) });
        app.MapPost("/api/workspace/{key}", (string key, System.Text.Json.JsonElement value, WorkspaceStore workspace) => { workspace.Write(key, value); return Results.NoContent(); });
        app.MapPost("/api/profiles", (SaveProfileRequest request, ConnectionProfiles profiles) => profiles.Save(request));
        app.MapDelete("/api/profiles/{id}", (string id, ConnectionProfiles profiles) => { profiles.Delete(id); return Results.NoContent(); });
        app.MapPost("/api/profiles/{id}/connect", async (string id, ConnectionProfiles profiles, Sessions sessions, CancellationToken ct) =>
            await Connect(profiles.Resolve(id), sessions, ct, profiles.Get(id).Name));
        app.MapPost("/api/connect", (ConnectionRequest request, Sessions sessions, CancellationToken ct) => Connect(request, sessions, ct));
        static async Task<IResult> Connect(ConnectionRequest request, Sessions sessions, CancellationToken ct, string? name = null)
        {
            var connectionString = Sessions.BuildConnectionString(request);
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync(ct);
            var catalog = await Database.Catalog(connection, ct);
            return Results.Ok(new { id = sessions.Add(connectionString), name = name ?? connection.Database, catalog, database = connection.Database, server = connection.DataSource, serverVersion = connection.ServerVersion });
        }

        var api = app.MapGroup("/api/sessions/{id}");
        api.AddEndpointFilter(async (invocation, next) =>
        {
            var id = invocation.HttpContext.Request.RouteValues["id"]!.ToString()!;
            var sessions = invocation.HttpContext.RequestServices.GetRequiredService<Sessions>();
            var session = sessions.Get(id);
            await session.Gate.WaitAsync(invocation.HttpContext.RequestAborted);
            try
            {
                _ = sessions.Get(id);
                invocation.HttpContext.Items["session"] = session;
                return await next(invocation);
            }
            finally { session.Gate.Release(); }
        });
        DatabaseSession Session(HttpContext context) => (DatabaseSession)context.Items["session"]!;
        api.MapDelete("", (string id, Sessions sessions) => { sessions.Remove(id); return Results.NoContent(); });
        api.MapGet("/catalog", async (HttpContext context, CancellationToken ct) =>
        {
            await using var connection = await Database.Open(Session(context), ct);
            return await Database.Catalog(connection, ct);
        });
        api.MapPost("/table", async (TableRequest request, HttpContext context, CancellationToken ct) =>
        {
            await using var connection = await Database.Open(Session(context), ct);
            return await Database.Page(connection, request, ct);
        });
        api.MapPost("/edit", async (EditRequest request, HttpContext context, CancellationToken ct) =>
        {
            await using var connection = await Database.Open(Session(context), ct);
            await Database.Edit(connection, request, ct);
            return Results.Ok(new { saved = request.Rows.Count });
        });
        api.MapPost("/query", async (QueryRequest request, HttpContext context, CancellationToken ct) =>
        {
            await using var connection = await Database.Open(Session(context), ct);
            return await QueryStore.Run(Session(context), connection, request.Sql, ct);
        });
        api.MapGet("/results/{resultId}", (string resultId, int offset, HttpContext context, CancellationToken ct) => QueryStore.Page(Session(context), resultId, offset, ct));
        api.MapPost("/export", async (ExportRequest request, HttpContext context, CancellationToken ct) =>
        {
            if (request.Format is not ("csv" or "json")) throw new InputException("Choose CSV or JSON.");
            if (request.ResultId is not null)
            {
                var result = QueryStore.Get(Session(context), request.ResultId);
                await QueryStore.Export(context.Response, request.Format, result.Columns, QueryStore.Rows(result, ct), ct);
            }
            else if (request.Table is not null)
            {
                await using var connection = await Database.Open(Session(context), ct);
                var columns = await Database.Columns(connection, request.Table.Schema, request.Table.Table, ct);
                await using var command = Database.Select(connection, request.Table, columns, false);
                await using var reader = await command.ExecuteReaderAsync(ct);
                await QueryStore.Export(context.Response, request.Format, columns, QueryStore.ReadRows(reader, ct), ct);
            }
            else throw new InputException("Choose a table or query result to export.");
        });
        app.UseDefaultFiles();
        app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse = ctx => ctx.Context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        app.MapFallbackToFile("index.html");
        return app;

    }
}
