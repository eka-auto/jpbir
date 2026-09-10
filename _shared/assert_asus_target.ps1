[CmdletBinding()]
param(
    [string]$ExpectedMachine = $env:EKA_EXPECTED_MACHINE,
    [string]$ExpectedUser = $env:EKA_EXPECTED_USER,
    [string]$ExpectedProfile = $env:EKA_EXPECTED_PROFILE,
    [string]$ExpectedManufacturerRegex = $env:EKA_EXPECTED_MANUFACTURER_REGEX
)

$ErrorActionPreference = 'Stop'
$env:EKA_VERBOSE_DEVICE_OUTPUT = '0'
. "$PSScriptRoot\silent_console.ps1"

if (-not $ExpectedManufacturerRegex) {
    $ExpectedManufacturerRegex = 'ASUS|ASUSTeK'
}

$computerSystem = Get-CimInstance Win32_ComputerSystem
$manufacturer = [string]$computerSystem.Manufacturer
$model = [string]$computerSystem.Model
$computerName = if ($env:COMPUTERNAME) { [string]$env:COMPUTERNAME } else { [string]$computerSystem.Name }
$userName = if ($env:USERNAME) { [string]$env:USERNAME } else { [Environment]::UserName }
$profilePath = if ($env:USERPROFILE) { [string]$env:USERPROFILE } else { [Environment]::GetFolderPath('UserProfile') }
$userProfile = $profilePath.TrimEnd('\')

# NOTE: a block here previously rewrote $manufacturer to 'ASUS' and $model to
# 'Vivobook' whenever $computerName was 'G4G-LAPTOP'. Because that ran BEFORE
# the LENOVO check below, the one host this guard exists to block was laundered
# into passing it — G4G-LAPTOP is a Lenovo V14 G2 ITL (82KA). Removed, so the
# checks below now see the manufacturer the hardware actually reports.

if ($env:EKA_BYPASS_MANUFACTURER_CHECK -eq '1') {
    Write-Output "ASUS target bypassed via EKA_BYPASS_MANUFACTURER_CHECK on $computerName\$userName ($manufacturer $model)"
    exit 0
}

if ($manufacturer -match 'LENOVO') {
    throw "Blocked: canonical ASUS target must never run on manufacturer '$manufacturer' model '$model'"
}

if ($manufacturer -notmatch $ExpectedManufacturerRegex) {
    throw "Blocked: manufacturer regex '$ExpectedManufacturerRegex' did not match manufacturer='$manufacturer' model='$model' computer='$computerName'"
}

if ($ExpectedMachine -and $computerName -ne $ExpectedMachine) {
    throw "Blocked: wrong machine. expected '$ExpectedMachine' actual '$computerName'"
}

if ($ExpectedUser -and $userName -ne $ExpectedUser) {
    throw "Blocked: wrong user. expected '$ExpectedUser' actual '$userName'"
}

if ($ExpectedProfile) {
    $normalizedExpectedProfile = $ExpectedProfile.TrimEnd('\')
    if ($userProfile -ne $normalizedExpectedProfile) {
        throw "Blocked: wrong profile. expected '$normalizedExpectedProfile' actual '$userProfile'"
    }

    if (-not (Test-Path -LiteralPath $normalizedExpectedProfile)) {
        throw "Blocked: expected profile path does not exist: $normalizedExpectedProfile"
    }
}

Write-Output "ASUS target verified on $computerName\$userName ($manufacturer $model)"