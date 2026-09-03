# Freeze Device Script
# Sets staleAlertState in Firestore to prevent stale device alerts
# Usage: .\freeze_device.ps1 -DeviceId "samsung-s24-ultra" -Action "freeze"

param(
    [Parameter(Mandatory=$true)]
    [string]$DeviceId,
    
    [Parameter(Mandatory=$false)]
    [ValidateSet('freeze', 'unfreeze')]
    [string]$Action = 'freeze'
)

$ErrorActionPreference = 'Stop'

# Load Firebase service account JSON from environment
$firebaseJson = $env:FIREBASE_SERVICE_ACCOUNT_JSON
if (-not $firebaseJson) {
    $saPath = "$PSScriptRoot\..\serviceAccountKey.json"
    if (Test-Path $saPath) {
        $firebaseJson = Get-Content $saPath -Raw -Encoding UTF8
    } else {
        Write-Host "[!] FIREBASE_SERVICE_ACCOUNT_JSON not set and no serviceAccountKey.json found" -ForegroundColor Red
        exit 1
    }
}

try {
    $sa = $firebaseJson | ConvertFrom-Json
} catch {
    Write-Host "[!] Failed to parse Firebase service account JSON" -ForegroundColor Red
    exit 1
}

$projectId = $sa.project_id
$database = $env:FIRESTORE_DB
if (-not $database) { $database = 'eka-agent' }

Write-Host '== Freeze Device ==' -ForegroundColor Cyan
Write-Host "Project: $projectId"
Write-Host "Database: $database"
Write-Host "Device: $DeviceId"
Write-Host "Action: $Action"

# Get OAuth token using service account
function Get-FirestoreToken {
    param($sa)
    
    $now = [int][double]::Parse((Get-Date -UFormat %s))
    $exp = $now + 3600
    
    $header = @{ alg = 'RS256'; typ = 'JWT' }
    $claim = @{
        iss = $sa.client_email
        scope = 'https://www.googleapis.com/auth/datastore'
        aud = 'https://oauth2.googleapis.com/token'
        iat = $now
        exp = $exp
    }
    
    $b64url = { param($obj) 
        [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($obj | ConvertTo-Json -Compress), [Base64FormattingOptions]::None) 
            -replace '\+', '-' -replace '/', '_' -replace '=' 
    }
    
    $headerJson = $header | ConvertTo-Json -Compress
    $claimJson = $claim | ConvertTo-Json -Compress
    $inputStr = "$(&$b64url $headerJson).$(&$b64url $claimJson)"
    
    $privateKey = $sa.private_key -replace '\\n', "`n"
    $rsa = [System.Security.Cryptography.RSA]::Create()
    $rsa.ImportFromPem($privateKey)
    $sig = $rsa.SignData([System.Text.Encoding]::UTF8.GetBytes($inputStr), [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $sigB64 = [Convert]::ToBase64String($sig, [Base64FormattingOptions]::None) -replace '\+', '-' -replace '/', '_'
    
    $jwt = "$inputStr.$sigB64"
    
    $response = Invoke-RestMethod -Uri 'https://oauth2.googleapis.com/token' -Method POST -ContentType 'application/x-www-form-urlencoded' -Body "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=$jwt"
    return $response.access_token
}

try {
    $token = Get-FirestoreToken -sa $sa
    Write-Host "[ok] OAuth token obtained" -ForegroundColor Green
} catch {
    Write-Host "[!] Failed to get OAuth token: $_" -ForegroundColor Red
    exit 1
}

# Get current device state
$baseUrl = "https://firestore.googleapis.com/v1/projects/$projectId/databases/$database/documents"
$headers = @{ Authorization = "Bearer $token" }

try {
    $deviceUrl = "$baseUrl/devices/$DeviceId"
    $deviceResponse = Invoke-RestMethod -Uri $deviceUrl -Method GET -Headers $headers
    $fields = $deviceResponse.fields
    
    $currentState = $null
    if ($fields.staleAlert -and $fields.staleAlert.mapValue.fields.state) {
        $currentState = $fields.staleAlert.mapValue.fields.state.stringValue
    }
    
    Write-Host "`nCurrent state:" -ForegroundColor Yellow
    Write-Host "  Device ID: $DeviceId"
    if ($fields.deviceDisplayName) {
        Write-Host "  Display Name: $($fields.deviceDisplayName.stringValue)"
    }
    if ($fields.lastSeen) {
        Write-Host "  Last Seen: $($fields.lastSeen.stringValue)"
    }
    if ($fields.online -ne $null) {
        Write-Host "  Online: $($fields.online.booleanValue)"
    }
    Write-Host "  Stale Alert State: $($currentState ?? 'not set')"
    
} catch {
    Write-Host "[!] Failed to get device state: $_" -ForegroundColor Red
    exit 1
}

# Set new state
$newState = if ($Action -eq 'freeze') { 'frozen' } else { 'healthy' }

try {
    $patchUrl = "$baseUrl/devices/$DeviceId?updateMask.fieldPaths=staleAlert"
    $newStateObj = @{
        fields = @{
            staleAlert = @{
                mapValue = @{
                    fields = @{
                        state = @{ stringValue = $newState }
                        since = @{ stringValue = (Get-Date -UFormat %Y-%m-%dT%H:%M:%SZ) }
                    }
                }
            }
        }
    } | ConvertTo-Json -Depth 10
    
    Write-Host "`nPatching device state..." -ForegroundColor Yellow
    $patchResponse = Invoke-RestMethod -Uri $patchUrl -Method PATCH -Headers $headers -ContentType 'application/json' -Body $newStateObj
    
    Write-Host "[ok] Device $DeviceId $Actiond successfully!" -ForegroundColor Green
    Write-Host "  New staleAlertState: $newState"
    
} catch {
    Write-Host "[!] Failed to update device state: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n== Complete ==" -ForegroundColor Cyan
