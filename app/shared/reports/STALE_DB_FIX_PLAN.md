# Stale Firestore DB Fix Plan

Generated: 2026-09-03  
Audit Script: `stale_db_audit.py`  
Detailed Report: `stale_db_audit_report.json` (43K lines)

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

## Phase 1: Safe Deletions (161 files)

### DESTRUCTIVE scripts (targeting dead DBs)
These will fail if run today — safe to delete:

- `factory_reset_s24_ultra_all_databases.py` × 4 trees
- `execute_armed_wipe_queue.py` × 4 trees
- `execute_pure_engineering_factory_reset.py` × 4 trees
- `execute_real_device_hardware_wipe*.py` × 4 trees
- `factory_reset_s24_eka_validation_fast.py` × 4 trees
- `monitor_wipe_completion_eka_validation.py` × 4 trees
- `check_wipe_status_once.py` × 4 trees

**Total DESTRUCTIVE:** ~28 files

### BUILD/SCRATCH intermediates
Auto-generated or temporary working files:

- `.tmp\*.py` × 3 files × 4 trees = 12 files
- `scratch\*.py` × 5 files × 4 trees = 20 files
- `android\app\build\**` × 99 files (Eka Runner only)

**Total BUILD/SCRATCH:** ~133 files

---

## Phase 2: Config Fixes (345 NEEDS_FIX files)

### High-priority config files

These need DB references updated from stale → `eka-agent`:

1. **`claude_sdk_unified_config.py`** × 5 copies
   - Line 42: `database_id="swarn"` → `database_id="eka-agent"`
   - Line 124: `FIRESTORE_DB` env fallback same change

2. **`config/firebase/firebase.<db>.json`** × 4 trees × 4 files
   - `firebase.eka-llm.json`
   - `firebase.eka-validation.json`
   - `firebase.jarvis.json`
   - `firebase.swarn.json`

3. **`firebase.json`** × multiple copies
   - Update `"database": "eka-validation"` → `"database": "eka-agent"`

4. **`DEPLOYMENT_CONFIG.json`**, `isolated_config.json`

---

## Phase 3: Case-by-Case Review (428 NEEDS_REVIEW files)

### OPS scripts (~150 files)
Each needs review:
- Does this script still make sense?
- Should it target `eka-agent` now?
- Or is it obsolete and should be deleted?

### Documentation (~100 files)
- Update or archive
- Keep as historical record?

### TEST files (~18 files)
- Fix alongside code changes
- Or delete if testing obsolete functionality

---

## Phase 4: S24 Canonical (106 KEEP_AS_IS files)

These already use `eka-agent` correctly:

- `devices\s24\firestore_mcp.py` ✓
- `devices\s24\wa_export_daemon.py` ✓
- `devices\s24\mcp_guard.py` ✓
- `devices\s24\mcp_health_gate.py` ✓
- Related S24 docs ✓

---

## Execution Order

```
1. Delete SAFE_TO_DELETE (161 files)
   └─→ Reduces noise, safe cleanup

2. Fix high-priority CONFIG files (~20 files)
   └─→ claude_sdk_unified_config.py
   └─→ firebase.json variants
   └─→ Config defaults

3. Review OPS scripts case-by-case
   └─→ Keep + fix OR delete

4. Update documentation
   └─→ Accuracy pass

5. Verify scripts run against eka-agent
   └─→ Smoke test key scripts
```

---

## vscode-office AI Integration

Use the AI Polish feature in your vscode-office fork to:

1. **Batch load NEEDS_FIX files** in the editor
2. **Ask AI to identify** exact lines with stale DB references
3. **Generate suggested edits** inline
4. **Apply fixes** after review

Example prompt for AI:
```
This file references stale Firestore databases (eka-validation, eka-llm, eka-runner, swarn, jarvis).
The canonical database is now "eka-agent".

Identify all lines that reference these databases and suggest edits to use "eka-agent" instead.
Flag any lines where the change would break functionality.
```

---

## Risk Assessment

| Category | Risk | Mitigation |
|----------|------|------------|
| DESTRUCTIVE deletion | Low | Scripts target dead DBs — already fail |
| BUILD/SCRATCH deletion | None | Auto-generated intermediates |
| CONFIG edits | Medium | Test after each edit |
| OPS script fixes | High | Case-by-case review required |

---

## Next Steps

**Option A (Recommended):** Start with Phase 1 — delete the 161 SAFE_TO_DELETE files  
**Option B:** Jump to Phase 2 — fix the ~20 high-priority config files  
**Option C:** Use vscode-office AI to audit a sample of NEEDS_FIX files first

Which phase should we start with?
