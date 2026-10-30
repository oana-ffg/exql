$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath (Split-Path $PSScriptRoot)
try {
    sqlcmd -S localhost -E -C -b -f 65001 -i scripts/seed.sql
    if ($LASTEXITCODE -ne 0) { throw 'Demo database creation failed.' }
} finally { Pop-Location }
