# One-time setup for the Lenovo daemon (this machine).
# Run from this folder: powershell -ExecutionPolicy Bypass -File install_lenovo.ps1

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "== Lenovo daemon install =="

# 1. Register the scheduled task (at logon + repeat every 5 min, single instance)
$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
    -Argument "/c `"`"C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe`" `"$here\device_agent.py`" `"$here\devices.json`" g4g-lenovo-laptop >> `"$here\logs\lenovo.log`" 2>&1`"" `
    -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)).Repetition
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'EKA-Lenovo-Daemon' -Action $action -Trigger $trigger -Settings $settings -Description 'Lenovo device daemon (channel-sandbox)' -Force | Out-Null
Write-Host "[ok] scheduled task EKA-Lenovo-Daemon registered"

# 2. Start it now
Start-ScheduledTask -TaskName 'EKA-Lenovo-Daemon'
Write-Host "[ok] daemon started - dashboard should show g4g-lenovo-laptop LIVE within 45s"
