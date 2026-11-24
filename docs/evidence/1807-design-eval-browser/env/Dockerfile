# Generator environment (#1807). Build context: a new empty directory holding this file and
# playwright-core-1.49.1.tgz (npm pack; sha512 integrity checked against the registry metadata).
#
# Stage "browser": headless Chromium + playwright-core, built with `docker build --network none --target browser`.
#   Used for the isolation counterexamples (no model, no internet).
# Stage "generator": adds fonts and the Claude Code CLI. Needs network at build time (apt, npm registry),
#   so it is built only after the owner approves the run (EVAL_PLAN.md). Not built in the preparation phase.
FROM mcr.microsoft.com/playwright:v1.49.1-noble@sha256:70e367e0cbf60340a5b5fd562f6247a34eb3196efab9f88a3dd56482d9fe09d2 AS browser
COPY playwright-core-1.49.1.tgz /tmp/pwc.tgz
RUN cd /opt && npm install --offline --no-audit --no-fund --ignore-scripts /tmp/pwc.tgz && rm /tmp/pwc.tgz
USER pwuser
WORKDIR /work

FROM browser AS generator
USER root
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-noto-cjk-extra fonts-dejavu-core fonts-liberation \
  && rm -rf /var/lib/apt/lists/* && fc-cache -f
# Version pinned to the Host version used for #1804. Owner decision may change it before the run.
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code@2.1.323
USER pwuser
WORKDIR /work
