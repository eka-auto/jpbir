# Database Backup - Production Data Export

**Date:** 2026-09-10  
**Purpose:** Backup all production data before migration

## 📦 Current Production Data

### Firestore Devices (eka-agent database)
```bash
curl -s "https://jpbirrestructured.vercel.app/api/jp-devices?key=1a3272549f4b0daee7c59d86babf31dd" > firestore-devices-backup.json
```

**Devices to backup:**
1. g4g-lenovo-laptop (online, live)
2. eka-cloud-sandbox (online, not live)
3. jayti-asus-vivobook (offline)
4. samsung-s24-ultra (offline, 2 commands queued)
5. g4g-laptop (offline)

### DynamoDB Telemetry (jaytipargal_telemetry table)
```bash
aws dynamodb scan --table-name jaytipargal_telemetry --region us-west-2 > dynamodb-telemetry-backup.json
```

**Item count:** 23 items

## 🔄 Migration Plan

### Step 1: Create Backup
```bash
# Export Firestore devices
curl -s "https://jpbirrestructured.vercel.app/api/jp-devices?key=1a3272549f4b0daee7c59d86babf31dd" | python -m json.tool > db-backup/firestore-devices-2026-09-10.json

# Export DynamoDB items
aws dynamodb scan --table-name jaytipargal_telemetry --region us-west-2 --output json > db-backup/dynamodb-telemetry-2026-09-10.json
```

### Step 2: Verify Backup
- [ ] All 5 devices exported
- [ ] All 23 telemetry items exported
- [ ] JSON files are valid

### Step 3: Deploy New Version
- Keep existing databases (no migration needed)
- Deploy new code with same environment variables
- Verify all endpoints work

### Step 4: Test New Deployment
- [ ] `/api/verify-db` passes
- [ ] `/api/jp-devices` returns all 5 devices
- [ ] `/api/jp-stats` returns telemetry data
- [ ] All UI pages load correctly

### Step 5: Remove Old Deployment
```bash
vercel rm <old-deployment-id> --yes
```

### Step 6: Final Verification
- [ ] Production URL serves new deployment
- [ ] All data intact
- [ ] All endpoints working
