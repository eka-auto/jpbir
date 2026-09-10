$EkaSilentMode = $env:EKA_VERBOSE_DEVICE_OUTPUT -ne '1'
if (-not $EkaSilentMode) {
    return
}

function Get-EkaCallerPath {
    $callStack = @(Get-PSCallStack)
    foreach ($frame in $callStack) {
        if ($frame.ScriptName -and ($frame.ScriptName -ne $PSCommandPath)) {
            return $frame.ScriptName
        }
    }

    if ($PSCommandPath) {
        return $PSCommandPath
    }

    return (Join-Path $PWD 'eka-console.ps1')
}

$script:EkaCallerPath = Get-EkaCallerPath
$script:EkaLogPath = [System.IO.Path]::ChangeExtension($script:EkaCallerPath, '.log')
try {
    $script:EkaEncoding = New-Object System.Text.UTF8Encoding $false
    $script:EkaLogWriter = New-Object System.IO.StreamWriter($script:EkaLogPath, $true, $script:EkaEncoding)
    $script:EkaLogWriter.AutoFlush = $true
} catch {
    $script:EkaLogWriter = $null
}

function Write-EkaLog {
    param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Message)
    $text = ($Message | ForEach-Object {
        if ($_ -is [string]) {
            $_
        } else {
            (($_ | Out-String).Trim())
        }
    }) -join ' '

    if ($text -and $script:EkaLogWriter) {
        try {
            $script:EkaLogWriter.WriteLine($text.TrimEnd())
        } catch {
            # Keep target execution silent even if the log file is unavailable.
        }
    }
}

function Write-Host {
    param(
        [Parameter(Position = 0, ValueFromRemainingArguments = $true)][object[]]$Object,
        [Parameter()][switch]$NoNewline,
        [Parameter()][ConsoleColor]$ForegroundColor,
        [Parameter()][ConsoleColor]$BackgroundColor
    )

    $text = ($Object | ForEach-Object {
        if ($_ -is [string]) {
            $_
        } else {
            (($_ | Out-String).Trim())
        }
    }) -join ' '

    if ($text -match 'SUCCESS' -or $text -match '^{') {
        [Console]::WriteLine($text)
    }

    Write-EkaLog @Object
}

function Write-Warning {
    param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Message)
    Write-EkaLog ("WARNING: " + (($Message | ForEach-Object { $_.ToString() }) -join ' '))
}

function Write-Error {
    param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Message)
    Write-EkaLog ("ERROR: " + (($Message | ForEach-Object { $_.ToString() }) -join ' '))
}

function Write-Verbose {
    param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Message)
    Write-EkaLog ("VERBOSE: " + (($Message | ForEach-Object { $_.ToString() }) -join ' '))
}

function Write-Information {
    param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Message)
    Write-EkaLog ("INFO: " + (($Message | ForEach-Object { $_.ToString() }) -join ' '))
}

$InformationPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'

function Write-Debug {
    param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Message)
    Write-EkaLog ("DEBUG: " + (($Message | ForEach-Object { $_.ToString() }) -join ' '))
}