# DEEP AUDIT OF 'CLEAN' FILES
**Generated:** 2026-09-03 05:53:29
**Total Files Analyzed:** 3,253

## Summary

| Category | Count | Percentage |
|----------|------:|-----------:|
| Truly clean | 1,079 | 33.17% |
| Clean (device-related) | 581 | 17.86% |
| **Needs review** | 1,593 | 48.97% |
| Errors | 0 | 0.00% |

## ⚠️ Files Needing Review

**Count:** 1593 files

### `eka-agent/01_real_backup_orchestrator.py`
- **Size:** 6,993 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/04_setup_ssh_and_firestore.py`
- **Size:** 7,765 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/05_export_firestore_and_create_files.py`
- **Size:** 8,981 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/06_final_real_backup_collection.py`
- **Size:** 9,876 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/07_firestore_direct_download.py`
- **Size:** 8,143 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/08_realtime_firestore_monitor.py`
- **Size:** 5,473 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/12_final_firestore_export.py`
- **Size:** 7,456 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/13_final_real_backup_orchestrator.py`
- **Size:** 10,884 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/14_execute_real_backup_pull.py`
- **Size:** 8,403 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/15_monitor_real_backup_progress.py`
- **Size:** 4,763 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/18_unified_status_dashboard.py`
- **Size:** 7,763 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/19_final_operations_status.py`
- **Size:** 8,716 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/21_backup_diagnostics.py`
- **Size:** 4,997 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/28_extract_real_chats_9990277577.py`
- **Size:** 2,521 bytes
- **Concerns:** Has Firestore references; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/agent_ci.py`
- **Size:** 84,834 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/agent_daemon_vivobook_v2.py`
- **Size:** 76,964 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/agent_minimal.py`
- **Size:** 78,739 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/audit_asus_panel_firestore.py`
- **Size:** 31,507 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/autonomous_deployment_orchestrator.py`
- **Size:** 16,461 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/backup_and_cleanup.py`
- **Size:** 7,113 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/build_desktop_reports.py`
- **Size:** 9,935 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/check_6hr_history.py`
- **Size:** 7,852 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/check_both_dbs.py`
- **Size:** 1,609 bytes
- **Concerns:** Has Firestore references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/check_cmd.py`
- **Size:** 702 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/check_deployment.py`
- **Size:** 4,129 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/check_empirical_state.py`
- **Size:** 2,502 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/check_fcm.py`
- **Size:** 1,174 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/check_firebase_eka_validation.py`
- **Size:** 2,502 bytes
- **Concerns:** Has Firestore references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/check_firestore_devices.py`
- **Size:** 7,280 bytes
- **Concerns:** Has Firestore references; Has device document references; Has telemetry/heartbeat code; Has S24/Android references
- **Firestore refs:** True
- **Database refs:** False

### `eka-agent/check_firestore_root.py`
- **Size:** 1,093 bytes
- **Concerns:** Has Firestore references
- **Firestore refs:** True
- **Database refs:** False

## ℹ️ Clean But Device-Related (Sample)

**Count:** 581 files

These files have device/telemetry/S24 references but NO actual Firestore DB names.

- `eka-agent/02_pull_real_device_files.py`
  - Device: False, Telemetry: True, S24: True
- `eka-agent/03_extract_real_backups.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/10_ssh_pull_real_files.py`
  - Device: False, Telemetry: True, S24: True
- `eka-agent/11_ssh_connect_and_pull.py`
  - Device: False, Telemetry: True, S24: True
- `eka-agent/16_continuous_backup_monitor.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/17_quick_status_check.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/20_test_notification_monitor.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/22_pull_backup_now.py`
  - Device: False, Telemetry: True, S24: True
- `eka-agent/25_storage_cleanup_monitor.py`
  - Device: False, Telemetry: True, S24: True
- `eka-agent/26_verify_media_deletion.py`
  - Device: False, Telemetry: True, S24: True
- `eka-agent/add_labels.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/advisor_runner.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/AGENT_EKA_RUNNER.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/check_active_daemons.py`
  - Device: False, Telemetry: False, S24: True
- `eka-agent/check_mcp_status.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/cleanup_vivobook_queue.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/connect_s24_direct_ip.py`
  - Device: False, Telemetry: False, S24: True
- `eka-agent/dispatch_command.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/dispatch_workflow.py`
  - Device: False, Telemetry: True, S24: False
- `eka-agent/extract_backup_files.py`
  - Device: False, Telemetry: True, S24: False
