# Duke Forger: set up a Windows PC (or cloud PC) for building Unreal games with Duke.
# Run in PowerShell (Admin):   irm dukeforger.com/win | iex
# Installs: Git (with Git LFS), Python 3.12, Epic Games Launcher, Visual Studio 2022 Build Tools (C++ for Unreal), Blender.
# Every installer is downloaded straight from its official site (github.com/git-for-windows, python.org,
# epicgames.com, aka.ms -> microsoft.com) and run with its own documented silent switches.

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Say($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }
$dl = Join-Path $env:TEMP 'DukeSetup'; New-Item -ItemType Directory -Force -Path $dl | Out-Null

function Get-File($url, $name) {
  $out = Join-Path $dl $name
  try { Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -Headers @{ 'User-Agent' = 'DukeForgerSetup' }; return $out }
  catch { Write-Host "  Download failed: $url ($($_.Exception.Message))" -ForegroundColor Red; return $null }
}
function Run($file, $arguments) {
  if (-not $file) { return }
  $p = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru
  Write-Host "  finished (code $($p.ExitCode))"
}
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

$gitOk = { [bool](Get-Command git -ErrorAction SilentlyContinue) }
$pyOk = { [bool](Get-Command py -ErrorAction SilentlyContinue) }
$epicExe = @("${env:ProgramFiles(x86)}\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe",
  "${env:ProgramFiles(x86)}\Epic Games\Launcher\Portal\Binaries\Win32\EpicGamesLauncher.exe",
  "$env:ProgramFiles\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
function Epic-Ok { [bool](@("${env:ProgramFiles(x86)}\Epic Games\Launcher", "$env:ProgramFiles\Epic Games\Launcher") | Where-Object { Test-Path $_ }) }
$vsDir = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"

Say 'Git (with Git LFS)'
if (& $gitOk) { Write-Host '  already installed' } else {
  try {
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'DukeForgerSetup' }
    $asset = $rel.assets | Where-Object { $_.name -match '^Git-.*-64-bit\.exe$' } | Select-Object -First 1
    Run (Get-File $asset.browser_download_url 'git.exe') '/VERYSILENT /NORESTART /NOCANCEL /SP- /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh,gitlfs"'
  } catch { Write-Host "  Could not find the Git download: $($_.Exception.Message)" -ForegroundColor Red }
}

Say 'Python 3.12'
if (& $pyOk) { Write-Host '  already installed' } else {
  Run (Get-File 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' 'python.exe') '/quiet InstallAllUsers=1 PrependPath=1 Include_launcher=1 Include_test=0'
}

Say 'Epic Games Launcher'
if (Epic-Ok) { Write-Host '  already installed' } else {
  $msi = Get-File 'https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/EpicGamesLauncherInstaller.msi' 'epic.msi'
  if ($msi) { Run 'msiexec.exe' "/i `"$msi`" /qn /norestart" }
}

Say 'Visual Studio 2022 Build Tools (C++ for Unreal) - this one takes 10-20 minutes'
if (Test-Path $vsDir) { Write-Host '  already installed' } else {
  Run (Get-File 'https://aka.ms/vs/17/release/vs_BuildTools.exe' 'vs_buildtools.exe') ('--quiet --wait --norestart --nocache ' +
    '--add Microsoft.VisualStudio.Workload.VCTools ' +
    '--add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ' +
    '--add Microsoft.VisualStudio.Component.Windows11SDK.22621 ' +
    '--add Microsoft.Net.Component.4.8.SDK ' +
    '--add Microsoft.VisualStudio.Component.VC.Llvm.Clang ' +
    '--includeRecommended')
}

Say 'Blender (used by the Duke 3D Generator for AAA finishing)'
$blOk = [bool](Get-ChildItem "$env:ProgramFiles\Blender Foundation" -Recurse -Filter blender.exe -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($blOk) { Write-Host '  already installed' } else {
  try {
    $idx = (Invoke-WebRequest -Uri 'https://download.blender.org/release/' -UseBasicParsing).Links.href | Where-Object { $_ -match '^Blender(\d+)\.(\d+)/$' } |
      Sort-Object { [version](($_ -replace '^Blender','') -replace '/$','') } | Select-Object -Last 1
    $page = (Invoke-WebRequest -Uri "https://download.blender.org/release/$idx" -UseBasicParsing).Links.href | Where-Object { $_ -match '^blender-[\d.]+-windows-x64\.msi$' } |
      Sort-Object { [version]($_ -replace '^blender-','' -replace '-windows-x64\.msi$','') } | Select-Object -Last 1
    $msi = Get-File "https://download.blender.org/release/$idx$page" 'blender.msi'
    if ($msi) { Run 'msiexec.exe' "/i `"$msi`" /qn /norestart ALLUSERS=1" }
  } catch { Write-Host "  Could not download Blender: $($_.Exception.Message)" -ForegroundColor Red }
}

Refresh-Path
if (& $gitOk) { git lfs install | Out-Null }

Say 'Done'
$check = @(
  @('Git', (& $gitOk)),
  @('Python', (& $pyOk)),
  @('Epic Games Launcher', (Epic-Ok)),
  @('VS Build Tools', (Test-Path $vsDir)),
  @('Blender', [bool](Get-ChildItem "$env:ProgramFiles\Blender Foundation" -Recurse -Filter blender.exe -ErrorAction SilentlyContinue | Select-Object -First 1))
)
foreach ($c in $check) { if ($c[1]) { Write-Host ("  OK       " + $c[0]) -ForegroundColor Green } else { Write-Host ("  MISSING  " + $c[0]) -ForegroundColor Yellow } }

Write-Host "`nNext:" -ForegroundColor Cyan
Write-Host '  1. Epic Games Launcher: sign in, then Unreal Engine > Library > + > install 5.8.'
Write-Host '  2. dukeforger.com: log in and download the Duke app (step 9), then double-click DukeForger.py.'
$epicExe = Get-ChildItem "${env:ProgramFiles(x86)}\Epic Games\Launcher", "$env:ProgramFiles\Epic Games\Launcher" -Recurse -Filter EpicGamesLauncher.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($epicExe) { Start-Process $epicExe.FullName }
Start-Process 'https://dukeforger.com/studio'
