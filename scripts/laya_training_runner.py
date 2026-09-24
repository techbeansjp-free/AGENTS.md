#!/usr/bin/env python3
"""Pinned, development-only Laya frozen-head trainer."""

from __future__ import annotations

import argparse
import collections
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import random
import re
import secrets
import shutil
import stat
import sys
import tempfile
import time
from typing import NoReturn

LAYA_REVISION = "2c6c16baf3ea3149948777937d5005a7c7fba425"
NOTEBOOK_SHA256 = "6b81f290bbd213008d3e79c80d207b9abc1d1b5ab0a23f3f4bd9a289611433ed"
BASE_MODEL = "convaiinnovations/laya-multilingual"
BASE_MODEL_REVISION = "82d57fc4f2d1be3d2caac494045f2ec51d0842f3"
MAX_INPUT_BYTES = 64 * 1024 * 1024
EPOCHS = 4
BATCH_SIZE = 8
LEARNING_RATE = 1e-4
MAX_OVERSAMPLE = 8
LOCAL_RUN_ROOT = Path(".agent-skill-chain/local/laya-runs")
LAYA_SOURCE_SHA256 = {
    "__init__.py": "a5311fed0deff4e691f119d1078f57a0f7ab5c0a5b5086f542d05e00491a7407",
    "common.py": "98fe673acb1973b56bedfc9495d4afacb7271e99ea0811a968bbab237cd0b429",
}
BASE_MODEL_SHA256 = {
    "model.safetensors": "9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204",
    "rl_agent_config.json": "25061739243b617ad88d1219ba6f8a9c86c5881ca28df024fa2d9b3b2fcc30c6",
    "encoder/config.json": "83f6916d13ef0f556ac461f28308dc2bffa7ebeadee8ec9e2db5812020ea5bb4",
    "tokenizer/tokenizer.json": "609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f",
    "tokenizer/tokenizer_config.json": "424b69444bf7b5809dc2cd2e36d0bd71b8055124dd24274d6db3c655d38205e7",
}
TRAINING_ENVIRONMENT = {
    "python": "3.12.14",
    "torch": "2.14.0",
    "transformers": "5.17.0",
    "safetensors": "0.8.0",
    "huggingface_hub": "1.32.0",
}
TRAINING_ENVIRONMENT_SHA256 = "0795cbc6120e9d75db2ff77390ac0b82ab4a59de9d1ccbfe8a15acdad032426e"


def fail(message: str) -> NoReturn:
    raise SystemExit(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_inventory(root: Path, inventory: dict[str, str], label: str) -> None:
    """Verify reviewed bytes and reject links before Python or ML loads them."""
    root_metadata = root.lstat()
    if stat.S_ISLNK(root_metadata.st_mode) or not stat.S_ISDIR(root_metadata.st_mode):
        fail(f"{label} root must be a regular non-symlink directory")
    root = root.resolve(strict=True)
    for relative, expected in inventory.items():
        candidate = root / relative
        try:
            metadata = candidate.lstat()
        except FileNotFoundError:
            fail(f"{label} artifact is missing: {relative}")
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            fail(f"{label} artifact must be a regular non-symlink file: {relative}")
        if candidate.resolve(strict=True).parent != (root / relative).parent.resolve(strict=True):
            fail(f"{label} artifact escapes its reviewed directory: {relative}")
        if sha256(candidate) != expected:
            fail(f"{label} artifact digest mismatch: {relative}")


def verify_laya_package() -> None:
    spec = importlib.util.find_spec("laya")
    if spec is None or spec.origin is None:
        fail("pinned Laya package is unavailable")
    package_root = Path(spec.origin).parent
    verify_inventory(package_root, LAYA_SOURCE_SHA256, "Laya source")


def materialize_model(
    source: Path, *, allow_cache_links: bool
) -> tuple[tempfile.TemporaryDirectory[str], Path]:
    """Copy digest-pinned public model files so the loader never follows cache links."""
    workspace = tempfile.TemporaryDirectory(prefix="asc-laya-model-")
    target = Path(workspace.name)
    for relative in BASE_MODEL_SHA256:
        source_file = source / relative
        if not allow_cache_links:
            try:
                source_metadata = source_file.lstat()
            except FileNotFoundError:
                workspace.cleanup()
                fail(f"base model artifact is missing: {relative}")
            if stat.S_ISLNK(source_metadata.st_mode) or not stat.S_ISREG(source_metadata.st_mode):
                workspace.cleanup()
                fail(f"explicit base model artifact must be a regular non-symlink file: {relative}")
        try:
            resolved = source_file.resolve(strict=True)
        except FileNotFoundError:
            workspace.cleanup()
            fail(f"base model artifact is missing: {relative}")
        if not stat.S_ISREG(resolved.stat().st_mode):
            workspace.cleanup()
            fail(f"base model artifact is not regular: {relative}")
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(resolved, destination)
    verify_inventory(target, BASE_MODEL_SHA256, "base model")
    return workspace, target


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
        "environmentDigest",
        "splitArtifact", "teacherArtifacts", "adjudicationArtifacts",
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
        "environmentDigest": TRAINING_ENVIRONMENT_SHA256,
    }
    for key, expected in pins.items():
        if value[key] != expected:
            fail(f"{key} is not pinned to the reviewed value")
    seed = value["seed"]
    if not isinstance(seed, int) or isinstance(seed, bool) or not 0 <= seed <= 2_147_483_647:
        fail("seed is invalid")
    references = [value.get("splitArtifact")]
    teachers = value.get("teacherArtifacts")
    adjudications = value.get("adjudicationArtifacts")
    if not isinstance(teachers, list) or len(teachers) != 2 or {item.get("teacher") for item in teachers if isinstance(item, dict)} != {"codex", "opus"}:
        fail("manifest must bind Codex and Opus teacher artifacts")
    if not isinstance(adjudications, list):
        fail("manifest adjudicationArtifacts must be an array")
    references.extend(teachers)
    references.extend(adjudications)
    for reference in references:
        allowed = {"path", "sha256", "teacher"} if isinstance(reference, dict) and "teacher" in reference else {"path", "sha256"}
        if not isinstance(reference, dict) or set(reference) != allowed:
            fail("manifest artifact reference is invalid")
        digest = reference.get("sha256")
        if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            fail("manifest artifact digest is invalid")
    return value


QUESTION_CLASSES = {
    "finding-validity": ("yes", "no", "insufficient-evidence"),
    "severity": ("critical", "high", "medium", "low"),
    "required-action": ("fix", "investigate", "dismiss"),
    "distribution-impact": ("yes", "no", "insufficient-evidence"),
}
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")


def canonical_object(raw: object, label: str) -> dict[str, object]:
    if not isinstance(raw, str) or not raw or len(raw.encode("utf-8")) > 1024 * 1024:
        fail(f"{label} must be a bounded JSON string")
    value = json.loads(raw)
    if not isinstance(value, dict):
        fail(f"{label} must decode to an object")
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if canonical != raw:
        fail(f"{label} must be canonical JSON")
    return value


def load_bound_json(root: Path, reference: dict[str, object], label: str) -> object:
    artifact = contained_file(root, reference["path"], f"{label} path")
    if sha256(artifact) != reference["sha256"]:
        fail(f"{label} digest does not match manifest")
    with artifact.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_training_bindings(root: Path, manifest: dict[str, object]) -> dict[str, object]:
    split = load_bound_json(root, manifest["splitArtifact"], "sealed split artifact")
    if not isinstance(split, dict) or set(split) != {"schemaVersion", "createdAt", "sourceDigest", "partitions", "splitDigest"}:
        fail("sealed split artifact is invalid")
    partitions = split.get("partitions")
    if split.get("schemaVersion") != "asc/laya-split/v1" or not isinstance(partitions, dict) or set(partitions) != {"train", "validation", "holdout", "reserve"}:
        fail("sealed split artifact is invalid")
    seen: set[str] = set()
    for partition, ids in partitions.items():
        if not isinstance(ids, list) or any(not isinstance(case_id, str) or SAFE_ID.fullmatch(case_id) is None for case_id in ids):
            fail(f"sealed split {partition} is invalid")
        if seen.intersection(ids):
            fail("sealed split contains duplicate cases")
        seen.update(ids)
    unsigned = {key: split[key] for key in ("schemaVersion", "createdAt", "sourceDigest", "partitions")}
    split_digest = hashlib.sha256(json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if split.get("splitDigest") != manifest["splitDigest"] or split_digest != split.get("splitDigest"):
        fail("sealed split digest does not match manifest")

    teacher_answers: dict[tuple[str, str, str, str], tuple[str, str]] = {}
    teacher_digests: dict[str, str] = {}
    assessment_fields = {
        "schemaVersion", "teacher", "runId", "caseId", "questionId", "purpose",
        "partition", "answer", "inputDigest", "confidence", "evidenceReason", "splitDigest",
        "sealDigest", "recordedAt",
    }
    for reference in manifest["teacherArtifacts"]:
        teacher = reference["teacher"]
        artifact = load_bound_json(root, reference, f"{teacher} teacher artifact")
        if not isinstance(artifact, dict) or set(artifact) != {"schemaVersion", "teacher", "assessments"} or artifact.get("schemaVersion") != "asc/laya-teacher-assessment-set/v1" or artifact.get("teacher") != teacher or not isinstance(artifact.get("assessments"), list):
            fail(f"{teacher} teacher artifact is invalid")
        teacher_digests[teacher] = reference["sha256"]
        for assessment in artifact["assessments"]:
            if not isinstance(assessment, dict) or set(assessment) != assessment_fields:
                fail(f"{teacher} assessment is invalid")
            case_id = assessment.get("caseId")
            question_id = assessment.get("questionId")
            partition = assessment.get("partition")
            answer = assessment.get("answer")
            if (
                assessment.get("schemaVersion") != "asc/laya-teacher-assessment/v1" or
                assessment.get("teacher") != teacher or
                partition not in {"train", "validation"} or
                assessment.get("purpose") != "train-label" or
                assessment.get("splitDigest") != manifest["splitDigest"] or
                assessment.get("sealDigest") != manifest["sealDigest"] or
                case_id not in partitions[partition] or
                question_id not in QUESTION_CLASSES or
                answer not in QUESTION_CLASSES[question_id] or
                not isinstance(assessment.get("inputDigest"), str) or
                DIGEST.fullmatch(assessment["inputDigest"]) is None
            ):
                fail(f"{teacher} assessment binding is invalid")
            key = (teacher, case_id, question_id, partition)
            if key in teacher_answers:
                fail(f"{teacher} assessment is duplicated")
            teacher_answers[key] = (answer, assessment["inputDigest"])

    adjudications: dict[tuple[str, str, str], tuple[str, str]] = {}
    adjudication_digests: set[str] = set()
    adjudication_fields = {"caseId", "questionId", "purpose", "partition", "answer", "inputDigest", "splitDigest", "sealDigest"}
    for reference in manifest["adjudicationArtifacts"]:
        artifact = load_bound_json(root, reference, "strong adjudication artifact")
        if not isinstance(artifact, dict) or set(artifact) != {"schemaVersion", "adjudications"} or artifact.get("schemaVersion") != "asc/laya-strong-adjudication-set/v1" or not isinstance(artifact.get("adjudications"), list):
            fail("strong adjudication artifact is invalid")
        adjudication_digests.add(reference["sha256"])
        for item in artifact["adjudications"]:
            if not isinstance(item, dict) or set(item) != adjudication_fields:
                fail("strong adjudication is invalid")
            case_id = item.get("caseId")
            question_id = item.get("questionId")
            partition = item.get("partition")
            answer = item.get("answer")
            if (
                partition not in {"train", "validation"} or
                item.get("purpose") != "train-label" or
                item.get("splitDigest") != manifest["splitDigest"] or
                item.get("sealDigest") != manifest["sealDigest"] or
                case_id not in partitions[partition] or
                question_id not in QUESTION_CLASSES or
                answer not in QUESTION_CLASSES[question_id] or
                not isinstance(item.get("inputDigest"), str) or
                DIGEST.fullmatch(item["inputDigest"]) is None
            ):
                fail("strong adjudication binding is invalid")
            key = (case_id, question_id, partition)
            if key in adjudications:
                fail("strong adjudication is duplicated")
            adjudications[key] = (answer, item["inputDigest"])
    return {
        "split": partitions,
        "teachers": teacher_answers,
        "teacher_digests": teacher_digests,
        "adjudications": adjudications,
        "adjudication_digests": adjudication_digests,
    }


def validate_provenance(value: object, manifest: dict[str, object], line: int, labels: dict[str, str], input_digests: dict[str, str], partition: str, bindings: dict[str, object]) -> None:
    if not isinstance(value, dict):
        fail(f"dataset line {line} provenance must be an object")
    common = {"labelSource", "sourceCaseId", "splitDigest", "sealDigest", "purpose", "partition"}
    source = value.get("labelSource")
    if source == "teacher-consensus":
        if set(value) != common | {"teacherAssessments"}:
            fail(f"dataset line {line} teacher consensus provenance is invalid")
        assessments = value["teacherAssessments"]
        if not isinstance(assessments, list) or len(assessments) != 2:
            fail(f"dataset line {line} requires Codex and Opus assessments")
        teachers: list[str] = []
        for assessment in assessments:
            if not isinstance(assessment, dict) or set(assessment) != {"teacher", "assessmentDigest", "answers"}:
                fail(f"dataset line {line} teacher assessment is invalid")
            teacher = assessment["teacher"]
            digest = assessment["assessmentDigest"]
            if teacher not in {"codex", "opus"} or not isinstance(digest, str) or len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
                fail(f"dataset line {line} teacher assessment is invalid")
            if digest != bindings["teacher_digests"].get(teacher):
                fail(f"dataset line {line} teacher digest is not manifest-bound")
            answers = assessment["answers"]
            if not isinstance(answers, dict) or set(answers) != set(labels) or any(
                answers.get(question_id) != label or
                bindings["teachers"].get((teacher, value.get("sourceCaseId"), question_id, partition)) != (label, input_digests[question_id])
                for question_id, label in labels.items()
            ):
                fail(f"dataset line {line} teacher assessment does not agree with gold")
            teachers.append(str(teacher))
        if set(teachers) != {"codex", "opus"}:
            fail(f"dataset line {line} teacher consensus is not independent")
    elif source == "strong-adjudication":
        if set(value) != common | {"adjudicationDigest", "adjudicatedAnswers"}:
            fail(f"dataset line {line} strong adjudication provenance is invalid")
        digest = value["adjudicationDigest"]
        if not isinstance(digest, str) or len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            fail(f"dataset line {line} adjudication digest is invalid")
        if digest not in bindings["adjudication_digests"]:
            fail(f"dataset line {line} adjudication digest is not manifest-bound")
        answers = value["adjudicatedAnswers"]
        if not isinstance(answers, dict) or set(answers) != set(labels) or any(
            answers.get(question_id) != label or
            bindings["adjudications"].get((value.get("sourceCaseId"), question_id, partition)) != (label, input_digests[question_id])
            for question_id, label in labels.items()
        ):
            fail(f"dataset line {line} adjudication does not agree with gold")
    else:
        fail(f"dataset line {line} weak review labels are forbidden")
    source_case_id = value.get("sourceCaseId")
    if not isinstance(source_case_id, str) or SAFE_ID.fullmatch(source_case_id) is None:
        fail(f"dataset line {line} sourceCaseId is invalid")
    if value.get("splitDigest") != manifest["splitDigest"] or value.get("sealDigest") != manifest["sealDigest"]:
        fail(f"dataset line {line} provenance does not match manifest")
    if value.get("purpose") != "train-label" or value.get("partition") != partition:
        fail(f"dataset line {line} purpose/partition does not match dataset")
    if source_case_id not in bindings["split"][partition]:
        fail(f"dataset line {line} case is not in sealed split partition")


def read_rows(path: Path, manifest: dict[str, object], partition: str, bindings: dict[str, object]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                fail(f"dataset line {number} must be an object")
            if set(value) != {"schemaVersion", "id", "workflow", "state", "questions", "gold", "provenance"}:
                fail(f"dataset line {number} fields are invalid")
            if value["schemaVersion"] != "asc/laya-training-row/v1":
                fail(f"dataset line {number} schema is invalid")
            row_id = value["id"]
            if not isinstance(row_id, str) or SAFE_ID.fullmatch(row_id) is None:
                fail(f"dataset line {number} id is invalid")
            workflow = value["workflow"]
            if workflow not in {"general", "distribution"}:
                fail(f"dataset line {number} workflow is invalid")
            state = canonical_object(value["state"], f"dataset line {number} state")
            if set(state) != {"claim", "evidence", "slice"} or state["slice"] != workflow:
                fail(f"dataset line {number} state is invalid")
            if not isinstance(state["claim"], str) or not state["claim"].strip() or not isinstance(state["evidence"], list) or not state["evidence"]:
                fail(f"dataset line {number} state is invalid")
            questions = canonical_object(value["questions"], f"dataset line {number} questions")
            gold = canonical_object(value["gold"], f"dataset line {number} gold")
            expected = {"distribution-impact"} if workflow == "distribution" else {"finding-validity", "severity", "required-action"}
            if not questions or not set(questions).issubset(expected) or set(questions) != set(gold):
                fail(f"dataset line {number} question set is invalid")
            labels: dict[str, str] = {}
            input_digests: dict[str, str] = {}
            for question_id, question in questions.items():
                classes = QUESTION_CLASSES[question_id]
                if not isinstance(question, dict) or set(question) != {"type", "instructions", "criteria"}:
                    fail(f"dataset line {number} question is invalid")
                if question["type"] != "choice" or not isinstance(question["instructions"], str) or not question["instructions"].strip():
                    fail(f"dataset line {number} question is invalid")
                criteria = question["criteria"]
                if not isinstance(criteria, dict) or set(criteria) != set(classes) or any(not isinstance(text, str) or not text.strip() for text in criteria.values()):
                    fail(f"dataset line {number} criteria are invalid")
                input_digests[question_id] = hashlib.sha256(json.dumps(
                    {"state": state, "questionId": question_id, "question": question},
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()).hexdigest()
                answer = gold[question_id]
                if not isinstance(answer, dict) or set(answer) != {"label", "probabilities"} or answer["label"] not in classes:
                    fail(f"dataset line {number} gold is invalid")
                labels[question_id] = str(answer["label"])
                probabilities = answer["probabilities"]
                if not isinstance(probabilities, dict) or set(probabilities) != set(classes):
                    fail(f"dataset line {number} probabilities are invalid")
                for choice in classes:
                    probability = probabilities[choice]
                    if not isinstance(probability, (int, float)) or isinstance(probability, bool) or not math.isfinite(probability) or probability != (1 if choice == answer["label"] else 0):
                        fail(f"dataset line {number} gold must be one-hot")
            validate_provenance(value["provenance"], manifest, number, labels, input_digests, partition, bindings)
            if value["provenance"].get("sourceCaseId") != row_id:
                fail(f"dataset line {number} id does not match sourceCaseId")
            rows.append(value)
    if not rows:
        fail("dataset has no training rows")
    ids = [str(row["id"]) for row in rows]
    if len(ids) != len(set(ids)):
        fail("dataset contains duplicate ids")
    source_case_ids = [str(row["provenance"]["sourceCaseId"]) for row in rows]
    if len(source_case_ids) != len(set(source_case_ids)):
        fail("dataset contains duplicate sourceCaseIds")
    return rows


def select_device(torch: object) -> str:
    if getattr(torch, "cuda").is_available():
        return "cuda"
    mps = getattr(getattr(torch, "backends", object()), "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def verify_training_environment(modules: dict[str, object]) -> dict[str, str]:
    observed = {
        "python": ".".join(str(part) for part in sys.version_info[:3]),
        **{
            name: str(getattr(module, "__version__", ""))
            for name, module in modules.items()
        },
    }
    if observed != TRAINING_ENVIRONMENT:
        fail(
            "training environment is not pinned: "
            + json.dumps(observed, sort_keys=True, separators=(",", ":"))
        )
    encoded = json.dumps(observed, sort_keys=True, separators=(",", ":")).encode()
    if hashlib.sha256(encoded).hexdigest() != TRAINING_ENVIRONMENT_SHA256:
        fail("training environment digest does not match the reviewed value")
    return observed


def question_metrics(predictions: list[dict[str, object]]) -> dict[str, object]:
    """Compute metrics per question so unrelated label spaces are never mixed."""
    grouped: dict[str, list[dict[str, object]]] = collections.defaultdict(list)
    for prediction in predictions:
        grouped[str(prediction["questionId"])].append(prediction)
    by_question: dict[str, object] = {}
    for question_id in sorted(grouped):
        rows = grouped[question_id]
        classes = list(QUESTION_CLASSES[question_id])
        f1: list[float] = []
        brier = 0.0
        high_confidence = 0
        high_confidence_errors = 0
        error_ids: list[str] = []
        high_confidence_error_ids: list[str] = []
        bins = [dict(count=0, confidence=0.0, correct=0) for _ in range(10)]
        for row in rows:
            predicted = str(row["predicted"])
            gold = str(row["gold"])
            probabilities = row["probabilities"]
            assert isinstance(probabilities, dict)
            correct = predicted == gold
            confidence = float(probabilities[predicted])
            bucket = bins[min(9, math.floor(confidence * 10))]
            bucket["count"] += 1
            bucket["confidence"] += confidence
            bucket["correct"] += int(correct)
            if not correct:
                error_ids.append(f'{row["caseId"]}:{question_id}')
            if confidence >= 0.9:
                high_confidence += 1
                high_confidence_errors += int(not correct)
                if not correct:
                    high_confidence_error_ids.append(f'{row["caseId"]}:{question_id}')
            for name in classes:
                brier += (float(probabilities[name]) - (1 if gold == name else 0)) ** 2
        for name in classes:
            true_positive = sum(row["gold"] == name and row["predicted"] == name for row in rows)
            false_positive = sum(row["gold"] != name and row["predicted"] == name for row in rows)
            false_negative = sum(row["gold"] == name and row["predicted"] != name for row in rows)
            precision = 0.0 if true_positive + false_positive == 0 else true_positive / (true_positive + false_positive)
            recall = 0.0 if true_positive + false_negative == 0 else true_positive / (true_positive + false_negative)
            f1.append(0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall))
        ece = sum(
            bucket["count"] / len(rows)
            * abs(bucket["correct"] / bucket["count"] - bucket["confidence"] / bucket["count"])
            for bucket in bins
            if bucket["count"]
        )
        by_question[question_id] = {
            "classes": classes,
            "sampleCount": len(rows),
            "accuracy": sum(row["gold"] == row["predicted"] for row in rows) / len(rows),
            "macroF1": sum(f1) / len(f1),
            "brier": brier / len(rows),
            "expectedCalibrationError": ece,
            "highConfidenceErrorRate": None if high_confidence == 0 else high_confidence_errors / high_confidence,
            "highConfidenceErrorCaseQuestionIds": sorted(high_confidence_error_ids),
            "errorCaseQuestionIds": sorted(error_ids),
        }

    by_case: dict[str, dict[str, dict[str, object]]] = collections.defaultdict(dict)
    for prediction in predictions:
        by_case[str(prediction["caseId"])][str(prediction["questionId"])] = prediction
    false_escalation_base = 0
    false_escalations = 0
    critical_base = 0
    critical_correct = 0
    critical_misses: list[str] = []
    for case_id, answers in by_case.items():
        validity = answers.get("finding-validity")
        action = answers.get("required-action")
        severity = answers.get("severity")
        dismissable = (
            (validity is not None and validity["gold"] == "no")
            or (action is not None and action["gold"] == "dismiss")
        )
        if dismissable and (validity is not None or action is not None):
            false_escalation_base += 1
            if (
                (validity is not None and validity["predicted"] == "yes")
                or (action is not None and action["predicted"] == "fix")
            ):
                false_escalations += 1
        actual_critical = (
            severity is not None
            and severity["gold"] == "critical"
            and (
                (validity is not None and validity["gold"] == "yes")
                or (action is not None and action["gold"] == "fix")
            )
        )
        if actual_critical:
            critical_base += 1
            detected = (
                (validity is not None and validity["predicted"] == "yes")
                or (action is not None and action["predicted"] == "fix")
            )
            if detected:
                critical_correct += 1
            else:
                critical_misses.append(case_id)
    return {
        "schemaVersion": "asc/laya-validation-evaluation/v1",
        "sampleCount": len(predictions),
        "byQuestion": by_question,
        "safety": {
            "falseEscalationRate": None if false_escalation_base == 0 else false_escalations / false_escalation_base,
            "criticalRecall": None if critical_base == 0 else critical_correct / critical_base,
            "criticalMissCaseIds": sorted(critical_misses),
        },
    }


def train(manifest_path: Path, output: Path) -> None:
    repository = Path.cwd().resolve(strict=True)
    manifest_path = manifest_path.resolve(strict=True)
    manifest = load_manifest(manifest_path)
    train_path = contained_file(repository, manifest["trainPath"], "trainPath")
    validation_path = contained_file(repository, manifest["validationPath"], "validationPath")
    bindings = load_training_bindings(repository, manifest)
    combined = hashlib.sha256((sha256(train_path) + sha256(validation_path)).encode()).hexdigest()
    if combined != manifest["datasetDigest"]:
        fail("dataset digest mismatch")
    run_root_path = repository / LOCAL_RUN_ROOT
    try:
        run_root_metadata = run_root_path.lstat()
    except FileNotFoundError:
        fail(f"local run root must exist: {LOCAL_RUN_ROOT.as_posix()}")
    if stat.S_ISLNK(run_root_metadata.st_mode) or not stat.S_ISDIR(run_root_metadata.st_mode):
        fail("local run root must be a regular non-symlink directory")
    run_root = run_root_path.resolve(strict=True)
    if run_root != run_root_path:
        fail("local run root must not contain symlink ancestors")
    output_lexical = repository / output
    if output.is_absolute() or output_lexical.parent != run_root_path or output.name in {"", ".", ".."}:
        fail(f"output must be a direct child of {LOCAL_RUN_ROOT.as_posix()}")
    output = run_root / output.name
    run_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    run_fd = os.open(run_root, run_flags)
    run_identity = (os.fstat(run_fd).st_dev, os.fstat(run_fd).st_ino)
    try:
        os.stat(output.name, dir_fd=run_fd, follow_symlinks=False)
    except FileNotFoundError:
        pass
    else:
        os.close(run_fd)
        fail("output must not already exist")

    try:
        import torch
        import transformers
        import safetensors
        import huggingface_hub
        from huggingface_hub import snapshot_download
        from huggingface_hub.errors import LocalEntryNotFoundError
        from safetensors.torch import load_file, save_file
        from transformers import AutoTokenizer
    except ImportError:
        os.close(run_fd)
        fail("optional training dependencies are unavailable; no checkpoint was created")

    training_environment = verify_training_environment({
        "torch": torch,
        "transformers": transformers,
        "safetensors": safetensors,
        "huggingface_hub": huggingface_hub,
    })

    verify_laya_package()
    from laya.common import QTYPES, build_model, build_sequence, render_options

    seed = int(manifest["seed"])
    random.seed(seed)
    torch.manual_seed(seed)
    device = select_device(torch)
    torch.use_deterministic_algorithms(True, warn_only=device == "mps")
    if device == "cuda":
        torch.cuda.manual_seed_all(seed)
    if device == "mps":
        torch.mps.manual_seed(seed)
    model_files = [
        "model.safetensors",
        "rl_agent_config.json",
        "encoder/*",
        "tokenizer/*",
    ]
    explicit_model = os.environ.get("ASC_LAYA_MODEL_PATH")
    allow_cache_links = False
    if explicit_model:
        model_candidate = Path(explicit_model)
        if not model_candidate.is_absolute():
            fail("ASC_LAYA_MODEL_PATH must be absolute")
        if model_candidate.is_symlink():
            fail("ASC_LAYA_MODEL_PATH must not be a symlink")
        model_candidate = model_candidate.resolve(strict=True)
        if model_candidate.name != BASE_MODEL_REVISION:
            fail("ASC_LAYA_MODEL_PATH is not the pinned revision")
        source_model = model_candidate
        # Hugging Face snapshots commonly expose blobs through symlinks. The
        # source is never loaded in place: every required file is copied to an
        # isolated directory and verified against BASE_MODEL_SHA256 first.
        allow_cache_links = True
    else:
        allow_cache_links = True
        try:
            source_model = Path(snapshot_download(
                repo_id=BASE_MODEL,
                revision=BASE_MODEL_REVISION,
                allow_patterns=model_files,
                local_files_only=True,
            ))
        except LocalEntryNotFoundError:
            source_model = Path(snapshot_download(
                repo_id=BASE_MODEL,
                revision=BASE_MODEL_REVISION,
                allow_patterns=model_files,
            ))
    model_workspace, model_dir = materialize_model(
        source_model, allow_cache_links=allow_cache_links
    )
    config = json.loads((model_dir / "rl_agent_config.json").read_text(encoding="utf-8"))
    config["max_len"] = min(int(config.get("max_len", 1024)), 1024)
    config["head_max_len"] = min(int(config.get("head_max_len", 256)), 256)
    tokenizer = AutoTokenizer.from_pretrained(model_dir / "tokenizer")
    model = build_model(config, encoder_dir=str(model_dir / "encoder"), pretrained=False)
    model.load_state_dict(load_file(model_dir / "model.safetensors"), strict=True)
    for parameter in model.encoder.parameters():
        parameter.requires_grad = False
    model.to(device)

    def make_items(rows: list[dict[str, object]]) -> list[dict[str, object]]:
        items: list[dict[str, object]] = []
        for row in rows:
            state = json.loads(str(row["state"]))
            questions = json.loads(str(row["questions"]))
            gold = json.loads(str(row["gold"]))
            for question_id, question in questions.items():
                answer = gold[question_id]
                choices = list(QUESTION_CLASSES[question_id])
                ordered_criteria = {
                    choice: question["criteria"][choice] for choice in choices
                }
                target = [float(answer["probabilities"].get(choice, 0.0)) for choice in choices]
                sequence, markers = build_sequence(
                    tokenizer,
                    state,
                    {"t": question["type"], "ins": question["instructions"], "crit": ordered_criteria},
                    config["max_len"],
                    config["head_max_len"],
                )
                if len(markers) != len(render_options({"t": question["type"], "crit": ordered_criteria})):
                    fail("training question marker count is invalid")
                items.append({
                    "case_id": row["id"], "ids": sequence, "markers": markers,
                    "qtype": QTYPES[question["type"]], "target": target,
                    "label": target.index(max(target)), "question": question_id,
                    "choices": choices,
                })
        if not items:
            fail("dataset has no labeled questions")
        return items

    def balanced(items: list[dict[str, object]]) -> tuple[list[dict[str, object]], collections.Counter[tuple[str, int]]]:
        counts = collections.Counter((str(item["question"]), int(item["label"])) for item in items)
        maxima: dict[str, int] = {}
        for (question, _), count in counts.items():
            maxima[question] = max(maxima.get(question, 0), count)
        expanded: list[dict[str, object]] = []
        for item in items:
            key = (str(item["question"]), int(item["label"]))
            repeat = min(MAX_OVERSAMPLE, max(1, round(maxima[key[0]] / counts[key])))
            expanded.extend([item] * repeat)
        random.Random(seed).shuffle(expanded)
        return expanded, counts

    def collate(items: list[dict[str, object]]):
        length = max(len(item["ids"]) for item in items)
        maximum_choices = max(len(item["markers"]) for item in items)
        ids = torch.full((len(items), length), tokenizer.pad_token_id, dtype=torch.long)
        attention = torch.zeros((len(items), length), dtype=torch.long)
        positions = torch.zeros((len(items), maximum_choices), dtype=torch.long)
        mask = torch.zeros((len(items), maximum_choices), dtype=torch.bool)
        target = torch.zeros((len(items), maximum_choices), dtype=torch.float32)
        for index, item in enumerate(items):
            item_ids = item["ids"]
            item_markers = item["markers"]
            item_target = item["target"]
            ids[index, :len(item_ids)] = torch.tensor(item_ids)
            attention[index, :len(item_ids)] = 1
            positions[index, :len(item_markers)] = torch.tensor(item_markers)
            mask[index, :len(item_markers)] = True
            target[index, :len(item_target)] = torch.tensor(item_target)
        return ids, attention, positions, mask, target, torch.tensor([item["qtype"] for item in items])

    def evaluate(items: list[dict[str, object]], include_predictions: bool = False) -> dict[str, object]:
        model.train(False)
        correct = 0
        loss_sum = 0.0
        predictions: list[dict[str, object]] = []
        with torch.no_grad():
            for start in range(0, len(items), BATCH_SIZE):
                chunk = items[start:start + BATCH_SIZE]
                ids, attention, positions, mask, target, qtype = collate(chunk)
                logits, _ = model(ids.to(device), attention.to(device), positions.to(device), mask.to(device), qtype.to(device))
                masked = logits.masked_fill(~mask.to(device), -1e4)
                loss = -(target.to(device) * torch.log_softmax(masked, -1)).sum(-1).mean()
                correct += int((masked.argmax(-1).cpu() == target.argmax(-1)).sum())
                loss_sum += float(loss) * len(chunk)
                if include_predictions:
                    probabilities = torch.softmax(masked, -1).cpu()
                    for index, item in enumerate(chunk):
                        choices = list(item["choices"])
                        predicted_index = int(probabilities[index, :len(choices)].argmax())
                        predictions.append({
                            "schemaVersion": "asc/laya-validation-prediction/v1",
                            "caseId": item["case_id"],
                            "questionId": item["question"],
                            "classes": choices,
                            "probabilities": {
                                choice: float(probabilities[index, choice_index])
                                for choice_index, choice in enumerate(choices)
                            },
                            "predicted": choices[predicted_index],
                            "gold": choices[int(item["label"])],
                        })
        result: dict[str, object] = {
            "loss": loss_sum / len(items),
            "accuracy": correct / len(items),
            "count": len(items),
        }
        if include_predictions:
            result["predictions"] = sorted(
                predictions,
                key=lambda prediction: (str(prediction["caseId"]), str(prediction["questionId"])),
            )
        return result

    train_rows = read_rows(train_path, manifest, "train", bindings)
    validation_rows = read_rows(validation_path, manifest, "validation", bindings)
    train_ids = {str(row["id"]) for row in train_rows}
    validation_ids = {str(row["id"]) for row in validation_rows}
    overlap = sorted(train_ids & validation_ids)
    if overlap:
        fail(f"train and validation datasets overlap: {overlap[0]}")
    train_items = make_items(train_rows)
    validation_items = make_items(validation_rows)
    expanded, counts = balanced(train_items)
    trainable = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=LEARNING_RATE, weight_decay=0.01)
    history: list[dict[str, object]] = []
    started = time.time()
    for epoch in range(EPOCHS):
        random.Random(seed + epoch).shuffle(expanded)
        model.train()
        loss_sum = 0.0
        for start in range(0, len(expanded), BATCH_SIZE):
            chunk = expanded[start:start + BATCH_SIZE]
            ids, attention, positions, mask, target, qtype = collate(chunk)
            logits, _ = model(ids.to(device), attention.to(device), positions.to(device), mask.to(device), qtype.to(device))
            loss = -(target.to(device) * torch.log_softmax(logits.masked_fill(~mask.to(device), -1e4), -1)).sum(-1).mean()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable, 1.0)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            loss_sum += float(loss.detach()) * len(chunk)
        history.append({"epoch": epoch + 1, "trainLoss": loss_sum / len(expanded), "validation": evaluate(validation_items)})

    validation_run = evaluate(validation_items, include_predictions=True)
    validation_predictions = validation_run.pop("predictions")

    current_root = os.stat(run_root_path, follow_symlinks=False)
    if stat.S_ISLNK(current_root.st_mode) or (current_root.st_dev, current_root.st_ino) != run_identity:
        fail("local run root identity changed during training")
    temporary_name = f".{output.name}-{secrets.token_hex(12)}"
    os.mkdir(temporary_name, mode=0o700, dir_fd=run_fd)
    repository_fd = os.open(repository, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    os.fchdir(run_fd)
    temporary = Path(temporary_name)
    try:
        weights = {key: value.detach().cpu().contiguous() for key, value in model.state_dict().items()}
        save_file(weights, temporary / "model.safetensors")
        model.encoder.config.save_pretrained(temporary / "encoder")
        tokenizer.save_pretrained(temporary / "tokenizer")
        config.update({
            "fine_tuned": True,
            "model_name": "asc-laya-decision-candidate",
            "training": {
                "profile": "frozen-decision-head-v1", "seed": seed, "epochs": EPOCHS,
                "determinism": "best-effort-mps" if device == "mps" else "strict",
                "encoderFrozen": True, "trainItems": len(train_items),
                "balancedItems": len(expanded), "validationItems": len(validation_items),
                "history": history,
                "labelCounts": {f"{key[0]}:{key[1]}": count for key, count in counts.items()},
            },
        })
        (temporary / "rl_agent_config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        predictions_path = temporary / "predictions-validation.jsonl"
        predictions_path.write_text(
            "".join(
                json.dumps(prediction, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
                for prediction in validation_predictions
            ),
            encoding="utf-8",
        )
        checkpoint_sha = sha256(temporary / "model.safetensors")
        result = {
            "schemaVersion": "asc/laya-training-result/v1", "state": "trained-candidate",
            "authority": False, "device": device, "manifestSha256": sha256(manifest_path),
            "baseCheckpointSha256": sha256(model_dir / "model.safetensors"),
            "checkpointSha256": checkpoint_sha,
            "trainingProfile": "frozen-decision-head-v1",
            "environmentDigestSha256": TRAINING_ENVIRONMENT_SHA256,
        }
        (temporary / "training-result.json").write_text(json.dumps(result, sort_keys=True) + "\n", encoding="utf-8")
        artifact_digests = {
            relative: sha256(temporary / relative)
            for relative in [
                "model.safetensors",
                "rl_agent_config.json",
                "encoder/config.json",
                "tokenizer/tokenizer.json",
                "tokenizer/tokenizer_config.json",
                "predictions-validation.jsonl",
                "training-result.json",
            ]
        }
        output_digest = hashlib.sha256(
            "".join(f"{name}:{digest}\n" for name, digest in sorted(artifact_digests.items())).encode()
        ).hexdigest()
        run_report = {
            "schemaVersion": "asc/laya-training-run-report/v1",
            "state": "trained-candidate",
            "authority": False,
            "manifestSha256": sha256(manifest_path),
            "dataSha256": {"train": sha256(train_path), "validation": sha256(validation_path)},
            "checkpointSha256": checkpoint_sha,
            "baseCheckpointSha256": sha256(model_dir / "model.safetensors"),
            "artifactSha256": artifact_digests,
            "outputDigest": output_digest,
            "counts": {
                "trainRows": len(train_rows), "validationRows": len(validation_rows),
                "trainItems": len(train_items), "balancedItems": len(expanded),
                "validationItems": len(validation_items),
            },
            "metrics": {
                **validation_run,
                "questionLevel": question_metrics(validation_predictions),
            },
            "environment": {
                "device": device,
                "dependencies": training_environment,
                "digestSha256": TRAINING_ENVIRONMENT_SHA256,
            },
            "determinism": "best-effort-mps" if device == "mps" else "strict",
            "elapsedSeconds": time.time() - started,
        }
        (temporary / "run-report.json").write_text(
            json.dumps(run_report, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        current_root = os.stat(run_root_path, follow_symlinks=False)
        if stat.S_ISLNK(current_root.st_mode) or (current_root.st_dev, current_root.st_ino) != run_identity:
            fail("local run root identity changed before publication")
        try:
            os.stat(output.name, dir_fd=run_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            fail("output appeared during training")
        os.rename(temporary_name, output.name, src_dir_fd=run_fd, dst_dir_fd=run_fd)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    finally:
        os.fchdir(repository_fd)
        os.close(repository_fd)
        os.close(run_fd)
        model_workspace.cleanup()


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
