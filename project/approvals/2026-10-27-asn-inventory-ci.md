# Owner direction — add the read-only ASN inventory CI step (2026-10-27)

The blocked remainder of batch-2 question 2 (live `jpbir_live` ASN counts) was offered with
two unblocks: a local live `DATABASE_URL` the agent never sees, or *"say the word and I'll
add a read-only CI step in a future PR"*. The owner answered **"add it"**.

## What that authorizes

| Action | Approval |
| --- | --- |
| Add `Database/scripts/asn-inventory.mjs` (SELECT-only inventory) and `.github/workflows/asn-inventory.yml` through a normal reviewed pull request | Approved — pipeline files change only through reviewed PRs (contract rule 12), so this file is the record and the PR carries the change |
| The workflow reads `secrets.DATABASE_URL` (the same secret `migrate-production.yml` already uses) and prints counts to the CI log as evidence | Approved — counts and database name only; the script cannot print a connection string (enforced by `asn-inventory.test.mjs`) |
| Triggering it once by `workflow_dispatch` on `main` after merge to collect the live numbers | Approved |

## Not authorized

No migration, no schema or data change, no write of any kind (SELECT-only, contract-tested),
no `pull_request` trigger (public repo — the secret must never face a fork), no change to any
existing workflow. Merging this PR requires the usual owner approval step unless the owner
says otherwise, as with #202 and #203.
