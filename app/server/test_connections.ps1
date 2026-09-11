# SSH Connection Test Script
param([string]$VivoBookIP = "", [string]$S24IP = "")

$ErrorActionPreference = 'Continue'
Write-Host '== SSH Connection Test ==' -ForegroundColor Cyan

if ([string]::IsNullOrEmpty($VivoBookIP)) { $VivoBookIP = Read-Host "VivoBook IP" }
if ([string]::IsNullOrEmpty($S24IP)) { $S24IP = Read-Host "S24 IP" }

Write-Host "`nTesting Laptop -> VivoBook ($VivoBookIP)..." -ForegroundColor Yellow
$result1 = ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes "vivobook@$VivoBookIP" "echo OK" 2>&1
if ($result1 -like '*OK*') { Write-Host "[ok] VivoBook: Connected" -ForegroundColor Green } else { Write-Host "[!] VivoBook: Failed" -ForegroundColor Red }

Write-Host "`nTesting Laptop -> S24 ($S24IP)..." -ForegroundColor Yellow
$result2 = ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes "root@$S24IP" "echo OK" 2>&1
if ($result2 -like '*OK*') { Write-Host "[ok] S24: Connected" -ForegroundColor Green } else { Write-Host "[!] S24: Failed" -ForegroundColor Red }

Write-Host "`n== Summary =="
Write-Host "Run 'ssh vivobook' and 'ssh s24' to connect"
