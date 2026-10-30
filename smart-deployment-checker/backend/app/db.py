from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from flask import current_app, g


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        database_path = Path(current_app.config["DATABASE_PATH"])
        database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(database_path, timeout=20, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        g.db = connection
    return g.db


def close_db(_error=None) -> None:
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def init_db(app) -> None:
    with app.app_context():
        db = get_db()
        db.executescript("""
        CREATE TABLE IF NOT EXISTS deployments (
            id TEXT PRIMARY KEY,
            environment TEXT NOT NULL,
            version TEXT NOT NULL,
            namespace TEXT NOT NULL,
            replicas INTEGER NOT NULL,
            status TEXT NOT NULL,
            test_total INTEGER DEFAULT 0,
            test_passed INTEGER DEFAULT 0,
            test_failed INTEGER DEFAULT 0,
            build_status TEXT NOT NULL DEFAULT 'WAITING',
            cluster_status TEXT NOT NULL DEFAULT 'WAITING',
            image_tag TEXT NOT NULL,
            artifact_path TEXT,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            stages TEXT NOT NULL,
            logs TEXT NOT NULL,
            failure_injection INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS test_runs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            total INTEGER NOT NULL,
            passed INTEGER NOT NULL,
            failed INTEGER NOT NULL,
            skipped INTEGER NOT NULL,
            duration REAL NOT NULL,
            output TEXT NOT NULL,
            cases TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            injected_failure INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS health_checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT NOT NULL,
            http_code INTEGER NOT NULL,
            response_ms REAL NOT NULL,
            message TEXT NOT NULL,
            checked_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sandbox_cluster (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            cluster_name TEXT NOT NULL,
            namespace TEXT NOT NULL,
            deployment_name TEXT NOT NULL,
            service_name TEXT NOT NULL,
            desired_replicas INTEGER NOT NULL,
            available_replicas INTEGER NOT NULL,
            image_tag TEXT NOT NULL,
            pods TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT NOT NULL,
            source TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """)
        # Lightweight forward migration for databases created by earlier builds.
        columns = {row[1] for row in db.execute("PRAGMA table_info(test_runs)").fetchall()}
        if "cases" not in columns:
            db.execute("ALTER TABLE test_runs ADD COLUMN cases TEXT NOT NULL DEFAULT '[]'")
        db.commit()
    app.teardown_appcontext(close_db)


def json_load(value: str, fallback):
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback
