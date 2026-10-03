param(
    [string]$EnrollmentCode = $env:EKA_ENROLLMENT_CODE
)

# One-time broker setup for the physical ASUS VivoBook.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$DeviceId = 'jayti-asus-vivobook'
$TaskName = 'EKA-VivoBook-Daemon'
$Target = 'C:\eka-agent\broker'
$StatePath = Join-Path $Target "$DeviceId.broker-state.json"
$CodePath = Join-Path $Target 'enrollment_code.txt'
$LogPath = Join-Path $Target "logs\$DeviceId.log"
$PinnedCommit = '183e600d0acd7e6171e35be904c657e7fe967384'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Remove-LegacyFleetStartup {
    # The retired fleet agent writes directly to Firestore with a service-account
    # key it loads at start. Retire every launcher of it only after the signed
    # broker has proved it is live; otherwise a cleanup error could leave this
    # laptop without either agent.
    #
    # Launchers are matched by their own text, never by one exact python.exe path.
    # The writer has run as ...\.venv\Scripts\python.exe and as pythonw.exe (the
    # windowless form a VBS launcher starts), under a wscript/cscript loop over
    # EKA-Fleet-Agent.vbs that restarts it, and from Run values and Startup
    # shortcuts that point at that .vbs. Matching only `python.exe ... -m ekagent`
    # left the pythonw.exe writer running with the key already in memory, and
    # deleting the key file does not revoke a credential a live process holds.
    # The strings are literals, not Join-Path output, so what is compared is
    # exactly the text Windows stores.
    #
    # All of this runs under the script's Set-StrictMode -Version Latest, where
    # reading a property an object does not have throws. Not every scheduled-task
    # action is an exec action: COM-handler actions (MSFT_TaskComHandlerAction,
    # e.g. \Microsoft\Windows\Wininet\CacheTask on a stock install) have no
    # Execute or Arguments. Reading $_.Execute on the first one threw, the single
    # catch around the whole filter printed one warning and treated the list as
    # empty, and no legacy task was ever removed. Properties are read through
    # PSObject.Properties[...], which yields $null for a missing one, and each
    # task is inspected on its own, so one odd task cannot hide the others.
    $LegacyRoot = 'C:\eka-fleet-agent'
    $LegacyVbsName = 'EKA-Fleet-Agent.vbs'
    $LegacyModulePattern = '(?i)(^|\s)-m\s+"?ekagent\b'
    $RegistryNoteProperties = @('PSPath', 'PSParentPath', 'PSChildName', 'PSDrive', 'PSProvider')

    function Invoke-LegacyCleanup {
        param([string]$Description, [scriptblock]$Action)
        try {
            & $Action
            Write-Host "[ok] $Description"
        } catch {
            # Broker recovery is already proven. A locked vbs or an admin-only
            # machine startup folder must not convert that success into a failed install.
            Write-Warning "Could not ${Description}: $($_.Exception.Message)"
        }
    }

    function Get-OptionalProperty {
        param($InputObject, [string]$Name)
        if ($null -eq $InputObject) { return $null }
        $Property = $InputObject.PSObject.Properties[$Name]
        if ($Property) { return $Property.Value }
        return $null
    }

    # True for text that starts the legacy writer: its launcher .vbs, or the
    # ekagent module run from the legacy install.
    function Test-LegacyLauncherText {
        param([string]$Text)
        if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
        if ($Text.IndexOf($LegacyVbsName, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
        return ($Text.IndexOf($LegacyRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $Text -match $LegacyModulePattern)
    }

    # Host: the wscript/cscript loop running the legacy .vbs, which restarts the
    # writer. Writer: a python.exe / pythonw.exe running the ekagent module.
    function Get-LegacyProcess {
        param([ValidateSet('Host', 'Writer')][string]$Kind)
        @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
            $CommandLine = [string](Get-OptionalProperty $_ 'CommandLine')
            $Name = [string](Get-OptionalProperty $_ 'Name')
            if ($Kind -eq 'Host') {
                $Name -match '^(?i)[wc]script\.exe$' -and
                    $CommandLine.IndexOf($LegacyVbsName, [StringComparison]::OrdinalIgnoreCase) -ge 0
            } else {
                $CommandLine -match $LegacyModulePattern -and
                    ($Name -match '^(?i)pythonw?\.exe$' -or $CommandLine.IndexOf($LegacyRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0)
            }
        })
    }

    function Get-ShortcutCommandLine {
        param([string]$Path)
        $Shell = New-Object -ComObject WScript.Shell
        try {
            $Shortcut = $Shell.CreateShortcut($Path)
            return "$($Shortcut.TargetPath) $($Shortcut.Arguments)"
        } finally {
            if ([Runtime.InteropServices.Marshal]::IsComObject($Shell)) {
                [void][Runtime.InteropServices.Marshal]::ReleaseComObject($Shell)
            }
        }
    }

    # The loop first, so it cannot start a fresh writer after the writer is
    # stopped; then the writers, enumerated again.
    foreach ($Kind in @('Host', 'Writer')) {
        $LegacyProcesses = @()
        try {
            $LegacyProcesses = @(Get-LegacyProcess $Kind)
        } catch {
            Write-Warning "Could not inspect legacy fleet processes: $($_.Exception.Message)"
        }
        foreach ($Process in $LegacyProcesses) {
            $ProcessId = Get-OptionalProperty $Process 'ProcessId'
            Invoke-LegacyCleanup "stopped legacy fleet $($Kind.ToLowerInvariant()) process $ProcessId" {
                Stop-Process -Id $ProcessId -Force -ErrorAction Stop
            }
        }
        if ($Kind -eq 'Host' -and $LegacyProcesses.Count -gt 0) { Start-Sleep -Milliseconds 500 }
    }

    foreach ($StartupFolder in @(
        [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup),
        [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonStartup)
    )) {
        if ([string]::IsNullOrWhiteSpace($StartupFolder) -or -not (Test-Path -LiteralPath $StartupFolder -PathType Container)) { continue }
        foreach ($Item in @(Get-ChildItem -LiteralPath $StartupFolder -File -ErrorAction SilentlyContinue)) {
            $IsLegacy = $Item.Name -ieq $LegacyVbsName
            if (-not $IsLegacy -and $Item.Extension -ieq '.lnk') {
                try {
                    $IsLegacy = Test-LegacyLauncherText (Get-ShortcutCommandLine $Item.FullName)
                } catch {
                    Write-Warning "Could not read Startup shortcut $($Item.FullName): $($_.Exception.Message)"
                }
            }
            if ($IsLegacy) {
                $LegacyLauncher = $Item.FullName
                Invoke-LegacyCleanup "removed legacy Startup launcher $LegacyLauncher" {
                    Remove-Item -LiteralPath $LegacyLauncher -Force -ErrorAction Stop
                }
            }
        }
    }

    foreach ($RunKey in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
    )) {
        if (-not (Test-Path -LiteralPath $RunKey)) { continue }
        $LegacyValues = @()
        try {
            $RunProperties = (Get-ItemProperty -LiteralPath $RunKey -ErrorAction Stop).PSObject.Properties
            $LegacyValues = @($RunProperties | Where-Object {
                $_.MemberType -eq 'NoteProperty' -and
                $RegistryNoteProperties -notcontains $_.Name -and
                (Test-LegacyLauncherText ([string]$_.Value))
            })
        } catch {
            Write-Warning "Could not inspect legacy Run entries at ${RunKey}: $($_.Exception.Message)"
            continue
        }
        foreach ($Value in $LegacyValues) {
            $ValueName = $Value.Name
            Invoke-LegacyCleanup "removed legacy Run entry $RunKey\$ValueName" {
                Remove-ItemProperty -LiteralPath $RunKey -Name $ValueName -ErrorAction Stop
            }
        }
    }

    $AllTasks = @()
    try {
        $AllTasks = @(Get-ScheduledTask -ErrorAction Stop)
    } catch {
        Write-Warning "Could not list scheduled tasks: $($_.Exception.Message)"
    }
    foreach ($Task in $AllTasks) {
        $TaskName = [string](Get-OptionalProperty $Task 'TaskName')
        $TaskPath = [string](Get-OptionalProperty $Task 'TaskPath')
        $IsLegacy = $false
        try {
            foreach ($TaskAction in @(Get-OptionalProperty $Task 'Actions' | Where-Object { $null -ne $_ })) {
                $ActionText = "$(Get-OptionalProperty $TaskAction 'Execute') $(Get-OptionalProperty $TaskAction 'Arguments')"
                if (Test-LegacyLauncherText $ActionText) { $IsLegacy = $true; break }
            }
        } catch {
            Write-Warning "Could not inspect scheduled task ${TaskPath}${TaskName}: $($_.Exception.Message)"
            continue
        }
        if ($IsLegacy) {
            Invoke-LegacyCleanup "removed legacy scheduled task ${TaskPath}${TaskName}" {
                Stop-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
                Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false -ErrorAction Stop
            }
        }
    }

    $LegacyKey = Join-Path $LegacyRoot 'serviceAccountKey.json'
    if (Test-Path -LiteralPath $LegacyKey -PathType Leaf) {
        Invoke-LegacyCleanup "removed legacy service-account key $LegacyKey" {
            Remove-Item -LiteralPath $LegacyKey -Force -ErrorAction Stop
        }
    }
}

# Hash is the SHA-256 of the bundled file's BYTES - 64 hex characters, exactly what
# (Get-FileHash -Algorithm SHA256).Hash returns below. It is NOT a git object id.
# This table carried `git hash-object` output for single_instance.py: a 40-character
# SHA-1 blob id, which can never equal a 64-character digest, so the integrity check
# threw for every possible file content and the install aborted before the venv,
# enrollment and scheduled task were ever reached. That is consistent with this device
# having never written a single telemetry field. The Lenovo twin had the same table
# with a well-formed but stale-generation SHA-256, and failed identically.
# _shared/tests/installer-pins.test.mjs re-hashes every pin against the kit bytes and
# fails on a wrong length, so neither mistake can recur silently.
$Artifacts = @(
    [pscustomobject]@{ Name = 'device_agent.py'; Hash = '8DEC43C4C25BB7032091042D29C613EEC57F7EF64D0B336354FB5F2FB5428CD7' },
    [pscustomobject]@{ Name = 'broker_client.py'; Hash = 'E380867C5843E49C21D7E46704DB20607389A9F1FAAD4B3CF61F9B4EAB173BB1' },
    [pscustomobject]@{ Name = 'signer.py'; Hash = '64C56FA828DC56656CE6E28A116A43386781A1A0F737E5D794BEC587DB4927FA' },
    [pscustomobject]@{ Name = 'single_instance.py'; Hash = '287FE1C114488E847F0252C89170067E6FE5B33650780C72E8A8F00F7B63843A' },
    [pscustomobject]@{ Name = 'requirements-broker.txt'; Hash = '1940BA363C2B88D6CAE8EEECF14BDA2479268122A65F8B548147201883F76977' }
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

Write-Host '== ASUS VivoBook broker install =='

$Computer = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1
$Manufacturer = [string]$Computer.Manufacturer
$Model = [string]$Computer.Model
if ($Manufacturer -match '(?i)lenovo' -or $Model -match '(?i)\b82KA\b') {
    throw "Hardware guard rejected Lenovo $Model. This kit is only for the ASUS VivoBook."
}
if ($Manufacturer -notmatch '(?i)ASUS|ASUSTeK' -or $Model -notmatch '(?i)VivoBook') {
    throw "Hardware guard expected ASUS/ASUSTeK VivoBook, found '$Manufacturer' '$Model'."
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
    & $AgentPython -c "from signer import WindowsCngSigner; WindowsCngSigner('EKA-BROKER-JAYTI-ASUS-VIVOBOOK').public_key_pem(); print('[ok] TPM signer ready')"
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
    throw 'Enrollment/heartbeat preflight failed. The scheduled task was not installed.'
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
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description 'ASUS VivoBook signed outbound broker daemon' -Force -Error[...]
    Remove-ItemProperty -LiteralPath $RunKey -Name $TaskName -ErrorAction SilentlyContinue
    $Persistence = 'scheduled task'
} catch {
    $Pythonw = Join-Path $Venv 'Scripts\pythonw.exe'
    New-Item -Path $RunKey -Force | Out-Null
    Set-ItemProperty -LiteralPath $RunKey -Name $TaskName -Value "`"$Pythonw`" $ActionArgs"
    $Persistence = 'current-user startup'
}

if ($Persistence -eq 'scheduled task') {
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
