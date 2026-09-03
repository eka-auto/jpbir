# SSH Key Exchange Script
param([string]$VivoBookIP = "", [string]$S24IP = "")

$ErrorActionPreference = 'Continue'
Write-Host '== SSH Key Exchange ==' -ForegroundColor Cyan

$LaptopPubKey = Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" -ErrorAction SilentlyContinue
Write-Host "[ok] Laptop key loaded"

if ([string]::IsNullOrEmpty($VivoBookIP)) { $VivoBookIP = Read-Host "VivoBook IP" }
if ([string]::IsNullOrEmpty($S24IP)) { $S24IP = Read-Host "S24 IP" }

$AllKeys = @($LaptopPubKey)

Write-Host "`nGet VivoBook key:" -ForegroundColor Yellow
Write-Host "1. On VivoBook: Get-Content `$env:USERPROFILE\.ssh\id_ed25519.pub"
Write-Host "2. Paste below:"
$vbKey = Read-Host "VivoBook public key"
if ($vbKey) { $AllKeys += $vbKey }

Write-Host "`nGet S24 key:" -ForegroundColor Yellow
Write-Host "1. On S24: cat ~/.ssh/id_ed25519.pub"
Write-Host "2. Paste below:"
$s24Key = Read-Host "S24 public key"
if ($s24Key) { $AllKeys += $s24Key }

$CombinedPath = "$PSScriptRoot\combined_authorized_keys"
$AllKeys | Set-Content $CombinedPath -Encoding UTF8
Write-Host "`n[ok] Combined keys saved to: $CombinedPath"
Write-Host "Copy this file to each device and rename to authorized_keys"
