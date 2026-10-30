param(
    [Parameter(Mandatory)][string]$Server,
    [Parameter(Mandatory)][string]$Database,
    [Parameter(Mandatory)][string]$InputFile
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$builder = [System.Data.SqlClient.SqlConnectionStringBuilder]::new()
$builder['Data Source'] = $Server
$builder['Initial Catalog'] = $Database
$builder['Integrated Security'] = $true
$builder['Encrypt'] = $true
$builder['TrustServerCertificate'] = $true
$builder['Connect Timeout'] = 10
$builder['Application Name'] = 'ExQL independent test observer'
$connection = [System.Data.SqlClient.SqlConnection]::new($builder.ConnectionString)
try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 60
    $command.CommandText = [IO.File]::ReadAllText($InputFile)
    $reader = $command.ExecuteReader()
    try {
        do {
            while ($reader.Read()) { [Console]::Write([string]$reader.GetValue(0)) }
        } while ($reader.NextResult())
    } finally { $reader.Dispose(); $command.Dispose() }
} finally { $connection.Dispose() }
