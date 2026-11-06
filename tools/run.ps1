# Chill with me - short dev commands. Usage:  .\run <command>   (see .\run help)
# Only calls existing project commands; changes no project files.
param(
    [Parameter(Position = 0)][string]$Command = "help",
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = "Stop"

$Root     = Split-Path $PSScriptRoot -Parent
$Backend  = Join-Path $Root "Backend"
$Frontend = Join-Path $Root "Frontend"
$VenvPy   = Join-Path $Backend ".venv\Scripts\python.exe"

function Need-Venv {
    if (-not (Test-Path $VenvPy)) { throw "Backend\.venv not found - run '.\run setup' first." }
}

function Invoke-In([string]$Dir, [scriptblock]$Block) {
    Push-Location $Dir
    try { & $Block; if ($LASTEXITCODE) { exit $LASTEXITCODE } } finally { Pop-Location }
}

# Checks the MongoDB in MONGODB_URI (.env) - the same one the backend uses. Prints ok | down-local | down-remote.
function Test-Mongo {
    Push-Location $Backend
    try { $r = & $VenvPy (Join-Path $PSScriptRoot "check_mongo.py") 2>$null } catch { $r = "down-local" } finally { Pop-Location }
    return ("$r").Trim()
}

function Start-Mongo {
    $state = Test-Mongo
    if ($state -eq "ok") { Write-Host "MongoDB: connected (MONGODB_URI from .env)" -ForegroundColor Green; return }
    if ($state -eq "down-remote") {
        Write-Host "MongoDB in MONGODB_URI (.env) is not reachable. Check your internet / database host, then try again." -ForegroundColor Red
        exit 1
    }
    # URI points at this machine and nothing answers: try the project's docker-compose MongoDB.
    Write-Host "MongoDB: not running locally - trying docker compose..." -ForegroundColor Yellow
    Push-Location $Root
    try { docker compose up -d 2>$null } catch { } finally { Pop-Location }
    if ((Test-Mongo) -ne "ok") {
        Write-Host "MongoDB is not reachable on this machine. Start your MongoDB (or Docker Desktop) and try again." -ForegroundColor Red
        exit 1
    }
    Write-Host "MongoDB: started with docker compose" -ForegroundColor Green
}

function Open-Window([string]$Title, [string]$Dir, [string]$Cmd) {
    $script = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$Dir'; $Cmd"
    Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script
}

$ApiCmd = "& '$VenvPy' -m uvicorn app.main:app --reload --port 8000"
$WebCmd = "npm.cmd run dev"

switch ($Command.ToLower()) {
    "dev" {
        Need-Venv
        Start-Mongo
        Open-Window "Chill API :8000" $Backend $ApiCmd
        Open-Window "Chill Web :5173" $Frontend $WebCmd
        Write-Host "Started in 2 new windows:" -ForegroundColor Green
        Write-Host "  API  http://localhost:8000/docs"
        Write-Host "  Web  http://localhost:5173"
        Write-Host "Close a window (or Ctrl+C in it) to stop that part."
    }
    "api"   { Need-Venv; Start-Mongo; Invoke-In $Backend { & $VenvPy -m uvicorn app.main:app --reload --port 8000 } }
    "web"   { Invoke-In $Frontend { npm.cmd run dev } }
    "mongo" { Start-Mongo }
    "setup" {
        if (-not (Test-Path $VenvPy)) {
            Write-Host "Creating Backend\.venv..." -ForegroundColor Yellow
            Invoke-In $Backend { python -m venv .venv }
        }
        Invoke-In $Backend { & $VenvPy -m pip install -r requirements.txt }
        Invoke-In $Frontend { npm.cmd install }
        Write-Host "Setup done. Next: '.\run data' (first time only), then '.\run dev'." -ForegroundColor Green
    }
    "data" {
        Need-Venv
        Start-Mongo
        Invoke-In $Backend { & $VenvPy -m scripts.import_csv --drop }
        Invoke-In $Backend { & $VenvPy -m scripts.build_ml }
        Invoke-In $Backend { & $VenvPy -m scripts.verify_import }
    }
    "verify" { Need-Venv; Invoke-In $Backend { & $VenvPy -m scripts.verify_import } }
    "test" {
        Need-Venv
        Invoke-In $Backend { & $VenvPy -m pytest @Rest }
        Invoke-In $Frontend { npm.cmd test }
    }
    "admin" {
        Need-Venv
        if (-not $Rest) { throw "usage: .\run admin 0812345678   (or --revoke 0812345678, --list)" }
        Invoke-In $Backend { & $VenvPy -m scripts.set_admin @Rest }
    }
    "sms" {
        Need-Venv
        if (-not $Rest) { throw "usage: .\run sms 0812345678" }
        Invoke-In $Backend { & $VenvPy -m scripts.test_sms @Rest }
    }
    default {
        Write-Host @"
Chill with me - commands (run from the project folder):

  .\run dev        start MongoDB + API (:8000) + Web (:5173) in 2 windows
  .\run api        API only, in this window
  .\run web        Web only, in this window
  .\run mongo      start MongoDB (docker compose) if not running
  .\run setup      create Backend\.venv, pip install, npm install
  .\run data       import CSV + train ML + verify (first time / data changed)
  .\run verify     check imported data only
  .\run test       pytest (Backend) + vitest (Frontend)
  .\run admin 08.. make an account an admin (--revoke 08.. / --list)
  .\run sms 08...  send one test SMS with the configured provider
"@
    }
}
