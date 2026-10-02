$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot)
$testRoot = "artifacts/update-test-$([Guid]::NewGuid().ToString('N'))"
& ./publish.ps1 -Version 0.0.1 -OutputDirectory "$testRoot/feed"
if ($LASTEXITCODE -ne 0) { throw 'Building update test version A failed.' }
Expand-Archive -LiteralPath "$testRoot/feed/ExQL.Desktop-win-x64-Portable.zip" -DestinationPath "$testRoot/app"
& ./publish.ps1 -Version 0.0.2 -OutputDirectory "$testRoot/feed"
if ($LASTEXITCODE -ne 0) { throw 'Building update test version B failed.' }
node scripts/verify-updates.mjs $testRoot
if ($LASTEXITCODE -ne 0) { throw "Updater verification failed. Evidence is in $testRoot." }
