from __future__ import annotations

import os
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from .db import init_db
from .routes import api

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = ROOT / "frontend" / "dist"


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config.from_mapping(
        SECRET_KEY=os.getenv("SECRET_KEY", "local-development-key-change-me"),
        DATABASE_PATH=os.getenv("DATABASE_PATH", str(ROOT / "instance" / "smart-deploy.db")),
        INFRA_MODE=os.getenv("INFRA_MODE", "sandbox"),
        MAX_CONTENT_LENGTH=1024 * 1024,
    )
    if test_config:
        app.config.update(test_config)

    init_db(app)
    app.register_blueprint(api)

    @app.get("/")
    def index():
        # Browsers receive the SPA; API clients receive a stable service identity payload.
        index_file = FRONTEND_DIST / "index.html"
        accepts_html = request.accept_mimetypes.best == "text/html"
        if index_file.exists() and accepts_html:
            return send_from_directory(FRONTEND_DIST, "index.html")
        return jsonify({
            "name": "Smart Deployment Checker",
            "message": "Release workflow service is ready.",
            "health": "/health",
            "api": "/api/dashboard",
        })

    @app.get("/<path:path>")
    def frontend_assets(path: str):
        requested = FRONTEND_DIST / path
        if requested.is_file():
            return send_from_directory(FRONTEND_DIST, path)
        index_file = FRONTEND_DIST / "index.html"
        if index_file.exists():
            return send_from_directory(FRONTEND_DIST, "index.html")
        return jsonify({"error": "Not found", "path": path}), 404

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException):
        if error.code == 404:
            return jsonify({"error": "The requested resource was not found."}), 404
        return jsonify({"error": error.description}), error.code or 500

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception):
        app.logger.exception("Unhandled application error")
        return jsonify({"error": "An unexpected server error occurred."}), 500

    return app
