#!/usr/bin/env python3
"""Issue #1342 REV-02是正の変異試験。置換が当たったことをassertしてから走らせる。"""
import io, os, re, shutil, subprocess, sys

W = "/home/tatsuru/Projects/techbeansjp-free/AGENTS.md/.worktrees/20260912_022211-1342-journal-reconfirmation"
SRC = os.path.join(W, "src/domain/workflow.ts")
BAK = SRC + ".mutation-orig"
BLOCK = '''  input.entries.forEach((entry, index) => {
    if (!entry.reconfirmation) return;
    if (terminalIndex >= 0 && index > terminalIndex)
      errors.push(
        "上流再確定entryはStep 11より後に置けません。Step 11記録後に置けるのはpost-terminal intakeのStep 10だけです",
      );
  });'''

MUTATIONS = [
    ("L", "削除: Step 11後の再確定を拒否する検査ごと落とす", BLOCK, ""),
    ("M", "反転: 位置条件を逆にし、Step 11より前を拒否する",
     "if (terminalIndex >= 0 && index > terminalIndex)",
     "if (terminalIndex >= 0 && index < terminalIndex)"),
    ("N", "狭める: terminalIndexが0のときだけ効くようにする",
     "if (terminalIndex >= 0 && index > terminalIndex)",
     "if (terminalIndex > 0 && index > terminalIndex + 1)"),
    ("O", "対象拡大: reconfirmation以外にも当てる（正常系を壊す）",
     "    if (!entry.reconfirmation) return;\n    if (terminalIndex >= 0 && index > terminalIndex)",
     "    if (terminalIndex >= 0 && index > terminalIndex)"),
    ("P", "値の空洞化: 診断文言を別の文字列にする",
     '"上流再確定entryはStep 11より後に置けません。Step 11記録後に置けるのはpost-terminal intakeのStep 10だけです"',
     '"順序に問題があります"'),
    ("Q", "削除: 先行entry判定からhumanOverrideの除外を落とす",
     "          !candidate.postTerminalIntake &&\n          !candidate.humanOverride,",
     "          !candidate.postTerminalIntake,"),
    ("R", "狭める: humanOverride除外をStep 3だけに限る",
     "          !candidate.humanOverride,",
     "          (entry.step !== 3 || !candidate.humanOverride),"),
]

env = dict(os.environ); env.pop("WORKER_CMD", None)

def run(flt):
    p = subprocess.run(["node","--import","tsx","./node_modules/@cucumber/cucumber/bin/cucumber.js",
                        "--config","cucumber.mjs","--name",flt], cwd=W, env=env,
                       capture_output=True, text=True)
    out = p.stdout + p.stderr
    m = re.search(r"^\d+ scenarios? \(.*\)$", out, re.M)
    return p.returncode, (m.group(0) if m else "(集計行なし)")

shutil.copyfile(SRC, BAK)
code, summary = run("SCN-UNIT-RECONFIRM")
print(f"baseline: exit={code} {summary}")
if code != 0:
    shutil.copyfile(BAK, SRC); sys.exit("baseline不合格。中止。")

rows = []
for mid, desc, old, new in MUTATIONS:
    s = io.open(SRC, encoding="utf-8").read()
    if s.count(old) != 1:
        shutil.copyfile(BAK, SRC)
        sys.exit(f"変異{mid}: 置換対象が{s.count(old)}件。scriptの欠陥。")
    io.open(SRC, "w", encoding="utf-8").write(s.replace(old, new))
    assert io.open(SRC, encoding="utf-8").read() != s
    code, summary = run("SCN-UNIT-RECONFIRM")
    killed = "killed" if code != 0 else "**生存**"
    rows.append((mid, desc, killed, summary))
    print(f"変異{mid}（{desc}）: {killed} / {summary}")
    shutil.copyfile(BAK, SRC)

code, summary = run("SCN-UNIT-RECONFIRM")
print(f"復旧後: exit={code} {summary}")
os.remove(BAK)
print("\n| 変異 | 内容 | 結果 | 集計 |\n|---|---|---|---|")
for mid, desc, killed, summary in rows:
    print(f"| {mid} | {desc} | {killed} | {summary} |")
sys.exit(0 if all(r[2]=="killed" for r in rows) else 1)
