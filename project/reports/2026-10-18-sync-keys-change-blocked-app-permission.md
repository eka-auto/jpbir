# The DB-URL sync change — verified here, but this identity cannot push it (2026-10-18)

Role `devops` (`cline-cloud[bot]`). This records work done end to end and the hard block hit at the end.

## The change

Same content as PR #173 (owner's branch `feat/jp-agent-droplet-runner`), landed on a correctly named
short-lived branch and tidied so the file carries one comment instead of two:

- `.github/workflows/sync-keys-to-vercel.yml`, 1 file, **+3 −2**
- removes `DATABASE_URL DATABASE_URL_UNPOOLED POSTGRES_URL POSTGRES_URL_NON_POOLING` from `SYNC_KEYS`
- replaces the duplicated "Every key the deployed code reads" comment with one that states the reason:
  the `jpbir_live` production database is pinned outside CI so the readable recovered chats stay intact
- applied patch: `project/reports/2026-10-18-sync-keys-drop-db-urls.patch` (`git apply` it, or merge #173)

## Verification actually performed (not eyeballed)

| Check | Tool / method | Result |
| --- | --- | --- |
| Workflow still lints clean | **actionlint 1.7.12**, the exact version `ci-cd.yml` pins, run against the edited file | **exit 0**, no findings — identical to the same file on `main` |
| Env list still correct | folded-scalar parse of the edited `SYNC_KEYS` block | **24 keys**, no `DATABASE_URL`/`POSTGRES_URL` remains, `CRON_SECRET`, `DB_ADMIN_KEY`, `WA_INGEST_KEY`, `S24_SYNC_PUBLIC_KEYS` all intact |
| No collateral edit | byte check | CRLF endings preserved, duplicate comment gone, diff limited to the two hunks |
| Blast radius on production | read of `.github/scripts/sync-keys-to-vercel.mjs` | script is **add-only** ("Nothing is updated or removed"), so no Vercel variable is deleted or rewritten; the `STATIC_ENV_FILES` guard cannot fire because no workflow sets it |

## The block — the push was rejected by the Git host

```
! [remote rejected] ci/sync-keys-drop-db-urls -> ci/sync-keys-drop-db-urls
  (refusing to allow a GitHub App to create or update workflow
   `.github/workflows/sync-keys-to-vercel.yml` without `workflows` permission)
```

The Cline GitHub App installation does not hold the **`workflows`** permission, so this identity cannot
create or update any file under `.github/workflows/` — not on a branch, not in a PR, not for a tidy-up.
This is a host-level rule, not a pipeline rule. Consequence: **PR #173 is the only vehicle that can carry
this change**, because its author (the owner) pushes with a credential that has the permission. My
verified version exists only as the patch above.

## What unblocks it

1. **Owner:** enable Actions again (Settings → Billing; repo → Settings → Actions → General). Until then
   every check on every PR is **Error**, and nothing can be merged with evidence.
2. **Owner:** merge **#173** as it stands (the change itself is verified above), or grant the Cline app the
   **`workflows`** permission and the tidied version will be pushed as its own PR.
3. **Owner:** set a real expiry for `eka-auto` in `project/ACCESS.md` (PR #174 currently records
   2026-11-17, 30 days).

## Correction to the earlier review

`.github/actionlint.yaml` declares the self-hosted labels `jp-agent-droplet`, `jp-agent`, `droplet`,
`deploy`, so `runs-on: [self-hosted, jp-agent-droplet]` in `deploy-droplet.yml` is valid and lint-clean.
The deploy job is therefore not mislabelled — the self-hosted runner is simply **not online**, which is
owner answer Q5 and still open.
