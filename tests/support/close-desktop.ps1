param(
    [Parameter(Mandatory)][string]$Executable,
    # Fails when the app does not exit by itself, for example because it asked a question.
    [switch]$RequireCleanExit
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$automation = [System.Windows.Automation.AutomationElement]
$expected = [IO.Path]::GetFullPath($Executable)

# Closes the same window as the title bar button. Process.CloseMainWindow can pick
# another hidden window of the process, and then the app never receives the request.
function Close-AppWindow($process) {
    $condition = [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new($automation::ProcessIdProperty, $process.Id),
        [System.Windows.Automation.PropertyCondition]::new($automation::NameProperty, 'ExQL'))
    $window = $automation::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    if (!$window) { throw 'The ExQL window was not found.' }
    $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
}

Get-Process ExQL -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $expected } | ForEach-Object {
    $problem = $null
    try {
        Close-AppWindow $_
        if (!$_.WaitForExit(10000)) { $problem = 'it did not exit within 10 seconds' }
    }
    catch { $problem = $_.Exception.Message }
    if ($problem) {
        Write-Warning "Test app did not close cleanly: $expected ($problem)"
        $_.Kill()
        $_.WaitForExit()
        if ($RequireCleanExit) { throw "ExQL did not close by itself: $problem" }
    }
}
