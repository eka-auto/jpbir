# syntax=docker/dockerfile:1
#
# jpbir project environment - the single manifest for every runner
# (contract rule 3; Step 0 item 7 / T-03; decision D-8).
#
# Build, test and lint run here, through project/environment/run, and nowhere
# else. Base images are pinned by digest: bump a digest deliberately and record
# it in project/decisions.md, never float on a tag.

# Python 3.14.6, taken from the official image so the version is exact and there
# is no source build. tracker.py is stdlib-only, and the repo's Python mirrors
# (_shared/tests/python-harness.mjs) run under this interpreter.
FROM python:3.14.6-slim-bookworm@sha256:4c92ffcde4dd6f1ff72a24518f49fd4990b27134987dfa31a733badde66df9f8 AS python

# Node 24.16.0 on Debian bookworm - the repo's runtime (package.json engines: 24.x).
FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203

# Contract rule 3: the entry point executes the command directly once inside.
ENV PROJECT_ENV=1
ENV NODE_ENV=development

# Runtime libraries the copied CPython stdlib C extensions link against.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      curl \
      libbz2-1.0 \
      libexpat1 \
      libffi8 \
      liblzma5 \
      libncursesw6 \
      libreadline8 \
      libsqlite3-0 \
      libssl3 \
      libuuid1 \
      zlib1g \
 && rm -rf /var/lib/apt/lists/*

# Copy CPython 3.14.6 out of the official image: the interpreter, its shared
# library and the standard library. `python3 --version` fails the build if the
# interpreter cannot start, so a broken copy never ships as a green image.
COPY --from=python /usr/local/bin/python3.14 /usr/local/bin/python3.14
COPY --from=python /usr/local/lib/libpython3.14.so.1.0 /usr/local/lib/libpython3.14.so.1.0
COPY --from=python /usr/local/lib/python3.14 /usr/local/lib/python3.14
RUN ln -sf python3.14 /usr/local/bin/python3 \
 && ln -sf python3.14 /usr/local/bin/python \
 && ldconfig \
 && python3 --version

WORKDIR /workspace
