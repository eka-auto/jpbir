# Owner approval: ASN / network-org labels in the visitor drawer (R1 scope addition)

The owner asked for the feature directly ("add an ASN/org lookup to the dashboard so those
show a name instead of unattributed"), was shown a preview rendered with the shipped drawer
code, and answered **YES** to the batched scope question:

> 1. Include the ASN/org network labels in release R1 as a scope addition?
>    (Recommendation: YES — read-only enrichment, no schema change, no DB writes, no
>    backfill; one caveat: visitor IPs are sent to ipwho.is for the ASN lookup.)

What the YES authorizes:

- Record the R1 scope addition as an amendment to D-16 (this decision is **D-32**).
- Re-port the already-built and tested enrichment onto current `main` and open a pull
  request through the normal reviewed pipeline (owner approves the PR; CI gates run; the
  Vercel Git integration deploys after merge).
- Record run-state files (this approval and the intent checkpoint) on `project-state`.
- The PR also records the acting session's identity in `project/ACCESS.md`.

What the YES does not authorize: merging without owner review, direct pushes to `main`,
any database write or backfill, any schema change, and any deploy from an agent shell.

Egress note accepted by the YES: each unique visitor IP is looked up on read at
`ipwho.is` (fallback `ipinfo.io`), ~200 ms per new IP, cached 7 days per warm instance,
private/reserved addresses never sent. No IP is stored or sent anywhere else.

Identity verified before the external action (contract rule 11): session signed in as
`jaytipargal` (id 313854821), `permissions.push = true` on `eka-auto/jpbir`
(repository id 1350770272, matching `project/targets.json`).

- Date: 2026-10-27
- Question answered: 1 YES (this run's single batched owner question)
- Recorded by: opencode session acting as the author role
