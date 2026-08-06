$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Split-Path -Parent $ScriptDir
$ServerDir = Join-Path $ProjectDir "local-voice-server"
$VenvDir = Join-Path $ServerDir ".venv-omnivoice"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $PythonExe)) {
    # Fallback to system py or python if venv not created yet
    $SysPython = Get-Command "py" -ErrorAction SilentlyContinue
    if ($SysPython) {
        $PythonExe = "py"
    } else {
        $PythonExe = "python"
    }
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Khoi chay Local OmniVoice TTS Server" -ForegroundColor Cyan
Write-Host " Running on: http://127.0.0.1:8000" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Set-Location $ServerDir
& $PythonExe omnivoice_server.py
