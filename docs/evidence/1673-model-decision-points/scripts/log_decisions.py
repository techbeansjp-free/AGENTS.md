"""Read-only analysis of ASC Claude Code sessions for decision-point behaviour.

Input: inventory.json from log_inventory.py. Only sessions with ASC markers on host claude.
Outputs aggregate counts only (no message text, no paths) to stdout and a JSON file.
"""
import json, re, sys, pathlib, collections

inv = json.loads(pathlib.Path(sys.argv[1]).read_text())
out = pathlib.Path(sys.argv[2])
files = [s["file"] for s in inv if s["host"] == "claude" and s["asc_hits"]]

TEST_CMD = re.compile(r"\b(npm (run )?test|npm run quality|pnpm (run )?test|yarn test|node --test|pytest|go test|cargo test|vitest|jest|playwright test|make test|bun test)\b")
PASS_CLAIM = re.compile(r"(テスト|test|tests)[^。\n]{0,40}(すべて|全て|全部|all)?[^。\n]{0,20}(通り|通過|成功|合格|pass(ed)?|green)", re.I)
SEV = re.compile(r"\b(High|Medium|Low)\b")
REVIEW = re.compile(r"独立レビュー|independent review", re.I)

def norm(cmd):
    cmd = re.sub(r"\s+", " ", cmd.strip())
    return cmd[:120]

stats = collections.Counter()
tok_main = collections.defaultdict(lambda: [0, 0, 0])   # model -> [fresh_in, cache_read, out]
tok_side = collections.defaultdict(lambda: [0, 0, 0])
agent_models = collections.Counter()
review_models = collections.Counter()
review_sev = collections.Counter()
streak_after = collections.Counter()
streak_len = collections.Counter()

for f in files:
    stats["sessions"] += 1
    tool_cmd = {}              # tool_use_id -> normalized command
    tool_kind = {}             # tool_use_id -> 'review' when an independent review Agent
    test_ran = False
    last_fail_cmd, run = None, 0
    pending_streak = None      # (cmd, len) awaiting the next action
    try:
        fh = open(f, "rb")
    except OSError:
        continue
    with fh:
        for raw in fh:
            try:
                o = json.loads(raw)
            except Exception:
                continue
            if not isinstance(o, dict):
                continue
            m = o.get("message")
            if not isinstance(m, dict):
                continue
            side = bool(o.get("isSidechain"))
            content = m.get("content") if isinstance(m.get("content"), list) else []
            if m.get("role") == "assistant":
                if m.get("model"):
                    u = m.get("usage") or {}
                    r = (tok_side if side else tok_main)[m["model"]]
                    r[0] += u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
                    r[1] += u.get("cache_read_input_tokens", 0)
                    r[2] += u.get("output_tokens", 0)
                for c in content:
                    if not isinstance(c, dict):
                        continue
                    if c.get("type") == "text" and not side:
                        if PASS_CLAIM.search(c.get("text", "")):
                            stats["pass_claims"] += 1
                            if not test_ran:
                                stats["pass_claims_without_test_in_session"] += 1
                    if c.get("type") != "tool_use":
                        continue
                    name, inp = c.get("name"), c.get("input") or {}
                    if pending_streak and not side:
                        cmd = norm(inp.get("command", "")) if name == "Bash" else None
                        if name in ("Agent", "Task"):
                            streak_after["delegated_or_consulted"] += 1
                        elif cmd and cmd == pending_streak:
                            pass
                        elif name in ("Edit", "Write", "MultiEdit"):
                            streak_after["edited_then_retry"] += 1
                        else:
                            streak_after["other_change"] += 1
                        if not (cmd and cmd == pending_streak):
                            pending_streak = None
                    if name == "Bash":
                        cmd = inp.get("command", "")
                        tool_cmd[c.get("id")] = norm(cmd)
                        if TEST_CMD.search(cmd):
                            test_ran = True
                    if name in ("Agent", "Task"):
                        stats["agent_calls"] += 1
                        agent_models[inp.get("model") or "(inherit/default)"] += 1
                        if REVIEW.search(inp.get("prompt", "") + inp.get("description", "")):
                            stats["review_calls"] += 1
                            review_models[inp.get("model") or "(inherit/default)"] += 1
                            tool_kind[c.get("id")] = "review"
            elif m.get("role") == "user":
                for c in content:
                    if not isinstance(c, dict) or c.get("type") != "tool_result":
                        continue
                    tid = c.get("tool_use_id")
                    body = c.get("content")
                    text = body if isinstance(body, str) else " ".join(x.get("text", "") for x in body or [] if isinstance(x, dict))
                    if tool_kind.get(tid) == "review":
                        sev = set(SEV.findall(text))
                        stats["review_results"] += 1
                        if "High" in sev: review_sev["has_high"] += 1
                        if "Medium" in sev: review_sev["has_medium"] += 1
                        if sev and sev <= {"Low"}: review_sev["low_only"] += 1
                        if not sev: review_sev["no_severity_label"] += 1
                    if tid in tool_cmd and not side:
                        cmd = tool_cmd[tid]
                        if c.get("is_error"):
                            if cmd == last_fail_cmd:
                                run += 1
                            else:
                                last_fail_cmd, run = cmd, 1
                            if run == 3:
                                stats["fail_streaks_ge3"] += 1
                                pending_streak = cmd
                            if run >= 3:
                                streak_len[min(run, 6)] += 1
                        else:
                            if cmd == last_fail_cmd and run >= 3:
                                stats["streak_eventually_succeeded_same_cmd"] += 1
                            last_fail_cmd, run = None, 0

def fmt(d):
    return {k: {"fresh_in": v[0], "cache_read": v[1], "out": v[2]} for k, v in sorted(d.items(), key=lambda x: -sum(x[1]))}

res = {"stats": dict(stats), "tokens_main": fmt(tok_main), "tokens_subagent": fmt(tok_side),
       "agent_model_param": dict(agent_models), "review_model_param": dict(review_models),
       "review_severity": dict(review_sev), "after_fail_streak": dict(streak_after),
       "fail_streak_len_hist(>=3, capped 6)": {str(k): v for k, v in sorted(streak_len.items())}}
out.write_text(json.dumps(res, ensure_ascii=False, indent=1))
print(json.dumps(res, ensure_ascii=False, indent=1))
