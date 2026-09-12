# COMPREHENSIVE FILE AUDIT REPORT
**Generated:** 2026-09-03 06:12:25
**Total Files Audited:** 3,253

## Executive Summary

| Status | Count | Percentage |
|--------|------:|-----------:|
| NEEDS_FIX | 0 | 0.00% |
| FALSE_POSITIVE | 220 | 6.76% |
| CORRECT (uses eka-agent) | 918 | 28.22% |
| CLEAN (no DB refs) | 2,115 | 65.02% |
| ERROR | 0 | 0.00% |

## Per-Tree Breakdown

| Tree | NEEDS_FIX | FALSE_POS | CORRECT | CLEAN | ERROR | Total |
|------|----------:|----------:|--------:|------:|------:|------:|
| eka-agent | 0 | 52 | 218 | 399 | 0 | 669 |
| eka-agent-clean | 0 | 52 | 219 | 484 | 0 | 755 |
| eka-agent-main | 0 | 52 | 218 | 399 | 0 | 669 |
| Eka Runner | 0 | 64 | 263 | 833 | 0 | 1,160 |

## ℹ️ False Positives (Not Actual DB Refs)

**Count:** 220 files

- Panel type refs only: 0 files
- Document ID refs only: 4 files
- GitHub repo refs only: 217 files
- URL refs only: 0 files

## ✅ Files Using Canonical eka-agent

**Count:** 918 files

## ✓ Files With No DB References

**Count:** 2115 files

## 📋 Recommendations

2. **REVIEW:** 220 false positives confirmed (panel types, doc IDs, URLs, GitHub repos)
3. **VERIFY:** 918 files correctly use `eka-agent`
4. **CLEAN:** 2115 files have no DB references (safe)
