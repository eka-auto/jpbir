# Environment manifest — jpbir (contract rule 3)
# Base image and toolchains pinned by digest. ENV PROJECT_ENV=1 marks "inside the environment".
# Every agent, CI job and person builds, tests and lints through project/environment/run.
FROM node:24.16.0-bookworm-slim@sha256:0000000000000000000000000000000000000000000000000000000000000000

# Toolchains pinned (digest placeholder — pin to the real digest at first build; see decisions.md)
# python 3.14.6 is needed by project/audit/tracker.py (stdlib-only, runs anywhere).
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.14 \
        git \
        curl \
    && rm -rf /var/lib/apt/lists/*

ENV PROJECT_ENV=1
ENV NODE_ENV=production
WORKDIR /app

# The repository is mounted at /app by compose.yaml (dev service).
# Entry point is project/environment/run <command>.
CMD ["project/environment/run"]
