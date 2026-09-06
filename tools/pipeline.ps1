# Local mirror of the CI test pipeline.
# Runs the exact same test sequence as .github/workflows/ci-deploy.yml.
# Deployment is handled by Vercel's git integration (single pipeline).
#
# Usage:
#   .\tools\pipeline.ps1

param([string]$PythonPath)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$py = if ($PythonPath) { $PythonPath } else { Join-Path $root "venv\Scripts\python.exe" }
if (-not (Test-Path $py)) { $py = "python" }

Write-Host "==> [1/3] Sandbox tests" -ForegroundColor Cyan
Push-Location (Join-Path $root "Sandbox/Configuration")
& $py -m pytest tests -q -o addopts=""
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Sandbox tests failed" }
Pop-Location

Write-Host "==> [2/3] JavaScript syntax" -ForegroundColor Cyan
Push-Location $root
try {
    $scripts = git ls-files '*.js' '*.mjs'
    if ($LASTEXITCODE -ne 0) { throw "Could not list JavaScript files" }
    foreach ($script in $scripts) {
        node --check $script
        if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax failed: $script" }
    }
} finally {
    Pop-Location
}

Write-Host "==> [3/3] Dashboard tests" -ForegroundColor Cyan
Push-Location (Join-Path $root "Dashboard/Current")
& npm.cmd run test:frontend
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "frontend build tests failed" }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "frontend build failed" }
node others/test/stale.test.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "stale tests failed" }
node others/test/broker.test.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "broker tests failed" }
node others/test/connect.test.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "connect tests failed" }
Pop-Location

Write-Host "All tests passed." -ForegroundColor Green
