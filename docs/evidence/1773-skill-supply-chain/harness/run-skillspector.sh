#!/bin/sh
# Runs the pinned SkillSpector image once per directory under <input-root>, static mode only, without network.
# usage: run-skillspector.sh <image> <input-root> <output-dir> <worktree-label> [extra scan options...]
# Each container is disposable (--rm), has no network, no capabilities, a read-only root and a read-only input mount,
# and receives no environment from the caller (so no provider credential can reach it). Output is the JSON on stdout,
# the exit code and the child's peak RSS / wall time, written by the caller's shell into <output-dir>.
set -eu
image=$1 root=$2 out=$3 label=$4
shift 4
mkdir -p "$out"
for dir in "$root"/*/; do
  id=$(basename "$dir")
  start=$(date +%s)
  set +e
  docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges --read-only \
    --tmpfs /tmp:rw,size=256m --tmpfs /home/scanner:rw,size=64m --memory 2g --pids-limit 256 \
    --label "asc.worktree=$label" -v "$dir:/scan/in:ro" --entrypoint python "$image" -c '
import resource, subprocess, sys, time
t = time.monotonic()
r = subprocess.run(["skillspector", "scan", "/scan/in", "--no-llm", "--format", "json", *sys.argv[1:]], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
sys.stdout.buffer.write(r.stdout)
sys.stderr.write(r.stderr.decode(errors="replace")[-4000:])
sys.stderr.write("\nASC_MEASURE exit=%d rss_kib=%d seconds=%.2f\n" % (r.returncode, resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss, time.monotonic() - t))
sys.exit(r.returncode)
' "$@" >"$out/$id.json" 2>"$out/$id.stderr"
  code=$?
  set -e
  echo "$id exit=$code wall=$(( $(date +%s) - start ))s"
done
