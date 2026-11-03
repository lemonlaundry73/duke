# Duke Local setup for Windows (your Shadow PC). Safe to run again: it only installs what is missing,
# and asks before every large download. Nothing here sends your projects or prompts anywhere.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$App = Split-Path -Parent $PSScriptRoot
$dl = Join-Path $env:TEMP 'DukeLocalSetup'; New-Item -ItemType Directory -Force -Path $dl | Out-Null
function Say($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }
function Ask($q) { (Read-Host "$q [y/N]") -match '^(y|yes)$' }
function Get-File($url, $name) { $o = Join-Path $dl $name; try { Invoke-WebRequest -Uri $url -OutFile $o -UseBasicParsing; return $o } catch { Write-Host "  Download failed: $url" -ForegroundColor Red; return $null } }
function Run($f, $a) { if ($f) { (Start-Process -FilePath $f -ArgumentList $a -Wait -PassThru).ExitCode | Out-Null } }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

Say 'This PC (measured)'
$gpu = $null
try { $gpu = (& nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits 2>$null | Select-Object -First 1) } catch {}
$os = Get-CimInstance Win32_OperatingSystem
$ramGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1); $ramFreeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$disk = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':'))
$freeGB = [math]::Round($disk.Free / 1GB, 1)
if ($gpu) { $g = $gpu.Split(',') | ForEach-Object { $_.Trim() }; Write-Host "  Graphics: $($g[0]), $([math]::Round($g[1]/1024,1)) GB VRAM ($([math]::Round($g[2]/1024,1)) GB free)" } else { Write-Host '  Graphics: no NVIDIA GPU found (the model would run slowly on the CPU)' -ForegroundColor Yellow }
Write-Host "  Memory (RAM): $ramGB GB ($ramFreeGB GB free)"
Write-Host "  Disk free on $($env:SystemDrive): $freeGB GB"

Say 'Node.js (runs the Duke backend)'
$nodeOk = $false; try { $v = (& node --version) -replace '^v',''; $nodeOk = [version]$v -ge [version]'22.2.0'; Write-Host "  found Node $v" } catch {}
if (-not $nodeOk) {
  if (Ask '  Node.js 22 is needed (about 30 MB). Download and install it?') {
    $sum = (Invoke-WebRequest 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt' -UseBasicParsing).Content
    $msi = ([regex]'node-v[\d.]+-x64\.msi').Match($sum).Value
    Run 'msiexec.exe' "/i `"$(Get-File "https://nodejs.org/dist/latest-v22.x/$msi" 'node.msi')`" /qn /norestart"; Refresh-Path
  }
}

Say 'Git (checkpoints for your project)'
if (Get-Command git -ErrorAction SilentlyContinue) { Write-Host '  already installed' }
elseif (Ask '  Git is used for checkpoints (about 65 MB). Install it?') {
  $rel = Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'DukeLocalSetup' }
  $a = $rel.assets | Where-Object { $_.name -match '^Git-.*-64-bit\.exe$' } | Select-Object -First 1
  Run (Get-File $a.browser_download_url 'git.exe') '/VERYSILENT /NORESTART /SP-'; Refresh-Path
} else { Write-Host '  Skipped: Duke will use folder copies for checkpoints instead.' }

Say 'Blender'
$bl = Get-ChildItem "$env:ProgramFiles\Blender Foundation" -Recurse -Filter blender.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($bl) { Write-Host "  found $($bl.FullName)" }
elseif (Ask '  Blender is needed for 3D work (about 400 MB). Install the latest Blender?') {
  $idx = (Invoke-WebRequest 'https://download.blender.org/release/' -UseBasicParsing).Links.href | Where-Object { $_ -match '^Blender(\d+)\.(\d+)/$' } | Sort-Object { [version](($_ -replace '^Blender','') -replace '/$','') } | Select-Object -Last 1
  $msi = (Invoke-WebRequest "https://download.blender.org/release/$idx" -UseBasicParsing).Links.href | Where-Object { $_ -match '^blender-[\d.]+-windows-x64\.msi$' } | Sort-Object { [version]($_ -replace '^blender-','' -replace '-windows-x64\.msi$','') } | Select-Object -Last 1
  Run 'msiexec.exe' "/i `"$(Get-File "https://download.blender.org/release/$idx$msi" 'blender.msi')`" /qn /norestart ALLUSERS=1"
}

Say 'Ollama (runs the AI model on this PC)'
# Local only: listen on 127.0.0.1, no cloud models. Duke also refuses any non-local model address itself.
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', '127.0.0.1:11434', 'User'); $env:OLLAMA_HOST = '127.0.0.1:11434'
[Environment]::SetEnvironmentVariable('OLLAMA_NO_CLOUD', '1', 'User'); $env:OLLAMA_NO_CLOUD = '1'
$ol = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ol -and (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe")) { $ol = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if ($ol) { Write-Host '  already installed' }
elseif (Ask '  Ollama is needed to run the model locally (about 1 GB). Install it?') {
  Run (Get-File 'https://ollama.com/download/OllamaSetup.exe' 'OllamaSetup.exe') '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART'; Refresh-Path
}

Say 'Local model'
$model = 'qwen3.5:9b'
$vfree = 0; if ($gpu) { $vfree = [double]$g[2] / 1024 }
if ($gpu -and $vfree -lt 8.5) { Write-Host "  Only $([math]::Round($vfree,1)) GB of graphics memory is free. A 9B model needs about 6.6 GB plus room for Blender." -ForegroundColor Yellow
  if (Ask '  Use the smaller qwen3.5:4b instead?') { $model = 'qwen3.5:4b' } }
$exe = (Get-Command ollama -ErrorAction SilentlyContinue).Source; if (-not $exe) { $exe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if (Test-Path $exe) {
  $have = (& $exe list 2>$null) -match [regex]::Escape($model)
  if ($have) { Write-Host "  $model already downloaded" }
  elseif (Ask "  Download $model now? (several GB, one time)") { & $exe pull $model }
  else { Write-Host "  Skipped. You can download it later from the Duke Local page." }
}

Say 'Shortcut'
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Duke Local.lnk'
$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut($lnk)
$s.TargetPath = Join-Path $App 'Start Duke Local.cmd'; $s.WorkingDirectory = $App; $s.Save()
Write-Host "  Desktop shortcut: $lnk"
Write-Host "`nDone. Double-click 'Duke Local' on the desktop to start." -ForegroundColor Green
