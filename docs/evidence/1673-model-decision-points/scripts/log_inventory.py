"""Read-only inventory of Claude Code and Codex session logs.

Outputs only metadata and counts (no message text) to the given JSON path.
Per session: host, project root (cwd without .worktrees/...), first/last timestamp,
models with token usage, ASC markers, subagent (sidechain) usage.
"""
import json, os, re, sys, pathlib, collections

out_path = pathlib.Path(sys.argv[1])
ASC = re.compile(r"skills/asc/|asc-v05\.mjs|\.agent-skill-chain|worktree-create|review-and-remediation|subagent-model-selection")

def root(cwd):
    if not cwd:
        return None
    return re.sub(r"/\.worktrees/.*$", "", cwd)

def scan_claude(path):
    s = {"host": "claude", "file": str(path), "cwd": None, "first": None, "last": None,
         "models": collections.defaultdict(lambda: [0, 0, 0, 0]), "asc_hits": 0,
         "sidechain_msgs": 0, "lines": 0}
    with open(path, "rb") as f:
        for raw in f:
            s["lines"] += 1
            if ASC.search(raw.decode("utf-8", "ignore")):
                s["asc_hits"] += 1
            try:
                o = json.loads(raw)
            except Exception:
                continue
            if not isinstance(o, dict):
                continue
            s["cwd"] = s["cwd"] or o.get("cwd")
            ts = o.get("timestamp")
            if ts:
                s["first"] = s["first"] or ts
                s["last"] = ts
            if o.get("isSidechain"):
                s["sidechain_msgs"] += 1
            m = o.get("message")
            if isinstance(m, dict) and m.get("role") == "assistant" and m.get("model"):
                u = m.get("usage") or {}
                r = s["models"][m["model"]]
                r[0] += 1
                r[1] += u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
                r[2] += u.get("cache_read_input_tokens", 0)
                r[3] += u.get("output_tokens", 0)
    return s

def scan_codex(path):
    s = {"host": "codex", "file": str(path), "cwd": None, "first": None, "last": None,
         "models": collections.defaultdict(lambda: [0, 0, 0, 0]), "asc_hits": 0,
         "sidechain_msgs": 0, "lines": 0}
    model = None
    last_total = None
    with open(path, "rb") as f:
        for raw in f:
            s["lines"] += 1
            if ASC.search(raw.decode("utf-8", "ignore")):
                s["asc_hits"] += 1
            try:
                o = json.loads(raw)
            except Exception:
                continue
            if not isinstance(o, dict):
                continue
            ts = o.get("timestamp")
            if ts:
                s["first"] = s["first"] or ts
                s["last"] = ts
            p = o.get("payload") if isinstance(o.get("payload"), dict) else {}
            if o.get("type") in ("session_meta", "turn_context"):
                s["cwd"] = s["cwd"] or p.get("cwd")
                model = p.get("model") or model
            if p.get("type") == "token_count" and isinstance(p.get("info"), dict):
                t = p["info"].get("total_token_usage") or {}
                last_total = t
    if last_total:
        r = s["models"][model or "unknown"]
        r[0] += 1
        r[1] += last_total.get("input_tokens", 0) - last_total.get("cached_input_tokens", 0)
        r[2] += last_total.get("cached_input_tokens", 0)
        r[3] += last_total.get("output_tokens", 0)
    return s

sessions = []
for base, fn in ((pathlib.Path.home() / ".claude/projects", scan_claude), (pathlib.Path.home() / ".codex/sessions", scan_codex)):
    for p in base.rglob("*.jsonl"):
        try:
            s = fn(p)
        except Exception as e:
            continue
        s["root"] = root(s["cwd"])
        s["models"] = {k: v for k, v in s["models"].items()}
        sessions.append(s)

out_path.write_text(json.dumps(sessions, ensure_ascii=False))
by = collections.defaultdict(lambda: {"sessions": 0, "asc_sessions": 0, "hosts": collections.Counter()})
for s in sessions:
    b = by[s["root"] or "?"]
    b["sessions"] += 1
    b["hosts"][s["host"]] += 1
    if s["asc_hits"]:
        b["asc_sessions"] += 1
print("sessions", len(sessions))
for r, b in sorted(by.items(), key=lambda x: -x[1]["asc_sessions"])[:25]:
    print(b["asc_sessions"], b["sessions"], dict(b["hosts"]), r)
