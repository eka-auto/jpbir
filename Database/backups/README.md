# Database Backup - Production Data Export

**Date:** 2026-09-10  
**Purpose:** Backup all production data before migration

## 📦 Current Production Data

### Firestore Devices (eka-agent database)
```bash
curl -s "https://jpbirrestructured.vercel.app/api/jp-devices?key=<redacted - rotated 2026-09-12>" > firestore-devices-backup.json
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

## Loading the telemetry backup into Neon

`dynamodb-telemetry-backup.json` is the only surviving copy of those 23 events.
`Backend/db-push.js` mirrors **live** DynamoDB into Postgres, so it cannot help
once the table is gone or its credentials are rotated away. The file itself is
imported instead:

```bash
npm run db:import-backup                       # Database/backups/dynamodb-telemetry-backup.json
node Database/scripts/import-telemetry-backup.mjs path/to/other-backup.json
```

It unmarshals DynamoDB's typed JSON into the camelCase shape `jp-track` writes
and inserts through `Backend/lib/warehouse.js`, so the rows get the same id,
site and rollup treatment as the live path. Inserts are `ON CONFLICT DO NOTHING`
and the `visitors` / `sessions` rollups are recomputed afterwards, so running it
twice is a no-op. Rows land with `source_system = 'dynamodb-backup'`, which is
what the dashboard's Health page groups on.

## 🔄 Migration Plan

### Step 1: Create Backup
```bash
# Export Firestore devices
curl -s "https://jpbirrestructured.vercel.app/api/jp-devices?key=<redacted - rotated 2026-09-12>" | python -m json.tool > db-backup/firestore-devices-2026-09-10.json

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
