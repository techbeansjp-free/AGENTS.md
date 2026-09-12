#!/usr/bin/env python3
"""Issue #1341 変異試験。

置換が当たったことを assert で確かめてから scenario を走らせる（空振りを
「変異が生存」と読み違えないため）。復旧は複写で行い、git checkout を使わない。
"""

import io
import os
import re
import shutil
import subprocess
import sys

W = "/home/tatsuru/Projects/techbeansjp-free/AGENTS.md/.worktrees/20260912_092508-1341-observation-diagnostic"
SRC = os.path.join(W, "src/adapters/provider.ts")
BAK = SRC + ".mutation-orig"

MUTATIONS = [
    (
        "A",
        "削除: 非0終了経路の attempt を落とす",
        '      "provider実行入口のread-only観測が失敗しました",\n      { args, exitCode: result.status },\n',
        '      "provider実行入口のread-only観測が失敗しました",\n',
        "SCN-UNIT-OBSDIAG-001",
    ),
    (
        "B",
        "削除: 起動失敗経路の attempt を落とす",
        '  } catch {\n    return unknownObservation(\n      provider,\n      observedAt,\n      "provider実行入口を起動できません",\n      { args },\n    );',
        '  } catch {\n    return unknownObservation(\n      provider,\n      observedAt,\n      "provider実行入口を起動できません",\n    );',
        "SCN-UNIT-OBSDIAG-002",
    ),
    (
        "C",
        "狭める: argv 連結を先頭1要素だけにする",
        '  const entrypoint = [provider, ...attempt.args].join(" ");',
        '  const entrypoint = [provider, attempt.args[0]].join(" ");',
        "SCN-UNIT-OBSDIAG-001",
    ),
    (
        "D",
        "値の空洞化: 終了値を定数1へ固定する",
        "        : `${reason}（終了値${attempt.exitCode}）`,",
        "        : `${reason}（終了値1）`,",
        "SCN-UNIT-OBSDIAG-001",
    ),
    (
        "E",
        "消したものへの変異: 成功経路の entrypoint を実 argv へ変える",
        '    entrypoint: provider === "codex" ? "codex app-server model/list" : provider,',
        '    entrypoint: [provider, ...args].join(" "),',
        "SCN-UNIT-ROUTING-009",
    ),
    (
        "F",
        "狭める: 非 codex の argv から --json を落とす",
        '      : ["models", "list", "--json"];',
        '      : ["models", "list"];',
        "SCN-UNIT-OBSDIAG-001",
    ),
    (
        "G",
        "安全条件の破壊: stderr 本文を reason へ転記する",
        '      "provider実行入口のread-only観測が失敗しました",\n      { args, exitCode: result.status },\n',
        "      `provider実行入口のread-only観測が失敗しました:${result.stderr}`,\n      { args, exitCode: result.status },\n",
        "SCN-UNIT-OBSDIAG-003",
    ),
    (
        "H",
        "狭める: 終了値を載せる条件を反転させ null のときだけ載せる",
        "      attempt.exitCode === undefined",
        "      attempt.exitCode !== undefined",
        "SCN-UNIT-OBSDIAG-001",
    ),
    (
        "I",
        "削除: 起動失敗の判定枝を落とす（終了値1と区別しなくなる）",
        """  if (result.launchFailure)
    return unknownObservation(
      provider,
      observedAt,
      "provider実行入口を起動できません",
      { args },
    );
""",
        "",
        "SCN-UNIT-OBSDIAG-004",
    ),
    (
        "J",
        "削除: executorへ渡すargvの複写を外し同じ参照を渡す",
        'result = await observer(provider, [...args], options.cwd ?? process.cwd(), {',
        "result = await observer(provider, args, options.cwd ?? process.cwd(), {",
        "SCN-UNIT-OBSDIAG-005",
    ),
    (
        "K",
        "狭める: 起動失敗の判定を非0終了より後ろへ置き到達しなくする",
        """  if (result.launchFailure)""",
        """  if (result.launchFailure && result.status === 0)""",
        "SCN-UNIT-OBSDIAG-004",
    ),
]

env = dict(os.environ)
env.pop("WORKER_CMD", None)


def run(name_filter):
    proc = subprocess.run(
        [
            "node",
            "--import",
            "tsx",
            "./node_modules/@cucumber/cucumber/bin/cucumber.js",
            "--config",
            "cucumber.mjs",
            "--name",
            name_filter,
        ],
        cwd=W,
        env=env,
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    m = re.search(r"^\d+ scenarios? \(.*\)$", out, re.M)
    return (proc.returncode, m.group(0) if m else "(集計行なし)")


def main():
    shutil.copyfile(SRC, BAK)
    rows = []
    for label in ("SCN-UNIT-OBSDIAG", "SCN-UNIT-ROUTING-009"):
        code, summary = run(label)
        print(f"baseline {label}: exit={code} {summary}")
        if code != 0:
            print("baseline が合格していない。中止する。")
            shutil.copyfile(BAK, SRC)
            return 1

    for mid, desc, old, new, target in MUTATIONS:
        s = io.open(SRC, encoding="utf-8").read()
        count = s.count(old)
        if count != 1:
            print(f"変異{mid}: 置換対象が{count}件（1件でない）。scriptの欠陥。")
            shutil.copyfile(BAK, SRC)
            return 1
        io.open(SRC, "w", encoding="utf-8").write(s.replace(old, new))
        assert io.open(SRC, encoding="utf-8").read() != s, f"変異{mid}が当たっていない"
        code, summary = run(target)
        killed = "killed" if code != 0 else "**生存**"
        rows.append((mid, desc, target, killed, summary))
        print(f"変異{mid}（{desc}）→ {target}: {killed} / {summary}")
        shutil.copyfile(BAK, SRC)

    for label in ("SCN-UNIT-OBSDIAG", "SCN-UNIT-ROUTING-009"):
        code, summary = run(label)
        print(f"復旧後 {label}: exit={code} {summary}")
    os.remove(BAK)

    print("\n| 変異 | 内容 | 対象scenario | 結果 | 集計 |")
    print("|---|---|---|---|---|")
    for mid, desc, target, killed, summary in rows:
        print(f"| {mid} | {desc} | {target} | {killed} | {summary} |")
    return 0 if all(r[3] == "killed" for r in rows) else 1


sys.exit(main())
