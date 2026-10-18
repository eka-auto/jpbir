# Access register

| Identity | Holder | Scope | Expiry | Notes |
| --- | --- | --- | --- | --- |
| author | Copilot CLI session | GitHub repo `jaytipargal/jpbir` push/PR workflow scope | session | Used for controlled automation changes and CI interactions |
| verifier | Pending owner setup | GitHub `project-verifier` and `project-state` branch-scoped write | pending | Must be separate from author for HOD independence |
| deployer | Vercel `jayti2/jpbir` project deploy identity | Production deployment only | managed by Vercel | Verified via `vercel whoami` and production redeploy logs |
| cline-agent | Cline agent sessions (`cline-cloud[bot]`) | GitHub repo `jaytipargal/jpbir`: push/PR on non-protected branches. **Plus**, owner-directed 2026-10-18: may merge pull requests into `main` where the owner has given the approval, recorded in `project/approvals/2026-10-18-merge-authority.md`. Still no deploy and no direct write to protected controls | 2026-11-17 (30 days) | Owner-granted automation identity; acts as the `devops` role only. Scope widened for merging on the owner's in-session instruction; takes effect when this change is itself merged |
