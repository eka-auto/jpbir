Write-Host "🔍 QUICK HOSTING CHECK FOR jaytibirthday.in" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "🎯 CHECKING DOMAIN..."
try {
    $result = nslookup jaytibirthday.in 2>$null
    if ($result -match "Address:") {
        Write-Host "✅ Domain is resolving (Hosting likely active)" -ForegroundColor Green
        Write-Host ""
        Write-Host "📊 DNS LOOKUP RESULTS:" -ForegroundColor White
        $result | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
    } else {
        Write-Host "❓ Domain not resolving or no DNS records" -ForegroundColor Yellow
        Write-Host "   This could mean:" -ForegroundColor Gray
        Write-Host "   - No hosting configured" -ForegroundColor Gray
        Write-Host "   - DNS propagation delay" -ForegroundColor Gray
        Write-Host "   - Domain not pointing to hosting" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Could not check domain" -ForegroundColor Red
}

Write-Host ""

Write-Host "🎯 QUICK WEBSITE CHECK:" -ForegroundColor White
Write-Host "   Visit: https://jaytibirthday.in" -ForegroundColor Cyan
Write-Host "   Does it show your website?" -ForegroundColor Gray

Write-Host ""

Write-Host "🎯 GODADDY ACCOUNT CHECK:" -ForegroundColor White
Write-Host "   1. Login to: https://www.godaddy.com" -ForegroundColor Gray
Write-Host "   2. Go to 'My Products'" -ForegroundColor Gray
Write-Host "   3. Check jaytibirthday.in status" -ForegroundColor Gray

Write-Host ""

Write-Host "🔧 IF NO HOSTING:" -ForegroundColor Yellow
Write-Host "   - Purchase hosting from GoDaddy ($50-100/year)" -ForegroundColor Gray
Write-Host "   - OR use free hosting alternatives" -ForegroundColor Gray

Write-Host ""

Write-Host "✅ IF HOSTING ACTIVE:" -ForegroundColor Green
Write-Host "   - Upload jaytibirthday-analytics.js" -ForegroundColor Gray
Write-Host "   - Add HTML code" -ForegroundColor Gray
Write-Host "   - Your analytics will work!" -ForegroundColor Gray
