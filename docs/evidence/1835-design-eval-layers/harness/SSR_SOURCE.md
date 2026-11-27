# SSRの道具のsource（`ssr.py`）

このrepositoryは実装言語をTypeScript（`.ts`・`.mjs`）に集約しており、`.py`のfileを置けない（`scripts/check_source_quality.ts`）。SSRのembedding（`fastembed`）はPythonでしか動かせなかったので、本番で実行した`ssr.py`の本文を、ここに記録として残す。repositoryの中では実行しない。

- 本番で実行したfileのsha256：`af4d175da3c06b4514aa319d0f2910a08a55080d9b4908cf00e1c5d2e4af2855`
- 書き出し：`node harness/ssr-source.mjs <出力先のfile>`。下の本文を書き出し、sha256が上と一致しなければ失敗する。出力先は、repositoryの外（scratch）にする。

```python
"""SSR (semantic similarity rating) of the F critiques against the fixed anchors (EVAL_PLAN.md 3 and 4). #1835.

Run with the scratch venv and -I:  <venv>/bin/python -I harness/ssr.py <command> ...
  score    --anchors anchors.json --in texts.jsonl --out ssr.json --cache-dir <dir>
           texts.jsonl: one {"id": ..., "text": ...} per line (aggregate.mjs critiques writes it)
  negation --anchors anchors.json --pairs negation-pairs.json --out ssr-negation.json --cache-dir <dir>
  formula  --vectors vectors.json --out out.json
           vectors.json: {"responses": {"id": [floats]}, "anchors": [[5 vectors] per set]}  (no model; used by the tests)

Formula (Maier et al., SSR): per anchor set, s_r = cos(response, anchor_r) for r = 1..5,
p_r = (s_r - min_j s_j) / sum_j (s_j - min_j s_j); the pmf is averaged over the sets, and the expected value is
sum_r r * p_r. If all s_r of a set are equal (denominator 0) the set is "degenerate", its pmf is uniform and it is flagged.
The embedding (intfloat/multilingual-e5-large via fastembed, local files only) is imported only by score/negation.
"""
import argparse
import json
import math
import os
import sys


def cos(a, b):
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def pmf_of(sims):
    m = min(sims)
    d = [s - m for s in sims]
    total = sum(d)
    if total <= 0:
        return [1.0 / len(sims)] * len(sims), True
    return [x / total for x in d], False


def rate(response_vec, anchor_sets):
    """anchor_sets: list of 5-vector lists. Returns the averaged pmf, the expected value and per-set details."""
    per_set = []
    for vecs in anchor_sets:
        sims = [cos(response_vec, v) for v in vecs]
        p, degenerate = pmf_of(sims)
        per_set.append({"similarities": sims, "pmf": p, "degenerate": degenerate})
    k = len(per_set)
    pmf = [sum(s["pmf"][r] for s in per_set) / k for r in range(5)]
    expected = sum((r + 1) * pmf[r] for r in range(5))
    return {"pmf": pmf, "expected": expected, "sets": per_set, "degenerate": any(s["degenerate"] for s in per_set)}


def snapshot_of(cache_dir):
    found = []
    for root, dirs, _ in os.walk(cache_dir):
        if os.path.basename(root) == "snapshots":
            found.extend(dirs)
    return sorted(set(found))


def embedder(cfg_prefix, cache_dir, model):
    os.environ.setdefault("HF_HUB_OFFLINE", "1")  # the model was fetched before; never send anything
    from fastembed import TextEmbedding  # noqa: E402 (lazy: the formula command needs no dependency)
    import fastembed
    m = TextEmbedding(model, cache_dir=cache_dir)

    def embed(texts, kind):
        pre = cfg_prefix[kind]
        return [list(map(float, v)) for v in m.embed([pre + t for t in texts])]
    meta = {"model": model, "fastembed": fastembed.__version__, "snapshots": snapshot_of(cache_dir), "prefix": cfg_prefix}
    return embed, meta


def load_cfg():
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", "config", "eval.json"), encoding="utf-8") as f:
        return json.load(f)["ssr"]


def anchor_vectors(embed, anchors):
    return [embed(s["levels"], "anchor") for s in anchors["sets"]]


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["score", "negation", "formula"])
    ap.add_argument("--anchors")
    ap.add_argument("--in", dest="inp")
    ap.add_argument("--pairs")
    ap.add_argument("--vectors")
    ap.add_argument("--cache-dir")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    out = {"schema": "asc-1835-ssr/v1", "command": a.command}
    if a.command == "formula":
        with open(a.vectors, encoding="utf-8") as f:
            v = json.load(f)
        out["results"] = {k: rate(vec, v["anchors"]) for k, vec in v["responses"].items()}
    else:
        cfg = load_cfg()
        with open(a.anchors, encoding="utf-8") as f:
            anchors = json.load(f)
        try:
            embed, meta = embedder(cfg["prefix"], a.cache_dir, cfg["model"])
            avs = anchor_vectors(embed, anchors)
        except Exception as e:  # the core mechanism did not run: S is undetermined (plan 7)
            out["coreFailed"] = repr(e)
            with open(a.out, "w", encoding="utf-8") as f:
                json.dump(out, f, ensure_ascii=False, indent=1)
            return 6
        out["embedding"] = meta
        if a.command == "score":
            rows = []
            with open(a.inp, encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        rows.append(json.loads(line))
            vecs = embed([r["text"] for r in rows], "response") if rows else []
            out["results"] = {r["id"]: rate(v, avs) for r, v in zip(rows, vecs)}
        else:
            with open(a.pairs, encoding="utf-8") as f:
                pairs = json.load(f)["pairs"]
            vecs = embed([t for p in pairs for t in (p["positive"], p["negative"])], "response")
            res = []
            for i, p in enumerate(pairs):
                pos, neg = rate(vecs[2 * i], avs), rate(vecs[2 * i + 1], avs)
                res.append({"id": p["id"], "positive": pos["expected"], "negative": neg["expected"],
                            "pass": neg["expected"] < pos["expected"], "cosPositiveNegative": cos(vecs[2 * i], vecs[2 * i + 1])})
            out["pairs"] = res
            out["failures"] = sum(1 for r in res if not r["pass"])
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```
