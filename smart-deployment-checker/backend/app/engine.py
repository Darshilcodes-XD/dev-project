from __future__ import annotations

import json
import os
import sqlite3
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import current_app

from .db import get_db

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "artifacts"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def add_log(source: str, message: str, level: str = "INFO") -> None:
    db = get_db()
    db.execute(
        "INSERT INTO app_logs(level, source, message, created_at) VALUES (?, ?, ?, ?)",
        (level, source, message, utc_now()),
    )
    db.commit()


def run_pytest(inject_failure: bool = False) -> dict[str, Any]:
    """Execute the repository's actual pytest suite and parse its JUnit report."""
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    report_fd, report_name = tempfile.mkstemp(prefix="pytest-", suffix=".xml", dir=ARTIFACTS)
    os.close(report_fd)
    report_path = Path(report_name)
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(ROOT) + os.pathsep + environment.get("PYTHONPATH", "")
    environment["PIPELINE_INJECT_FAILURE"] = "1" if inject_failure else "0"
    command = [sys.executable, "-m", "pytest", "backend/tests", "-q", f"--junitxml={report_path}"]
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        duration = time.perf_counter() - started
        output = (completed.stdout or "") + (completed.stderr or "")
        total = passed = failed = skipped = 0
        failure_details: list[dict[str, str]] = []
        test_cases: list[dict[str, Any]] = []
        try:
            root = ET.parse(report_path).getroot()
            total = int(root.attrib.get("tests", 0))
            failed = int(root.attrib.get("failures", 0)) + int(root.attrib.get("errors", 0))
            skipped = int(root.attrib.get("skipped", 0))
            passed = max(0, total - failed - skipped)
            for case in root.iter("testcase"):
                problem = case.find("failure")
                if problem is None:
                    problem = case.find("error")
                skipped_node = case.find("skipped")
                if problem is not None:
                    outcome = "FAILED"
                    failure_details.append({
                        "name": f"{case.attrib.get('classname', '')}.{case.attrib.get('name', 'test')}".strip("."),
                        "message": problem.attrib.get("message", "Assertion failed"),
                        "details": (problem.text or "").strip()[-1200:],
                    })
                elif skipped_node is not None:
                    outcome = "SKIPPED"
                else:
                    outcome = "PASSED"
                test_cases.append({
                    "name": f"{case.attrib.get('classname', '')}.{case.attrib.get('name', 'test')}".strip("."),
                    "duration": float(case.attrib.get("time", 0) or 0),
                    "status": outcome,
                    "message": problem.attrib.get("message", "") if problem is not None else "",
                    "details": (problem.text or "").strip()[-1200:] if problem is not None else "",
                })
        except (ET.ParseError, OSError, ValueError):
            # Preserve the raw output if the test runner itself fails before producing XML.
            total, passed, failed, skipped = 0, 0, 1 if completed.returncode else 0, 0
        if completed.returncode != 0 and failed == 0:
            failed = 1
            total = max(1, total)
        return {
            "status": "PASSED" if completed.returncode == 0 and failed == 0 else "FAILED",
            "total": total,
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "duration": round(duration, 3),
            "output": output[-16000:],
            "failures": failure_details,
            "cases": test_cases,
            "command": "python -m pytest backend/tests -q",
            "exit_code": completed.returncode,
            "injected_failure": inject_failure,
        }
    except subprocess.TimeoutExpired as error:
        duration = time.perf_counter() - started
        return {
            "status": "FAILED", "total": 0, "passed": 0, "failed": 1, "skipped": 0,
            "duration": round(duration, 3),
            "output": f"Test execution exceeded the 90 second safety limit.\n{error}",
            "failures": [{"name": "pytest.timeout", "message": "Test execution timed out", "details": "Review slow or blocked tests."}],
            "cases": [{"name": "pytest.timeout", "status": "FAILED", "duration": duration, "message": "Test execution timed out", "details": "Review slow or blocked tests."}],
            "command": "python -m pytest backend/tests -q", "exit_code": 124,
            "injected_failure": inject_failure,
        }
    finally:
        report_path.unlink(missing_ok=True)


def save_test_run(result: dict[str, Any]) -> str:
    run_id = f"TST-{uuid.uuid4().hex[:8].upper()}"
    db = get_db()
    db.execute(
        """INSERT INTO test_runs(id,status,total,passed,failed,skipped,duration,output,cases,created_at,injected_failure)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (run_id, result["status"], result["total"], result["passed"], result["failed"],
         result["skipped"], result["duration"], result["output"], json.dumps(result.get("cases", [])),
         utc_now(), int(result["injected_failure"])),
    )
    db.commit()
    return run_id


def create_container_package(deployment_id: str, image_tag: str) -> tuple[str, str]:
    """Assemble a reproducible container build context for the virtual build provider."""
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    archive_path = ARTIFACTS / f"{deployment_id.lower()}-container-context.tar.gz"
    include_paths = [
        ROOT / "backend", ROOT / "frontend" / "dist", ROOT / "requirements.txt",
        ROOT / "Dockerfile", ROOT / "gunicorn.conf.py", ROOT / "render.yaml",
    ]
    with tarfile.open(archive_path, "w:gz") as archive:
        for item in include_paths:
            if item.exists():
                archive.add(item, arcname=item.relative_to(ROOT), filter=_exclude_generated)
    digest = __import__("hashlib").sha256(archive_path.read_bytes()).hexdigest()[:12]
    image_reference = f"local.sandbox/smart-deployment-checker:{image_tag}"
    manifest_path = ARTIFACTS / f"{deployment_id.lower()}-image-manifest.json"
    manifest_path.write_text(json.dumps({
        "schemaVersion": 1,
        "artifactType": "application/vnd.smart-deployment-checker.context.v1+tar",
        "image": image_reference,
        "digest": f"sha256:{digest}",
        "archive": archive_path.name,
        "builtAt": utc_now(),
        "provider": "virtual-container-builder",
    }, indent=2), encoding="utf-8")
    return str(archive_path), image_reference


def _exclude_generated(tar_info: tarfile.TarInfo) -> tarfile.TarInfo | None:
    excluded = {"__pycache__", ".pytest_cache", "node_modules", ".venv", ".git", "artifacts", "instance", ".mypy_cache"}
    if any(part in excluded for part in Path(tar_info.name).parts):
        return None
    return tar_info


def _update_deployment(deployment_id: str, **fields) -> None:
    db = get_db()
    assignments = ", ".join(f"{key} = ?" for key in fields)
    db.execute(f"UPDATE deployments SET {assignments} WHERE id = ?", (*fields.values(), deployment_id))
    db.commit()


def _append_deployment_log(deployment_id: str, message: str, level: str = "INFO") -> None:
    db = get_db()
    row = db.execute("SELECT logs FROM deployments WHERE id = ?", (deployment_id,)).fetchone()
    logs = json.loads(row["logs"]) if row else []
    logs.append({"time": utc_now(), "level": level, "message": message})
    db.execute("UPDATE deployments SET logs = ? WHERE id = ?", (json.dumps(logs), deployment_id))
    db.commit()
    add_log("pipeline", f"{deployment_id}: {message}", level)


def _set_stage(deployment_id: str, stage_name: str, status: str, detail: str = "") -> None:
    db = get_db()
    row = db.execute("SELECT stages FROM deployments WHERE id = ?", (deployment_id,)).fetchone()
    stages = json.loads(row["stages"])
    for stage in stages:
        if stage["id"] == stage_name:
            stage["status"] = status
            stage["detail"] = detail
            if status == "RUNNING":
                stage["started_at"] = utc_now()
            if status in {"PASSED", "FAILED", "BLOCKED"}:
                stage["completed_at"] = utc_now()
            break
    _update_deployment(deployment_id, stages=json.dumps(stages))


def execute_pipeline(app, deployment_id: str) -> None:
    """Real test execution followed by sandbox container packaging and cluster rollout."""
    with app.app_context():
        db = get_db()
        deployment = db.execute("SELECT * FROM deployments WHERE id = ?", (deployment_id,)).fetchone()
        if not deployment:
            return
        inject_failure = bool(deployment["failure_injection"])
        _update_deployment(deployment_id, status="RUNNING")
        _append_deployment_log(deployment_id, "Pipeline accepted. Initializing isolated deployment workspace.")
        _set_stage(deployment_id, "source", "PASSED", "Application source and configuration loaded")

        _set_stage(deployment_id, "tests", "RUNNING", "Executing the repository Pytest suite")
        _append_deployment_log(deployment_id, "Running the actual Pytest suite.")
        test_result = run_pytest(inject_failure=inject_failure)
        test_run_id = save_test_run(test_result)
        _update_deployment(
            deployment_id,
            test_total=test_result["total"],
            test_passed=test_result["passed"],
            test_failed=test_result["failed"],
        )
        if test_result["status"] != "PASSED":
            _set_stage(deployment_id, "tests", "FAILED", f"{test_result['failed']} test(s) failed")
            _append_deployment_log(deployment_id, f"Required tests failed. Build and rollout are blocked. Test run: {test_run_id}.", "ERROR")
            for stage_id in ("build", "deploy", "verify"):
                _set_stage(deployment_id, stage_id, "BLOCKED", "Blocked because required tests did not pass")
            _update_deployment(deployment_id, status="BLOCKED", build_status="BLOCKED", cluster_status="BLOCKED", completed_at=utc_now())
            return

        _set_stage(deployment_id, "tests", "PASSED", f"{test_result['passed']} passed · {test_result['duration']}s")
        _append_deployment_log(deployment_id, f"All {test_result['passed']} required tests passed in {test_result['duration']}s.")

        _set_stage(deployment_id, "build", "RUNNING", "Assembling a versioned container context")
        _append_deployment_log(deployment_id, "Preparing versioned container build context.")
        try:
            archive_path, image_tag = create_container_package(deployment_id, deployment["version"])
            _update_deployment(deployment_id, build_status="PACKAGED", artifact_path=archive_path, image_tag=image_tag)
            _set_stage(deployment_id, "build", "PASSED", "Container artifact assembled and SHA-256 tagged")
            _append_deployment_log(deployment_id, f"Container artifact created: {Path(archive_path).name}.")
        except (OSError, tarfile.TarError) as error:
            _set_stage(deployment_id, "build", "FAILED", str(error)[:180])
            _append_deployment_log(deployment_id, f"Container packaging failed: {error}", "ERROR")
            for stage_id in ("deploy", "verify"):
                _set_stage(deployment_id, stage_id, "BLOCKED", "Blocked because the container package was not created")
            _update_deployment(deployment_id, status="FAILED", build_status="FAILED", cluster_status="BLOCKED", completed_at=utc_now())
            return

        _set_stage(deployment_id, "deploy", "RUNNING", "Applying resources to the virtual cluster")
        _append_deployment_log(deployment_id, "Applying deployment and service records to the virtual cluster provider.")
        try:
            replicas = int(deployment["replicas"])
            pods = [
                {
                    "name": f"smart-deployment-{deployment_id[-5:].lower()}-{index + 1}",
                    "status": "Running",
                    "ready": True,
                    "restarts": 0,
                    "age": "just now",
                    "image": image_tag,
                }
                for index in range(replicas)
            ]
            db.execute(
                """INSERT INTO sandbox_cluster(id,cluster_name,namespace,deployment_name,service_name,
                desired_replicas,available_replicas,image_tag,pods,updated_at)
                VALUES(1,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET cluster_name=excluded.cluster_name,namespace=excluded.namespace,
                deployment_name=excluded.deployment_name,service_name=excluded.service_name,
                desired_replicas=excluded.desired_replicas,available_replicas=excluded.available_replicas,
                image_tag=excluded.image_tag,pods=excluded.pods,updated_at=excluded.updated_at""",
                ("smart-sandbox-cluster", deployment["namespace"], "smart-deployment", "smart-checker-service",
                 replicas, replicas, image_tag, json.dumps(pods), utc_now()),
            )
            db.commit()
            _update_deployment(deployment_id, cluster_status="ROLLED_OUT")
            _set_stage(deployment_id, "deploy", "PASSED", f"{replicas}/{replicas} virtual replicas available")
            _append_deployment_log(deployment_id, f"Virtual rollout complete. {replicas} of {replicas} replicas are ready.")
        except (ValueError, sqlite3.Error) as error:  # noqa: F821
            _set_stage(deployment_id, "deploy", "FAILED", str(error)[:180])
            _append_deployment_log(deployment_id, f"Sandbox rollout failed: {error}", "ERROR")
            _set_stage(deployment_id, "verify", "BLOCKED", "Blocked because rollout failed")
            _update_deployment(deployment_id, status="FAILED", cluster_status="FAILED", completed_at=utc_now())
            return

        _set_stage(deployment_id, "verify", "RUNNING", "Checking the application's live health endpoint")
        started = time.perf_counter()
        health = app.test_client().get("/health")
        response_ms = round((time.perf_counter() - started) * 1000, 2)
        healthy = health.status_code == 200 and health.get_json() == {"status": "healthy"}
        if healthy:
            _set_stage(deployment_id, "verify", "PASSED", f"HTTP 200 · {response_ms}ms · health endpoint verified")
            _append_deployment_log(deployment_id, f"Application health verified (HTTP 200, {response_ms}ms).")
            _update_deployment(deployment_id, status="SUCCEEDED", completed_at=utc_now())
        else:
            _set_stage(deployment_id, "verify", "FAILED", f"Health verification returned HTTP {health.status_code}")
            _append_deployment_log(deployment_id, f"Health verification failed with HTTP {health.status_code}.", "ERROR")
            _update_deployment(deployment_id, status="FAILED", cluster_status="UNHEALTHY", completed_at=utc_now())
