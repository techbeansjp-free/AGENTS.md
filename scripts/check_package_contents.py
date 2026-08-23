#!/usr/bin/env python3
"""npm配布物への開発専用ファイル混入を拒否する。"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tarfile
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
    ".agent-skill-chain/tmp/",
    ".agent-skill-chain/role-log/",
    ".agent-skill-chain/metrics/",
    ".agent-skill-chain/project/",
    "secret-fixtures/",
)
FORBIDDEN_FILES = {
    "cucumber.mjs",
    "tsconfig.json",
    "test-execution.log",
    ".agent-skill-chain/project-policy.json",
}


def matches_manifest(file: str, entries: list[str]) -> bool:
    if file == "package.json":
        return True
    return any(file == entry.rstrip("/") or file.startswith(entry.rstrip("/") + "/") for entry in entries)


def sensitive(file: str) -> bool:
    name = Path(file).name.lower()
    stem = name.rsplit(".", 1)[0]
    return (
        name.startswith(".env")
        or re.search(
            r"(?:^|[._-])(?:credentials?|secrets?|auth|client-secrets?)(?:$|[._-])",
            stem,
        )
        is not None
        or name.endswith((".pem", ".key", ".p12", ".pfx"))
    )


SECRET_KEY = re.compile(
    r"^(?:token|password|secret|api[_-]?key|apikey|databaseurl|connectionstring|privatekey|authorization)$",
    re.IGNORECASE,
)
SECRET_TEXT = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{20,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{8,}|"
    r"\b[a-z][a-z0-9+.-]*://[^\s/@:]+:[^\s/@]+@|"
    r"[\"']?(?:token|password|secret|api[_-]?key|apiKey|databaseUrl|connectionString|privateKey)[\"']?\s*[=:]\s*(?:\"[^\"\r\n]{8,}\"|'[^'\r\n]{8,}'|(?![/[{(])[A-Za-z0-9._+~-]{8,})",
    re.IGNORECASE,
)


def structured_secret(value: object) -> bool:
    if isinstance(value, list):
        return any(structured_secret(item) for item in value)
    if not isinstance(value, dict):
        return False
    return any(SECRET_KEY.match(str(key)) or structured_secret(item) for key, item in value.items())


def content_sensitive(contents: bytes) -> bool:
    text = contents.decode("utf-8", errors="ignore")
    if SECRET_TEXT.search(text):
        return True
    try:
        return structured_secret(json.loads(text))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False


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
    packed_contents: dict[str, bytes] = {}
    with tempfile.TemporaryDirectory(prefix="asc-npm-pack-") as temporary:
        cache = str(Path(temporary) / "cache")
        destination = Path(temporary) / "artifact"
        destination.mkdir()
        process = subprocess.run(
            ["npm", "pack", "--json", "--ignore-scripts", f"--pack-destination={destination}"],
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
        archives = list(destination.glob("*.tgz"))
        if len(archives) != 1:
            print("パッケージ内容検査: 失敗（artifactを一意に取得できません）", file=sys.stderr)
            return 1
        with tarfile.open(archives[0], "r:gz") as archive:
            for member in archive.getmembers():
                if member.isfile() and member.name.startswith("package/"):
                    stream = archive.extractfile(member)
                    if stream is not None:
                        packed_contents[member.name.removeprefix("package/")] = stream.read()
    manifest_entries = json.loads((ROOT / "package.json").read_text(encoding="utf-8")).get("files", [])
    forbidden = [
        file
        for file in files
        if file in FORBIDDEN_FILES
        or any(file.startswith(prefix) for prefix in FORBIDDEN_PREFIXES)
        or "/memo/" in file
        or sensitive(file)
        or not matches_manifest(file, manifest_entries)
    ]
    secret_content = sorted(file for file, contents in packed_contents.items() if content_sensitive(contents))
    required = {
        "package.json",
        "bin/agent-skill-chain.js",
        "AGENTS.md",
        ".agent-skill-chain/00_利用案内.md",
        ".agent-skill-chain/docs/00_運用ポリシー.md",
        ".agent-skill-chain/docs/01_開発ワークフロー.md",
        ".agent-skill-chain/docs/02_品質基準.md",
        ".agent-skill-chain/policy/00_利用案内.md",
        ".agent-skill-chain/schemas/00_利用案内.md",
        ".agent-skill-chain/skills/00_利用案内.md",
        ".agent-skill-chain/templates/00_利用案内.md",
        ".agent-skill-chain/templates/common/02_利用案内.md",
        ".agent-skill-chain/templates/issue/12_利用案内.md",
        ".agent-skill-chain/templates/specs/00_利用案内.md",
        ".agent-skill-chain/schemas/project-policy.schema.json",
        ".agent-skill-chain/schemas/project-policy-manifest.schema.json",
        ".agent-skill-chain/schemas/project-choice.schema.json",
        ".agent-skill-chain/schemas/project-rule.schema.json",
        ".agent-skill-chain/schemas/project-conformance-binding.schema.json",
        ".agent-skill-chain/schemas/conformance-contract.schema.json",
        ".agent-skill-chain/policy/default.json",
        ".agent-skill-chain/policy/conformance.json",
    }
    missing = sorted(required - set(files))
    if forbidden or missing or tracked_memo or secret_content:
        print("パッケージ内容検査: 失敗", file=sys.stderr)
        for file in forbidden:
            print(f"- 開発専用ファイルが配布物へ混入しています: {file}", file=sys.stderr)
        for file in tracked_memo:
            print(f"- memoディレクトリはGit管理外にしてください: {file}", file=sys.stderr)
        for file in missing:
            print(f"- 必須実行資産が不足しています: {file}", file=sys.stderr)
        for file in secret_content:
            print(f"- 配布fileの実contentに秘密patternがあります: {file}", file=sys.stderr)
        return 1
    print(f"パッケージ内容検査: 合格（実行・配布ファイル{len(files)}件、project policy・role log・開発計測・test fixture・秘密情報は除外）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
