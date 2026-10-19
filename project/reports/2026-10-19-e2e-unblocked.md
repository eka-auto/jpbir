# Report — the browser suite runs, and was never broken

**Date:** 2026-10-19 · **Author:** devops role (Cline), branch `cline/34rkyqre`
· **Identity:** `cline-cloud[bot]` on `jaytipargal/jpbir`.

## Result

`npm run test:browser` → **17/17 passed.** Nothing under `e2e/` or `Frontend/` was
changed to get there: the suite has been green on this code all along, and `git diff
191cb326..HEAD -- Frontend/ e2e/` is empty.

## Why it looked like 17 failures

Two gaps in the machine it was run on, both of which read like product bugs:

1. **No X/ATK/GBM libraries.** `chrome-headless-shell` aborts on load
   (`libglib-2.0.so.0: cannot open shared object file`), and Playwright reports
   *"Target page, context or browser has been closed"* for all 17 tests in ~1 ms each.
2. **No fonts.** Once the libraries were in place, every text node laid out with
   **height 0**, so `getByRole('heading', { name: 'Analytics' })` resolved and was
   reported *hidden*. Measured on the live page: `#gate h1` had `display: block`,
   `visibility: visible`, `height: 0`. With `fonts-dejavu-core` installed the same box
   measures 38.39px and the suite passes.

Neither can happen in CI, which runs `npx playwright install --with-deps chromium` —
except that since 2026-10-18T01:15Z the job has not run at all (the billing lock in
`2026-10-18-failing-checks-diagnosis.md`).

## Reproduction without root

```bash
ROOT=/workspace/.chromium-deps
APT="-o Dir::State::lists=$ROOT/apt/lists -o Dir::Cache=$ROOT/apt/cache \
     -o Dir::Etc::sourcelist=$ROOT/apt/sources.list -o Dir::Etc::sourceparts=- \
     -o Dir::State::status=$ROOT/empty-status -o APT::Sandbox::User=$(id -un)"
apt-get $APT update
apt-get $APT install -y --download-only --no-install-recommends \
  fonts-liberation fonts-dejavu-core libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
  libcairo2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 \
  libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2
for d in $ROOT/apt/cache/archives/*.deb; do dpkg -x "$d" $ROOT/sysroot; done

export LD_LIBRARY_PATH=$ROOT/sysroot/usr/lib/x86_64-linux-gnu:$ROOT/sysroot/lib/x86_64-linux-gnu
export FONTCONFIG_PATH=$ROOT/sysroot/etc/fonts XDG_DATA_HOME=$ROOT/sysroot/usr/share
npm run test:browser
```

`.chromium-deps/` is git-ignored. The `Dir::State::status` override matters: without
it apt believes the base image's stripped packages are installed and silently skips
`libdbus-1-3` and the rest of the closure.

## Durable fix

`project/environment/Dockerfile` now installs the same package set, so
`project/environment/run npm run test:browser` works from a clean manifest. CI still
does not run its gates through that manifest (contract rule 3), which is the gap that
let this drift: the job's own `--with-deps` line is the only thing keeping e2e
alive in CI.
