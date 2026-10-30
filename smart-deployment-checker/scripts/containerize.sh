#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
IMAGE="${IMAGE_NAME:-smart-deployment-checker:local}"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Building container image: $IMAGE"
  docker build --pull -t "$IMAGE" .
  echo "Container image built: $IMAGE"
else
  mkdir -p artifacts
  tar -czf "artifacts/container-build-context.tar.gz" \
    --exclude='./.git' --exclude='./.venv' --exclude='./venv' \
    --exclude='./node_modules' --exclude='./frontend/node_modules' \
    --exclude='./frontend/dist' --exclude='./artifacts' --exclude='./instance' \
    --exclude='./.pytest_cache' --exclude='*/__pycache__' .
  echo "Docker Engine is not available in this environment."
  echo "Created artifacts/container-build-context.tar.gz; this is a build context, not a container image."
  echo "On a Docker-enabled machine run: docker build -t $IMAGE ."
fi
