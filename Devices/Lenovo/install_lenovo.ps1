param(
    [string]$EnrollmentCode = $env:EKA_ENROLLMENT_CODE
)

# One-time broker setup for this physical Lenovo 82KA.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$DeviceId = 'g4g-lenovo-laptop'
$TaskName = 'EKA-Lenovo-Daemon'
$Target = 'C:\eka-agent\broker'
$StatePath = Join-Path $Target "$DeviceId.broker-state.json"
$CodePath = Join-Path $Target 'enrollment_code.txt'
$LogPath = Join-Path $Target "logs\$DeviceId.log"
$PinnedCommit = '183e600d0acd7e6171e35be904c657e7fe967384'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Remove-LegacyFleetStartup {
    # The retired fleet agent writes directly to Firestore, so it must not start
    # beside this signed broker on the next user logon.
    $LegacyVbs = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)) 'EKA-Fleet-Agent.vbs'
    if (Test-Path -LiteralPath $LegacyVbs -PathType Leaf) {
        Remove-Item -LiteralPath $LegacyVbs -Force
        Write-Host '[ok] removed legacy EKA-Fleet-Agent.vbs from Startup'
    }
}

# Hash is the SHA-256 of the bundled file's BYTES - 64 hex characters, exactly what
# (Get-FileHash -Algorithm SHA256).Hash returns below. It is NOT a git object id.
# This table once carried `git hash-object` output for single_instance.py: a
# 40-character SHA-1 blob id, which can never equal a 64-character digest, so the
# integrity check threw for every possible file content and the install aborted
# before the venv, enrollment and scheduled task were ever reached. The sibling
# Lenovo pin was a well-formed SHA-256 of an older generation of the same file, so
# it failed too. _shared/tests/installer-pins.test.mjs re-hashes every pin against
# the kit bytes and fails on a wrong length, so neither mistake can recur silently.
$Artifacts = @(
    [pscustomobject]@{ Name = 'device_agent.py'; Hash = '8DEC43C4C25BB7032091042D29C613EEC57F7EF64D0B336354FB5F2FB5428CD7' },
    [pscustomobject]@{ Name = 'broker_client.py'; Hash = 'E380867C5843E49C21D7E46704DB20607389A9F1FAAD4B3CF61F9B4EAB173BB1' },
    [pscustomobject]@{ Name = 'signer.py'; Hash = '64C56FA828DC56656CE6E28A116A43386781A1A0F737E5D794BEC587DB4927FA' },
    [pscustomobject]@{ Name = 'single_instance.py'; Hash = '287FE1C114488E847F0252C89170067E6FE5B33650780C72E8A8F00F7B63843A' },
    [pscustomobject]@{ Name = 'requirements-broker.txt'; Hash = '37B13C7D746D596E7DA6E73098DFBA792EAB1A49C8ACC7E0A5AB287B56B107D5' }
)

function Get-CompatiblePython {
    $Candidates = @(
        [pscustomobject]@{ Command = 'py.exe'; Prefix = @('-3.12') },
        [pscustomobject]@{ Command = 'python.exe'; Prefix = @() },
        [pscustomobject]@{ Command = 'python3.exe'; Prefix = @() }
    )
    foreach ($Candidate in $Candidates) {
        $Resolved = Get-Command $Candidate.Command -ErrorAction SilentlyContinue
        if (-not $Resolved) { continue }
        $Probe = & $Resolved.Source @($Candidate.Prefix) -c "import sys; print(sys.executable) if sys.version_info >= (3, 10) else sys.exit(1)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $Probe) {
            return ($Probe | Select-Object -Last 1).Trim()
        }
    }
    throw 'Python 3.10 or newer was not found. Install 64-bit Python and rerun this installer.'
}

function Get-ExistingEnrollment {
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return $false }
    try {
        $State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        return ($State.enrolled -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$State.keyId))
    } catch {
        throw "Existing broker state is invalid: $StatePath"
    }
}

Write-Host '== Lenovo 82KA broker install =='

$Computer = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1
$Manufacturer = [string]$Computer.Manufacturer
$Model = [string]$Computer.Model
if ($Manufacturer -notmatch '(?i)^LENOVO$' -or $Model -notmatch '(?i)^82KA') {
    throw "Hardware guard expected LENOVO 82KA, found '$Manufacturer' '$Model'."
}
Write-Host "[ok] hardware guard: $Manufacturer $Model"

$BootstrapPython = Get-CompatiblePython
New-Item -ItemType Directory -Path $Target,(Split-Path -Parent $LogPath) -Force | Out-Null

foreach ($Artifact in $Artifacts) {
    $Source = Join-Path $Here $Artifact.Name
    $Destination = Join-Path $Target $Artifact.Name
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Deploy kit is incomplete: missing $($Artifact.Name)."
    }
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    $ActualHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
    if ($ActualHash -ne $Artifact.Hash) {
        Remove-Item -LiteralPath $Destination -Force
        throw "Integrity check failed for $($Artifact.Name)."
    }
}
Copy-Item -LiteralPath (Join-Path $Here 'devices.json') -Destination (Join-Path $Target 'devices.json') -Force
Write-Host "[ok] copied and verified bundled broker artifacts from commit $PinnedCommit"

$Venv = Join-Path $Target '.venv'
$AgentPython = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $AgentPython -PathType Leaf)) {
    & $BootstrapPython -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the broker virtual environment.' }
}
& $AgentPython -m pip install --disable-pip-version-check --requirement (Join-Path $Target 'requirements-broker.txt')
if ($LASTEXITCODE -ne 0) { throw 'Broker dependency installation failed.' }

Push-Location $Target
try {
    & $AgentPython -c "from signer import WindowsCngSigner; WindowsCngSigner('EKA-BROKER-G4G-LENOVO-LAPTOP').public_key_pem(); print('[ok] TPM signer ready')"
    if ($LASTEXITCODE -ne 0) { throw 'The TPM-backed CNG signer preflight failed.' }
} finally {
    Pop-Location
}

$AlreadyEnrolled = Get-ExistingEnrollment
if ($AlreadyEnrolled) {
    if (Test-Path -LiteralPath $CodePath -PathType Leaf) {
        [IO.File]::WriteAllBytes($CodePath, [byte[]]::new(0))
        Remove-Item -LiteralPath $CodePath -Force
    }
} else {
    if ([string]::IsNullOrWhiteSpace($EnrollmentCode)) {
        $SecureCode = Read-Host 'Enter the 32-character one-time enrollment code' -AsSecureString
        $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureCode)
        try {
            $EnrollmentCode = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
        }
    }
    if ($EnrollmentCode -cnotmatch '^[0-9a-fA-F]{32}$') {
        throw 'Enrollment code must be exactly 32 hexadecimal characters.'
    }
    [IO.File]::WriteAllText($CodePath, $EnrollmentCode, [Text.UTF8Encoding]::new($false))
}
$EnrollmentCode = $null
Remove-Item Env:EKA_ENROLLMENT_CODE -ErrorAction SilentlyContinue

$StaleKey = Join-Path $Target 'serviceAccountKey.json'
if (Test-Path -LiteralPath $StaleKey -PathType Leaf) { Remove-Item -LiteralPath $StaleKey -Force }
$StaleClient = Join-Path $Target 'firestore_client.py'
if (Test-Path -LiteralPath $StaleClient -PathType Leaf) { Remove-Item -LiteralPath $StaleClient -Force }

$ConfigPath = Join-Path $Target 'devices.json'
$AgentPath = Join-Path $Target 'device_agent.py'
& $AgentPython $AgentPath $ConfigPath $DeviceId --once --log-file $LogPath
if ($LASTEXITCODE -ne 0 -or -not (Get-ExistingEnrollment)) {
    throw 'Enrollment/heartbeat preflight failed. The scheduled task was not changed.'
}
if (Test-Path -LiteralPath $CodePath) {
    throw 'Enrollment code was not consumed; refusing to install a persistent task.'
}
Write-Host '[ok] signed enrollment and heartbeat verified'

$RunningAgents = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match 'device_agent\.py' -and
    $_.CommandLine -match [regex]::Escape($DeviceId) -and
    $_.CommandLine -notmatch '--once'
}
foreach ($RunningAgent in $RunningAgents) {
    Stop-Process -Id $RunningAgent.ProcessId -Force -ErrorAction Stop
}
if ($RunningAgents) { Start-Sleep -Seconds 2 }

$StateBeforeStart = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$SeqBeforeStart = [int64]$StateBeforeStart.seq
$CurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$ActionArgs = "`"$AgentPath`" `"$ConfigPath`" $DeviceId --log-file `"$LogPath`""
$Action = New-ScheduledTaskAction -Execute $AgentPython -Argument $ActionArgs -WorkingDirectory $Target
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$Persistence = $null
try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description 'Lenovo signed outbound broker daemon' -Force -ErrorAction Stop | Out-Null
    Remove-ItemProperty -LiteralPath $RunKey -Name $TaskName -ErrorAction SilentlyContinue
    $Persistence = 'scheduled task'
} catch {
    $ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $ExistingCommand = if ($ExistingTask) { "$($ExistingTask.Actions[0].Execute) $($ExistingTask.Actions[0].Arguments)" } else { '' }
    $SourceAgentPath = Join-Path $Here 'device_agent.py'
    $Pythonw = Join-Path $Venv 'Scripts\pythonw.exe'
    New-Item -Path $RunKey -Force | Out-Null
    Set-ItemProperty -LiteralPath $RunKey -Name $TaskName -Value "`"$Pythonw`" $ActionArgs"
    $Persistence = if ($ExistingTask -and $ExistingCommand -like "*$SourceAgentPath*" -and $ExistingCommand -like "*$DeviceId*") {
        'protected broker task plus current-user startup'
    } else {
        'current-user startup'
    }
}

if ($Persistence -like '*scheduled task') {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
} else {
    $Pythonw = Join-Path $Venv 'Scripts\pythonw.exe'
    Start-Process -FilePath $Pythonw -ArgumentList $ActionArgs -WorkingDirectory $Target -WindowStyle Hidden
}
Start-Sleep -Seconds 8
$SourceAgentPath = Join-Path $Here 'device_agent.py'
$LiveAgent = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -notmatch '--once' -and
    $_.CommandLine -like "*$DeviceId*" -and
    ($_.CommandLine -like "*$AgentPath*" -or $_.CommandLine -like "*$SourceAgentPath*")
} | Select-Object -First 1
$StateAfterStart = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
if (-not $LiveAgent -or [int64]$StateAfterStart.seq -le $SeqBeforeStart) {
    throw "Persistent broker startup did not prove a signed request. Review $LogPath."
}

Remove-LegacyFleetStartup
Write-Host "[ok] broker is running via $Persistence with no service-account key on the device"
