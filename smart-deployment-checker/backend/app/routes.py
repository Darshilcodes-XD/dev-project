from __future__ import annotations

import json
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from flask import Blueprint, current_app, jsonify, request

from .db import get_db, json_load
from .engine import add_log, execute_pipeline, run_pytest, save_test_run, utc_now

api = Blueprint("api", __name__)
executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="deployment-pipeline")
VALID_ENVIRONMENTS = {"Development", "Staging", "Production"}


def _deployment(row):
    if row is None:
        return None
    data = dict(row)
    data["stages"] = json_load(data.get("stages"), [])
    data["logs"] = json_load(data.get("logs"), [])
    return data


def _test_run(row):
    if row is None:
        return None
    data = dict(row)
    data["cases"] = json_load(data.get("cases"), [])
    return data


@api.get("/health")
def health():
    return jsonify({"status": "healthy"})


@api.get("/api/health")
def api_health():
    return jsonify({"status": "healthy", "service": "Smart Deployment Checker", "checked_at": utc_now()})


@api.get("/api/dashboard")
def dashboard():
    db = get_db()
    deployment_stats = db.execute("""SELECT COUNT(*) total,
        SUM(CASE WHEN status='SUCCEEDED' THEN 1 ELSE 0 END) successful,
        SUM(CASE WHEN status IN ('FAILED','BLOCKED') THEN 1 ELSE 0 END) unsuccessful
        FROM deployments""").fetchone()
    test_stats = db.execute("""SELECT COUNT(*) runs,
        SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) failed_runs
        FROM test_runs""").fetchone()
    latest_deployment = db.execute("SELECT * FROM deployments ORDER BY started_at DESC LIMIT 1").fetchone()
    latest_test = db.execute("SELECT * FROM test_runs ORDER BY created_at DESC LIMIT 1").fetchone()
    latest_health = db.execute("SELECT * FROM health_checks ORDER BY checked_at DESC LIMIT 1").fetchone()
    return jsonify({
        "deployments": {
            "total": deployment_stats["total"] or 0,
            "successful": deployment_stats["successful"] or 0,
            "unsuccessful": deployment_stats["unsuccessful"] or 0,
        },
        "tests": {"runs": test_stats["runs"] or 0, "failed_runs": test_stats["failed_runs"] or 0},
        "latest_deployment": _deployment(latest_deployment),
        "latest_test": _test_run(latest_test),
        "health": dict(latest_health) if latest_health else None,
        "infrastructure": {"mode": "sandbox", "cluster": "smart-sandbox-cluster", "connected": True},
    })


@api.get("/api/tests")
def list_tests():
    db = get_db()
    rows = db.execute("SELECT * FROM test_runs ORDER BY created_at DESC LIMIT 30").fetchall()
    return jsonify({"items": [_test_run(row) for row in rows]})


@api.post("/api/tests/run")
def run_tests():
    payload = request.get_json(silent=True) or {}
    inject_failure = bool(payload.get("inject_failure", False))
    result = run_pytest(inject_failure=inject_failure)
    run_id = save_test_run(result)
    add_log("tests", f"Test run {run_id}: {result['passed']} passed, {result['failed']} failed.",
            "ERROR" if result["status"] == "FAILED" else "INFO")
    # Execution failures are test outcomes, not malformed API requests.
    return jsonify({"id": run_id, **result, "created_at": utc_now()}), 200


@api.get("/api/tests/<run_id>")
def test_run_detail(run_id: str):
    row = get_db().execute("SELECT * FROM test_runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Test run not found."}), 404
    return jsonify(_test_run(row))


@api.get("/api/deployments")
def list_deployments():
    db = get_db()
    rows = db.execute("SELECT * FROM deployments ORDER BY started_at DESC LIMIT 100").fetchall()
    return jsonify({"items": [_deployment(row) for row in rows]})


@api.post("/api/deployments")
def create_deployment():
    payload = request.get_json(silent=True) or {}
    environment = payload.get("environment", "Development")
    version = str(payload.get("version", "1.0.0")).strip()
    namespace = str(payload.get("namespace", "default")).strip()
    try:
        replicas = int(payload.get("replicas", 2))
    except (TypeError, ValueError):
        return jsonify({"error": "Replica count must be a whole number."}), 400

    if environment not in VALID_ENVIRONMENTS:
        return jsonify({"error": "Choose Development, Staging, or Production."}), 400
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,39}", version):
        return jsonify({"error": "Version must be 1–40 characters and use letters, numbers, dots, underscores, or hyphens."}), 400
    if not re.fullmatch(r"[a-z0-9]([-a-z0-9]*[a-z0-9])?", namespace) or len(namespace) > 63:
        return jsonify({"error": "Namespace must be a valid Kubernetes-style name."}), 400
    if not 1 <= replicas <= 10:
        return jsonify({"error": "Replica count must be between 1 and 10."}), 400
    if environment == "Production" and payload.get("confirm_production") is not True:
        return jsonify({"error": "Production rollout requires explicit confirmation."}), 409

    deployment_id = f"DEP-{uuid.uuid4().hex[:8].upper()}"
    image_tag = f"sandbox.registry.local/smart-deployment-checker:{version}"
    stages = [
        {"id": "source", "name": "Source", "status": "WAITING", "detail": "Waiting for pipeline"},
        {"id": "tests", "name": "Automated tests", "status": "WAITING", "detail": "Waiting for pipeline"},
        {"id": "build", "name": "Container build", "status": "WAITING", "detail": "Waiting for pipeline"},
        {"id": "deploy", "name": "Sandbox rollout", "status": "WAITING", "detail": "Waiting for pipeline"},
        {"id": "verify", "name": "Health verification", "status": "WAITING", "detail": "Waiting for pipeline"},
    ]
    db = get_db()
    db.execute("""INSERT INTO deployments(id,environment,version,namespace,replicas,status,image_tag,
        started_at,stages,logs,failure_injection) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (deployment_id, environment, version, namespace, replicas, "QUEUED", image_tag,
         utc_now(), json.dumps(stages), json.dumps([]), int(bool(payload.get("inject_failure", False)))))
    db.commit()
    add_log("deployments", f"{deployment_id} queued for {environment}.")
    application = current_app._get_current_object()
    executor.submit(execute_pipeline, application, deployment_id)
    return jsonify({"id": deployment_id, "status": "QUEUED", "message": "Pipeline queued.", "poll_url": f"/api/deployments/{deployment_id}"}), 202


@api.get("/api/deployments/<deployment_id>")
def deployment_detail(deployment_id: str):
    row = get_db().execute("SELECT * FROM deployments WHERE id = ?", (deployment_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Deployment not found."}), 404
    return jsonify(_deployment(row))


@api.get("/api/deployments/<deployment_id>/logs")
def deployment_logs(deployment_id: str):
    row = get_db().execute("SELECT logs FROM deployments WHERE id = ?", (deployment_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Deployment not found."}), 404
    return jsonify({"items": json_load(row["logs"], [])})


@api.get("/api/docker/status")
def docker_status():
    db = get_db()
    rows = db.execute("SELECT * FROM deployments WHERE artifact_path IS NOT NULL ORDER BY started_at DESC LIMIT 20").fetchall()
    docker_available = __import__("shutil").which("docker") is not None
    return jsonify({
        "engine": "Virtual container build provider",
        "mode": "sandbox",
        "docker_cli_available": docker_available,
        "description": "A reproducible, SHA-256 tagged container build artifact is assembled after tests pass. The workflow uses an isolated virtual build provider and does not contact a remote image registry.",
        "builds": [_deployment(row) for row in rows],
    })


@api.get("/api/kubernetes/status")
def kubernetes_status():
    db = get_db()
    row = db.execute("SELECT * FROM sandbox_cluster WHERE id = 1").fetchone()
    if row is None:
        cluster = {
            "cluster_name": "smart-sandbox-cluster", "namespace": "default",
            "deployment_name": "smart-deployment", "service_name": "smart-checker-service",
            "desired_replicas": 0, "available_replicas": 0, "image_tag": "—", "pods": [], "updated_at": None,
        }
    else:
        cluster = dict(row)
        cluster["pods"] = json_load(cluster["pods"], [])
    return jsonify({
        "connected": True,
        "mode": "sandbox",
        "provider": "Virtual cluster adapter",
        "cluster": cluster,
        "service": {"name": "smart-checker-service", "type": "NodePort", "port": 5000, "node_port": 30080},
    })


@api.get("/api/health/history")
def health_history():
    rows = get_db().execute("SELECT * FROM health_checks ORDER BY checked_at DESC LIMIT 30").fetchall()
    return jsonify({"items": [dict(row) for row in rows]})


@api.post("/api/health/check")
def check_health():
    started = time.perf_counter()
    response = current_app.test_client().get("/health")
    response_ms = round((time.perf_counter() - started) * 1000, 2)
    data = response.get_json(silent=True) or {}
    healthy = response.status_code == 200 and data.get("status") == "healthy"
    message = "Health endpoint returned healthy." if healthy else "Health endpoint did not return the expected status."
    db = get_db()
    cursor = db.execute(
        "INSERT INTO health_checks(status,http_code,response_ms,message,checked_at) VALUES(?,?,?,?,?)",
        ("HEALTHY" if healthy else "UNHEALTHY", response.status_code, response_ms, message, utc_now()),
    )
    db.commit()
    return jsonify({"id": cursor.lastrowid, "status": "HEALTHY" if healthy else "UNHEALTHY",
                    "http_code": response.status_code, "response_ms": response_ms,
                    "message": message, "checked_at": utc_now()}), 200 if healthy else 503


@api.get("/api/logs")
def recent_logs():
    rows = get_db().execute("SELECT * FROM app_logs ORDER BY id DESC LIMIT 200").fetchall()
    return jsonify({"items": [dict(row) for row in rows]})


@api.get("/api/settings")
def settings():
    return jsonify({
        "application": "Smart Deployment Checker",
        "infrastructure_mode": "sandbox",
        "test_execution": "Actual Pytest subprocess execution",
        "container_build": "Versioned SHA-256 tagged container artifact",
        "orchestration": "Virtual cluster state stored in the application database",
        "database": "SQLite",
        "database_path": current_app.config["DATABASE_PATH"],
        "production_confirmation_required": True,
        "notes": [
            "The test suite runs as a real subprocess and its JUnit report is parsed.",
            "Container packaging and Kubernetes orchestration are isolated sandbox operations, not external Docker or Kubernetes calls.",
            "The application itself is a deployable Flask service; free-host local storage may be ephemeral.",
        ],
    })
