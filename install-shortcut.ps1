# Creates Reel shortcuts (no console window, Reel icon). Usage:
#   pwsh ./install-shortcut.ps1            -> Reel.lnk in this folder
#   pwsh ./install-shortcut.ps1 -StartMenu -Desktop
param([switch]$StartMenu, [switch]$Desktop)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$pythonw = Join-Path $backend ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $pythonw)) { throw "Run 'cd backend; uv sync' first." }
if (-not (Test-Path (Join-Path $root "frontend\dist\index.html"))) {
  Push-Location (Join-Path $root "frontend"); npm install --silent; npm run build; Pop-Location
}
$targets = @(Join-Path $root "Reel.lnk")
if ($StartMenu) { $targets += Join-Path ([Environment]::GetFolderPath("Programs")) "Reel.lnk" }
if ($Desktop) { $targets += Join-Path ([Environment]::GetFolderPath("Desktop")) "Reel.lnk" }
$shell = New-Object -ComObject WScript.Shell
foreach ($path in $targets) {
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $pythonw
  $lnk.Arguments = "desktop.py"
  $lnk.WorkingDirectory = $backend
  $lnk.IconLocation = (Join-Path $backend "assets\reel.ico")
  $lnk.Description = "Reel, your film diary"
  $lnk.Save()
  "Created $path"
}
