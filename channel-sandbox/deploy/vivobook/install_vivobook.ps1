# One-time setup for the ASUS VivoBook daemon.
# Run from this folder: powershell -ExecutionPolicy Bypass -File install_vivobook.ps1

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = 'C:\eka-agent\agent'
$keySrc = Join-Path $here 'serviceAccountKey.json'
$keyDst = Join-Path $target 'serviceAccountKey.json'

Write-Host "== VivoBook daemon install =="

# 1. Copy the daemon files
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item (Join-Path $here 'device_agent.py') $target -Force
Copy-Item (Join-Path $here 'firestore_client.py') $target -Force
Copy-Item (Join-Path $here 'single_instance.py') $target -Force
Copy-Item (Join-Path $here 'devices.json') $target -Force
Write-Host "[ok] daemon files copied to $target"

# 2. Place the service-account key (must be present in this folder)
if (Test-Path $keySrc) {
    Copy-Item $keySrc $keyDst -Force
    Write-Host "[ok] service account key placed at $keyDst"
} else {
    Write-Warning "serviceAccountKey.json not found in this folder — place it at $keyDst manually"
}

# 3. Register the scheduled task (at logon + repeat every 5 min, single instance)
$action = New-ScheduledTaskAction -Execute 'C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe' `
    -Argument "`"$target\device_agent.py`" `"$target\devices.json`" jayti-asus-vivobook" `
    -WorkingDirectory $target
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)).Repetition
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'EKA-VivoBook-Daemon' -Action $action -Trigger $trigger -Settings $settings -Description 'ASUS VivoBook device daemon (channel-sandbox)' -Force | Out-Null
Write-Host "[ok] scheduled task EKA-VivoBook-Daemon registered"

# 4. Start it now
Start-ScheduledTask -TaskName 'EKA-VivoBook-Daemon'
Write-Host "[ok] daemon started — dashboard should show jayti-asus-vivobook LIVE within 45s"
