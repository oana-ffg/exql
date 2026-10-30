$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot)
$testRoot = "artifacts/desktop-test-$([Guid]::NewGuid().ToString('N'))"
& ./publish.ps1 -OutputDirectory "$testRoot/packages"
if ($LASTEXITCODE -ne 0) { throw 'Portable desktop build failed.' }
Expand-Archive -LiteralPath "$testRoot/packages/ExQL.Desktop-win-x64-Portable.zip" -DestinationPath "$testRoot/app"
node scripts/verify-desktop.mjs $testRoot
if ($LASTEXITCODE -ne 0) { throw "Desktop journeys failed. Evidence: $testRoot" }
