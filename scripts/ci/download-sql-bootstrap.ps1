function Get-SqlBootstrap {
    param([Parameter(Mandatory)][string]$Destination)

    # Microsoft maintains this Express alias; it currently serves SQL Server 2025.
    # Verify the signed payload rather than trusting an HTTP success or .exe name.
    $uri = 'https://go.microsoft.com/fwlink/p/?linkid=2216019&clcid=0x409&culture=en-us&country=us'
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $uri -OutFile $Destination -PassThru -TimeoutSec 120
            $file = Get-Item -LiteralPath $Destination
            $resolvedUri = $response.BaseResponse.RequestMessage.RequestUri
            Write-Host "SQL bootstrap attempt ${attempt}: URL=$resolvedUri; Content-Type=$($response.Headers['Content-Type']); bytes=$($file.Length)"
            if ($file.Length -lt 1MB) { throw "SQL bootstrap is too small ($($file.Length) bytes); expected a signed executable of at least 1 MB." }
            $signature = Get-AuthenticodeSignature -LiteralPath $Destination
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
                throw "SQL bootstrap must have a valid Microsoft signature (status=$($signature.Status))."
            }
            $hash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
            Write-Host "Verified SQL bootstrap: version=$($file.VersionInfo.ProductVersion); SHA256=$hash"
            return
        } catch {
            # Never leave an invalid or partial download available for execution.
            if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
            if ($attempt -eq 3) { throw "SQL bootstrap download failed after $attempt attempts: $($_.Exception.Message)" }
            Write-Warning "SQL bootstrap attempt $attempt failed: $($_.Exception.Message). Retrying."
            Start-Sleep -Seconds (5 * $attempt)
        }
    }
}
