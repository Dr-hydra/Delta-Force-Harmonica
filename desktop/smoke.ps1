# UI smoke test used during development: launch the non-elevated dev build with a
# sample MIDI, optionally click a nav button by name, capture the window, exit.
#   dotnet build DFH.Desktop -p:DfhNoAdmin=true -o $env:TEMP\dfh-dev
#   powershell -File smoke.ps1 -Midi sample.mid -Click 曲库 -Shot shot.png
param(
    [string]$Exe = "$env:TEMP\dfh-dev\DeltaForceHarmonica.exe",
    [string]$Midi = "",
    [string]$Click = "",
    [string]$Shot = "$env:TEMP\dfh-shot.png",
    [int]$WaitSeconds = 6
)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public struct RECT { public int L, T, R, B; }
public static class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@

$argList = if ($Midi) { @($Midi) } else { @() }
$p = if ($argList.Count -gt 0) { Start-Process -FilePath $Exe -ArgumentList $argList -PassThru } else { Start-Process -FilePath $Exe -PassThru }
Start-Sleep -Seconds 4
$p.Refresh()
$h = $p.MainWindowHandle
if ($h -eq 0) { Start-Sleep -Seconds 2; $p.Refresh(); $h = $p.MainWindowHandle }
[W]::SetForegroundWindow($h) | Out-Null

# -Click accepts a "|"-separated list of accessibility names; each is invoked (or selected) in turn with a pause between.
foreach ($name in ($Click -split "\|" | Where-Object { $_ })) {
    Start-Sleep -Seconds 3
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
    $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($el -ne $null) {
        $pattern = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() }
        elseif ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select() }
        "clicked: $name"
    } else { "not found: $name" }
}

Start-Sleep -Seconds $WaitSeconds
$r = New-Object RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save($Shot)
"alive: $(-not $p.HasExited) size ${w}x${hh} shot: $Shot"
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
