#!/usr/bin/env python3
"""人が読むMarkdownの日本語記述を安全側で検査する。"""

from __future__ import annotations

import re
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
JAPANESE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
LATIN = re.compile(r"[A-Za-z]")
INLINE_CODE = re.compile(r"`[^`]*`")
URL = re.compile(r"https?://\S+")
DIRECTORIES = (
    ".agent-skill-chain/skills",
    ".agent-skill-chain/templates",
    ".agent-skill-chain/docs",
    "docs/specs",
    "docs/reviews",
)
ROOT_DOCUMENTS = ("AGENTS.md",)


def markdown_files(root: Path) -> list[Path]:
    files = [root / name for name in ROOT_DOCUMENTS if (root / name).is_file()]
    for directory in DIRECTORIES:
        base = root / directory
        if base.is_dir():
            files.extend(base.rglob("*.md"))
    return sorted(set(files))


def human_text(line: str) -> str:
    text = INLINE_CODE.sub("", line)
    text = URL.sub("", text)
    text = re.sub(r"[\s#>*_\-|:\[\]().,/0-9]+", " ", text)
    return text.strip()


def check(root: Path) -> list[str]:
    errors: list[str] = []
    files = markdown_files(root)
    if not files:
        return ["検査対象のMarkdown文書がありません"]

    for file in files:
        in_code = False
        in_frontmatter = False
        relative = file.relative_to(root).as_posix()
        for number, line in enumerate(file.read_text(encoding="utf-8").splitlines(), start=1):
            stripped = line.strip()
            if number == 1 and stripped == "---":
                in_frontmatter = True
                continue
            if in_frontmatter:
                if stripped == "---":
                    in_frontmatter = False
                    continue
                if stripped.startswith("description:"):
                    stripped = stripped.partition(":")[2].strip()
                else:
                    continue
            if stripped.startswith("```") or stripped.startswith("~~~"):
                in_code = not in_code
                continue
            if in_code or not stripped or stripped.startswith("<!--"):
                continue
            text = human_text(stripped)
            if len(LATIN.findall(text)) >= 12 and not JAPANESE.search(text):
                errors.append(f"{relative}:{number}: 人が読む見出し・本文を日本語で記述してください")
    return errors


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPOSITORY_ROOT
    errors = check(root)
    if errors:
        print("日本語文書形式検査: 失敗", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("日本語文書形式検査: 合格（人向けMarkdownの英語本文なし）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
