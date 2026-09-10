$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
dotnet publish desktop -c Release -r win-x64 --self-contained true --configfile NuGet.Config -o dist
if ($LASTEXITCODE -ne 0) { throw 'Desktop publish failed.' }
Write-Host 'Portable application: dist\ExQL.exe'
