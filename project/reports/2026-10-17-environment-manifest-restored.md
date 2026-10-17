# Restored the missing project environment manifest — 2026-10-17

**Author:** Cline cloud session `tsk-01M53NS38R0JWAD2Z3GFNZ5Z4D`, acting as `cline-cloud[bot]` — the `devops` automation identity recorded in `project/ACCESS.md` (push/PR on non-protected branches only, expiring 2026-11-15).
**Subject:** `jaytipargal/jpbir` `main@9fb86fcac4f66416d9ddc5bd6f4175396afdd6e8`, branch `cline/gfnz5z4d`.
**Purpose:** record the real repository blocker behind the "cloud environment denies Alpine access" report — the required environment manifest was absent — and what was added. Diagnostic record and Step 0 draft; not a tracker event (the `project-state` branch still does not exist), not HOD sign-off, and not merged.

## 1. The blocker, verified

Cloud-environment onboarding reported: *"jpbir requires `project/environment/run`, but its environment directory is missing."* That is true in the repository:

| Check | Result |
| --- | --- |
| `ls project/environment` on `main@9fb86fc` | `No such file or directory` |
| `git ls-tree -r --name-only HEAD -- project` | no `project/environment/*` |
| `git log --all --oneline -- project/environment` | empty — never existed in any ref |
| `git check-ignore -v project/environment/...` | not ignored |

Contract rule 3 requires it (`project/environment/Dockerfile`, `project/environment/compose.yaml`, entry point `project/environment/run`), Step 0 item 7 / task T-03 drafts it, and decision D-8 recorded its design. It was simply never committed.

## 2. What was added

- `project/environment/run` — byte-for-byte the pinned skill's template: it `exec`s the command directly when `PROJECT_ENV=1`, otherwise `exec docker compose -f compose.yaml run --rm dev "$@"`. Executable bit set.
- `project/environment/Dockerfile` — base `node:24.16.0-bookworm-slim` pinned by digest, `ENV PROJECT_ENV=1`, plus CPython 3.14.6 copied from the official image (D-8) with the stdlib runtime libraries, `git`/`curl`/`ca-certificates`.
- `project/environment/compose.yaml` — a `dev` service built from the Dockerfile with the repository mounted, and a pinned `postgres:16.4-bookworm` backing service with a health check.

Pinned digests (resolved from the registry on 2026-10-17, not copied from a tag):

| Image | Digest |
| --- | --- |
| `node:24.16.0-bookworm-slim` | `sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203` |
| `python:3.14.6-slim-bookworm` | `sha256:4c92ffcde4dd6f1ff72a24518f49fd4990b27134987dfa31a733badde66df9f8` |
| `postgres:16.4-bookworm` | `sha256:e62fbf9d3e2b49816a32c400ed2dba83e3b361e6833e624024309c35d334b412` |

## 3. Verification performed here

| Check | Command | Result |
| --- | --- | --- |
| Entry-point syntax | `sh -n project/environment/run` | OK |
| Entry-point passthrough | `PROJECT_ENV=1 sh project/environment/run echo inside-env-ok` | prints `inside-env-ok` |
| Digests resolve | `HEAD registry-1.docker.io/v2/library/<image>/manifests/<tag>` | all three match the pinned digests |
| Repo checks unchanged | `npm ci && npm run lint && npm run build && npm test` | lint OK, build OK, **49/49 suites passed** |

**Not verified here, and stated as such:** the image build itself. This sandbox has **no Docker** (`docker: command not found`), so `project/environment/run` cannot be exercised end to end. Per D-8 the digest pin is confirmed "at first build"; the build belongs to CI on this pull request, where the environment is built and the existing build and tests run inside it (Step 0 item 7 ordering).

## 4. Boundary: the Alpine denial and jaytibirthday-site

- `dl-cdn.alpinelinux.org` is reachable from **this** sandbox (DNS + HTTP 200 on the root, both `APKINDEX` paths, plain http, and an independent mirror; a real `.apk` downloaded and inflated). The `403` is a property of the other runner's proxy, not reproducible here — a platform/owner action, not a repository change.
- `jaytibirthday-site` is **not present in this workspace** (`find / -iname '*jaytibirthday*'` finds nothing), and no `Dockerfile` exists anywhere here. Its Dockerfile and its own missing CI/CD-skill copy are that repository's work; nothing in `jpbir` can change them.

## 5. Status

- This is the Step 0 manifest draft (T-03), proposed for review through a pull request; it is **not merged**, and `project/environment/` is a protected control (contract rule 12), so it needs the owner's/HOD's review, not a worker merge.
- No `project/ACCESS.md`, `project/decisions.md`, tracker file or workflow is changed.
- The claim "jpbir now passes all 49 test suites, lint, build" is **independently confirmed here** (49/49).
