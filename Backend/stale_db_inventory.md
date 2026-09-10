# Stale Firestore DB Reference Inventory (v2 — comprehensive re-scan)

Generated 2026-09-03 from 4 eka-agent trees. Re-scan caught 214 additional paths that v1 missed by excluding `.json/.yaml/.md/.txt` files, `tests/`, `scratch/`, `.tmp/`, and `_backup` paths.

## Summary

- **423 unique paths** contain references to non-existent Firestore databases (`eka-validation`, `eka-llm`, `eka-runner`, `swarn`, `jarvis`).
- **1078 file instances** across the 4 trees.
- Most files appear in all 4 trees (these are copies).

## Tree roots scanned


| Leaf name         | Full path                                                   | Hits |
| ------------------- | ------------------------------------------------------------- | ------ |
| `eka-agent`       | `C:\Users\abcom\github-repos\eka-agent`                     | 240  |
| `eka-agent-clean` | `C:\Users\abcom\Go4Garage\eka-agent-clean`                  | 242  |
| `eka-agent-main`  | `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main` | 240  |
| `Eka Runner`      | `C:\Users\abcom\Go4Garage\Eka Runner`                       | 356  |

## Patterns matched

- `plain` (lowercase, hyphen-separated): eka-validation, eka-llm, eka-runner, swarn, jarvis
- `uppercase`: EKA-VALIDATION, EKA-LLM, EKA-RUNNER, SWARN, JARVIS
- No new files found with underscore variants (`eka_validation` etc.)

## File categorization


| Category        | Count of unique paths | Description                                                                        |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| BACKUP          | 9                     | Backup/snapshot files (`.json`/`.txt` data dumps, `_backup*` paths)                |
| BUILD           | 99                    | Android build intermediates (`android/app/build/*`) — auto-generated              |
| CONFIG          | 37                    | Config files (`.json`, `.yaml`, `.toml`)                                           |
| DESTRUCTIVE     | 19                    | Destructive ops scripts targeting non-existent DBs (factory_reset, wipe, etc.)     |
| DOC             | 23                    | Markdown documentation                                                             |
| OPS             | 154                   | Orchestrator/devops scripts — need case-by-case review                            |
| PANEL_SUBSYSTEM | 53                    | `Eka Runner\eka-llm\*` panel tooling — separate subsystem                         |
| S24_CANONICAL   | 4                     | S24 daemon/MCP/Firestore client — already correct, matches are comments/fallbacks |
| SCRATCH         | 8                     | Scratch/`.tmp/` working files — typically safe to delete                          |
| TEST            | 8                     | Test files (`tests/` or `test_*`)                                                  |
| TXT             | 9                     | Plain text data/log files                                                          |

## Tree-by-tree breakdown

### `eka-agent` (240 files)

**BACKUP** (7 files):

- `01_real_backup_orchestrator.py`
- `06_final_real_backup_collection.py`
- `13_final_real_backup_orchestrator.py`
- `execute_backup_and_save.py`
- `s24_dump_sim.json`
- `set_vivobook_emergency_backup.py`
- `verify_backup_cleanup.py`

**CONFIG** (27 files):

- `.codex\config.toml`
- `.github\workflows\collect-vivobook-logs.yml`
- `.github\workflows\ekarunnernew-deploy.yml`
- `.github\workflows\runner-health-check.yml`
- `.vscode\settings.json`
- `01-agent\firebase.json`
- `02-audit\firebase.json`
- `04-device\firebase.json`
- `06-extract\firebase.json`
- `07-firebase\firebase.json`
- `10-monitor\firebase.json`
- `11-s24\firebase.json`
- `15-utility\firebase.json`
- `DEPLOYMENT_CONFIG.json`
- `apphosting.yaml`
- `cloudbuild-backends.yaml`
- `config\devices.json`
- `config\firebase\firebase.eka-llm.json`
- `config\firebase\firebase.eka-validation.json`
- `config\firebase\firebase.jarvis.json`
- `config\firebase\firebase.swarn.json`
- `docker-compose.yml`
- `firebase.json`
- `functions\firebase.json`
- `isolated_config.json`
- `package-lock.json`
- `web-app\firebase.json`

**DESTRUCTIVE** (19 files):

- `apply_ci_fixes_jarvis.ps1`
- `check_firebase_eka_validation.py`
- `clean_eka_validation_mock_data.py`
- `clean_jarvis_db.py`
- `deploy_eka_validation.ps1`
- `execute_armed_wipe_queue.py`
- `execute_isolated_eka_validation_sync.py`
- `execute_pure_engineering_factory_reset.py`
- `execute_real_device_hardware_wipe.py`
- `execute_real_device_hardware_wipe_fast.py`
- `factory_reset_s24_eka_validation_fast.py`
- `factory_reset_s24_ultra_all_databases.py`
- `live_sync_eka_validation_device.py`
- `monitor_jarvis.ps1`
- `monitor_wipe_completion_eka_validation.py`
- `notification_sync_eka_validation.py`
- `purge_and_fresh_sync_eka_validation.py`
- `scripts\sync_to_eka_llm.js`
- `sync_authentic_data_to_eka_validation.py`

**DOC** (21 files):

- `.agents\skills\run-eka-panel\SKILL.md`
- `ANTIGRAVITY_JULY2_HISTORY_LEADS.md`
- `DEPLOYMENT_GUIDE.md`
- `DEPLOYMENT_READY_CHECKLIST.md`
- `DEPLOYMENT_SCOPE.md`
- `DEPLOYMENT_STATUS_REPORT.md`
- `EKARUNNERNEW_DEPLOYMENT_SUMMARY.md`
- `FINAL_PRODUCTION_CHECKLIST.md`
- `FIREBASE_CONFIG_GUIDE.md`
- `FIREBASE_DEPLOYMENT_MANIFEST.md`
- `FIRESTORE_CLEANUP_REPORT.md`
- `FIRESTORE_E2E_AUDIT_REPORT.md`
- `GEMINI.md`
- `IMMEDIATE_DEPLOYMENT_GUIDE.md`
- `JARVIS_PANEL_COMPLETE.md`
- `MCP_STATUS_REPORT.md`
- `PANEL_LOGIN_GUIDE.md`
- `PRODUCTION_DEPLOYMENT_GUIDE.md`
- `SECURITY-MATRIX.md`
- `docs\dr-mcp-status-contract.md`
- `docs\single-repo-e2e-audit.md`

**OPS** (146 files):

- `04_setup_ssh_and_firestore.py`
- `05_export_firestore_and_create_files.py`
- `07_firestore_direct_download.py`
- `08_realtime_firestore_monitor.py`
- `12_final_firestore_export.py`
- `AGENT_EKA_RUNNER.py`
- `E2E_DEPLOYMENT_TESTS.py`
- `add_labels.py`
- `agent_ci.py`
- `agent_minimal.py`
- `apply_ci_fixes.ps1`
- `apply_ci_fixes_all.ps1`
- `auto_restart_agent.ps1`
- `autonomous_deployment_orchestrator.py`
- `backup_and_cleanup.py`
- `bootstrap.sh`
- `check_both_dbs.py`
- `check_cmd.py`
- `check_empirical_state.py`
- `check_firestore_devices.py`
- `check_firestore_root.py`
- `check_github_runner_status.py`
- `check_wipe_status_once.py`
- `check_workflow_runs.py`
- `claude_sdk_unified_config.py`
- `clean_stale_db_metadata.py`
- `cleanup_firestore_databases.py`
- `connect_and_sync_devices.py`
- `connect_ssh_and_execute_queue.py`
- `continuous_monitor.py`
- `create_s24_devices.py`
- `create_whatsapp_export_folder.py`
- `deploy.sh`
- `deploy_agents_to_devices.sh`
- `deploy_autorestart_to_vivobook.ps1`
- `deploy_backends.py`
- `deploy_cloud_run.sh`
- `deploy_isolated.ps1`
- `device_sync_monitor.py`
- `device_worker_contract.py`
- `direct_device_commands.py`
- `dispatch_command.py`
- `dispatch_daemon.py`
- `dispatch_wa_workflows.py`
- `dispatch_workflow.py`
- `eka_master_deploy.ps1`
- `enable_all_mcp_servers.ps1`
- `execute_device_exports.py`
- `export_network_details.py`
- `export_wifi_details.py`
- `final_deployment_go.py`
- `final_pipeline_check.py`
- `final_verification_report.py`
- `fix_auth.js`
- `fix_ids.py`
- `force_green.py`
- `force_online.py`
- `get_device_ip.py`
- `get_device_ip_from_firestore.py`
- `get_job_logs.py`
- `get_job_logs_part2.py`
- `get_job_output.py`
- `get_latest_run_jobs.py`
- `get_workflow_logs.py`
- `google-takeout-mcp\oauth_gt.py`
- `google_takeout_export.py`
- `inspect_and_execute_all_queues.py`
- `install_runner.ps1`
- `keep_alive.ps1`
- `live_extract_wa_ankush.py`
- `live_screen_server.py`
- `master_setup.ps1`
- `mcp_server.py`
- `migrate_s24.py`
- `monitor_all_sdks.py`
- `monitor_export_progress.py`
- `monitor_production.py`
- `monitor_run.py`
- `notification_sync.py`
- `notification_sync_isolated.py`
- `notification_sync_launcher.py`
- `persistent_device_connection.py`
- `production_execution.py`
- `push_adb_check.py`
- `push_and_update_device.py`
- `push_chats_to_vivobook.py`
- `push_debug_cmd.py`
- `push_exports_to_firestore.py`
- `push_install.py`
- `push_s24_setup_via_vivobook.py`
- `push_urgent_wa_command.py`
- `push_wa_extract_cmd.py`
- `queue_bootstrap.py`
- `queue_ssh_enable.py`
- `quick_eka_val_check.py`
- `read_wa_exports.py`
- `read_wa_scripts.py`
- `reconnect_runner.ps1`
- `restore_asus_jayat_runner.ps1`
- `sanitize_s24_direct_cloud_state.py`
- `scripts\audit_runtime.py`
- `scripts\cleanup_legacy_lenovo_state.py`
- `scripts\export_existing_data.py`
- `scripts\export_takeout_location.py`
- `scripts\imap_location_sync.py`
- `scripts\push_live_heartbeat.js`
- `scripts\queue_runner_activation.py`
- `scripts\run_asus_vivobook_enrollment.ps1`
- `scripts\run_wa_drive.ps1`
- `scripts\run_wa_drive_upload.ps1`
- `scripts\s24_sync_once.ps1`
- `scripts\verify_e2e.py`
- `scripts\wa_extract_upload_drive.py`
- `scripts\watchdog_check.js`
- `set_panel_password.py`
- `setup_permanent_connection.py`
- `show_s24_success.py`
- `silent_force.py`
- `silent_setup.ps1`
- `silent_wake_asus.py`
- `simulate_s24_telemetry.py`
- `simulate_vivobook_telemetry.py`
- `start_stream_job.ps1`
- `sustained_operations.py`
- `sustained_telemetry_daemon.py`
- `sync_device_metadata.py`
- `sync_device_now.py`
- `temp_push.py`
- `termux\boot\start_s24_direct_cloud.sh`
- `termux\install_s24_direct_cloud.sh`
- `termux_ssh_redeploy.py`
- `trigger_correct_wa_export.py`
- `trigger_extract_asus.py`
- `trigger_s24_full_export.py`
- `trigger_validate_s24.py`
- `trigger_vivobook.py`
- `trigger_vivobook_s24_wake_bridge.py`
- `update_app.py`
- `upload_desktop_chats_to_firestore.py`
- `verify_operations.py`
- `verify_panel_data_sources.py`
- `verify_production_deployment.py`
- `verify_sync_complete.py`
- `vivobook_bootstrap.ps1`
- `watch_and_fetch_results.py`
- `web-app\src\utils.ts`

**S24_CANONICAL** (4 files):

- `devices\s24\README.md`
- `devices\s24\firestore_mcp.py`
- `devices\s24\wa_export_daemon.py`
- `functions\ekarunnerf\index.js`

**SCRATCH** (8 files):

- `.tmp\clean_and_run.py`
- `.tmp\resolve_s24.py`
- `.tmp\watch_and_connect_s24.py`
- `scratch\check_swarn_status.py`
- `scratch\list_all_devices.py`
- `scratch\push_agent_patch.py`
- `scratch\push_debug_calllog.py`
- `scratch\run_local_s24_setup.py`

**TEST** (8 files):

- `scratch\test_github_dispatch.py`
- `tests\test_claude_agent_sdk.py`
- `tests\test_device_worker_contract.py`
- `tests\test_dr_mcp_status.py`
- `tests\test_mcp_guard.py`
- `tests\test_s24_device_id_routes.py`
- `tests\test_s24_relay.py`
- `tests\test_verify_e2e.py`

### `eka-agent-clean` (242 files)

**BACKUP** (7 files):

- `01_real_backup_orchestrator.py`
- `06_final_real_backup_collection.py`
- `13_final_real_backup_orchestrator.py`
- `execute_backup_and_save.py`
- `s24_dump_sim.json`
- `set_vivobook_emergency_backup.py`
- `verify_backup_cleanup.py`

**CONFIG** (28 files):

- `.codex\config.toml`
- `.github\workflows\ekarunnernew-deploy.yml`
- `.github\workflows\extract-asus-data.yml`
- `.github\workflows\runner-health-check.yml`
- `.github\workflows\runtime-verify.yml`
- `.vscode\settings.json`
- `01-agent\firebase.json`
- `02-audit\firebase.json`
- `04-device\firebase.json`
- `06-extract\firebase.json`
- `07-firebase\firebase.json`
- `10-monitor\firebase.json`
- `11-s24\firebase.json`
- `15-utility\firebase.json`
- `DEPLOYMENT_CONFIG.json`
- `apphosting.yaml`
- `cloudbuild-backends.yaml`
- `config\devices.json`
- `config\firebase\firebase.eka-llm.json`
- `config\firebase\firebase.eka-validation.json`
- `config\firebase\firebase.jarvis.json`
- `config\firebase\firebase.swarn.json`
- `docker-compose.yml`
- `firebase.json`
- `functions\firebase.json`
- `isolated_config.json`
- `package-lock.json`
- `web-app\firebase.json`

**DESTRUCTIVE** (19 files):

- `apply_ci_fixes_jarvis.ps1`
- `check_firebase_eka_validation.py`
- `clean_eka_validation_mock_data.py`
- `clean_jarvis_db.py`
- `deploy_eka_validation.ps1`
- `execute_armed_wipe_queue.py`
- `execute_isolated_eka_validation_sync.py`
- `execute_pure_engineering_factory_reset.py`
- `execute_real_device_hardware_wipe.py`
- `execute_real_device_hardware_wipe_fast.py`
- `factory_reset_s24_eka_validation_fast.py`
- `factory_reset_s24_ultra_all_databases.py`
- `live_sync_eka_validation_device.py`
- `monitor_jarvis.ps1`
- `monitor_wipe_completion_eka_validation.py`
- `notification_sync_eka_validation.py`
- `purge_and_fresh_sync_eka_validation.py`
- `scripts\sync_to_eka_llm.js`
- `sync_authentic_data_to_eka_validation.py`

**DOC** (22 files):

- `.agents\skills\run-eka-panel\SKILL.md`
- `ANTIGRAVITY_JULY2_HISTORY_LEADS.md`
- `DEPLOYMENT_GUIDE.md`
- `DEPLOYMENT_READY_CHECKLIST.md`
- `DEPLOYMENT_SCOPE.md`
- `DEPLOYMENT_STATUS_REPORT.md`
- `EKARUNNERNEW_DEPLOYMENT_SUMMARY.md`
- `FINAL_PRODUCTION_CHECKLIST.md`
- `FIREBASE_CONFIG_GUIDE.md`
- `FIREBASE_DEPLOYMENT_MANIFEST.md`
- `FIRESTORE_CLEANUP_REPORT.md`
- `FIRESTORE_E2E_AUDIT_REPORT.md`
- `GEMINI.md`
- `IMMEDIATE_DEPLOYMENT_GUIDE.md`
- `JARVIS_PANEL_COMPLETE.md`
- `MCP_STATUS_REPORT.md`
- `PANEL_LOGIN_GUIDE.md`
- `PRODUCTION_DEPLOYMENT_GUIDE.md`
- `SECURITY-MATRIX.md`
- `docs\dr-mcp-status-contract.md`
- `docs\single-repo-e2e-audit.md`
- `web-app\.claude\skills\run-web-app\SKILL.md`

**OPS** (146 files):

- `04_setup_ssh_and_firestore.py`
- `05_export_firestore_and_create_files.py`
- `07_firestore_direct_download.py`
- `08_realtime_firestore_monitor.py`
- `12_final_firestore_export.py`
- `AGENT_EKA_RUNNER.py`
- `E2E_DEPLOYMENT_TESTS.py`
- `add_labels.py`
- `agent_ci.py`
- `agent_minimal.py`
- `apply_ci_fixes.ps1`
- `apply_ci_fixes_all.ps1`
- `auto_restart_agent.ps1`
- `autonomous_deployment_orchestrator.py`
- `backup_and_cleanup.py`
- `bootstrap.sh`
- `check_both_dbs.py`
- `check_cmd.py`
- `check_empirical_state.py`
- `check_firestore_devices.py`
- `check_firestore_root.py`
- `check_github_runner_status.py`
- `check_wipe_status_once.py`
- `check_workflow_runs.py`
- `claude_sdk_unified_config.py`
- `clean_stale_db_metadata.py`
- `cleanup_firestore_databases.py`
- `connect_and_sync_devices.py`
- `connect_ssh_and_execute_queue.py`
- `continuous_monitor.py`
- `create_s24_devices.py`
- `create_whatsapp_export_folder.py`
- `deploy.sh`
- `deploy_agents_to_devices.sh`
- `deploy_autorestart_to_vivobook.ps1`
- `deploy_backends.py`
- `deploy_cloud_run.sh`
- `deploy_isolated.ps1`
- `device_sync_monitor.py`
- `device_worker_contract.py`
- `direct_device_commands.py`
- `dispatch_command.py`
- `dispatch_daemon.py`
- `dispatch_wa_workflows.py`
- `dispatch_workflow.py`
- `eka_master_deploy.ps1`
- `enable_all_mcp_servers.ps1`
- `execute_device_exports.py`
- `export_network_details.py`
- `export_wifi_details.py`
- `final_deployment_go.py`
- `final_pipeline_check.py`
- `final_verification_report.py`
- `fix_auth.js`
- `fix_ids.py`
- `force_green.py`
- `force_online.py`
- `get_device_ip.py`
- `get_device_ip_from_firestore.py`
- `get_job_logs.py`
- `get_job_logs_part2.py`
- `get_job_output.py`
- `get_latest_run_jobs.py`
- `get_workflow_logs.py`
- `google-takeout-mcp\oauth_gt.py`
- `google_takeout_export.py`
- `inspect_and_execute_all_queues.py`
- `install_runner.ps1`
- `keep_alive.ps1`
- `live_extract_wa_ankush.py`
- `live_screen_server.py`
- `master_setup.ps1`
- `mcp_server.py`
- `migrate_s24.py`
- `monitor_all_sdks.py`
- `monitor_export_progress.py`
- `monitor_production.py`
- `monitor_run.py`
- `notification_sync.py`
- `notification_sync_isolated.py`
- `notification_sync_launcher.py`
- `persistent_device_connection.py`
- `production_execution.py`
- `push_adb_check.py`
- `push_and_update_device.py`
- `push_chats_to_vivobook.py`
- `push_debug_cmd.py`
- `push_exports_to_firestore.py`
- `push_install.py`
- `push_s24_setup_via_vivobook.py`
- `push_urgent_wa_command.py`
- `push_wa_extract_cmd.py`
- `queue_bootstrap.py`
- `queue_ssh_enable.py`
- `quick_eka_val_check.py`
- `read_wa_exports.py`
- `read_wa_scripts.py`
- `reconnect_runner.ps1`
- `restore_asus_jayat_runner.ps1`
- `sanitize_s24_direct_cloud_state.py`
- `scripts\audit_runtime.py`
- `scripts\cleanup_legacy_lenovo_state.py`
- `scripts\export_existing_data.py`
- `scripts\export_takeout_location.py`
- `scripts\imap_location_sync.py`
- `scripts\push_live_heartbeat.js`
- `scripts\queue_runner_activation.py`
- `scripts\run_wa_drive.ps1`
- `scripts\run_wa_drive_upload.ps1`
- `scripts\runtime_config.py`
- `scripts\s24_sync_once.ps1`
- `scripts\verify_e2e.py`
- `scripts\wa_extract_upload_drive.py`
- `scripts\watchdog_check.js`
- `set_panel_password.py`
- `setup_permanent_connection.py`
- `show_s24_success.py`
- `silent_force.py`
- `silent_setup.ps1`
- `silent_wake_asus.py`
- `simulate_s24_telemetry.py`
- `simulate_vivobook_telemetry.py`
- `start_stream_job.ps1`
- `sustained_operations.py`
- `sustained_telemetry_daemon.py`
- `sync_device_metadata.py`
- `sync_device_now.py`
- `temp_push.py`
- `termux\boot\start_s24_direct_cloud.sh`
- `termux\install_s24_direct_cloud.sh`
- `termux_ssh_redeploy.py`
- `trigger_correct_wa_export.py`
- `trigger_extract_asus.py`
- `trigger_s24_full_export.py`
- `trigger_validate_s24.py`
- `trigger_vivobook.py`
- `trigger_vivobook_s24_wake_bridge.py`
- `update_app.py`
- `upload_desktop_chats_to_firestore.py`
- `verify_operations.py`
- `verify_panel_data_sources.py`
- `verify_production_deployment.py`
- `verify_sync_complete.py`
- `vivobook_bootstrap.ps1`
- `watch_and_fetch_results.py`
- `web-app\src\utils.ts`

**S24_CANONICAL** (4 files):

- `devices\s24\README.md`
- `devices\s24\firestore_mcp.py`
- `devices\s24\wa_export_daemon.py`
- `functions\ekarunnerf\index.js`

**SCRATCH** (8 files):

- `.tmp\clean_and_run.py`
- `.tmp\resolve_s24.py`
- `.tmp\watch_and_connect_s24.py`
- `scratch\check_swarn_status.py`
- `scratch\list_all_devices.py`
- `scratch\push_agent_patch.py`
- `scratch\push_debug_calllog.py`
- `scratch\run_local_s24_setup.py`

**TEST** (8 files):

- `scratch\test_github_dispatch.py`
- `tests\test_claude_agent_sdk.py`
- `tests\test_device_worker_contract.py`
- `tests\test_dr_mcp_status.py`
- `tests\test_mcp_guard.py`
- `tests\test_s24_device_id_routes.py`
- `tests\test_s24_relay.py`
- `tests\test_verify_e2e.py`

### `eka-agent-main` (240 files)

**BACKUP** (7 files):

- `01_real_backup_orchestrator.py`
- `06_final_real_backup_collection.py`
- `13_final_real_backup_orchestrator.py`
- `execute_backup_and_save.py`
- `s24_dump_sim.json`
- `set_vivobook_emergency_backup.py`
- `verify_backup_cleanup.py`

**CONFIG** (27 files):

- `.codex\config.toml`
- `.github\workflows\collect-vivobook-logs.yml`
- `.github\workflows\ekarunnernew-deploy.yml`
- `.github\workflows\runner-health-check.yml`
- `.vscode\settings.json`
- `01-agent\firebase.json`
- `02-audit\firebase.json`
- `04-device\firebase.json`
- `06-extract\firebase.json`
- `07-firebase\firebase.json`
- `10-monitor\firebase.json`
- `11-s24\firebase.json`
- `15-utility\firebase.json`
- `DEPLOYMENT_CONFIG.json`
- `apphosting.yaml`
- `cloudbuild-backends.yaml`
- `config\devices.json`
- `config\firebase\firebase.eka-llm.json`
- `config\firebase\firebase.eka-validation.json`
- `config\firebase\firebase.jarvis.json`
- `config\firebase\firebase.swarn.json`
- `docker-compose.yml`
- `firebase.json`
- `functions\firebase.json`
- `isolated_config.json`
- `package-lock.json`
- `web-app\firebase.json`

**DESTRUCTIVE** (19 files):

- `apply_ci_fixes_jarvis.ps1`
- `check_firebase_eka_validation.py`
- `clean_eka_validation_mock_data.py`
- `clean_jarvis_db.py`
- `deploy_eka_validation.ps1`
- `execute_armed_wipe_queue.py`
- `execute_isolated_eka_validation_sync.py`
- `execute_pure_engineering_factory_reset.py`
- `execute_real_device_hardware_wipe.py`
- `execute_real_device_hardware_wipe_fast.py`
- `factory_reset_s24_eka_validation_fast.py`
- `factory_reset_s24_ultra_all_databases.py`
- `live_sync_eka_validation_device.py`
- `monitor_jarvis.ps1`
- `monitor_wipe_completion_eka_validation.py`
- `notification_sync_eka_validation.py`
- `purge_and_fresh_sync_eka_validation.py`
- `scripts\sync_to_eka_llm.js`
- `sync_authentic_data_to_eka_validation.py`

**DOC** (21 files):

- `.agents\skills\run-eka-panel\SKILL.md`
- `ANTIGRAVITY_JULY2_HISTORY_LEADS.md`
- `DEPLOYMENT_GUIDE.md`
- `DEPLOYMENT_READY_CHECKLIST.md`
- `DEPLOYMENT_SCOPE.md`
- `DEPLOYMENT_STATUS_REPORT.md`
- `EKARUNNERNEW_DEPLOYMENT_SUMMARY.md`
- `FINAL_PRODUCTION_CHECKLIST.md`
- `FIREBASE_CONFIG_GUIDE.md`
- `FIREBASE_DEPLOYMENT_MANIFEST.md`
- `FIRESTORE_CLEANUP_REPORT.md`
- `FIRESTORE_E2E_AUDIT_REPORT.md`
- `GEMINI.md`
- `IMMEDIATE_DEPLOYMENT_GUIDE.md`
- `JARVIS_PANEL_COMPLETE.md`
- `MCP_STATUS_REPORT.md`
- `PANEL_LOGIN_GUIDE.md`
- `PRODUCTION_DEPLOYMENT_GUIDE.md`
- `SECURITY-MATRIX.md`
- `docs\dr-mcp-status-contract.md`
- `docs\single-repo-e2e-audit.md`

**OPS** (146 files):

- `04_setup_ssh_and_firestore.py`
- `05_export_firestore_and_create_files.py`
- `07_firestore_direct_download.py`
- `08_realtime_firestore_monitor.py`
- `12_final_firestore_export.py`
- `AGENT_EKA_RUNNER.py`
- `E2E_DEPLOYMENT_TESTS.py`
- `add_labels.py`
- `agent_ci.py`
- `agent_minimal.py`
- `apply_ci_fixes.ps1`
- `apply_ci_fixes_all.ps1`
- `auto_restart_agent.ps1`
- `autonomous_deployment_orchestrator.py`
- `backup_and_cleanup.py`
- `bootstrap.sh`
- `check_both_dbs.py`
- `check_cmd.py`
- `check_empirical_state.py`
- `check_firestore_devices.py`
- `check_firestore_root.py`
- `check_github_runner_status.py`
- `check_wipe_status_once.py`
- `check_workflow_runs.py`
- `claude_sdk_unified_config.py`
- `clean_stale_db_metadata.py`
- `cleanup_firestore_databases.py`
- `connect_and_sync_devices.py`
- `connect_ssh_and_execute_queue.py`
- `continuous_monitor.py`
- `create_s24_devices.py`
- `create_whatsapp_export_folder.py`
- `deploy.sh`
- `deploy_agents_to_devices.sh`
- `deploy_autorestart_to_vivobook.ps1`
- `deploy_backends.py`
- `deploy_cloud_run.sh`
- `deploy_isolated.ps1`
- `device_sync_monitor.py`
- `device_worker_contract.py`
- `direct_device_commands.py`
- `dispatch_command.py`
- `dispatch_daemon.py`
- `dispatch_wa_workflows.py`
- `dispatch_workflow.py`
- `eka_master_deploy.ps1`
- `enable_all_mcp_servers.ps1`
- `execute_device_exports.py`
- `export_network_details.py`
- `export_wifi_details.py`
- `final_deployment_go.py`
- `final_pipeline_check.py`
- `final_verification_report.py`
- `fix_auth.js`
- `fix_ids.py`
- `force_green.py`
- `force_online.py`
- `get_device_ip.py`
- `get_device_ip_from_firestore.py`
- `get_job_logs.py`
- `get_job_logs_part2.py`
- `get_job_output.py`
- `get_latest_run_jobs.py`
- `get_workflow_logs.py`
- `google-takeout-mcp\oauth_gt.py`
- `google_takeout_export.py`
- `inspect_and_execute_all_queues.py`
- `install_runner.ps1`
- `keep_alive.ps1`
- `live_extract_wa_ankush.py`
- `live_screen_server.py`
- `master_setup.ps1`
- `mcp_server.py`
- `migrate_s24.py`
- `monitor_all_sdks.py`
- `monitor_export_progress.py`
- `monitor_production.py`
- `monitor_run.py`
- `notification_sync.py`
- `notification_sync_isolated.py`
- `notification_sync_launcher.py`
- `persistent_device_connection.py`
- `production_execution.py`
- `push_adb_check.py`
- `push_and_update_device.py`
- `push_chats_to_vivobook.py`
- `push_debug_cmd.py`
- `push_exports_to_firestore.py`
- `push_install.py`
- `push_s24_setup_via_vivobook.py`
- `push_urgent_wa_command.py`
- `push_wa_extract_cmd.py`
- `queue_bootstrap.py`
- `queue_ssh_enable.py`
- `quick_eka_val_check.py`
- `read_wa_exports.py`
- `read_wa_scripts.py`
- `reconnect_runner.ps1`
- `restore_asus_jayat_runner.ps1`
- `sanitize_s24_direct_cloud_state.py`
- `scripts\audit_runtime.py`
- `scripts\cleanup_legacy_lenovo_state.py`
- `scripts\export_existing_data.py`
- `scripts\export_takeout_location.py`
- `scripts\imap_location_sync.py`
- `scripts\push_live_heartbeat.js`
- `scripts\queue_runner_activation.py`
- `scripts\run_asus_vivobook_enrollment.ps1`
- `scripts\run_wa_drive.ps1`
- `scripts\run_wa_drive_upload.ps1`
- `scripts\s24_sync_once.ps1`
- `scripts\verify_e2e.py`
- `scripts\wa_extract_upload_drive.py`
- `scripts\watchdog_check.js`
- `set_panel_password.py`
- `setup_permanent_connection.py`
- `show_s24_success.py`
- `silent_force.py`
- `silent_setup.ps1`
- `silent_wake_asus.py`
- `simulate_s24_telemetry.py`
- `simulate_vivobook_telemetry.py`
- `start_stream_job.ps1`
- `sustained_operations.py`
- `sustained_telemetry_daemon.py`
- `sync_device_metadata.py`
- `sync_device_now.py`
- `temp_push.py`
- `termux\boot\start_s24_direct_cloud.sh`
- `termux\install_s24_direct_cloud.sh`
- `termux_ssh_redeploy.py`
- `trigger_correct_wa_export.py`
- `trigger_extract_asus.py`
- `trigger_s24_full_export.py`
- `trigger_validate_s24.py`
- `trigger_vivobook.py`
- `trigger_vivobook_s24_wake_bridge.py`
- `update_app.py`
- `upload_desktop_chats_to_firestore.py`
- `verify_operations.py`
- `verify_panel_data_sources.py`
- `verify_production_deployment.py`
- `verify_sync_complete.py`
- `vivobook_bootstrap.ps1`
- `watch_and_fetch_results.py`
- `web-app\src\utils.ts`

**S24_CANONICAL** (4 files):

- `devices\s24\README.md`
- `devices\s24\firestore_mcp.py`
- `devices\s24\wa_export_daemon.py`
- `functions\ekarunnerf\index.js`

**SCRATCH** (8 files):

- `.tmp\clean_and_run.py`
- `.tmp\resolve_s24.py`
- `.tmp\watch_and_connect_s24.py`
- `scratch\check_swarn_status.py`
- `scratch\list_all_devices.py`
- `scratch\push_agent_patch.py`
- `scratch\push_debug_calllog.py`
- `scratch\run_local_s24_setup.py`

**TEST** (8 files):

- `scratch\test_github_dispatch.py`
- `tests\test_claude_agent_sdk.py`
- `tests\test_device_worker_contract.py`
- `tests\test_dr_mcp_status.py`
- `tests\test_mcp_guard.py`
- `tests\test_s24_device_id_routes.py`
- `tests\test_s24_relay.py`
- `tests\test_verify_e2e.py`

### `Eka Runner` (356 files)

**BACKUP** (9 files):

- `01_real_backup_orchestrator.py`
- `06_final_real_backup_collection.py`
- `13_final_real_backup_orchestrator.py`
- `_device_docs_backup_20260731.json`
- `execute_backup_and_save.py`
- `s24_backup_summary.txt`
- `s24_dump_sim.json`
- `set_vivobook_emergency_backup.py`
- `verify_backup_cleanup.py`

**BUILD** (99 files):

- `android\app\build\intermediates\compatible_screen_manifest\debug\createDebugCompatibleScreenManifests\output-metadata.json`
- `android\app\build\intermediates\manifest_merge_blame_file\debug\processDebugMainManifest\manifest-merger-blame-debug-report.txt`
- `android\app\build\intermediates\merged_manifests\debug\processDebugManifest\output-metadata.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\mergeDebugResources.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-af.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-am.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ar.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-as.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-az.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-b+sr+Latn.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-be.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-bg.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-bn.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-bs.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ca.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-cs.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-da.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-de.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-el.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-en-rAU.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-en-rCA.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-en-rGB.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-en-rIN.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-en-rXC.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-es-rUS.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-es.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-et.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-eu.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-fa.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-fi.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-fr-rCA.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-fr.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-gl.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-gu.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-hi.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-hr.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-hu.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-hy.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-in.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-is.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-it.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-iw.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ja.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ka.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-kk.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-km.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-kn.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ko.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ky.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-lo.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-lt.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-lv.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-mk.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ml.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-mn.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-mr.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ms.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-my.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-nb.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ne.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-nl.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-or.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-pa.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-pl.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-pt-rBR.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-pt-rPT.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-pt.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ro.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ru.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-si.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sk.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sl.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sq.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sr.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sv.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sw.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ta.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-te.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-th.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-tl.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-tr.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-uk.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ur.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-uz.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-v16.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-v21.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-vi.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-zh-rCN.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-zh-rHK.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-zh-rTW.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-zu.json`
- `android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values.json`
- `android\app\build\intermediates\packaged_manifests\debug\processDebugManifestForPackage\output-metadata.json`
- `android\app\build\intermediates\processed_res\debug\processDebugResources\out\output-metadata.json`
- `android\app\build\intermediates\source_set_path_map\debug\mapDebugSourceSetPaths\file-map.txt`
- `android\app\build\intermediates\stable_resource_ids_file\debug\processDebugResources\stableIds.txt`
- `android\app\build\intermediates\symbol_list_with_package_name\debug\processDebugResources\package-aware-r.txt`
- `android\app\build\outputs\apk\debug\output-metadata.json`
- `android\app\build\outputs\logs\manifest-merger-debug-report.txt`

**CONFIG** (30 files):

- `.claude\settings.local.json`
- `.codex\config.toml`
- `.vscode\settings.json`
- `01-agent\firebase.json`
- `02-audit\firebase.json`
- `04-device\firebase.json`
- `06-extract\firebase.json`
- `07-firebase\firebase.json`
- `10-monitor\firebase.json`
- `11-s24\firebase.json`
- `15-utility\firebase.json`
- `DEPLOYMENT_CONFIG.json`
- `android\app\google-services.json`
- `apphosting.yaml`
- `cloudbuild-backends.yaml`
- `config\devices.json`
- `config\firebase\firebase.eka-llm.json`
- `config\firebase\firebase.eka-validation.json`
- `config\firebase\firebase.jarvis.json`
- `config\firebase\firebase.swarn.json`
- `docker-compose.yml`
- `firebase.json`
- `harvested_data-unzipped\takeout-location-export-20260605-170516_20260605_170551\summary.json`
- `harvested_data-unzipped\takeout-location-export-20260605-172222_20260605_172259\summary.json`
- `isolated_config.json`
- `latest_existing_data_20260601_093404\summary.json`
- `latest_existing_data_20260601_181819\existing-data-export\summary.json`
- `output\takeout_location_real_check2\summary.json`
- `package-lock.json`
- `temp_takeout_extract\summary.json`

**DESTRUCTIVE** (16 files):

- `check_firebase_eka_validation.py`
- `clean_eka_validation_mock_data.py`
- `clean_jarvis_db.py`
- `execute_armed_wipe_queue.py`
- `execute_isolated_eka_validation_sync.py`
- `execute_pure_engineering_factory_reset.py`
- `execute_real_device_hardware_wipe.py`
- `execute_real_device_hardware_wipe_fast.py`
- `factory_reset_s24_eka_validation_fast.py`
- `factory_reset_s24_ultra_all_databases.py`
- `live_sync_eka_validation_device.py`
- `monitor_wipe_completion_eka_validation.py`
- `notification_sync_eka_validation.py`
- `purge_and_fresh_sync_eka_validation.py`
- `scripts\sync_to_eka_llm.js`
- `sync_authentic_data_to_eka_validation.py`

**DOC** (21 files):

- `.agents\skills\run-eka-panel\SKILL.md`
- `DEPLOYMENT_GUIDE.md`
- `DEPLOYMENT_READY_CHECKLIST.md`
- `DEPLOYMENT_SCOPE.md`
- `DEPLOYMENT_STATUS_REPORT.md`
- `EKARUNNERNEW_DEPLOYMENT_SUMMARY.md`
- `FINAL_PRODUCTION_CHECKLIST.md`
- `FIREBASE_CONFIG_GUIDE.md`
- `FIREBASE_DEPLOYMENT_MANIFEST.md`
- `FIRESTORE_CLEANUP_REPORT.md`
- `FIRESTORE_E2E_AUDIT_REPORT.md`
- `GEMINI.md`
- `IMMEDIATE_DEPLOYMENT_GUIDE.md`
- `JARVIS_PANEL_COMPLETE.md`
- `MCP_STATUS_REPORT.md`
- `PANEL_LOGIN_GUIDE.md`
- `PRODUCTION_DEPLOYMENT_GUIDE.md`
- `S24_LIVE_SYNC_DEPLOYMENT.md`
- `SECURITY-MATRIX.md`
- `docs\dr-mcp-status-contract.md`
- `docs\single-repo-e2e-audit.md`

**OPS** (116 files):

- `04_setup_ssh_and_firestore.py`
- `05_export_firestore_and_create_files.py`
- `07_firestore_direct_download.py`
- `08_realtime_firestore_monitor.py`
- `12_final_firestore_export.py`
- `AGENT_EKA_RUNNER.py`
- `E2E_DEPLOYMENT_TESTS.py`
- `_audit_all.py`
- `_clean_orphans.py`
- `_connect_claude.py`
- `_db_check.py`
- `_fix_device_state.py`
- `_survey_dbs.py`
- `add_labels.py`
- `agent_ci.py`
- `agent_minimal.py`
- `autonomous_deployment_orchestrator.py`
- `backup_and_cleanup.py`
- `bootstrap.sh`
- `check_both_dbs.py`
- `check_cmd.py`
- `check_empirical_state.py`
- `check_fcm.py`
- `check_firestore_devices.py`
- `check_firestore_root.py`
- `check_github_runner_status.py`
- `check_wipe_status_once.py`
- `check_workflow_runs.py`
- `claude_sdk_unified_config.py`
- `clean_stale_db_metadata.py`
- `cleanup_firestore_databases.py`
- `connect_and_sync_devices.py`
- `connect_ssh_and_execute_queue.py`
- `continuous_monitor.py`
- `create_s24_devices.py`
- `create_whatsapp_export_folder.py`
- `deploy.sh`
- `deploy_agents_to_devices.sh`
- `deploy_backends.py`
- `deploy_cloud_run.sh`
- `device_sync_monitor.py`
- `direct_device_commands.py`
- `dispatch_command.py`
- `dispatch_daemon.py`
- `dispatch_wa_workflows.py`
- `dispatch_workflow.py`
- `execute_device_exports.py`
- `export_network_details.py`
- `export_wifi_details.py`
- `final_deployment_go.py`
- `final_pipeline_check.py`
- `final_verification_report.py`
- `fix_auth.js`
- `fix_ids.py`
- `force_green.py`
- `force_online.py`
- `get_device_ip.py`
- `get_device_ip_from_firestore.py`
- `get_job_logs.py`
- `get_job_logs_part2.py`
- `get_job_output.py`
- `get_latest_run_jobs.py`
- `get_workflow_logs.py`
- `google_takeout_export.py`
- `inspect_and_execute_all_queues.py`
- `live_extract_wa_ankush.py`
- `live_screen_server.py`
- `mcp_server.py`
- `migrate_s24.py`
- `monitor_all_sdks.py`
- `monitor_export_progress.py`
- `monitor_production.py`
- `monitor_run.py`
- `notification_sync.py`
- `notification_sync_isolated.py`
- `notification_sync_launcher.py`
- `production_execution.py`
- `push_adb_check.py`
- `push_and_update_device.py`
- `push_debug_cmd.py`
- `push_exports_to_firestore.py`
- `push_install.py`
- `push_s24_setup_via_vivobook.py`
- `push_urgent_wa_command.py`
- `push_wa_extract_cmd.py`
- `queue_bootstrap.py`
- `quick_eka_val_check.py`
- `read_wa_exports.py`
- `read_wa_scripts.py`
- `restore_asus_jayat_runner.ps1`
- `sanitize_s24_direct_cloud_state.py`
- `scripts\push_live_heartbeat.js`
- `scripts\watchdog_check.js`
- `set_panel_password.py`
- `show_s24_success.py`
- `silent_force.py`
- `silent_wake_asus.py`
- `simulate_s24_telemetry.py`
- `sustained_operations.py`
- `sustained_telemetry_daemon.py`
- `sync_device_metadata.py`
- `sync_device_now.py`
- `temp_push.py`
- `termux_ssh_redeploy.py`
- `trigger_correct_wa_export.py`
- `trigger_s24_full_export.py`
- `trigger_validate_s24.py`
- `trigger_vivobook.py`
- `update_app.py`
- `upload_desktop_chats_to_firestore.py`
- `verify_operations.py`
- `verify_panel_data_sources.py`
- `verify_production_deployment.py`
- `verify_sync_complete.py`
- `vivobook_bootstrap.ps1`
- `watch_and_fetch_results.py`

**PANEL_SUBSYSTEM** (53 files):

- `eka-llm\.claude\skills\run-eka-panel\NOTES.md`
- `eka-llm\.claude\skills\run-eka-panel\SKILL.md`
- `eka-llm\.claude\skills\run-eka-panel\driver.ps1`
- `eka-llm\ACTIVATE_EVERYTHING.ps1`
- `eka-llm\ACTIVATE_NOW.md`
- `eka-llm\AUDIT_REPORT.txt`
- `eka-llm\AUDIT_SUMMARY.md`
- `eka-llm\COMPLETE_IMPLEMENTATION_REPORT.md`
- `eka-llm\CREDENTIALS_FIX_GUIDE.md`
- `eka-llm\DEPLOYMENT_CHECK.md`
- `eka-llm\DEPLOYMENT_SUMMARY.md`
- `eka-llm\DEPLOY_AS_EKA_ADMIN.bat`
- `eka-llm\EKA_PANEL_DESIGN_SPEC.md`
- `eka-llm\EMERGENCY_BOOT_STATUS.md`
- `eka-llm\FINDINGS_SUMMARY.txt`
- `eka-llm\FIREBASE_CONFIG_ANALYSIS.md`
- `eka-llm\FIREBASE_CREDENTIALS_AUDIT.md`
- `eka-llm\LEGACY_DEPLOYMENT.md`
- `eka-llm\PANEL_ACCESS.md`
- `eka-llm\PANEL_LOGIN_GUIDE.md`
- `eka-llm\QUICK_REFERENCE.md`
- `eka-llm\README.md`
- `eka-llm\README_AUDIT.md`
- `eka-llm\RESOLUTION_COMPLETE.md`
- `eka-llm\STANDARDIZATION_IMPLEMENTATION.md`
- `eka-llm\START_RUNNER.bat`
- `eka-llm\STATUS.txt`
- `eka-llm\VERIFICATION_REPORT.md`
- `eka-llm\agent_ci.py`
- `eka-llm\auto_install.py`
- `eka-llm\check_command_bug.py`
- `eka-llm\check_doc_exists.py`
- `eka-llm\check_panel_authenticated.js`
- `eka-llm\claude_sdk_unified_config.py`
- `eka-llm\complete_setup.ps1`
- `eka-llm\diagnose_panel_empty.py`
- `eka-llm\eka_setup.py`
- `eka-llm\fix_correct_paths.py`
- `eka-llm\kb\c_drive_recovery_summary.json`
- `eka-llm\mcp_server.py`
- `eka-llm\monitor_agent_bootstrap.py`
- `eka-llm\push_status.ps1`
- `eka-llm\reset_panel_password.py`
- `eka-llm\setup.ps1`
- `eka-llm\setup_panel_auth.py`
- `eka-llm\setup_runner.bat`
- `eka-llm\silent_setup.ps1`
- `eka-llm\start_everything_now.py`
- `eka-llm\startup_fixer.bat`
- `eka-llm\test_fresh.js`
- `eka-llm\trigger_emergency_boot.py`
- `eka-llm\verify_panel_fix.py`
- `eka-llm\watch-deployment.ps1`

**SCRATCH** (3 files):

- `.tmp\clean_and_run.py`
- `.tmp\resolve_s24.py`
- `.tmp\watch_and_connect_s24.py`

**TXT** (9 files):

- `COMPLETE_SYSTEM_REPORT.txt`
- `extracted_logs2\shell\system.txt`
- `extracted_logs3\shell\system.txt`
- `extracted_logs4\shell\system.txt`
- `extracted_logs5\shell\system.txt`
- `extracted_logs6\shell\system.txt`
- `extracted_logs7\shell\system.txt`
- `extracted_logs\shell\system.txt`
- `s24_firestore_dump.txt`

## Recommendations

### Safest to leave alone

- `AUTO` (build intermediates)
- `GITHUB_REF` (not actually Firestore DB references)
- `BACKUP` (historical snapshots — comment out or leave alone)
- `S24_CANONICAL` (already correct)
- `PANEL_SUBSYSTEM` (`Eka Runner\eka-llm\*` — separate concern)

### Safe to delete (fail today, target non-existent DBs)

All `DESTRUCTIVE` files. ~50+ files across all trees. Plus most `SCRATCH` files.

### Need case-by-case review

- `OPS` (orchestrator/devops scripts) — ~150+ files with mixed legit/stale content
- `TEST` (test files) — 18 files; fix alongside code changes
- `CONFIG` (yaml/json) — high blast radius (build/CI configs)
- `DOC` (markdown) — review for accuracy

### Config defaults only — safe targeted edit

- `claude_sdk_unified_config.py` × 5 copies (4 trees + eka-llm\)
- Lines 42, 124 change `database_id="swarn"` → `"eka-agent"` and `FIRESTORE_DB` env fallback

## Scope choice pending

User picked "C" originally; v1 suggested A/C'/D after risks identified. v2 confirms 423 paths (not 209) — broader scope warranted.

- **A** (minimal, ~10 edits): just config defaults + delete `config/firebase/firebase.<db>.json`
- **C'** (~75 file ops): delete dead ops scripts + fix config defaults + add destructive guards
- **C** (blind string-replace, ~423 paths): RISKY — will corrupt panel configs, GitHub CLI calls, destructive wipe scripts
- **D**: user names files
