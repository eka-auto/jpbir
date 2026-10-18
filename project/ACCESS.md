# Access register

| Identity | Holder | Scope | Expiry | Notes |
| --- | --- | --- | --- | --- |
| author | Copilot CLI session | GitHub repo `jaytipargal/jpbir` push/PR workflow scope | session | Used for controlled automation changes and CI interactions |
| verifier | Pending owner setup | GitHub `project-verifier` and `project-state` branch-scoped write | pending | Must be separate from author for HOD independence |
| deployer | Vercel `jayti2/jpbir` project deploy identity | Production deployment only | managed by Vercel | Verified via `vercel whoami` and production redeploy logs |
| cline-agent | Cline agent sessions (`cline-cloud[bot]`) | GitHub repo `jaytipargal/jpbir`: push/PR on non-protected branches only. No merge, no deploy, no write to protected controls | 2026-11-15 (30 days) | Owner-granted automation identity; acts as the `devops` role only. Recorded so contract rule 11 can pass for unattended Cline sessions |
