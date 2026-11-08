$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'download-sql-bootstrap.ps1')

# No network, SQL installation or Windows-only signing API is used in these tests.
$directory = Join-Path ([IO.Path]::GetTempPath()) ('exql-download-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$destination = Join-Path $directory 'bootstrap.exe'

function Invoke-WebRequest {
    param($Uri, $OutFile, [switch]$PassThru, $TimeoutSec)
    if ($TimeoutSec -ne 120 -or -not $PassThru) { throw 'Download must be bounded and return response metadata.' }
    if (Test-Path -LiteralPath $OutFile) { throw 'Previous invalid download was not removed.' }
    $script:attempts++
    $script:payload = $script:payloads[[Math]::Min($script:attempts - 1, $script:payloads.Count - 1)]
    [IO.File]::WriteAllBytes($OutFile, [byte[]]@())
    if ($script:payload -eq 'network') { throw 'Simulated interrupted download' }
    if ($script:payload -eq 'html') {
        [IO.File]::WriteAllText($OutFile, '<html>Unavailable</html>')
    } elseif ($script:payload -eq 'truncated') {
        [IO.File]::WriteAllBytes($OutFile, [byte[]]@(0x4d, 0x5a))
    } else {
        [IO.File]::WriteAllBytes($OutFile, [byte[]]::new(1MB))
    }
    [pscustomobject]@{
        Headers = @{ 'Content-Type' = 'application/octet-stream' }
        BaseResponse = [pscustomobject]@{ RequestMessage = [pscustomobject]@{ RequestUri = 'https://download.microsoft.com/test.exe' } }
    }
}

function Get-AuthenticodeSignature {
    param($LiteralPath)
    $script:signatureChecks++
    [pscustomobject]@{
        Status = $(if ($script:payload -eq 'corrupt') { 'HashMismatch' } else { 'Valid' })
        SignerCertificate = [pscustomobject]@{
            Subject = $(if ($script:payload -eq 'other-signer') { 'CN=Other, O=Other Corporation, C=US' } else { 'CN=Microsoft Corporation, O=Microsoft Corporation, C=US' })
        }
    }
}

function Start-Sleep {
    param($Seconds)
    $script:delays += $Seconds
}

function Test-Download {
    param([string]$Name, [string[]]$Payloads, [int]$ExpectedAttempts, [int]$ExpectedSignatures, [switch]$Fails)
    $script:payloads = $Payloads
    $script:attempts = 0
    $script:signatureChecks = 0
    $script:delays = @()
    $failure = $null
    try { Get-SqlBootstrap -Destination $destination } catch { $failure = $_.Exception.Message }
    if ($Fails) {
        if ($failure -notlike 'SQL bootstrap download failed after 3 attempts:*') { throw "${Name}: expected final download failure, got '$failure'." }
        if (Test-Path -LiteralPath $destination) { throw "${Name}: invalid file remains after failure." }
    } else {
        if ($failure) { throw "${Name}: unexpected failure: $failure" }
        if (-not (Test-Path -LiteralPath $destination)) { throw "${Name}: valid download is missing." }
        Remove-Item -LiteralPath $destination
    }
    if ($script:attempts -ne $ExpectedAttempts) { throw "${Name}: expected $ExpectedAttempts attempts, got $script:attempts." }
    if ($script:signatureChecks -ne $ExpectedSignatures) { throw "${Name}: unexpected signature check count $script:signatureChecks." }
    $expectedDelays = @()
    for ($i = 1; $i -lt $ExpectedAttempts; $i++) { $expectedDelays += 5 * $i }
    if (($script:delays -join ',') -ne ($expectedDelays -join ',')) { throw "${Name}: unexpected retry delays." }
    Write-Host "PASS: $Name"
}

try {
    Test-Download 'valid Microsoft payload' @('valid') 1 1
    Test-Download 'HTML response retries' @('html', 'valid') 2 1
    Test-Download 'truncated executable retries' @('truncated', 'valid') 2 1
    Test-Download 'corrupt signed executable retries' @('corrupt', 'valid') 2 2
    Test-Download 'other publisher rejected' @('other-signer', 'valid') 2 2
    Test-Download 'partial network failure retries' @('network', 'valid') 2 1
    Test-Download 'persistent HTML stops after three attempts' @('html') 3 0 -Fails
    Test-Download 'persistent corruption stops after three attempts' @('corrupt') 3 3 -Fails
    Test-Download 'persistent network failure stops after three attempts' @('network') 3 0 -Fails
} finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
}
