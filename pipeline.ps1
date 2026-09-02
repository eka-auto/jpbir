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

Write-Host "==> [1/3] channel-sandbox tests" -ForegroundColor Cyan
Push-Location (Join-Path $root "channel-sandbox")
& $py -m pytest tests -q -o addopts=""
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "channel-sandbox tests failed" }
Pop-Location

Write-Host "==> [2/3] personal_folder_agent tests" -ForegroundColor Cyan
Push-Location $root
& $py -m pytest personal_folder_agent/tests -q -o addopts=""
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "personal_folder_agent tests failed" }
Pop-Location

Write-Host "==> [3/3] jayti-dashboard tests" -ForegroundColor Cyan
Push-Location (Join-Path $root "jayti-dashboard")
node test/stale.test.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "stale tests failed" }
node test/broker.test.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "broker tests failed" }
node test/connect.test.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "connect tests failed" }
Pop-Location

Write-Host "All tests passed." -ForegroundColor Green
