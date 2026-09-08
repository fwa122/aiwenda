# AI Knowledge Base QA - Stop All Services
# Stops by port precisely, does NOT touch other node/python processes on the machine.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\stop-all.ps1

foreach ($port in 5173, 3000, 8000) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
            Write-Host "stopped port $port (pid $_)"
        }
    } else {
        Write-Host "port ${port}: no listener"
    }
}

# celery worker does not listen on a port; find it by command line
Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
    Where-Object { $_.CommandLine -like '*celery*worker*' } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "stopped celery worker (pid $($_.ProcessId))"
    }

Write-Host 'Done. (Docker containers kb-postgres / kb-redis keep running; stop them manually if needed)'
