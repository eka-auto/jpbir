# Owner approval: bounded visitor-history restore

The owner requested `@Compound-Engineering fix it`, then explicitly answered `YES — run the bounded backfill (Recommended)` to this prepared operation:

> Approve a one-time exception to run the tested PostgreSQL backfill locally: insert 872 missing birthday events into the verified live jpbir_live database, preserve existing events, refresh affected session/visitor rollups, and save an encrypted rollback record before commit?

This is the one-time executor exception to contract rule 3 for this operation only, not a permanent rule change or new access grant.

- Neon project: fancy-cloud-99501540.
- Source: original branch, neondb, neondb_owner, fingerprint 26aa04d6c3284dccd8cca3ce18506d7aa7ec6fe095395d2d469c7b950ae81a44.
- Target: verified live jpbir_live, neondb_owner, fingerprint 54630545ea1855e7a48e91c74762a17a0710294a3e10f40031517d76af55b629.
- Site: jaytibirthday.in. Window starts 2026-10-10T00:00:00+05:30 and ends 2026-10-21T22:01:03.470Z.
- Source count 1068; existing 196; missing 872.
- Source digest cc2e1c66c4155127998d665bacf8804ec80bc282abf7d205786b9e3ab706eb58.
- Missing digest f1dc43340ea4d172671713f37959c8e27c65fc85dcc42a68c4d823d4459ef33a.
- Reviewed implementation e4bcaebe45f41783f6b4a19a5bdf4cee5204d712 (PR #195); 13 isolated PostgreSQL/planning checks passed and independent review completed.
- No source writes, deletion, overwriting existing target events, schema change, database repointing, credential disclosure, or private-data publication.
- Evidence: project/checkpoints/2026-10-22-visitor-restore-intent.json; apply receipt and live verification follow the operation.
