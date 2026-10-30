# Smart Deployment Checker

A full-stack release engineering workspace built around a test-gated delivery pipeline. The application has a React + TypeScript interface, a Flask REST API, an actual Pytest subprocess runner, SQLite persistence, a versioned container build artifact, and a stateful virtual Kubernetes adapter.

## What runs for real, and what is intentionally virtual

| Layer | Behaviour |
|---|---|
| Frontend | React production bundle served by Flask |
| Backend | Flask REST API and SQLite records |
| Automated tests | Executes `python -m pytest backend/tests -q`; results are parsed from JUnit XML |
| Release gate | A failing required test blocks container packaging and rollout |
| Container build stage | Assembles a versioned container build artifact and records its SHA-256 digest |
| Kubernetes stage | Updates virtual Deployment, Service, and Pod records in SQLite; it does not contact a Kubernetes cluster |
| Health verification | Calls the app's Flask `/health` route and checks HTTP 200 plus the expected JSON body |
| Hosted app | Deployable as a Docker web service on Render's free web plan |

The application itself is not a screenshot-only frontend. Buttons call the API, records are persisted, tests execute in a subprocess, the release gate is enforced by the backend, and every pipeline stage records timestamps and logs. Infrastructure operations are intentionally isolated in the virtual provider so the project can be presented without real cloud credentials or cluster costs.

## Technology

- React 18, TypeScript, Vite, Tailwind CSS, Lucide React, Recharts
- Python 3.12, Flask, Gunicorn, Pytest
- SQLite for application state
- Dockerfile (multi-stage frontend build + Flask runtime)
- Render Blueprint (`render.yaml`) for one-click free-tier setup

## Run locally

### Prerequisites

- Python 3.11 or newer
- Node.js 20 or newer and npm
- Docker Desktop is optional. The API and the virtual release workflow do not require a local Docker daemon.

### One-command setup, build, test, and run

On Windows, double-click `setup-and-run.bat` or run `./setup-and-run.ps1` from PowerShell. On macOS/Linux/WSL:

```bash
chmod +x setup-and-run.sh
./setup-and-run.sh
```

The script creates `.venv`, installs Python and Node dependencies, builds the frontend, runs the actual Pytest suite, prepares a container build context (or invokes `docker build` when Docker Engine is available), and starts the Flask service at `http://localhost:5000`.

### Manual commands

```bash
# Backend dependencies
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\\Scripts\\activate
python -m pip install -r requirements.txt

# Frontend dependencies and production build
cd frontend
npm install
npm run build
cd ..

# Automated tests
python -m pytest backend/tests -q

# Run the web application
python -m flask --app backend.wsgi:app run --host 0.0.0.0 --port 5000
```

Open `http://localhost:5000` after the frontend build finishes.

## Release workflow

1. Choose Development, Staging, or Production.
2. Submit the release configuration.
3. The backend runs the repository Pytest suite.
4. If any required test fails, the API records `BLOCKED`; packaging and rollout are not executed.
5. When all tests pass, the build provider assembles the app files into a versioned artifact and writes a manifest with its SHA-256 digest.
6. The virtual cluster adapter updates Deployment, Service, and Pod state for the selected namespace and replica count.
7. The backend checks `/health`. A release is marked `SUCCEEDED` only after the health contract passes.

To verify the release gate manually, open **Automated tests** or **Deployments** and enable **Exercise release protection**. This deliberately introduces a failing assertion. The run should show one failed test and the later pipeline stages as `BLOCKED`.

## Containerise locally

The Dockerfile builds the frontend in a Node stage and copies the compiled bundle into a slim Python runtime image.

```bash
# Real image build (requires a running Docker Engine)
docker build -t smart-deployment-checker:local .

# Run the image
docker run --rm -p 5000:10000 \
  -e PORT=10000 \
  -e DATABASE_PATH=/tmp/smart-deployment-checker.db \
  smart-deployment-checker:local
```

Or use the helper:

```bash
./scripts/containerize.sh
```

If Docker Engine is not installed or running, the helper creates `artifacts/container-build-context.tar.gz` and explicitly reports that no image was built. The Dockerfile remains ready for a Docker-enabled machine or hosted builder.

## Deploy free on Render

A Render Blueprint is provided at the repository root in `render.yaml`.

1. Push this project folder to a GitHub repository.
2. Sign in to Render and choose **New → Blueprint**.
3. Connect the GitHub repository containing `render.yaml`.
4. Review the `smart-deployment-checker` service and choose the Free plan.
5. Apply the Blueprint. Render builds the Dockerfile, starts Gunicorn, and checks `/health`.
6. Open the generated `https://<service-name>.onrender.com` URL.

Render's free web services sleep after 15 minutes without inbound traffic and use an ephemeral filesystem. This project stores SQLite data in `/tmp` on Render, so release history and generated artifacts may reset after a restart, spin-down, or redeploy. The free plan is suitable for project evaluation, not durable production workloads. See [Render's free instance documentation](https://render.com/docs/free) and [web service deployment guide](https://render.com/docs/web-services).

### Deployment status

The project includes the complete Render Docker/Blueprint configuration. Creating the public Render service still requires connecting a GitHub repository to a Render account; no repository or hosting credentials are present in this workspace, so a public URL cannot be provisioned from this local project folder alone.

## API reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | Service identity (API clients) / dashboard (browser) |
| GET | `/health` | Health contract |
| GET | `/api/dashboard` | Summary metrics and latest records |
| GET | `/api/tests` | Recent Pytest executions |
| POST | `/api/tests/run` | Execute Pytest and return parsed results |
| GET | `/api/tests/<run_id>` | Test-run detail |
| GET | `/api/deployments` | Release history |
| POST | `/api/deployments` | Queue a gated release pipeline |
| GET | `/api/deployments/<id>` | Release detail and stage states |
| GET | `/api/deployments/<id>/logs` | Release event log |
| GET | `/api/docker/status` | Build provider status and artifacts |
| GET | `/api/kubernetes/status` | Virtual cluster and pod inventory |
| GET | `/api/health/history` | Recent health checks |
| POST | `/api/health/check` | Execute the health endpoint check |
| GET | `/api/logs` | Workspace event stream |
| GET | `/api/settings` | Runtime configuration and release safeguards |

## Environment variables

Copy `.env.example` to `.env` and change `SECRET_KEY` for local use. The Render Blueprint generates its own secret key.

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | local development value | Flask application secret |
| `PORT` | `5000` locally / Render-provided | HTTP listener port |
| `DATABASE_PATH` | `instance/smart-deployment-checker.db` | SQLite database file |
| `INFRA_MODE` | `sandbox` | Isolated infrastructure provider mode |

## Project structure

```text
smart-deployment-checker/
├── backend/
│   ├── app/
│   │   ├── __init__.py       # Flask app factory and SPA hosting
│   │   ├── db.py             # SQLite schema and migrations
│   │   ├── engine.py         # Pytest runner and release pipeline
│   │   └── routes.py         # REST API endpoints
│   ├── tests/                # Actual Pytest suite
│   └── wsgi.py
├── frontend/
│   ├── src/App.tsx           # Dashboard and application pages
│   ├── src/styles.css        # White theme and responsive design system
│   └── ...                   # Vite / TypeScript configuration
├── scripts/                 # Test, containerise, and setup scripts
├── Dockerfile                # Multi-stage production image
├── render.yaml               # Free Render Blueprint
├── requirements.txt
└── setup-and-run.sh
```
