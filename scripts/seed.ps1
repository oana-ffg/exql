$ErrorActionPreference = 'Stop'
$taskSeed = Join-Path $PSScriptRoot 'seed.sql'
sqlcmd -S localhost -E -C -b -f 65001 -i $taskSeed
if ($LASTEXITCODE -ne 0) { throw 'Demo database creation failed.' }
