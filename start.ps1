$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path 'node_modules')) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
dotnet restore desktop --configfile NuGet.Config
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency restore failed.' }
dotnet build desktop --no-restore
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
Write-Host 'Opening the ExQL desktop workspace.'
dotnet run --project desktop --no-build --no-launch-profile
