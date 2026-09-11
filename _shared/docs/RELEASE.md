# Frontend assembly production release

Published [eb5fc09](https://github.com/jaytipargal/jpbir/commit/eb5fc09671ed6c55abd472d9ce09126561be3afb) to main.
GitHub [CI](https://github.com/jaytipargal/jpbir/actions/runs/34004815285) passed.

Vercel production deployment: dpl_B1M2BmAheCP42yjRwfL2r4chNBvY (READY).
All production aliases are assigned. All three repository-linked Vercel projects reached READY.

| Setting | Verified value |
| --- | --- |
| Root Directory | Dashboard/Current |
| Build Command | npm run build |
| Output Directory | dist |
| Include sibling sources | Enabled |

The homepage, S24 page, VivoBook page, and tracker return HTTP 200 on both jaytipargal.tech and jayti-dashboard.vercel.app. Their bytes match the clean release build.
The existing /api/jp-devices route returns HTTP 401 without credentials on both domains.
All 27 protected source/workspace files retain their pre-change hashes. Unrelated edits were excluded from the commit.

The complete release pipeline passed: 39 Python tests, 24 Python subtests, 36 dashboard tests, JavaScript syntax checks, and the frontend build.

Evidence: release-verification.json, production-http-checks.json, project-settings-readback.json, vercel-build-evidence.txt, snapshot-pipeline.log, and frontend-assembly.patch.
