# Launches the installed Swarmy app with the fake runtime and checks the window title.
# The installer is unsigned. If SmartScreen blocks it, choose More info, then Run anyway.
# A real Cursor agent is not started here.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repoRoot "dist"
$installer = Get-ChildItem -Path $dist -Filter "*-Setup-*.exe" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) {
  throw "No NSIS installer in $dist. Run npm run dist first."
}

$installDir = Join-Path $env:LOCALAPPDATA "SwarmySmoke"
if ($installDir -match " ") {
  throw "NSIS /D cannot install to a path with spaces: $installDir"
}

Get-Process -Name "Swarmy" -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($installDir, [System.StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { taskkill /pid $_.Id /T /F | Out-Null }

if (Test-Path $installDir) {
  Remove-Item -LiteralPath $installDir -Recurse -Force
}

Unblock-File -LiteralPath $installer.FullName
$install = Start-Process -FilePath $installer.FullName -ArgumentList @("/S", "/D=$installDir") -Wait -PassThru
if ($install.ExitCode -ne 0) {
  throw "Installer exited with code $($install.ExitCode). If SmartScreen blocked it, run the installer and choose More info, then Run anyway."
}

$exe = Join-Path $installDir "Swarmy.exe"
if (-not (Test-Path -LiteralPath $exe)) {
  throw "Installed app was not found at $exe"
}

$dataDir = Join-Path $env:TEMP "swarmy-smoke-data"
if (Test-Path $dataDir) {
  Remove-Item -LiteralPath $dataDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$previousRuntime = $env:SWARMY_RUNTIME
$previousData = $env:SWARMY_DATA_DIR
$previousWorkspaces = $env:SWARMY_WORKSPACES_DIR
$env:SWARMY_RUNTIME = "fake"
$env:SWARMY_DATA_DIR = $dataDir
$env:SWARMY_WORKSPACES_DIR = Join-Path $dataDir "workspaces"

$proc = $null
try {
  $proc = Start-Process -FilePath $exe -PassThru
  $deadline = (Get-Date).AddSeconds(45)
  $title = ""
  while ((Get-Date) -lt $deadline) {
    $live = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if (-not $live) {
      throw "Swarmy exited before the window title was Swarmy."
    }
    $title = $live.MainWindowTitle
    if ($title -eq "Swarmy") {
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if ($title -ne "Swarmy") {
    throw "Window title was '$title', expected Swarmy."
  }
  Write-Host "Packaged smoke passed: window title is Swarmy."
}
finally {
  if ($proc -and -not $proc.HasExited) {
    cmd /c "taskkill /pid $($proc.Id) /T /F >nul 2>&1"
  }
  $env:SWARMY_RUNTIME = $previousRuntime
  $env:SWARMY_DATA_DIR = $previousData
  $env:SWARMY_WORKSPACES_DIR = $previousWorkspaces
  if (Test-Path $dataDir) {
    Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
