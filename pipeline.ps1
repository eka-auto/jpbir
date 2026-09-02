# Local mirror of the CI + Deploy pipeline.
# Runs the exact same test sequence as .github/workflows/ci-deploy.yml,
# then deploys both Vercel projects if --deploy is passed.
#
# Usage:
#   .\pipeline.ps1            # test only
#   .\pipeline.ps1 -Deploy    # test + deploy (requires Vercel CLI login)

param(
    [switch]$Deploy
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $root "venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

Write-Host "==> [1/4] channel-sandbox tests" -ForegroundColor Cyan
Push-Location (Join-Path $root "channel-sandbox")
& $py -m pytest tests -q -o addopts=""
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "channel-sandbox tests failed" }
Pop-Location

Write-Host "==> [2/4] personal_folder_agent tests" -ForegroundColor Cyan
Push-Location $root
& $py -m pytest personal_folder_agent/tests -q -o addopts=""
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "personal_folder_agent tests failed" }
Pop-Location

Write-Host "==> [3/4] jayti-dashboard tests" -ForegroundColor Cyan
Push-Location (Join-Path $root "jayti-dashboard")
node test/stale.test.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "jayti-dashboard tests failed" }
Pop-Location

if (-not $Deploy) {
    Write-Host "==> [4/4] skipped (pass -Deploy to deploy)" -ForegroundColor DarkGray
    Write-Host "All tests passed." -ForegroundColor Green
    exit 0
}

Write-Host "==> [4/4] deploy to Vercel" -ForegroundColor Cyan
Push-Location (Join-Path $root "jayti-dashboard")
vercel --prod --yes
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "jayti-dashboard deploy failed" }
Pop-Location

Push-Location $root
vercel --prod --yes --scope jayti --project channel-sandbox
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "channel-sandbox deploy failed" }
Pop-Location

Write-Host "Pipeline complete." -ForegroundColor Green
