# AI KB backup script (P1-4): postgres DB dump + uploads volume tar.
# NOTE: source must stay ASCII-only - PowerShell 5.1 runs BOM-less .ps1 as ANSI,
# Chinese chars in source would mojibake (see project memory).
# Register daily task:
#   schtasks /Create /TN "KB-Daily-Backup" /SC DAILY /ST 03:00 /F ^
#     /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File <this script>"
param(
  [string]$Container = "kb-prod-postgres-1",
  [string]$UploadsVolume = "kb-prod_uploads_data",
  [int]$Keep = 7,
  [switch]$SkipUploads
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $projectRoot "backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

# db credentials from root .env (defaults match this project's compose defaults)
$dbUser = "kb"; $dbName = "kb"
$envFile = Join-Path $projectRoot ".env"
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^POSTGRES_USER=(.+)$') { $dbUser = $Matches[1].Trim() }
    if ($line -match '^POSTGRES_DB=(.+)$')   { $dbName = $Matches[1].Trim() }
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

# ---- 1. database dump (custom format, restore with pg_restore) ----
$tmp = "/tmp/kb-db-$stamp.dump"
docker exec $Container pg_dump -U $dbUser -d $dbName -Fc -f $tmp
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }
$dumpFile = Join-Path $backupDir "kb-db-$stamp.dump"
docker cp "${Container}:$tmp" $dumpFile
if ($LASTEXITCODE -ne 0) { throw "docker cp failed" }
docker exec $Container rm $tmp | Out-Null
$dbSize = (Get-Item $dumpFile).Length
Write-Output "[OK] DB dump  -> $dumpFile ($([math]::Round($dbSize/1KB,1)) KB)"

# ---- 2. uploads volume tar ----
if (-not $SkipUploads) {
  $tarName = "kb-uploads-$stamp.tar.gz"
  docker run --rm -v "${UploadsVolume}:/data" -v "${backupDir}:/backup" nginx:alpine tar czf "/backup/$tarName" -C /data .
  if ($LASTEXITCODE -ne 0) { throw "uploads tar failed (volume $UploadsVolume)" }
  $upSize = (Get-Item (Join-Path $backupDir $tarName)).Length
  Write-Output "[OK] uploads  -> $tarName ($([math]::Round($upSize/1KB,1)) KB)"
}

# ---- 3. retention: keep newest $Keep per type ----
Get-ChildItem $backupDir -File |
  Where-Object { $_.Name -like "kb-db-*.dump" -or $_.Name -like "kb-uploads-*.tar.gz" } |
  Group-Object { if ($_.Name -like "kb-db-*") { "db" } else { "uploads" } } |
  ForEach-Object {
    $_.Group | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep |
      ForEach-Object {
        Remove-Item $_.FullName -Force
        Write-Output "[GC] removed old: $($_.Name)"
      }
  }

Write-Output "[DONE] backup finished $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
