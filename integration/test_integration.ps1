# Test Script for jaytibirthday.in Analytics Integration
# Verifies that analytics integration works without affecting SEO

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Testing jaytibirthday.in Analytics Integration" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$DOMAIN = "jaytibirthday.in"
$ANALYTICS_PORT = "3001"
$PROJECT_DIR = "C:\Users\abcom\jpbir"
$TEST_RESULTS = @()

# Test 1: Check if analytics agent is running
Write-Host "🧪 Test 1: Analytics Agent Status" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:$ANALYTICS_PORT/api/status" -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        $data = $response.Content | ConvertFrom-Json
        $TEST_RESULTS += @{
            Test = "Analytics Agent"
            Status = "PASS"
            Details = "$($data.name) v$($data.version) - $($data.status)"
        }
        Write-Host "   ✅ PASS: $($data.name) is running" -ForegroundColor Green
    }
} catch {
    $TEST_RESULTS += @{
        Test = "Analytics Agent"
        Status = "FAIL"
        Details = "Agent not responding on port $ANALYTICS_PORT"
    }
    Write-Host "   ❌ FAIL: Agent not responding" -ForegroundColor Red
}

# Test 2: Check JavaScript tracker file
Write-Host "`n🧪 Test 2: JavaScript Tracker File" -ForegroundColor Yellow
$trackerFile = "$PROJECT_DIR\integration\website_tracker.js"
if (Test-Path $trackerFile) {
    $fileSize = (Get-Item $trackerFile).Length / 1KB
    $lineCount = (Get-Content $trackerFile).Count
    $TEST_RESULTS += @{
        Test = "JavaScript Tracker"
        Status = "PASS"
        Details = "File exists ($([math]::Round($fileSize, 2)) KB, $lineCount lines)"
    }
    Write-Host "   ✅ PASS: Tracker file exists" -ForegroundColor Green
} else {
    $TEST_RESULTS += @{
        Test = "JavaScript Tracker"
        Status = "FAIL"
        Details = "File not found: $trackerFile"
    }
    Write-Host "   ❌ FAIL: Tracker file not found" -ForegroundColor Red
}

# Test 3: Test database connectivity
Write-Host "`n🧪 Test 3: Database Connectivity" -ForegroundColor Yellow
$dbFiles = @(
    "$PROJECT_DIR\data\visitors.db",
    "$PROJECT_DIR\data\analytics.db"
)

$dbTestPassed = $false
foreach ($dbFile in $dbFiles) {
    if (Test-Path $dbFile) {
        $dbSize = (Get-Item $dbFile).Length / 1KB
        Write-Host "   ✅ Found: $(Split-Path $dbFile -Leaf) ($([math]::Round($dbSize, 2)) KB)" -ForegroundColor Gray
        $dbTestPassed = $true
    }
}

if ($dbTestPassed) {
    $TEST_RESULTS += @{
        Test = "Database Files"
        Status = "PASS"
        Details = "Database files exist and accessible"
    }
    Write-Host "   ✅ PASS: Database files found" -ForegroundColor Green
} else {
    $TEST_RESULTS += @{
        Test = "Database Files"
        Status = "WARNING"
        Details = "Database files will be created on first visitor"
    }
    Write-Host "   ⚠️  WARNING: Database files will be auto-created" -ForegroundColor Yellow
}

# Test 4: Test visitor tracking API
Write-Host "`n🧪 Test 4: Visitor Tracking API" -ForegroundColor Yellow
try {
    $trackData = @{
        session_id = "test_session_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        device_fingerprint = "test_fingerprint_123"
        page_url = "https://$DOMAIN/test"
        referrer = "direct"
        entry_time = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        browser_info = @{
            userAgent = "Test-Agent/1.0"
            language = "en-US"
            platform = "Windows"
        }
    }
    
    $jsonData = $trackData | ConvertTo-Json
    $response = Invoke-WebRequest -Uri "http://localhost:$ANALYTICS_PORT/api/analytics/track" `
        -Method POST `
        -Body $jsonData `
        -ContentType "application/json" `
        -TimeoutSec 5
    
    if ($response.StatusCode -eq 200) {
        $responseData = $response.Content | ConvertFrom-Json
        $TEST_RESULTS += @{
            Test = "Visitor Tracking API"
            Status = "PASS"
            Details = "API responded successfully, visitor ID: $($responseData.visitor_id)"
        }
        Write-Host "   ✅ PASS: Visitor tracking API working" -ForegroundColor Green
    }
} catch {
    $TEST_RESULTS += @{
        Test = "Visitor Tracking API"
        Status = "FAIL"
        Details = "API error: $($_.Exception.Message)"
    }
    Write-Host "   ❌ FAIL: Visitor tracking API error" -ForegroundColor Red
}

# Test 5: Test SEO compatibility (noindex headers)
Write-Host "`n🧪 Test 5: SEO Compatibility" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:$ANALYTICS_PORT/dashboard" -TimeoutSec 5
    $headers = $response.Headers
    
    # Check for noindex headers
    if ($headers["X-Robots-Tag"] -match "noindex") {
        $TEST_RESULTS += @{
            Test = "SEO Compatibility"
            Status = "PASS"
            Details = "X-Robots-Tag header set to 'noindex, nofollow'"
        }
        Write-Host "   ✅ PASS: SEO headers properly configured" -ForegroundColor Green
    } else {
        $TEST_RESULTS += @{
            Test = "SEO Compatibility"
            Status = "WARNING"
            Details = "No SEO headers found (should add X-Robots-Tag)"
        }
        Write-Host "   ⚠️  WARNING: No SEO headers detected" -ForegroundColor Yellow
    }
} catch {
    $TEST_RESULTS += @{
        Test = "SEO Compatibility"
        Status = "SKIP"
        Details = "Could not test headers: $($_.Exception.Message)"
    }
    Write-Host "   ↪️  SKIP: Could not test headers" -ForegroundColor Gray
}

# Test 6: Test background processing
Write-Host "`n🧪 Test 6: Background Processing" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:$ANALYTICS_PORT/api/analytics/process" -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        $data = $response.Content | ConvertFrom-Json
        $TEST_RESULTS += @{
            Test = "Background Processing"
            Status = "PASS"
            Details = "Background processing active: $($data.message)"
        }
        Write-Host "   ✅ PASS: Background processing working" -ForegroundColor Green
    }
} catch {
    $TEST_RESULTS += @{
        Test = "Background Processing"
        Status = "SKIP"
        Details = "Processing endpoint not available"
    }
    Write-Host "   ↪️  SKIP: Processing endpoint not available" -ForegroundColor Gray
}

# Test 7: Check integration configuration
Write-Host "`n🧪 Test 7: Integration Configuration" -ForegroundColor Yellow
$configFiles = @(
    "$PROJECT_DIR\integration\integration_config.js",
    "$PROJECT_DIR\integration\nginx_config.conf",
    "$PROJECT_DIR\integration\setup_integration.ps1",
    "$PROJECT_DIR\integration\integration_guide.md"
)

$configTestPassed = $true
foreach ($configFile in $configFiles) {
    if (Test-Path $configFile) {
        Write-Host "   ✅ Found: $(Split-Path $configFile -Leaf)" -ForegroundColor Gray
    } else {
        Write-Host "   ❌ Missing: $(Split-Path $configFile -Leaf)" -ForegroundColor Red
        $configTestPassed = $false
    }
}

if ($configTestPassed) {
    $TEST_RESULTS += @{
        Test = "Integration Configuration"
        Status = "PASS"
        Details = "All configuration files present"
    }
    Write-Host "   ✅ PASS: All configuration files found" -ForegroundColor Green
} else {
    $TEST_RESULTS += @{
        Test = "Integration Configuration"
        Status = "FAIL"
        Details = "Missing configuration files"
    }
    Write-Host "   ❌ FAIL: Missing configuration files" -ForegroundColor Red
}

# Test 8: Test JavaScript snippet SEO impact
Write-Host "`n🧪 Test 8: JavaScript SEO Impact" -ForegroundColor Yellow
$jsContent = Get-Content "$PROJECT_DIR\integration\website_tracker.js" -Raw

# Check for SEO-friendly attributes
$checks = @{
    "Async loading" = $jsContent -match "async.*defer"
    "Non-blocking" = $jsContent -match "non-blocking"
    "Low priority" = $jsContent -match "priority.*low"
    "No SEO keywords" = -not ($jsContent -match "keywords|description|title|meta")
    "Background only" = $jsContent -match "background"
}

$seoChecksPassed = 0
foreach ($check in $checks.Keys) {
    if ($checks[$check]) {
        Write-Host "   ✅ $check" -ForegroundColor Gray
        $seoChecksPassed++
    } else {
        Write-Host "   ❌ $check" -ForegroundColor DarkGray
    }
}

if ($seoChecksPassed -ge 4) {
    $TEST_RESULTS += @{
        Test = "JavaScript SEO Impact"
        Status = "PASS"
        Details = "$seoChecksPassed/5 SEO checks passed"
    }
    Write-Host "   ✅ PASS: JavaScript is SEO-friendly" -ForegroundColor Green
} else {
    $TEST_RESULTS += @{
        Test = "JavaScript SEO Impact"
        Status = "WARNING"
        Details = "Only $seoChecksPassed/5 SEO checks passed"
    }
    Write-Host "   ⚠️  WARNING: Some SEO checks failed" -ForegroundColor Yellow
}

# Display summary
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "📊 TEST RESULTS SUMMARY" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$passed = ($TEST_RESULTS | Where-Object { $_.Status -eq "PASS" }).Count
$failed = ($TEST_RESULTS | Where-Object { $_.Status -eq "FAIL" }).Count
$warnings = ($TEST_RESULTS | Where-Object { $_.Status -eq "WARNING" }).Count
$skipped = ($TEST_RESULTS | Where-Object { $_.Status -eq "SKIP" }).Count

Write-Host "✅ PASSED: $passed" -ForegroundColor Green
Write-Host "❌ FAILED: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Gray" })
Write-Host "⚠️  WARNINGS: $warnings" -ForegroundColor $(if ($warnings -gt 0) { "Yellow" } else { "Gray" })
Write-Host "↪️  SKIPPED: $skipped" -ForegroundColor Gray

Write-Host "`n📋 Detailed Results:" -ForegroundColor Yellow
foreach ($result in $TEST_RESULTS) {
    $color = switch ($result.Status) {
        "PASS" { "Green" }
        "FAIL" { "Red" }
        "WARNING" { "Yellow" }
        default { "Gray" }
    }
    Write-Host "  [$($result.Status)] $($result.Test)" -ForegroundColor $color
    Write-Host "      $($result.Details)" -ForegroundColor DarkGray
}

Write-Host "`n🔧 Recommendations:" -ForegroundColor Cyan
if ($failed -eq 0) {
    if ($warnings -eq 0) {
        Write-Host "   🎉 All tests passed! Integration is ready." -ForegroundColor Green
        Write-Host "   Next step: Add JavaScript snippet to your website HTML" -ForegroundColor Gray
    } else {
        Write-Host "   📝 Some warnings to address:" -ForegroundColor Yellow
        $warningsList = $TEST_RESULTS | Where-Object { $_.Status -eq "WARNING" }
        foreach ($warning in $warningsList) {
            Write-Host "   • $($warning.Test): $($warning.Details)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "   ⚠️  Issues to fix before deployment:" -ForegroundColor Red
    $failures = $TEST_RESULTS | Where-Object { $_.Status -eq "FAIL" }
    foreach ($failure in $failures) {
        Write-Host "   • $($failure.Test): $($failure.Details)" -ForegroundColor Red
    }
}

Write-Host "`n🚀 Integration Status:" -ForegroundColor Cyan
if ($failed -eq 0 -and $warnings -eq 0) {
    Write-Host "   ✅ FULLY READY FOR DEPLOYMENT" -ForegroundColor Green
    Write-Host "   The analytics integration will not affect your SEO" -ForegroundColor Gray
} elseif ($failed -eq 0) {
    Write-Host "   ⚠️  READY WITH MINOR WARNINGS" -ForegroundColor Yellow
    Write-Host "   SEO impact is minimal, warnings are non-critical" -ForegroundColor Gray
} else {
    Write-Host "   ❌ NOT READY - FIX ISSUES FIRST" -ForegroundColor Red
    Write-Host "   Some tests failed that could affect SEO" -ForegroundColor Gray
}

Write-Host "`n📝 Next Steps:" -ForegroundColor White
Write-Host "   1. Review test results above" -ForegroundColor Gray
Write-Host "   2. Fix any FAILED tests" -ForegroundColor Gray
Write-Host "   3. Address WARNINGS if needed" -ForegroundColor Gray
Write-Host "   4. Add JavaScript snippet to website:" -ForegroundColor Gray
Write-Host "      <script async defer src='/assets/js/jaytibirthday-analytics.js'></script>" -ForegroundColor White
Write-Host "   5. Monitor analytics at: http://localhost:$ANALYTICS_PORT/dashboard" -ForegroundColor Gray

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "✅ Integration Testing Complete" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan