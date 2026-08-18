Write-Host "✅ GODADDY UPLOAD VERIFICATION" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

Write-Host "🎯 FILES TO UPLOAD:" -ForegroundColor White
Write-Host "   Main file: jaytibirthday-analytics.js (7.52 KB)" -ForegroundColor Gray
Write-Host "   Guide: GODADDY_UPLOAD_GUIDE.txt" -ForegroundColor Gray
Write-Host "   Quick card: GODADDY_QUICK_CARD.txt" -ForegroundColor Gray
Write-Host ""

Write-Host "🚀 QUICK STEPS FOR GODADDY:" -ForegroundColor White
Write-Host "   1. Login to: https://www.godaddy.com" -ForegroundColor Gray
Write-Host "   2. Find: jaytibirthday.in in 'My Products'" -ForegroundColor Gray
Write-Host "   3. Click: 'Manage' → 'File Manager'" -ForegroundColor Gray
Write-Host "   4. Navigate to: public_html/assets/js/" -ForegroundColor Gray
Write-Host "   5. Upload: jaytibirthday-analytics.js" -ForegroundColor Cyan
Write-Host "   6. Add HTML code from HTML_CODE_TO_ADD.txt" -ForegroundColor Cyan
Write-Host ""

Write-Host "✅ ANALYTICS AGENT STATUS:" -ForegroundColor White
$agentRunning = netstat -ano | findstr :3001
if ($agentRunning) {
    Write-Host "   ✅ Agent is RUNNING on port 3001" -ForegroundColor Green
} else {
    Write-Host "   ❌ Agent is NOT running" -ForegroundColor Red
}

Write-Host ""

Write-Host "🎉 READY FOR UPLOAD!" -ForegroundColor Green
Write-Host "Follow the GoDaddy instructions and upload the file."
Write-Host "Your website will track visitors immediately after upload."
