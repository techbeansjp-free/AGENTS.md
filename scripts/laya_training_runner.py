#!/usr/bin/env python3
"""Pinned, development-only adapter for the upstream Laya training notebook.

This file deliberately has no ASC runtime import. It validates the immutable
manifest before importing optional ML dependencies, and writes only below the
explicit output directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

LAYA_REVISION = "2c6c16baf3ea3149948777937d5005a7c7fba425"
NOTEBOOK_SHA256 = "6b81f290bbd213008d3e79c80d207b9abc1d1b5ab0a23f3f4bd9a289611433ed"
BASE_MODEL = "convaiinnovations/laya-multilingual"
BASE_MODEL_REVISION = "82d57fc4f2d1be3d2caac494045f2ec51d0842f3"
MAX_INPUT_BYTES = 64 * 1024 * 1024


def fail(message: str) -> "NoReturn":
    raise SystemExit(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def contained_file(root: Path, raw: object, label: str) -> Path:
    if not isinstance(raw, str) or not raw or os.path.isabs(raw):
        fail(f"{label} must be a repository-relative path")
    candidate = (root / raw).resolve(strict=True)
    try:
        candidate.relative_to(root)
    except ValueError:
        fail(f"{label} escapes repository root")
    if not candidate.is_file() or candidate.stat().st_size > MAX_INPUT_BYTES:
        fail(f"{label} must be a bounded regular file")
    return candidate


def load_manifest(path: Path) -> dict[str, object]:
    if path.stat().st_size > 1024 * 1024:
        fail("manifest exceeds 1 MiB")
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        fail("manifest must be an object")
    required = {
        "schemaVersion", "sourceRepository", "sourceCommit", "datasetDigest",
        "splitDigest", "sealDigest", "layaRevision", "notebookSha256",
        "baseModel", "baseModelRevision", "seed", "trainPath", "validationPath",
    }
    if set(value) != required:
        fail("manifest fields do not match runner-v1")
    if value["schemaVersion"] != "asc/laya-training-manifest/v1":
        fail("unsupported manifest schema")
    if value["sourceRepository"] != "techbeansjp-free/AGENTS.md":
        fail("private or non-ASC source is forbidden")
    pins = {
        "layaRevision": LAYA_REVISION,
        "notebookSha256": NOTEBOOK_SHA256,
        "baseModel": BASE_MODEL,
        "baseModelRevision": BASE_MODEL_REVISION,
    }
    for key, expected in pins.items():
        if value[key] != expected:
            fail(f"{key} is not pinned to the reviewed value")
    return value


def train(manifest_path: Path, output: Path) -> None:
    repository = Path.cwd().resolve(strict=True)
    manifest_path = manifest_path.resolve(strict=True)
    manifest = load_manifest(manifest_path)
    train_path = contained_file(repository, manifest["trainPath"], "trainPath")
    validation_path = contained_file(repository, manifest["validationPath"], "validationPath")
    combined = hashlib.sha256((sha256(train_path) + sha256(validation_path)).encode()).hexdigest()
    if combined != manifest["datasetDigest"]:
        fail("dataset digest mismatch")
    output = output.resolve()
    try:
        output.relative_to(repository)
    except ValueError:
        fail("output must stay below repository root")
    output.mkdir(parents=True, exist_ok=False)
    try:
        import torch  # type: ignore[import-not-found]
        import transformers  # type: ignore[import-not-found]
    except ImportError:
        fail("optional training dependencies are unavailable; no checkpoint was created")
    result = {
        "schemaVersion": "asc/laya-training-result/v1",
        "state": "ready-for-pinned-notebook-training",
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "manifestSha256": sha256(manifest_path),
    }
    (output / "preflight.json").write_text(json.dumps(result, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    command = subparsers.add_parser("train")
    command.add_argument("--manifest", required=True)
    command.add_argument("--output", required=True)
    args = parser.parse_args()
    train(Path(args.manifest), Path(args.output))


if __name__ == "__main__":
    main()
