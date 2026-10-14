# Access register

| Identity | Holder | Scope | Expiry | Notes |
| --- | --- | --- | --- | --- |
| author | Copilot CLI session | GitHub repo `jaytipargal/jpbir` push/PR workflow scope | session | Used for controlled automation changes and CI interactions |
| verifier | Pending owner setup | GitHub `project-verifier` and `project-state` branch-scoped write | pending | Must be separate from author for HOD independence |
| deployer | Vercel `jayti2/jpbir` project deploy identity | Production deployment only | managed by Vercel | Verified via `vercel whoami` and production redeploy logs |
