# Environment manifest (contract rule 3) - jpbir run R1, decision D-8.
# node:24.16.0-bookworm-slim pinned by tag; pin the digest at first build
# (D-8 placeholder note). Every build, test and lint runs through
# project/environment/run; deploys run only from CI or provider pipelines.
FROM node:24.16.0-bookworm-slim
ENV PROJECT_ENV=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
CMD ["sleep", "infinity"]