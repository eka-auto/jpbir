# SSH Mesh Setup - VivoBook (jayti-asus-vivobook)
$ErrorActionPreference = 'Stop'
Write-Host '== Setting up SSH on jayti-asus-vivobook ==' -ForegroundColor Cyan

$Computer = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1
if ([string]$Computer.Manufacturer -notmatch '(?i)ASUS|ASUSTeK' -or [string]$Computer.Model -notmatch '(?i)VivoBook') {
    throw "Hardware guard: This script is only for ASUS VivoBook"
}

$sshService = Get-Service -Name sshd -ErrorAction SilentlyContinue
if (-not $sshService) {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
    $sshService = Get-Service -Name sshd
}

if ($sshService.Status -ne 'Running') {
    Start-Service sshd -ErrorAction SilentlyContinue
    Set-Service sshd -StartupType Automatic
}

$sshDir = Join-Path $env:USERPROFILE '.ssh'
if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir -Force | Out-Null }

$keyPath = Join-Path $sshDir 'id_ed25519'
if (-not (Test-Path $keyPath)) {
    ssh-keygen -t ed25519 -f $keyPath -N '' -C 'jayti-asus-vivobook-2026'
}

$pubKeyPath = Join-Path $sshDir 'id_ed25519.pub'
$authKeysPath = Join-Path $sshDir 'authorized_keys'
if (Test-Path $pubKeyPath) {
    Get-Content $pubKeyPath | Set-Content $authKeysPath -Encoding UTF8
}

$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -like '192.168.*' } | Select-Object -First 1 -ExpandProperty IPAddress
Write-Host "[ok] SSH setup complete. Device IP: $ip"
Write-Host 'Public key (copy to other devices):'
Get-Content $pubKeyPath
