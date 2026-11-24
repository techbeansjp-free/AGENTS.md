# Claude Code (Linux build) for offline listing observation. Build with --build-arg VERSION=<x.y.z>.
# Run with --network none; the model endpoint is a local capture server in the same container.
FROM node:22-alpine
ARG VERSION
RUN npm install -g @anthropic-ai/claude-code@${VERSION} && claude --version
RUN adduser -D -h /home/eval eval
USER eval
WORKDIR /home/eval
