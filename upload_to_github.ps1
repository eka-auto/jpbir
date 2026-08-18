Write-Host "🚀 ONE-CLICK UPLOAD SCRIPT FOR jaytibirthday.in" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "✅ REPOSITORY FOUND: urgaa-eka/jaytibirthday-site" -ForegroundColor Green
Write-Host ""

Write-Host "🎯 RUNNING UPLOAD..." -ForegroundColor White

# Step 1: Clone repository
Write-Host "Step 1: Cloning repository..." -ForegroundColor Yellow
Set-Location "C:\Users\abcom\jpbir"
if (Test-Path "jaytibirthday-site") {
    Write-Host "   ✅ Repository already exists" -ForegroundColor Green
} else {
    gh repo clone urgaa-eka/jaytibirthday-site
    Write-Host "   ✅ Repository cloned" -ForegroundColor Green
}

# Step 2: Enter repository
Set-Location jaytibirthday-site
Write-Host "Step 2: Entering repository..." -ForegroundColor Yellow
Write-Host "   Current directory: $(Get-Location)" -ForegroundColor Gray

# Step 3: Check structure
Write-Host "Step 3: Checking structure..." -ForegroundColor Yellow
if (Test-Path "assets\js") {
    Write-Host "   ✅ assets/js folder exists" -ForegroundColor Green
} else {
    New-Item -ItemType Directory -Path "assets\js" -Force
    Write-Host "   ✅ Created assets/js folder" -ForegroundColor Green
}

# Step 4: Copy file
Write-Host "Step 4: Copying analytics file..." -ForegroundColor Yellow
$sourceFile = "..\jaytibirthday-analytics.js"
$destFile = "assets\js\jaytibirthday-analytics.js"
if (Test-Path $sourceFile) {
    Copy-Item $sourceFile $destFile -Force
    Write-Host "   ✅ File copied: $destFile" -ForegroundColor Green
} else {
    Write-Host "   ❌ Source file not found: $sourceFile" -ForegroundColor Red
}

# Step 5: Check HTML file
Write-Host "Step 5: Looking for HTML file..." -ForegroundColor Yellow
$htmlFiles = Get-ChildItem *.html
if ($htmlFiles.Count -gt 0) {
    Write-Host "   ✅ Found HTML files:" -ForegroundColor Green
    $htmlFiles | ForEach-Object { Write-Host "      • $($_.Name)" -ForegroundColor Gray }
} else {
    Write-Host "   ❌ No HTML files found" -ForegroundColor Red
}

Write-Host ""
Write-Host "🎯 NEXT STEPS:" -ForegroundColor Cyan
Write-Host "   1. Edit the HTML file (likely index.html)" -ForegroundColor White
Write-Host "   2. Add this line BEFORE </head>:" -ForegroundColor White
Write-Host "      <script async defer src='/assets/js/jaytibirthday-analytics.js'></script>" -ForegroundColor Cyan
Write-Host "   3. Run: git add ." -ForegroundColor Gray
Write-Host "   4. Run: git commit -m 'Add analytics tracking'" -ForegroundColor Gray
Write-Host "   5. Run: git push" -ForegroundColor Gray
Write-Host ""
Write-Host "✅ READY FOR UPLOAD!" -ForegroundColor Green
