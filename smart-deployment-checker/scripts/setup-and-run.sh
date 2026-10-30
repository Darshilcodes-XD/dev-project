#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON_BIN="${PYTHON_BIN:-python3}"
NODE_BIN="${NODE_BIN:-node}"
NPM_BIN="${NPM_BIN:-npm}"
VENV_DIR="${VENV_DIR:-.venv}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python 3 is required. Install Python 3.11+ and rerun this script." >&2
  exit 1
fi
if ! command -v "$NODE_BIN" >/dev/null 2>&1 || ! command -v "$NPM_BIN" >/dev/null 2>&1; then
  echo "Node.js 20+ and npm are required to build the frontend." >&2
  exit 1
fi

if [[ ! -d "$VENV_DIR" ]]; then
  echo "[1/6] Creating Python virtual environment"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi
if [[ "${OS:-}" == "Windows_NT" ]]; then
  VENV_PY="$VENV_DIR/Scripts/python.exe"
else
  VENV_PY="$VENV_DIR/bin/python"
fi

echo "[2/6] Installing backend dependencies"
"$VENV_PY" -m pip install --upgrade pip
"$VENV_PY" -m pip install -r requirements.txt

echo "[3/6] Installing frontend dependencies"
if [[ -f frontend/package-lock.json ]]; then
  (cd frontend && "$NPM_BIN" ci)
else
  (cd frontend && "$NPM_BIN" install)
fi

echo "[4/6] Building the frontend"
(cd frontend && "$NPM_BIN" run build)

echo "[5/6] Running backend tests"
"$VENV_PY" -m pytest backend/tests -q

echo "[6/6] Preparing container build context"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker build -t smart-deployment-checker:local .
else
  mkdir -p artifacts
  tar -czf artifacts/container-build-context.tar.gz \
    --exclude='./.git' --exclude='./.venv' --exclude='./venv' \
    --exclude='./node_modules' --exclude='./frontend/node_modules' \
    --exclude='./frontend/dist' --exclude='./artifacts' --exclude='./instance' \
    --exclude='./.pytest_cache' --exclude='*/__pycache__' .
  echo "Docker Engine unavailable; a build context was created, not an image."
fi

mkdir -p instance
export DATABASE_PATH="${DATABASE_PATH:-instance/smart-deployment-checker.db}"
export SECRET_KEY="${SECRET_KEY:-local-only-change-this-secret}"
export PORT="${PORT:-5000}"
echo "Starting Smart Deployment Checker at http://127.0.0.1:${PORT}"
exec "$VENV_PY" -m flask --app backend.wsgi:app run --host 0.0.0.0 --port "$PORT"
