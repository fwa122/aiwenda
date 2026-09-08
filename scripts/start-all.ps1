# AI Knowledge Base QA - Start All Services
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot

function Test-Port($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

Write-Host '== 1/4 Infra (Docker: kb-postgres / kb-redis) ==' -ForegroundColor Cyan
$running = docker ps --format '{{.Names}}'
if ("$running" -notmatch 'kb-postgres') { docker start kb-postgres | Out-Null }
if ("$running" -notmatch 'kb-redis') { docker start kb-redis | Out-Null }
Write-Host '   postgres / redis ready'

Write-Host '== 2/4 Python AI service (uvicorn :8000 + celery worker) ==' -ForegroundColor Cyan
if (Test-Port 8000) {
    Write-Host '   already running, skipped'
} else {
    Start-Process -FilePath "$root\ai-service\.venv\Scripts\python.exe" -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000' -WorkingDirectory "$root\ai-service" -RedirectStandardOutput "$root\ai-service\api.log" -RedirectStandardError "$root\ai-service\api.err" -NoNewWindow
    Start-Process -FilePath "$root\ai-service\.venv\Scripts\python.exe" -ArgumentList '-m', 'celery', '-A', 'app.tasks:celery_app', 'worker', '--pool=solo', '--loglevel=info' -WorkingDirectory "$root\ai-service" -RedirectStandardOutput "$root\ai-service\celery.log" -RedirectStandardError "$root\ai-service\celery.err" -NoNewWindow
    Start-Sleep -Seconds 5
    Write-Host '   uvicorn + celery worker started'
}

Write-Host '== 3/4 Node BFF (:3000) ==' -ForegroundColor Cyan
if (Test-Port 3000) {
    Write-Host '   already running, skipped'
} else {
    Start-Process node -ArgumentList 'dist/main.js' -WorkingDirectory "$root\server" -RedirectStandardOutput "$root\server\run.log" -RedirectStandardError "$root\server\run.err" -NoNewWindow
    Start-Sleep -Seconds 3
    Write-Host '   started'
}

Write-Host '== 4/4 Frontend (:5173) ==' -ForegroundColor Cyan
if (Test-Port 5173) {
    Write-Host '   already running, skipped'
} else {
    Start-Process npm.cmd -ArgumentList 'run', 'dev' -WorkingDirectory "$root\frontend" -NoNewWindow
    Start-Sleep -Seconds 6
    Write-Host '   started'
}

Write-Host ''
Write-Host 'All services ready:' -ForegroundColor Green
Write-Host '  Frontend   http://localhost:5173   (admin / admin123)'
Write-Host '  Backend    http://localhost:3000/api/v1'
Write-Host '  AI service http://127.0.0.1:8000/internal/health'
