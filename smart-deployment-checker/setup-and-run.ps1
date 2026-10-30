$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
$NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
if (-not $PythonCommand) { throw 'Python 3.11+ is required. Install Python and reopen PowerShell.' }
if (-not $NodeCommand -or -not $NpmCommand) { throw 'Node.js 20+ and npm are required. Install Node.js and reopen PowerShell.' }

$PythonVersion = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
$VersionParts = $PythonVersion.Split('.') | ForEach-Object { [int]$_ }
if (($VersionParts[0] -lt 3) -or (($VersionParts[0] -eq 3) -and ($VersionParts[1] -lt 11))) {
  throw "Python 3.11+ is required; found $PythonVersion."
}

$VenvPython = Join-Path $Root '.venv\Scripts\python.exe'
if (-not (Test-Path $VenvPython)) {
  Write-Host '[1/6] Creating Python virtual environment' -ForegroundColor Cyan
  & python -m venv .venv
}

Write-Host '[2/6] Installing backend dependencies' -ForegroundColor Cyan
& $VenvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'pip upgrade failed.' }
& $VenvPython -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }

Write-Host '[3/6] Installing frontend dependencies' -ForegroundColor Cyan
Push-Location frontend
try {
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
  Write-Host '[4/6] Building production frontend' -ForegroundColor Cyan
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Frontend production build failed.' }
} finally { Pop-Location }

Write-Host '[5/6] Running backend tests' -ForegroundColor Cyan
& $VenvPython -m pytest backend/tests -q
if ($LASTEXITCODE -ne 0) { throw 'Backend test suite failed. Release execution stopped.' }

Write-Host '[6/6] Preparing container output' -ForegroundColor Cyan
$DockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$DockerReady = $false
if ($DockerCommand) {
  & docker info *> $null
  $DockerReady = ($LASTEXITCODE -eq 0)
}
if ($DockerReady) {
  & docker build -t smart-deployment-checker:local .
  if ($LASTEXITCODE -ne 0) { throw 'Docker image build failed.' }
} else {
  New-Item -ItemType Directory -Force -Path artifacts | Out-Null
  & tar -czf artifacts/container-build-context.tar.gz --exclude=.git --exclude=.venv --exclude=venv --exclude=node_modules --exclude=frontend/node_modules --exclude=frontend/dist --exclude=artifacts --exclude=instance --exclude=.pytest_cache --exclude=__pycache__ .
  if ($LASTEXITCODE -ne 0) { throw 'Container build context packaging failed.' }
  Write-Host 'Docker Engine is unavailable. A build context was created, not an image.' -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path instance | Out-Null
if (-not $env:DATABASE_PATH) { $env:DATABASE_PATH = 'instance/smart-deployment-checker.db' }
if (-not $env:SECRET_KEY) { $env:SECRET_KEY = 'local-only-change-this-secret' }
if (-not $env:PORT) { $env:PORT = '5000' }
Write-Host "Starting Smart Deployment Checker at http://127.0.0.1:$($env:PORT)" -ForegroundColor Green
& $VenvPython -m flask --app backend.wsgi:app run --host 0.0.0.0 --port $env:PORT
