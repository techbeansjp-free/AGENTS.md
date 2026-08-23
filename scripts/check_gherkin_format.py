#!/usr/bin/env python3
"""人が読める日本語Gherkinテスト起票を安全側で検査する。"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FEATURE_ROOT = ROOT / "test" / "features"
LAYERS = {"unit", "integration", "e2e"}
JAPANESE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
HEADER = re.compile(r"^\s*(Feature|Scenario(?: Outline)?|Given|When|Then|And|But):?\s+(.+?)\s*$")
SCENARIO = re.compile(r"^\s*Scenario(?: Outline)?:\s+(SCN-[A-Z0-9-]+)\s+(.+?)\s*$")
STEP = re.compile(r"^\s*(Given|When|Then|And|But)\s+(.+?)\s*$")


@dataclass
class ScenarioRecord:
    scenario_id: str
    file: Path
    line: int
    keywords: set[str] = field(default_factory=set)


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def check() -> list[str]:
    errors: list[str] = []
    files = sorted(FEATURE_ROOT.glob("**/*.feature"))
    if not files:
        return ["test/features配下に.featureがありません"]

    scenarios: list[ScenarioRecord] = []
    layer_counts = {layer: 0 for layer in LAYERS}
    for file in files:
        parts = set(file.relative_to(FEATURE_ROOT).parts)
        layers = parts & LAYERS
        if len(layers) != 1:
            errors.append(f"{relative(file)}: unit/integration/e2eのいずれか1 layer配下に置いてください")
        else:
            layer_counts[next(iter(layers))] += 1

        current: ScenarioRecord | None = None
        feature_seen = False
        for number, line in enumerate(file.read_text(encoding="utf-8").splitlines(), start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("@") or stripped.startswith("|"):
                continue
            if stripped.startswith("Feature:"):
                feature_seen = True
            match = HEADER.match(line)
            if match and not JAPANESE.search(match.group(2)):
                errors.append(f"{relative(file)}:{number}: {match.group(1)}の説明本文を日本語で記述してください")
            scenario = SCENARIO.match(line)
            if scenario:
                current = ScenarioRecord(scenario.group(1), file, number)
                scenarios.append(current)
                continue
            step = STEP.match(line)
            if step and current:
                current.keywords.add(step.group(1))
        if not feature_seen:
            errors.append(f"{relative(file)}: Featureがありません")

    seen: dict[str, ScenarioRecord] = {}
    for scenario in scenarios:
        if scenario.scenario_id in seen:
            first = seen[scenario.scenario_id]
            errors.append(
                f"{relative(scenario.file)}:{scenario.line}: SCN ID {scenario.scenario_id}が重複しています "
                f"(最初の定義: {relative(first.file)}:{first.line})"
            )
        else:
            seen[scenario.scenario_id] = scenario
        for keyword in ("Given", "When", "Then"):
            if keyword not in scenario.keywords:
                errors.append(f"{relative(scenario.file)}:{scenario.line}: {scenario.scenario_id}に{keyword}がありません")

    for layer, count in sorted(layer_counts.items()):
        if count == 0:
            errors.append(f"{layer} layerに.featureがありません")

    node_tests = sorted((ROOT / "test").glob("**/*.test.js"))
    for file in node_tests:
        errors.append(f"{relative(file)}: Node test起票を残さずGherkin .featureへ移行してください")

    return errors


def main() -> int:
    errors = check()
    if errors:
        print("Gherkin形式検査: 失敗", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Gherkin形式検査: 合格（英語keyword・日本語説明、一意のSCN ID、全テスト層）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
