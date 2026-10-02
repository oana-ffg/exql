[CmdletBinding()]
param(
    [ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')]
    [string]$Version,
    [string]$OutputDirectory = 'dist/releases',
    [string]$ReleaseNotes
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (!$Version) { $Version = (Get-Content package.json -Raw | ConvertFrom-Json).version }
if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') { throw 'A stable major.minor.patch version is required.' }
$outputPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $OutputDirectory))
$publishPath = Join-Path $PSScriptRoot "artifacts/publish/$Version-$([Guid]::NewGuid().ToString('N'))"
[xml]$project = Get-Content desktop/ExQL.csproj
$velopackVersion = ($project.Project.ItemGroup.PackageReference | Where-Object Include -eq 'Velopack').Version
$toolPath = Join-Path $PSScriptRoot "artifacts/tools/velopack-$velopackVersion"
if (!(Test-Path (Join-Path $toolPath 'vpk.exe'))) {
    dotnet tool install vpk --version $velopackVersion --tool-path $toolPath --configfile NuGet.Config
    if ($LASTEXITCODE -ne 0) { throw 'Velopack tool installation failed.' }
}
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
dotnet publish desktop -c Release -r win-x64 --self-contained true --configfile NuGet.Config -p:Version=$Version -o $publishPath
if ($LASTEXITCODE -ne 0) { throw 'Desktop publish failed.' }
Copy-Item -LiteralPath LICENSE, THIRD-PARTY-NOTICES.txt -Destination $publishPath
$packArgs = @('pack', '--packId', 'ExQL.Desktop', '--packTitle', 'ExQL', '--packVersion', $Version,
    '--packDir', $publishPath, '--mainExe', 'ExQL.exe', '--runtime', 'win-x64',
    '--channel', 'win-x64', '--noInst', '--outputDir', $outputPath)
if ($ReleaseNotes) { $packArgs += @('--releaseNotes', [IO.Path]::GetFullPath($ReleaseNotes)) }
& (Join-Path $toolPath 'vpk.exe') @packArgs
if ($LASTEXITCODE -ne 0) { throw 'Update packaging failed.' }
Write-Host "Portable ZIP and update feed: $outputPath"
Write-Host 'Extract the complete Portable.zip into a writable folder and run its root ExQL.exe.'
