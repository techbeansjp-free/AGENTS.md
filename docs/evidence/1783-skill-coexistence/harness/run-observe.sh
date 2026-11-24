#!/bin/sh
# Runs one listing observation in a disposable container: no network, read-only root, no home or secret mounts.
# Usage: run-observe.sh <worktree-label> <fixture-dir> <conditions.json> <condition> <out-dir>
set -eu
label=$1 fixture=$2 conds=$3 cond=$4 out=$5
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
docker run --rm --network none --read-only \
  --tmpfs /home/eval:rw,size=512m,uid=1001,gid=1001,mode=0700 --tmpfs /tmp:rw,size=64m \
  --memory 1g --cpus 2 --pids-limit 256 --user 1001:1001 \
  --label "asc.worktree=$label" --label asc.issue=1783 \
  -v "$here:/harness:ro" -v "$fixture:/fixture:ro" -v "$(cd "$(dirname "$conds")" && pwd)/$(basename "$conds"):/conds.json:ro" -v "$out:/out" \
  asc-1783-host:2.1.323 node /harness/observe-in-container.mjs /conds.json "$cond" /out
