$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ServerDir = Join-Path $Root "local-voice-server"
$VenvDir = Join-Path $ServerDir ".venv"
$VendorDir = Join-Path $ServerDir "vendors\vixtts-demo"
$TtsSourceDir = Join-Path $VendorDir "TTS"

if (!(Test-Path $VenvDir)) {
  Write-Host "Creating local voice server venv..."
  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if ($uv) {
    & uv python install 3.11
    & uv venv --python 3.11 $VenvDir
  } else {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
      try {
        & py -3.11 --version | Out-Null
      } catch {
        Write-Host "Python 3.11 was not found. Trying Python Launcher install..."
        & py install 3.11
      }
      & py -3.11 -m venv $VenvDir
    } else {
      throw "Python 3.11 or uv was not found. Install Python 3.11 and run again."
    }
  }
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
if (!(Test-Path $VenvPython)) {
  if (Test-Path $VenvDir) {
    Remove-Item -LiteralPath $VenvDir -Recurse -Force
  }
  throw "Failed to create local voice venv. Run the setup command again after Python 3.11 is installed."
}

Write-Host "Upgrading pip..."
& $VenvPython -m pip install --upgrade pip setuptools wheel

Write-Host "Installing local voice server API dependencies..."
& $VenvPython -m pip install -r (Join-Path $ServerDir "requirements.txt")

if (!(Test-Path $VendorDir)) {
  Write-Host "Cloning viXTTS source..."
  git clone --depth 1 https://github.com/thinhlpg/vixtts-demo.git $VendorDir
}

if (!(Test-Path (Join-Path $TtsSourceDir "TTS"))) {
  Write-Host "Fetching viXTTS TTS submodule..."
  git -C $VendorDir submodule update --init --recursive --depth 1
}

Write-Host "Installing viXTTS dependencies. This can take a while because audio/model packages are large..."
& $VenvPython -m pip install -r (Join-Path $ServerDir "requirements-vixtts.txt")

Write-Host ""
Write-Host "Done. Start server with:"
Write-Host "  .\scripts\start-local-voice-server.ps1"
