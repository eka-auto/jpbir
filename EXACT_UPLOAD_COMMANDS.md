# EXACT UPLOAD COMMANDS FOR jaytibirthday.in
# ===========================================

## ✅ REPOSITORY FOUND:
- Name: urgaa-eka/jaytibirthday-site
- Public repository
- Likely hosting: https://jaytibirthday.in

## 🚀 EXACT STEPS TO UPLOAD:

### Step 1: Clone the repository
```powershell
cd "C:\Users\abcom\jpbir"
gh repo clone urgaa-eka/jaytibirthday-site
cd jaytibirthday-site
```

### Step 2: Check current structure
```powershell
# List all files
dir

# Check for assets/js folder
dir assets\js 2>nul || echo "Folder doesn't exist"
```

### Step 3: Create folder structure if needed
```powershell
# Create assets/js folder if it doesn't exist
mkdir -p assets\js
```

### Step 4: Copy the analytics file
```powershell
# Copy from parent directory
copy "..\jaytibirthday-analytics.js" "assets\js\"
```

### Step 5: Check HTML file
```powershell
# Find main HTML file
dir *.html

# Check if index.html exists
dir index.html 2>nul && echo "Found index.html"
```

### Step 6: Add HTML code
Edit the HTML file (likely index.html) and add this line BEFORE `</head>`:
```html
<script async defer src="/assets/js/jaytibirthday-analytics.js"></script>
```

### Step 7: Commit and push
```powershell
git add .
git commit -m "Add visitor analytics tracking for jaytibirthday.in"
git push
```

## ⏱️ DEPLOYMENT:
- GitHub Pages deploys automatically
- Takes 1-2 minutes
- Website updates: https://jaytibirthday.in

## ✅ VERIFICATION:
After push:
1. Visit: https://jaytibirthday.in
2. Check: http://localhost:3001/dashboard
3. Email: ekaaiurgaa@gmail.com (daily reports)

## 🎯 ONE-LINER TO CHECK:
```powershell
# After deployment, verify file is accessible
curl -I https://jaytibirthday.in/assets/js/jaytibirthday-analytics.js
```
Should return HTTP 200 OK.
