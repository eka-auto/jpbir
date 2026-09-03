# SAFE_TO_DELETE Files Inventory
Generated: 2026-09-03
Source: `stale_db_audit_report.json`
Total Files: **161**

---

## Summary

| Category | Count | Action |
|----------|-------|--------|
| DESTRUCTIVE | 32 | Scripts targeting non-existent DBs |
| BUILD/SCRATCH | 129 | Build intermediates + temp files |

---

## Tree Breakdown

| Tree | Path | Files |
|------|------|-------|
| eka-agent | `C:\Users\abcom\github-repos\eka-agent` | 17 |
| eka-agent-clean | `C:\Users\abcom\Go4Garage\eka-agent-clean` | 17 |
| eka-agent-main | `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main` | 17 |
| Eka Runner | `C:\Users\abcom\Go4Garage\Eka Runner` | 110 |

---

## DESTRUCTIVE Scripts (32 files)

These scripts target non-existent Firestore databases (`eka-validation`, `swarn`, `jarvis`, `eka-llm`, `eka-runner`). They will fail if executed.

### eka-agent (8 files)
1. `C:\Users\abcom\github-repos\eka-agent\check_wipe_status_once.py`
2. `C:\Users\abcom\github-repos\eka-agent\execute_armed_wipe_queue.py`
3. `C:\Users\abcom\github-repos\eka-agent\execute_pure_engineering_factory_reset.py`
4. `C:\Users\abcom\github-repos\eka-agent\execute_real_device_hardware_wipe.py`
5. `C:\Users\abcom\github-repos\eka-agent\execute_real_device_hardware_wipe_fast.py`
6. `C:\Users\abcom\github-repos\eka-agent\factory_reset_s24_eka_validation_fast.py`
7. `C:\Users\abcom\github-repos\eka-agent\factory_reset_s24_ultra_all_databases.py`
8. `C:\Users\abcom\github-repos\eka-agent\monitor_wipe_completion_eka_validation.py`

### eka-agent-clean (8 files)
9. `C:\Users\abcom\Go4Garage\eka-agent-clean\check_wipe_status_once.py`
10. `C:\Users\abcom\Go4Garage\eka-agent-clean\execute_armed_wipe_queue.py`
11. `C:\Users\abcom\Go4Garage\eka-agent-clean\execute_pure_engineering_factory_reset.py`
12. `C:\Users\abcom\Go4Garage\eka-agent-clean\execute_real_device_hardware_wipe.py`
13. `C:\Users\abcom\Go4Garage\eka-agent-clean\execute_real_device_hardware_wipe_fast.py`
14. `C:\Users\abcom\Go4Garage\eka-agent-clean\factory_reset_s24_eka_validation_fast.py`
15. `C:\Users\abcom\Go4Garage\eka-agent-clean\factory_reset_s24_ultra_all_databases.py`
16. `C:\Users\abcom\Go4Garage\eka-agent-clean\monitor_wipe_completion_eka_validation.py`

### eka-agent-main (8 files)
17. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\check_wipe_status_once.py`
18. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\execute_armed_wipe_queue.py`
19. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\execute_pure_engineering_factory_reset.py`
20. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\execute_real_device_hardware_wipe.py`
21. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\execute_real_device_hardware_wipe_fast.py`
22. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\factory_reset_s24_eka_validation_fast.py`
23. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\factory_reset_s24_ultra_all_databases.py`
24. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\monitor_wipe_completion_eka_validation.py`

### Eka Runner (8 files)
25. `C:\Users\abcom\Go4Garage\Eka Runner\check_wipe_status_once.py`
26. `C:\Users\abcom\Go4Garage\Eka Runner\execute_armed_wipe_queue.py`
27. `C:\Users\abcom\Go4Garage\Eka Runner\execute_pure_engineering_factory_reset.py`
28. `C:\Users\abcom\Go4Garage\Eka Runner\execute_real_device_hardware_wipe.py`
29. `C:\Users\abcom\Go4Garage\Eka Runner\execute_real_device_hardware_wipe_fast.py`
30. `C:\Users\abcom\Go4Garage\Eka Runner\factory_reset_s24_eka_validation_fast.py`
31. `C:\Users\abcom\Go4Garage\Eka Runner\factory_reset_s24_ultra_all_databases.py`
32. `C:\Users\abcom\Go4Garage\Eka Runner\monitor_wipe_completion_eka_validation.py`

---

## BUILD/SCRATCH Files (129 files)

### Scratch Files - eka-agent (9 files)
33. `C:\Users\abcom\github-repos\eka-agent\.tmp\clean_and_run.py`
34. `C:\Users\abcom\github-repos\eka-agent\.tmp\resolve_s24.py`
35. `C:\Users\abcom\github-repos\eka-agent\.tmp\watch_and_connect_s24.py`
36. `C:\Users\abcom\github-repos\eka-agent\scratch\check_swarn_status.py`
37. `C:\Users\abcom\github-repos\eka-agent\scratch\list_all_devices.py`
38. `C:\Users\abcom\github-repos\eka-agent\scratch\push_agent_patch.py`
39. `C:\Users\abcom\github-repos\eka-agent\scratch\push_debug_calllog.py`
40. `C:\Users\abcom\github-repos\eka-agent\scratch\run_local_s24_setup.py`
41. `C:\Users\abcom\github-repos\eka-agent\scratch\test_github_dispatch.py`

### Scratch Files - eka-agent-clean (9 files)
42. `C:\Users\abcom\Go4Garage\eka-agent-clean\.tmp\clean_and_run.py`
43. `C:\Users\abcom\Go4Garage\eka-agent-clean\.tmp\resolve_s24.py`
44. `C:\Users\abcom\Go4Garage\eka-agent-clean\.tmp\watch_and_connect_s24.py`
45. `C:\Users\abcom\Go4Garage\eka-agent-clean\scratch\check_swarn_status.py`
46. `C:\Users\abcom\Go4Garage\eka-agent-clean\scratch\list_all_devices.py`
47. `C:\Users\abcom\Go4Garage\eka-agent-clean\scratch\push_agent_patch.py`
48. `C:\Users\abcom\Go4Garage\eka-agent-clean\scratch\push_debug_calllog.py`
49. `C:\Users\abcom\Go4Garage\eka-agent-clean\scratch\run_local_s24_setup.py`
50. `C:\Users\abcom\Go4Garage\eka-agent-clean\scratch\test_github_dispatch.py`

### Scratch Files - eka-agent-main (9 files)
51. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\.tmp\clean_and_run.py`
52. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\.tmp\resolve_s24.py`
53. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\.tmp\watch_and_connect_s24.py`
54. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\scratch\check_swarn_status.py`
55. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\scratch\list_all_devices.py`
56. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\scratch\push_agent_patch.py`
57. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\scratch\push_debug_calllog.py`
58. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\scratch\run_local_s24_setup.py`
59. `C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main\scratch\test_github_dispatch.py`

### Scratch Files - Eka Runner (9 files)
60. `C:\Users\abcom\Go4Garage\Eka Runner\.tmp\clean_and_run.py`
61. `C:\Users\abcom\Go4Garage\Eka Runner\.tmp\resolve_s24.py`
62. `C:\Users\abcom\Go4Garage\Eka Runner\.tmp\watch_and_connect_s24.py`
63. `C:\Users\abcom\Go4Garage\Eka Runner\scratch\check_swarn_status.py`
64. `C:\Users\abcom\Go4Garage\Eka Runner\scratch\list_all_devices.py`
65. `C:\Users\abcom\Go4Garage\Eka Runner\scratch\push_agent_patch.py`
66. `C:\Users\abcom\Go4Garage\Eka Runner\scratch\push_debug_calllog.py`
67. `C:\Users\abcom\Go4Garage\Eka Runner\scratch\run_local_s24_setup.py`
68. `C:\Users\abcom\Go4Garage\Eka Runner\scratch\test_github_dispatch.py`

### Android Build Intermediates - Eka Runner (99 files)

#### Build intermediates - manifest/blame files
69. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\compatible_screen_manifest\debug\createDebugCompatibleScreenManifests\output-metadata.json`
70. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\manifest_merge_blame_file\debug\processDebugMainManifest\manifest-merger-blame-debug-report.txt`
71. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_manifests\debug\processDebugManifest\output-metadata.json`
72. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\mergeDebugResources.json`
73. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-af.json`
74. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-am.json`
75. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ar.json`
76. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-as.json`
77. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-az.json`
78. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-b+sr+Latn.json`
79. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-be.json`
80. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-bg.json`
81. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-bn.json`
82. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-bs.json`
83. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ca.json`
84. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-cs.json`
85. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-da.json`
86. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-de.json`
87. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-el.json`
88. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-en-rAU.json`
89. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-en-rCA.json`
90. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-en-rGB.json`
91. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-en-rIN.json`
92. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-en-rXC.json`
93. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-es-rUS.json`
94. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-es.json`
95. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-et.json`
96. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-eu.json`
97. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-fa.json`
98. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-fi.json`
99. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-fr-rCA.json`
100. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-fr.json`
101. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-gl.json`
102. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-gu.json`
103. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-hi.json`
104. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-hr.json`
105. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-hu.json`
106. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-hy.json`
107. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-in.json`
108. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-is.json`
109. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-it.json`
110. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-iw.json`
111. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ja.json`
112. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ka.json`
113. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-kk.json`
114. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-km.json`
115. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-kn.json`
116. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ko.json`
117. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ky.json`
118. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-lo.json`
119. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-lt.json`
120. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-lv.json`
121. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-mk.json`
122. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ml.json`
123. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-mn.json`
124. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-mr.json`
125. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ms.json`
126. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-my.json`
127. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-nb.json`
128. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ne.json`
129. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-nl.json`
130. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-or.json`
131. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-pa.json`
132. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-pl.json`
133. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-pt-rBR.json`
134. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-pt-rPT.json`
135. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-pt.json`
136. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ro.json`
137. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ru.json`
138. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-si.json`
139. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sk.json`
140. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sl.json`
141. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sq.json`
142. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sr.json`
143. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sv.json`
144. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-sw.json`
145. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ta.json`
146. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-te.json`
147. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-th.json`
148. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-tl.json`
149. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-tr.json`
150. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-uk.json`
151. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-ur.json`
152. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-uz.json`
153. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-v16.json`
154. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-v21.json`
155. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-vi.json`
156. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-zh-rCN.json`
157. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-zh-rHK.json`
158. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-zh-rTW.json`
159. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values-zu.json`
160. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\merged_res_blame_folder\debug\mergeDebugResources\out\multi-v2\values.json`
161. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\packaged_manifests\debug\processDebugManifestForPackage\output-metadata.json`
162. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\processed_res\debug\processDebugResources\out\output-metadata.json`
163. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\source_set_path_map\debug\mapDebugSourceSetPaths\file-map.txt`
164. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\stable_resource_ids_file\debug\processDebugResources\stableIds.txt`
165. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\intermediates\symbol_list_with_package_name\debug\processDebugResources\package-aware-r.txt`
166. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\outputs\apk\debug\output-metadata.json`
167. `C:\Users\abcom\Go4Garage\Eka Runner\android\app\build\outputs\logs\manifest-merger-debug-report.txt`

---

## Notes

### Why these files are safe to delete

**DESTRUCTIVE scripts:**
- Target databases that do not exist (`eka-validation`, `swarn`, `jarvis`, `eka-llm`, `eka-runner`)
- Will fail immediately with 404 errors if executed
- Only canonical database is `eka-agent`

**BUILD/SCRATCH files:**
- `.tmp/` and `scratch/` are temporary working files
- `android/app/build/` are auto-generated by Android Gradle
- Can be regenerated by running `./gradlew assembleDebug`

### Files NOT on this list

The following categories were identified in the audit but are **NOT** being deleted:
- **KEEP_AS_IS** (106 files) - S24 canonical files already using `eka-agent`
- **NEEDS_FIX** (345 files) - Scripts/configs that need DB reference updates
- **NEEDS_REVIEW** (428 files) - OPS scripts requiring case-by-case review
- **PANEL_SUBSYSTEM** (53 files) - `Eka Runner\eka-llm\*` separate subsystem
- **BUILD** (99 Android files) - Already included above in Eka Runner

---

## Next Steps

**To delete these files:**
```powershell
# Run deletion script (to be created)
python C:\Users\abcom\jpbir\phase1_delete_safe.py
```

**Verification after deletion:**
```powershell
# Verify files are gone
git status  # Should show deleted files
```

---

Generated by: `stale_db_audit.py`  
Audit report: `stale_db_audit_report.json`
