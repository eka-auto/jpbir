# Stale Firestore DB Fix Plan - Progress

Generated: 2026-09-03  
Audit Script: `stale_db_audit.py`  
Detailed Report: `stale_db_audit_report.json`

---

## Summary

| Status | Count | Action |
|--------|-------|--------|
| **SAFE_TO_DELETE** | 161 | Delete immediately |
| **NEEDS_FIX** | 345 | Update DB references to `eka-agent` |
| **NEEDS_REVIEW** | 428 | Case-by-case review |
| **KEEP_AS_IS** | 106 | Already correct (S24 canonical) |
| **KEEP** | 5541 | No stale references |

**Total scanned:** 6,581 files across 4 trees

---

## Progress Log

### ✓ Phase 2a: Config Defaults (COMPLETE)

**Fixed `claude_sdk_unified_config.py` in all 4 trees:**

| Tree | Lines Fixed | Change |
|------|-------------|--------|
| `github-repos/eka-agent` | 42, 124 | `database_id="swarn"` → `"eka-agent"` |
| `Go4Garage/eka-agent-clean` | 42, 124 | Same |
| `Downloads/eka-agent-main` | 42, 124 | Same |
| `Go4Garage/Eka Runner` | 41 | Same (shorter file) |

**Impact:** All new Python scripts using this config will now default to `eka-agent` instead of `swarn`.

---

### ✓ Phase 2b: Firebase Config Files (COMPLETE)

**Deleted 16 stale config files:**
- `config/firebase/firebase.eka-validation.json` × 4 trees
- `config/firebase/firebase.eka-llm.json` × 4 trees
- `config/firebase/firebase.swarn.json` × 4 trees
- `config/firebase/firebase.jarvis.json` × 4 trees

**Updated 16 config files:**
- `firebase.json` × 4 trees (updated database + hosting target)
- `DEPLOYMENT_CONFIG.json` × 4 trees
- `isolated_config.json` × 4 trees
- `.vscode/settings.json` × 4 trees

**Changes made:**
- All `"database": "<stale-db>"` → `"database": "eka-agent"`
- All `"target": "<stale-db>"` → `"target": "eka-agent"`
- All `"defaultDatabase": "<stale-db>"` → `"defaultDatabase": "eka-agent"`

**Verified:** Root `firebase.json` now correctly uses:
```json
{
  "firestore": [{
    "database": "eka-agent",
    ...
  }],
  "hosting": [{
    "target": "eka-agent",
    ...
  }]
}
```

---

## Remaining Phases

### Phase 1: Safe Deletions (161 files)

**DESTRUCTIVE scripts** (~28 files):
- `factory_reset_s24_ultra_all_databases.py` × 4
- `execute_armed_wipe_queue.py` × 4
- Other wipe/factory reset scripts

**BUILD/SCRATCH** (~133 files):
- `.tmp\*.py` × 12
- `scratch\*.py` × 20
- `android\app\build\**` × 99 (Eka Runner only)

### Phase 3: Case-by-Case Review (428 NEEDS_REVIEW files)

OPS scripts, documentation, tests - needs human review

---

## vscode-office AI Integration

Use the AI Polish feature to batch-fix NEEDS_FIX files:

**Prompt template:**
```
This file references stale Firestore databases (eka-validation, eka-llm, eka-runner, swarn, jarvis).
The canonical database is now "eka-agent".

Identify all lines that reference these databases and suggest edits to use "eka-agent" instead.
Flag any lines where the change would break functionality.
```

---

## Next Actions

**Choose one:**
- **A** — Delete the 161 SAFE_TO_DELETE files (safe cleanup, reduces noise)
- **B** — Review a sample of NEEDS_REVIEW files with AI
- **C** — Something else

---

## Files Created This Session

- `stale_db_audit.py` — Audit script that classified 6,581 files
- `stale_db_audit_report.json` — Detailed JSON report (43K lines)
- `stale_db_fix_dashboard.html` — Interactive dashboard
- `_verify_config_fix.py` — Verification script
- `phase2b_fix_configs.py` — Phase 2b batch fix script
- `STALE_DB_FIX_PROGRESS.md` — This progress document
