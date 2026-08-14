param(
  [int]$Port = 1420
)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)

foreach ($listener in $listeners) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $commandLine = [string]$process.CommandLine
  $isProjectVite =
    $process.Name -ieq "node.exe" -and
    $commandLine.IndexOf($projectRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine.IndexOf("vite", [System.StringComparison]::OrdinalIgnoreCase) -ge 0

  if (-not $isProjectVite) {
    throw "Tauri needs port $Port, but it is used by $($process.Name) (PID $($listener.OwningProcess)). Stop that process or change the Tauri dev port explicitly."
  }

  Stop-Process -Id $listener.OwningProcess -Force
}

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    exit 0
  }
  Start-Sleep -Milliseconds 100
}

throw "The previous project Vite process did not release port $Port."
