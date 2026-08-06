$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Split-Path -Parent $ScriptDir
$ServerDir = Join-Path $ProjectDir "local-voice-server"
$VenvDir = Join-Path $ServerDir ".venv-omnivoice"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Setup Local OmniVoice TTS & Clone Server" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if (-not (Test-Path $VenvDir)) {
    Write-Host "[1/3] Dang tao môi truong ao Python (.venv-omnivoice)..." -ForegroundColor Yellow
    python -m venv $VenvDir
} else {
    Write-Host "[1/3] Môi truong ao .venv-omnivoice da ton tai." -ForegroundColor Green
}

$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
$PipExe = Join-Path $VenvDir "Scripts\pip.exe"

Write-Host "[2/3] Câp nhât pip..." -ForegroundColor Yellow
& $PipExe install --upgrade pip setuptools wheel

Write-Host "[3/3] Dang cai dat thu viện OmniVoice va PyTorch..." -ForegroundColor Yellow
$ReqFile = Join-Path $ServerDir "requirements-omnivoice.txt"
& $PipExe install -r $ReqFile

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " HOAN TAT CAI DAT OMNIVOICE LOCAL SERVER!" -ForegroundColor Green
Write-Host " De khoi chay server, hay chay script:" -ForegroundColor Yellow
Write-Host "   .\scripts\start-omnivoice-server.ps1" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Green
