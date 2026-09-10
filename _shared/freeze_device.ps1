# Freeze/Unfreeze VivoBook device in Firestore
# Usage: .\freeze_device.ps1 -Action "freeze"  (or "unfreeze")
# Default action: freeze

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('freeze', 'unfreeze')]
    [string]$Action = 'freeze'
)

$DEVICE_ID = "jayti-asus-vivobook"
$DISPLAY_NAME = "ASUS VivoBook"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$REPO_DIR = Split-Path -Parent (Split-Path -Parent $SCRIPT_DIR)

Write-Host '============================================================'
Write-Host 'VIVOBOOK DEVICE FREEZE TOOL'
Write-Host '============================================================'
Write-Host "Device: $DEVICE_ID"
Write-Host "Action: $Action"
Write-Host ''

# Check if Python is available
$pythonPath = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonPath) {
    Write-Host '[ERROR] Python not found. Install Python 3.12+' -ForegroundColor Red
    exit 1
}

# Check if firebase-admin is installed
$checkInstall = & python -c "import firebase_admin" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host '[INFO] Installing firebase-admin...' -ForegroundColor Yellow
    & pip install firebase-admin --quiet
}

# Run the freeze script
& python "$REPO_DIR\tools\freeze_device.py" --device $DEVICE_ID --action $Action

Write-Host ''
Write-Host '============================================================'
Write-Host 'COMPLETE' -ForegroundColor Green
Write-Host '============================================================'
