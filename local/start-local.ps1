# Duke Local launcher: starts Ollama (127.0.0.1 only) and the Duke backend (127.0.0.1 only),
# then opens Duke in this PC's browser with a one-time login code.
$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot
$Port = 4310
$Data = Join-Path $env:LOCALAPPDATA 'DukeForger\local-data'
New-Item -ItemType Directory -Force -Path $Data | Out-Null
$env:DUKE_LOCAL = '1'; $env:PORT = "$Port"; $env:DATA_DIR = $Data; $env:OLLAMA_HOST = '127.0.0.1:11434'; $env:OLLAMA_NO_CLOUD = '1'
function Up($u) { try { Invoke-RestMethod -Uri $u -TimeoutSec 3 | Out-Null; $true } catch { $false } }

if (-not (Up 'http://127.0.0.1:11434/api/version')) {
  $exe = (Get-Command ollama -ErrorAction SilentlyContinue).Source; if (-not $exe) { $exe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
  if (Test-Path $exe) { Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden; for ($i = 0; $i -lt 30 -and -not (Up 'http://127.0.0.1:11434/api/version'); $i++) { Start-Sleep 1 } }
  else { Write-Host 'Ollama is not installed. Run "Setup Duke Local" first. Duke will start without a model.' -ForegroundColor Yellow }
}

if (-not (Up "http://127.0.0.1:$Port/api/health")) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Write-Host 'Node.js is missing. Run "Setup Duke Local" first.' -ForegroundColor Red; Read-Host 'Press Enter'; exit 1 }
  $log = Join-Path $Data 'duke-local.log'
  Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $App -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  for ($i = 0; $i -lt 40 -and -not (Up "http://127.0.0.1:$Port/api/health"); $i++) { Start-Sleep 1 }
  Start-Sleep 1
  $code = Get-Content (Join-Path $Data 'local\login-code.txt') -Raw
} else {
  $secret = (Get-Content (Join-Path $Data 'local\secret.json') -Raw | ConvertFrom-Json).secret
  $code = (Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/local/login-code" -Headers @{ 'x-duke-local-secret' = $secret }).code
}
if (-not $code) { Write-Host "Duke did not start. See $Data\duke-local.log" -ForegroundColor Red; Read-Host 'Press Enter'; exit 1 }
Start-Process "http://127.0.0.1:$Port/local/login?code=$($code.Trim())"
