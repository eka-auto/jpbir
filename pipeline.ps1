# Local mirror of the CI test pipeline.
# Runs the exact same test sequence as .github/workflows/ci-deploy.yml.
# Deployment is handled by Vercel's git integration (single pipeline).
#
# Usage:
#   .\pipeline.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $root "venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

Write-Host "==> [1/2] Sandbox tests" -ForegroundColor Cyan
Push-Location (Join-Path $root "Sandbox/Configuration")
& $py -m pytest tests -q -o addopts=""
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Sandbox tests failed" }
Pop-Location

Write-Host "==> [2/2] Dashboard tests" -ForegroundColor Cyan
Push-Location (Join-Path $root "Dashboard/Current")
node others/test/stale.test.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "stale tests failed" }
node others/test/broker.test.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "broker tests failed" }
node others/test/connect.test.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "connect tests failed" }
Pop-Location

Write-Host "All tests passed." -ForegroundColor Green
