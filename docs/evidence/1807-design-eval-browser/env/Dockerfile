# Tool and rendering container (#1807). Build context: a new empty directory holding this file,
# playwright-core-1.49.1.tgz and axe-core-4.10.2.tgz (npm pack; sha512 checked against the registry metadata).
#
# Stage "browser": headless Chromium + playwright-core. `docker build --network none --target browser`.
# Stage "tools"  : + CJK fonts (apt; the only build step that needs network, approved by the owner) + axe-core (offline).
#   Used for the generator's MCP tools (fetch_page / view_page / screenshot), the renderer and the gold check.
# The generator CLI itself runs on the host with restricted tools (README「生成環境」); it is not installed here.
FROM mcr.microsoft.com/playwright:v1.49.1-noble@sha256:70e367e0cbf60340a5b5fd562f6247a34eb3196efab9f88a3dd56482d9fe09d2 AS browser
COPY playwright-core-1.49.1.tgz /tmp/pwc.tgz
RUN cd /opt && npm install --offline --no-audit --no-fund --ignore-scripts /tmp/pwc.tgz && rm /tmp/pwc.tgz
USER pwuser
WORKDIR /work

FROM browser AS tools
USER root
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-noto-cjk-extra fonts-dejavu-core fonts-liberation \
  && rm -rf /var/lib/apt/lists/* && fc-cache -f
COPY axe-core-4.10.2.tgz /tmp/axe.tgz
RUN cd /opt && npm install --offline --no-audit --no-fund --ignore-scripts /tmp/axe.tgz && rm /tmp/axe.tgz
USER pwuser
WORKDIR /work
