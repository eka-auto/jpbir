# Owner approval — ASN review follow-up (2026-10-27, second batch)

After the adversarial review of the merged ASN change (PR #202 / 5ae872e9) was reported —
14 confirmed findings, 0 high-severity code defects, 3 high-priority gaps — the owner answered
the batched questions with **"1 yes 23 yes"**, read as YES to both:

1. **YES — open the follow-up fix PR.** Scope: F1 transport faults must not be negative-cached;
   F2 NAT64 `64:ff9b::` / 6to4 `2002::` private embeds and documentation ranges into the
   non-public filter; F3 canonicalization (hex-mapped, leading-zero, zone-id) so one host is
   one cache key; F4 in-flight dedup (concurrent success no longer overwritten by a late
   failure); F5 warm cache reads inside a starved budget; F19 replace the real IP/city/ISP
   test fixtures with synthetic ones; F21 an AbortSignal regression test; F22 handler-wiring
   contract tests; and the gap-2 `intel` response block (attempted/resolved/over_budget) on
   both visitor endpoints.
2. **YES — authorize the read-only warehouse query** to settle the critic's gap 1 (does the
   sibling tracker write `events.asn` / `asn_org` / `asn_source` into the same warehouse?).
   Credentials are consumed in-process by the repository's own Database tooling and are never
   printed, logged or committed. SELECT-only; no write, no migration (contract rule on
   production data changes not triggered by a read).

Not authorized by this file: merging the follow-up PR (owner reviews it separately), any
database write, any ingestion change, or any change to D-16 scope beyond the items above.

Recorded by the opencode session under the still-valid identity row in `project/ACCESS.md`.
