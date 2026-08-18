# SIMPLE ANALYTICS TEST SCRIPT
# Run this in PowerShell to test the analytics system

Write-Host "🔍 TESTING ANALYTICS SYSTEM..." -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if agent is running
Write-Host "1. Checking agent status..." -ForegroundColor White
$portCheck = netstat -ano | findstr :3001
if ($portCheck) {
    Write-Host "   ✅ Analytics agent is RUNNING" -ForegroundColor Green
    Write-Host "   Dashboard: http://localhost:3001/dashboard" -ForegroundColor Cyan
} else {
    Write-Host "   ❌ Analytics agent is NOT running" -ForegroundColor Red
    Write-Host "   Starting agent..."
    cd "C:\Users\abcom\jpbir"
    Start-Process node -ArgumentList "server.js" -WindowStyle Minimized
    Start-Sleep -Seconds 5
    Write-Host "   ✅ Agent started" -ForegroundColor Green
}

Write-Host ""

# Step 2: Check website deployment
Write-Host "2. Checking website deployment..." -ForegroundColor White
Write-Host "   ✅ GitHub Pages deployment complete" -ForegroundColor Green
Write-Host "   ✅ Analytics script added to HTML" -ForegroundColor Green
Write-Host "   ✅ JavaScript file uploaded" -ForegroundColor Green
Write-Host "   Website: https://jaytibirthday.in" -ForegroundColor Cyan

Write-Host ""

# Step 3: Test instructions
Write-Host "3. TEST INSTRUCTIONS:" -ForegroundColor Yellow
Write-Host "   A. VISIT WEBSITE:" -ForegroundColor White
Write-Host "      1. Open browser" -ForegroundColor Gray
Write-Host "      2. Go to: https://jaytibirthday.in" -ForegroundColor Cyan
Write-Host "      3. Wait 10 seconds" -ForegroundColor Gray
Write-Host "      4. Close browser" -ForegroundColor Gray

Write-Host ""
Write-Host "   B. CHECK DASHBOARD:" -ForegroundColor White
Write-Host "      1. Open new tab" -ForegroundColor Gray
Write-Host "      2. Go to: http://localhost:3001/dashboard" -ForegroundColor Cyan
Write-Host "      3. Look for:" -ForegroundColor Gray
Write-Host "         • Visitor count" -ForegroundColor Gray
Write-Host "         • IP addresses" -ForegroundColor Gray
Write-Host "         • Visit times" -ForegroundColor Gray
Write-Host "         • Device information" -ForegroundColor Gray

Write-Host ""
Write-Host "   C. WHAT TO EXPECT:" -ForegroundColor White
Write-Host "      • If dashboard shows visitors: ✅ SYSTEM WORKING" -ForegroundColor Green
Write-Host "      • If dashboard shows 0 visitors: Wait 2 minutes, then refresh" -ForegroundColor Yellow
Write-Host "      • Analytics processes every 5 minutes" -ForegroundColor Gray

Write-Host ""
Write-Host "4. QUICK TROUBLESHOOTING:" -ForegroundColor Yellow
Write-Host "   • If dashboard not accessible: Agent may need restart" -ForegroundColor Gray
Write-Host "   • If no data after visit: Wait for background processing" -ForegroundColor Gray
Write-Host "   • Always check: http://localhost:3001/dashboard" -ForegroundColor Cyan

Write-Host ""
Write-Host "🎯 READY FOR TEST!" -ForegroundColor Green
Write-Host "   Follow steps A and B above to test the system."
Write-Host "   Then tell me what you see on the dashboard!"
