# Access register

Verified against the provider on 2026-10-22 (contract rule 11). The scope column states
what the identity is **used for**; where the provider grants more than the register records,
the difference is named in the notes and the extra privilege is not used.

| Identity | Holder | Scope | Expiry | Notes |
| --- | --- | --- | --- | --- |
| author | Copilot CLI session | GitHub repo `eka-auto/jpbir` (formerly `jaytipargal/jpbir`, same repository id `1350770272`) push/PR workflow scope | session | Used for controlled automation changes and CI interactions. The repository name changed when the repository was transferred; the immutable id did not (D-18) |
| verifier | Pending owner setup | GitHub `project-verifier` and `project-state` branch-scoped write | pending | Must be separate from author for HOD independence |
| deployer | Vercel `jayti2/jpbir` project deploy identity | Production deployment only | managed by Vercel | Verified via `vercel whoami` and production redeploy logs |
| cline-agent | Cline agent sessions (`cline-cloud[bot]`) | GitHub repo `eka-auto/jpbir`: push/PR on non-protected branches. **Plus**, owner-directed 2026-10-18: may merge pull requests into `main` where the owner has given the approval, recorded in `project/approvals/2026-10-18-merge-authority.md`. Still no deploy and no direct write to protected controls | 2026-11-17 (30 days) | Owner-granted automation identity; acts as the `devops` role only. Scope widened for merging on the owner's in-session instruction; takes effect when this change is itself merged |
| cline-agent | Cline agent sessions (`cline-cloud[bot]`) | GitHub repo `eka-auto/jpbir`: push/PR on non-protected branches only. No merge, no deploy, no write to protected controls | 2026-11-15 (30 days) | Owner-granted automation identity; acts as the `devops` role only. Recorded so contract rule 11 can pass for unattended Cline sessions |
| eka-auto | Eka Automation (GitHub user `eka-auto`, id 339395426) | GitHub repo `eka-auto/jpbir`: push/PR on non-protected branches. No merge, no deploy, no write to protected controls | 2026-11-17 (30 days — owner to confirm) | **Access drift, recorded 2026-10-22.** The repository was transferred to this account, so GitHub now reports `admin: true` (it was registered as a collaborator with `write` and `admin: false` on 2026-10-18). The repository's immutable id is unchanged (`1350770272`), so this is the same resource under a new owner, not a different one. Contract rule 11 stops an action by an identity that holds more access than recorded, so the extra privilege is **not used**: this identity pushes a branch and opens a pull request, and does not merge to `main`, does not modify ruleset `25339138`, and does not deploy. The owner still owns the repository, and the GitHub billing lock recorded in T-04 is gone (CI green on `main` pushes and pull requests, 2026-10-21) |


## Bounded owner-approved release administration (2026-10-22)

The owner approved the concrete release plan in the Codex session: "YES — approve bounded release access (Recommended)". The durable approval is `project/approvals/2026-10-22-bounded-release-admin.md`.

For this task only, the older restrictions above are superseded as follows:

| Identity | Verified privilege and authorized use | Expiry |
| --- | --- | --- |
| `eka-auto` (339395426) | Repository owner/admin on `eka-auto/jpbir` (1350770272). Configure `STACK_EVIDENCE_KEY`; merge PR #192 at reviewed head `09c6a2f7d4985f599f9725bb8815756f64b48596`; apply reviewed hardening of ruleset 25339138; propose CODEOWNERS through a reviewed PR. No direct product-code push to main and no fabricated approval. | Completion of the listed operations, no later than 2026-10-23T23:59:59+05:30 |
| Vercel deployer `jayti-2` (J8FsOGqdjjAyNidmDAX5XNjZ) | Set the identical generated key as a production Secret on `jayti2/jpbir` (`prj_47peuCvcDnURmUqhU3aFlaBP351J`). Deployment remains through the existing Git integration. | Same bounded expiry |

The existing owner/admin privilege is acknowledged explicitly; this does not create any additional provider privilege or an ongoing administrative grant. The personal CLI identity `jaytipargal` is not used for administrative secret/ruleset mutations.
