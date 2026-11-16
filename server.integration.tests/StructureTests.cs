using Exql;
using Microsoft.Data.SqlClient;
using Xunit;
using Xunit.Abstractions;

namespace Exql.Server.Integration.Tests;

public sealed class StructureTests(ITestOutputHelper output)
{
    [Fact]
    public async Task HiddenAliasTypeKeepsItsColumnAndExtendedProperties()
    {
        var database = $"ExqlTest_{Guid.NewGuid():N}";
        var settings = ConnectionSettings();
        await using var master = new SqlConnection(settings.ConnectionString);
        await master.OpenAsync();
        // Only successful CREATE establishes ownership; never drop an existing database.
        await Execute(master, $"CREATE DATABASE [{database}];");
        try
        {
            settings.InitialCatalog = database;
            await using var connection = new SqlConnection(settings.ConnectionString);
            await connection.OpenAsync();
            await Execute(connection, "CREATE TYPE dbo.PhoneNumber FROM nvarchar(20) NULL;");
            await Execute(connection, """
                CREATE TABLE dbo.Contacts (Id int NOT NULL PRIMARY KEY, Phone dbo.PhoneNumber NULL);
                EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'Contact phone number',
                  @level0type=N'SCHEMA', @level0name=N'dbo', @level1type=N'TABLE', @level1name=N'Contacts',
                  @level2type=N'COLUMN', @level2name=N'Phone';
                CREATE USER HiddenTypeReader WITHOUT LOGIN;
                GRANT SELECT ON dbo.Contacts TO HiddenTypeReader;
                """);

            await Execute(connection, "EXECUTE AS USER = 'HiddenTypeReader';");
            try
            {
                // Establish the permission boundary before exercising Structure.Read.
                // SELECT on the table must expose its columns, but not its alias type.
                await using (var command = new SqlCommand("""
                    SELECT TYPE_NAME(c.user_type_id),
                      (SELECT COUNT(*) FROM sys.types t WHERE t.user_type_id=c.user_type_id)
                    FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'dbo.Contacts') AND c.name=N'Phone';
                    """, connection))
                await using (var reader = await command.ExecuteReaderAsync())
                {
                    Assert.True(await reader.ReadAsync(), "The restricted user must see the Phone column.");
                    var typeName = reader.IsDBNull(0) ? "NULL" : reader.GetString(0);
                    output.WriteLine($"HiddenTypeReader: TYPE_NAME = {typeName}, visible sys.types rows = {reader.GetInt32(1)}.");
                    Assert.True(reader.IsDBNull(0), "SELECT on the table unexpectedly exposed the alias type through TYPE_NAME.");
                    Assert.Equal(0, reader.GetInt32(1));
                }

                var structure = await Structure.Read(connection, "dbo", "Contacts", CancellationToken.None);
                AssertColumns(structure, "nvarchar(20) (hidden alias type)");
                output.WriteLine($"HiddenTypeReader: {structure.Columns.Count} columns, Phone = {structure.Columns[1].Type}, MS_Description = Contact phone number.");
            }
            finally
            {
                await Execute(connection, "REVERT;");
            }

            var original = await Structure.Read(connection, "dbo", "Contacts", CancellationToken.None);
            AssertColumns(original, "dbo.PhoneNumber (nvarchar(20))");
            output.WriteLine($"Original login after REVERT: Phone = {original.Columns[1].Type}.");
        }
        finally
        {
            // The unpooled test connection is disposed before cleanup, even if REVERT fails.
            // Dropping this owned database also removes its WITHOUT LOGIN user.
            await Execute(master, $"ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{database}];");
            output.WriteLine($"Dropped owned database {database} and its WITHOUT LOGIN user.");
        }
    }

    private static void AssertColumns(TableStructure structure, string phoneType) =>
        Assert.Collection(structure.Columns,
            id =>
            {
                Assert.Equal("Id", id.Name);
                Assert.Equal("int", id.Type);
                Assert.True(id.PrimaryKey);
            },
            phone =>
            {
                Assert.Equal("Phone", phone.Name);
                Assert.Equal(phoneType, phone.Type);
                var description = Assert.Single(phone.Properties, property => property.Name == "MS_Description");
                Assert.Equal("Contact phone number", description.Value);
            });

    private static SqlConnectionStringBuilder ConnectionSettings()
    {
        var authentication = Environment.GetEnvironmentVariable("EXQL_TEST_AUTH") ?? "windows";
        var settings = new SqlConnectionStringBuilder
        {
            DataSource = Environment.GetEnvironmentVariable("EXQL_TEST_SERVER") ?? "localhost",
            InitialCatalog = "master",
            Encrypt = true,
            TrustServerCertificate = true,
            ConnectTimeout = 25,
            // Never return an impersonated connection to a pool if REVERT fails.
            Pooling = false,
        };
        switch (authentication)
        {
            case "windows":
                settings.IntegratedSecurity = true;
                break;
            case "sql":
                settings.UserID = Environment.GetEnvironmentVariable("EXQL_TEST_USER")
                    ?? throw new InvalidOperationException("EXQL_TEST_USER is required for SQL authentication.");
                settings.Password = Environment.GetEnvironmentVariable("EXQL_TEST_PASSWORD")
                    ?? throw new InvalidOperationException("EXQL_TEST_PASSWORD is required for SQL authentication.");
                break;
            default:
                throw new InvalidOperationException("EXQL_TEST_AUTH must be windows or sql.");
        }
        return settings;
    }

    private static async Task Execute(SqlConnection connection, string sql)
    {
        await using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}
