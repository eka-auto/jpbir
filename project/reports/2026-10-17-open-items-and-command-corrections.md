# Open items and command corrections — 2026-10-17

**Author:** automated session `tsk-01M532NH0WQD2YHSWJ1P14P7WY`, acting as `cline-cloud[bot]` (recorded in `project/ACCESS.md` as the `devops` automation identity) on branch `cline/1p14p7wy`.
**Subject revision:** `jaytipargal/jpbir` `main@6693bc44cdaa99d58d9ea630a988a221bd345e7e`.
**Purpose:** correct two command blocks in the 16 October diagnosis, and put four findings into the record that until now existed only in conversation. This is a diagnostic record — not a tracker event (the `project-state` branch still does not exist), not HOD sign-off, and not protected CI evidence.

## 1. Corrections to the 16 October report's section 5

The host session's addendum flagged both of these; they are accepted, with the reason and the replacement checks below.

### 1.1 Intel storage-driver mismatch (item 1)

The original commands — `Win32_PnPSignedDriver` and the uninstall-registry `DisplayVersion` — report the **bound INF package version** and installed graphics software. They would have returned `18.7.0.1002` on both sides and missed the mismatch entirely. The check has to compare the bound INF with the **loaded binaries**:

```powershell
# bound INF package per device
Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -match 'RST|VMD|iaStor' } |
  Select-Object DeviceName, DriverVersion, InfName, DriverProviderName, DriverDate | Format-Table -Auto

# the loaded binaries, which is where the reported mismatch lives
foreach ($f in 'C:\Windows\System32\drivers\iaStorVD.sys','C:\Windows\System32\drivers\iaStorAfs.sys') {
  $i = Get-Item $f -ErrorAction SilentlyContinue
  if ($i) { $v = $i.VersionInfo
    [pscustomobject]@{ File = $f; FileVersion = $v.FileVersion; ProductVersion = $v.ProductVersion
                       Signature = (Get-AuthenticodeSignature $f).Status } } }

# driver-store packages actually present on the machine
pnputil /enum-drivers | Select-String -Pattern 'oem\d+\.inf|iaStor'
```

The host observation stands as a **Fail and is unresolved**: RST VMD Controller `9A0B` is bound to `oem50.inf` `18.7.0.1002` while `iaStorVD.sys` and `iaStorAfs.sys` are `18.6.1.1016`, both with valid Intel signatures. No reinstall and no reboot were performed, so the mismatch is recorded, not repaired. These commands are written for the host and were not run here (this session has no Windows and no Intel device).

### 1.2 AzureAiProxy (item 6)

The original block implied one check; there are two, and only the first was performed:

```powershell
# 1. local Task Scheduler account (what the host session verified - Pass)
Get-ScheduledTask -TaskName '<task name>' | Select-Object -ExpandProperty Principal |
  Select-Object UserId, LogonType, RunLevel
# then resolve the SID to an account name, e.g.:
(New-Object System.Security.Principal.SecurityIdentifier('<SID>')).Translate([System.Security.Principal.NTAccount]).Value

# 2. cloud identity - a different test, NOT performed
#    the provider's own identity call (for example `az account show`) plus a matching row in project/ACCESS.md
```

So the recorded **Pass covers the local Windows task account only**. Cloud authentication is untested, and no `AzureAiProxy` identity appears in `project/ACCESS.md`; if one is in use it is unrecorded, which rule 11 stops on regardless of its state. The launch target is separately a **Fail**: the wrapper invokes `python` on `%USERPROFILE%\.azure-ai-proxy\azure_ai_proxy.py`, which is absent, so a historical task result of `0` does not establish proxy health.

## 2. Findings that were not in the record

### 2.1 The droplet target no longer matches its record — blocks Q5 target verification

| Source | Value |
| --- | --- |
| What this session's resolver reports | `runner.jaytipargal.tech` → **`168.144.24.224`** |
| What `project/targets.json` records | `ip_address` **`168.144.24.44`** (droplet `runner-jp-agent`, region `blr1`, `ssh_key_name` `jayat_laptop_key`) |

```
$ getent ahostsv4 runner.jaytipargal.tech
168.144.24.224  STREAM runner.jaytipargal.tech
$ python3 -c "import socket;print(sorted({r[4][0] for r in socket.getaddrinfo('runner.jaytipargal.tech',None)}))"
['168.144.24.224']
```

Both addresses accepted a TCP connect on `:22` from this sandbox, which is **not** evidence of two live SSH servers: this environment routes through a transparent egress proxy, so the probe is inconclusive and is not offered as evidence. Rule 11 requires the comparison to use the platform's own report, so reconciliation must come from the **DigitalOcean API** (droplet `runner-jp-agent`, region `blr1`), after which `project/targets.json` is corrected by the HOD or orchestrator. Until then, every droplet action — including Q5 — stops on a target mismatch, independently of credentials.

### 2.2 Four queued droplet deploy jobs, each waiting 24 h

Every merge to `main` queues a job that no runner picks up and that is cancelled 24 h later:

| Run | Trigger | Queued |
| --- | --- | --- |
| `38958400046` | `chore(project): record the cline-cloud bot email…` | 2026-10-16T19:54:54Z |
| `38958402101` | `docs(project): register cline-agent…` | 2026-10-16T19:54:55Z |
| `38960446905` | merge of PR #164 | 2026-10-16T20:11:37Z |
| `38962787212` | merge of PR #165 | 2026-10-16T20:30:54Z |

**Recommendation:** pause the `Deploy to jp-agent Droplet` workflow's `push` trigger until a runner is registered, then re-enable it. That is a pipeline definition — a protected control (rule 12) — so it needs HOD/owner approval; this report only recommends it.

### 2.3 No clean full scan of the host exists

The host session records that Defender's aggregate threats are all inactive (including Expiro), that the old infected driver-package directory is absent, and that antivirus, real-time and behaviour protection are enabled — but also that **the full scan was cancelled at the owner's request at 2026-10-16 23:54:16 IST** (event `1002`, `Aborted by the client`), so a populated `FullScanEndTime` is not evidence of a completed scan. No system-wide clean result is claimed and no scan was restarted.

**Open item (owner decision):** either complete a full scan of that machine, or record it explicitly as **out of scope for evidence** — because a host with a past file-infector incident, and no clean scan, should not silently be the machine that produces or influences pipeline evidence. Contract rule 4 already limits evidence to CI or a declared runner, device farm or hardware rig, so the second option is the cheaper and currently accurate one; either way it should be recorded, not left in prose.

### 2.4 Task Scheduler's Operational log is disabled

Five scheduled tasks report nonzero last results — `AnthropicTokenAutoRefresh`, `EkaAgentDaily`, `EkaPanelLaptopFirestoreSync`, `S24_WhatsApp_Export`, `WA_Export_Daemon_Daily` — and the Operational log that would carry their error events is disabled, so their failures have no retained evidence and their causes cannot be diagnosed from history. Enabling the log is a host configuration change for the owner; without it, item 4 of the original report ("several other background jobs report failures; their causes need further diagnosis") cannot be closed on that machine.


## 3. Verification notes from this session (for the record)

| Check | Command | Result |
| --- | --- | --- |
| PR #165 scope | first-parent diff of `6693bc44`, plus `gh pr view 165` | **2 files, +58, −0** — the 16 Oct report (+2 pointer lines) and the new addendum (+56) |
| `main` protection | `gh api repos/jaytipargal/jpbir/branches/main --jq .protected` | **`false`** — confirms the addendum; T-04 has no blocker left except the work itself |
| Production – jpbir | `gh api repos/jaytipargal/jpbir/deployments/7128522726` + statuses | `vercel[bot]`, sha `8b1a68a`, latest status **success** |
| Production – channel-sandbox | `gh api repos/jaytipargal/jpbir/deployments/7128512058` | `vercel[bot]`, sha `8b1a68a` |
| Runner count `0` | `gh api repos/jaytipargal/jpbir/actions/runners` | **HTTP 403 for this identity** — the addendum's `total_count=0` could not be independently verified here; it is owner-reported |
| PR #165 CI | `gh run list --branch main` | CI/CD Pipeline and Code Quality Checks **success** on `6693bc44`, plus two Endpoint Health Checks |

Note for future readers: range forms such as `git diff <merge>^..<merge>` mislead on merge commits in this partial clone — the first-parent diff (`git diff <merge>^1 <merge>`) is the reliable form. That mistake produced one false "nothing changed" reading during this verification, caught by cross-checking against `gh pr view`.

## 4. Status of the approved work (unchanged by this report)

| Item | State | Actor |
| --- | --- | --- |
| Q2 — audit script, `tracker.yml`, `hod-audit.yml`, protected `project-state`/`project-verifier` | Approved, not done; both state branches absent, so no tracker events and no `project/STOP` can exist | HOD |
| Q3 — record the 2.4.0 pin via `tracker.py upgrade` | Approved; follows Q2 (needs `tracker.json` on the state branch) | HOD/orchestrator |
| Q4 — branch protection, required checks, full history-secret and licence audits | Approved; `main` confirmed unprotected; the bounded tracked-tree secret scan was clean (16 Oct report §3.2) | Recorded identity + HOD |
| Q5 — droplet runner and reconciliation | Open; now additionally blocked on §2.1 | Owner (+ target reconciliation) |
| Q6 — host repairs (Intel RST, `cua-driver-serve`, AzureAiProxy wrapper, five scheduled tasks) | Diagnostic collection complete; repairs open | Owner |

The `cline-cloud[bot]` grant remains **`devops` push/PR on non-protected branches only**, expiring **2026-11-15**. This report does not expand it, touches no protected control, and records no task as Done.

