#!/usr/bin/env python3
"""npm配布物への開発専用ファイル混入を拒否する。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PREFIXES = (
    "test/",
    ".github/",
    "scripts/",
    "docs/specs/",
    "node_modules/",
    "memo/",
)
FORBIDDEN_FILES = {"cucumber.mjs", "tsconfig.json", "test-execution.log"}


def main() -> int:
    tracked_process = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, check=False, capture_output=True, text=True
    )
    if tracked_process.returncode != 0:
        print(tracked_process.stderr, file=sys.stderr)
        return tracked_process.returncode
    tracked_memo = [
        file
        for file in tracked_process.stdout.splitlines()
        if file == "memo" or file.startswith("memo/") or "/memo/" in file
    ]
    with tempfile.TemporaryDirectory(prefix="asc-npm-cache-") as cache:
        process = subprocess.run(
            ["npm", "pack", "--dry-run", "--json", "--ignore-scripts"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            env={**os.environ, "npm_config_cache": cache},
        )
    if process.returncode != 0:
        print(process.stderr, file=sys.stderr)
        return process.returncode
    report = json.loads(process.stdout)
    files = [entry["path"] for entry in report[0]["files"]]
    forbidden = [
        file
        for file in files
        if file in FORBIDDEN_FILES
        or any(file.startswith(prefix) for prefix in FORBIDDEN_PREFIXES)
        or "/memo/" in file
    ]
    required = {
        "package.json",
        "bin/agent-skill-chain.js",
        "AGENTS.md",
        ".agent-skill-chain/docs/00_運用ポリシー.md",
        ".agent-skill-chain/docs/01_開発ワークフロー.md",
        ".agent-skill-chain/docs/02_品質基準.md",
        ".agent-skill-chain/schemas/project-policy.schema.json",
        ".agent-skill-chain/policy/default.json",
    }
    missing = sorted(required - set(files))
    if forbidden or missing or tracked_memo:
        print("パッケージ内容検査: 失敗", file=sys.stderr)
        for file in forbidden:
            print(f"- 開発専用ファイルが配布物へ混入しています: {file}", file=sys.stderr)
        for file in tracked_memo:
            print(f"- memoディレクトリはGit管理外にしてください: {file}", file=sys.stderr)
        for file in missing:
            print(f"- 必須実行資産が不足しています: {file}", file=sys.stderr)
        return 1
    print(f"パッケージ内容検査: 合格（実行・配布ファイル{len(files)}件、開発専用ファイルは除外）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
