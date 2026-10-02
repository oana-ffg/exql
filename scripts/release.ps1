[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleaseNotes
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot)
$notesPath = (Resolve-Path -LiteralPath $ReleaseNotes).Path
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
if ($version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') { throw 'A stable major.minor.patch version is required.' }
if (git status --porcelain) { throw 'Commit the release changes before publishing.' }
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the working tree.' }
$commit = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the release commit.' }
$remoteCommit = gh api repos/oana-ffg/exql/commits/main --jq .sha
if ($LASTEXITCODE -ne 0 -or $remoteCommit -ne $commit) { throw 'Push this commit to origin/main before publishing.' }
$repo = gh repo view oana-ffg/exql --json isPrivate | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $repo.isPrivate) { throw 'The updater requires publicly downloadable release assets.' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
npm run check
if ($LASTEXITCODE -ne 0) { throw 'Local checks failed.' }
npm run format:check
if ($LASTEXITCODE -ne 0) { throw 'Formatting check failed.' }

# Each release gets a fresh output directory; old test packages cannot be uploaded.
$output = "artifacts/releases/$version-$([Guid]::NewGuid().ToString('N'))"
& ./publish.ps1 -Version $version -OutputDirectory $output -ReleaseNotes $notesPath
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
$assets = @(Get-ChildItem -LiteralPath $output -File | Where-Object Extension -in '.zip', '.nupkg', '.json' | ForEach-Object FullName)
if ($assets.Count -lt 3) { throw 'The portable ZIP, full package, and release metadata are required.' }
gh release create "v$version" @assets --repo oana-ffg/exql --target $commit --title "ExQL $version" --notes-file $notesPath --draft
if ($LASTEXITCODE -ne 0) { throw 'Creating the draft release failed. Inspect GitHub before retrying.' }
gh release edit "v$version" --repo oana-ffg/exql --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'The release remains a draft. Inspect its assets before publishing.' }
