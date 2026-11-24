# Claude Code 2.1.323 (Linux build) for offline listing observation.
# Run with --network none; the model endpoint is a local capture server in the same container.
FROM node:22-alpine
RUN npm install -g @anthropic-ai/claude-code@2.1.323 && claude --version
RUN adduser -D -h /home/eval eval
USER eval
WORKDIR /home/eval
