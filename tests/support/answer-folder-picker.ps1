param(
    [Parameter(Mandatory)][string]$Executable,
    [string]$Folder
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace Exql -Name DialogMessages -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, string lParam);
[DllImport("user32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
'@
$automation = [System.Windows.Automation.AutomationElement]
$children = [System.Windows.Automation.TreeScope]::Children
$expected = [IO.Path]::GetFullPath($Executable)
$process = Get-Process ExQL | Where-Object { $_.Path -eq $expected } | Select-Object -First 1
if (!$process) { throw "ExQL is not running from $expected" }

# UI Automation exposes the owned dialog as a child of the ExQL window, not of the desktop.
$windowCondition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new($automation::ProcessIdProperty, $process.Id),
    [System.Windows.Automation.PropertyCondition]::new($automation::NameProperty, 'ExQL'))
$window = $automation::RootElement.FindFirst($children, $windowCondition)
if (!$window) { throw 'The ExQL window was not found.' }
$dialogCondition = [System.Windows.Automation.PropertyCondition]::new($automation::NameProperty, 'Add script folder')
function Find-Dialog { $window.FindFirst($children, $dialogCondition) }

$deadline = (Get-Date).AddSeconds(30)
while (!($dialog = Find-Dialog)) {
    if ((Get-Date) -gt $deadline) { throw 'The folder picker did not open.' }
    Start-Sleep -Milliseconds 200
}

# Standard Windows common dialog IDs: 1152 = name box, 1 = accept (IDOK), 2 = cancel (IDCANCEL).
# Only direct children: items in the dialog's folder list reuse IDs such as 1 and 2.
$WM_SETTEXT = 0x000C
$WM_COMMAND = 0x0111
if ($Folder) {
    $nameBox = $dialog.FindFirst($children, [System.Windows.Automation.PropertyCondition]::new($automation::AutomationIdProperty, '1152'))
    if (!$nameBox) { throw 'The folder picker name box was not found.' }
    [void][Exql.DialogMessages]::SendMessage([IntPtr]$nameBox.Current.NativeWindowHandle, $WM_SETTEXT, [IntPtr]::Zero, $Folder)
    $command = 1
} else { $command = 2 }
# The first accept can just navigate to a typed folder and the next one selects it, so repeat until it closes.
$deadline = (Get-Date).AddSeconds(30)
while (Find-Dialog) {
    if ((Get-Date) -gt $deadline) { throw 'The folder picker did not close.' }
    if (![Exql.DialogMessages]::PostMessage([IntPtr]$dialog.Current.NativeWindowHandle, $WM_COMMAND, [IntPtr]$command, [IntPtr]::Zero)) {
        throw "Could not answer the folder picker: Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    Start-Sleep -Seconds 1
}
