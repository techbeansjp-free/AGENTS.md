#!/bin/sh
# Isolation counterexamples (#1807): internal-only Docker networks, local dummy site, no model, no internet.
# Usage: sh isolation/run.sh <worktree-abs-path> <scratch-dir> <out-dir>
#   <scratch-dir> must be a new directory outside the repository holding playwright-core-1.49.1.tgz.
# Every resource gets the label asc.worktree=<worktree>; containers and networks are removed at the end.
set -eu
W="$1"; S="$2"; OUT="$3"
E="$W/docs/evidence/1807-design-eval-browser"
L="asc.worktree=$W"
IMG=${IMG:-asc-1807-browser:1}   # IMG=asc-1807-tools:1 SKIP_BUILD=1 re-runs the probes on the image used for the run
mkdir -p "$S/ctx" "$S/work" "$S/log" "$S/home-sim" "$OUT"
cp "$E/env/Dockerfile" "$S/pkg/playwright-core-1.49.1.tgz" "$S/ctx/"
[ "${SKIP_BUILD:-0}" = 1 ] || docker build --network none --target browser --label "$L" -t "$IMG" "$S/ctx" > "$S/build.log" 2>&1
MARK=marker-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
echo "$MARK-token" > "$S/home-sim/$MARK"

cleanup() {
  for c in asc1807-probe asc1807-proxy asc1807-proxy2 asc1807-site; do docker rm -f -v "$c" >/dev/null 2>&1 || true; done
  for n in asc1807-gen asc1807-up; do docker network rm "$n" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT
cleanup
docker network create --internal --label "$L" asc1807-gen >/dev/null
docker network create --internal --label "$L" asc1807-up >/dev/null
HARD="--read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 512m --cpus 1 --label $L"
docker run -d --name asc1807-site $HARD --network asc1807-up \
  --network-alias allowed.test --network-alias blocked.test --network-alias allowed.test.blocked.test --network-alias model-api.test \
  -v "$E/isolation:/opt/iso:ro" node:22-alpine node /opt/iso/dummy-site.mjs >/dev/null
for p in proxy proxy2; do
  cfg=allowlist.test.json; [ "$p" = proxy2 ] && cfg=allowlist.test-private.json
  docker run -d --name asc1807-$p $HARD --user node --network asc1807-up \
    -v "$E/env:/opt/env:ro" -v "$E/isolation:/opt/iso:ro" node:22-alpine node /opt/env/proxy.mjs /opt/iso/$cfg >/dev/null
  docker network connect --alias $p asc1807-gen asc1807-$p
done
SITE_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "asc1807-up").IPAddress}}' asc1807-site)
sleep 2
set +e
docker run --name asc1807-probe --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 2g --cpus 2 \
  --shm-size 512m --tmpfs /tmp:rw,size=256m --user pwuser --label "$L" --network asc1807-gen \
  -v "$S/work:/work" -v "$E/env:/opt/env:ro" -v "$E/isolation:/opt/iso:ro" -v "$E/isolation:/config:ro" -v "$S/log:/log" \
  -e HOME=/tmp -e PROXY_HOST=proxy -e PROXY2_HOST=proxy2 -e SITE_IP="$SITE_IP" -e MARKER_NAME="$MARK" \
  -e BROWSE_PROXY=http://proxy:3129 -e ALLOWLIST=/config/allowlist.test.json -e WORK_DIR=/work -e TOOL_LOG=/log/tools.jsonl \
  "$IMG" node /opt/iso/probe.mjs > "$OUT/probe.json" 2> "$S/probe.stderr"
echo "probe exit=$?"
set -e
docker inspect asc1807-probe --format '{{json .HostConfig}}' | python3 -I -c '
import json,sys; h=json.load(sys.stdin)
print(json.dumps({k:h.get(k) for k in ["ReadonlyRootfs","CapDrop","CapAdd","SecurityOpt","Privileged","PidsLimit","Memory","NanoCpus","ShmSize","NetworkMode","Tmpfs"]}|{"bindTargets":[b.split(":")[1] for b in h.get("Binds") or []]},indent=1))' > "$OUT/probe-hostconfig.json"
docker network inspect asc1807-gen asc1807-up --format '{{.Name}} internal={{.Internal}}' > "$OUT/networks.txt"
docker logs asc1807-proxy 2>&1 | grep -v '"event"' > "$OUT/proxy.jsonl" || true
docker logs asc1807-proxy2 2>&1 | grep -v '"event"' > "$OUT/proxy2.jsonl" || true
docker logs asc1807-site > "$OUT/site.jsonl" 2>&1 || true
cp "$S/log/tools.jsonl" "$OUT/tools.jsonl" 2>/dev/null || true
python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print("pass" if d["pass"] else "FAIL", sum(r["pass"] for r in d["results"]), "/", len(d["results"]))' "$OUT/probe.json"
