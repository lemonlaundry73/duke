# Duke Forger: set up a Windows PC (or cloud PC) for building Unreal games with Duke.
# Run in PowerShell (Admin):   irm dukeforger.com/win | iex
# Installs: Git (with Git LFS), Python 3.12, Epic Games Launcher, Visual Studio 2022 Build Tools (C++ for Unreal).
# Nothing hidden: every step below is a standard winget install from Microsoft's package catalog.

$ErrorActionPreference = 'Continue'
function Say($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host 'winget is missing. Open the Microsoft Store, install "App Installer", then run this again.' -ForegroundColor Red
  return
}

$common = @('-e', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')

Say 'Git (with Git LFS)'
winget install --id Git.Git @common --silent

Say 'Python 3.12'
winget install --id Python.Python.3.12 @common --silent

Say 'Epic Games Launcher'
winget install --id EpicGames.EpicGamesLauncher @common --silent

Say 'Visual Studio 2022 Build Tools (C++ for Unreal) - this one takes 10-20 minutes'
$vs = '--quiet --wait --norestart --nocache ' +
      '--add Microsoft.VisualStudio.Workload.VCTools ' +
      '--add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ' +
      '--add Microsoft.VisualStudio.Component.Windows11SDK.22621 ' +
      '--add Microsoft.Net.Component.4.8.SDK ' +
      '--add Microsoft.VisualStudio.Component.VC.Llvm.Clang ' +
      '--includeRecommended'
winget install --id Microsoft.VisualStudio.2022.BuildTools @common --override $vs

# Make the new tools usable in this window.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
if (Get-Command git -ErrorAction SilentlyContinue) { git lfs install | Out-Null }

Say 'Done'
$check = @(
  @('Git', [bool](Get-Command git -ErrorAction SilentlyContinue)),
  @('Python', [bool](Get-Command py -ErrorAction SilentlyContinue)),
  @('Epic Games Launcher', (Test-Path "${env:ProgramFiles(x86)}\Epic Games\Launcher")),
  @('VS Build Tools', (Test-Path "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"))
)
foreach ($c in $check) { if ($c[1]) { Write-Host ("  OK       " + $c[0]) -ForegroundColor Green } else { Write-Host ("  MISSING  " + $c[0]) -ForegroundColor Yellow } }

Write-Host "`nNext:" -ForegroundColor Cyan
Write-Host '  1. Epic Games Launcher: sign in, then Unreal Engine > Library > + > install 5.8.'
Write-Host '  2. dukeforger.com: log in and download the Duke app (step 9), then double-click DukeForger.py.'
Start-Process 'https://dukeforger.com/studio'
$epic = "${env:ProgramFiles(x86)}\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe"
if (Test-Path $epic) { Start-Process $epic }
