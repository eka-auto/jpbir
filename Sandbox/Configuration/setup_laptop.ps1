# SSH Mesh Setup - Laptop (g4g-lenovo-laptop)
$ErrorActionPreference = 'Stop'
Write-Host '== Setting up SSH on g4g-lenovo-laptop ==' -ForegroundColor Cyan

$sshService = Get-Service -Name sshd -ErrorAction SilentlyContinue
if (-not $sshService) {
    Write-Host 'Installing OpenSSH Server...' -ForegroundColor Yellow
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
    ssh-keygen -t ed25519 -f $keyPath -N '' -C 'g4g-lenovo-laptop-2026'
}

$pubKeyPath = Join-Path $sshDir 'id_ed25519.pub'
$authKeysPath = Join-Path $sshDir 'authorized_keys'
if (Test-Path $pubKeyPath) {
    Get-Content $pubKeyPath | Set-Content $authKeysPath -Encoding UTF8
}

Write-Host '[ok] SSH setup complete'
Write-Host 'Public key (copy to other devices):'
Get-Content $pubKeyPath
