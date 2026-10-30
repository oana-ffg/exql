param([Parameter(Mandatory)][string]$Executable)
$ErrorActionPreference = 'Stop'
$expected = [IO.Path]::GetFullPath($Executable)
Get-Process ExQL -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $expected } | ForEach-Object {
    if (!$_.CloseMainWindow() -or !$_.WaitForExit(10000)) {
        Write-Warning "Test app did not close cleanly: $expected"
        $_.Kill()
        $_.WaitForExit()
    }
}
