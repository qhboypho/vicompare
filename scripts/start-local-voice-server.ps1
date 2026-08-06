param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 7860,
  [string]$Token = "",
  [string]$Device = "auto",
  [string]$Language = "vi"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ServerDir = Join-Path $Root "local-voice-server"
$VenvPython = Join-Path $ServerDir ".venv\Scripts\python.exe"

if (!(Test-Path $VenvPython)) {
  throw "Local voice venv does not exist. Run .\scripts\setup-local-voice-server.ps1 first."
}

$env:LOCAL_VOICE_HOST = $HostName
$env:LOCAL_VOICE_PORT = "$Port"
$env:LOCAL_VOICE_DEVICE = $Device
$env:LOCAL_VOICE_LANGUAGE = $Language
if ($Token) {
  $env:LOCAL_VOICE_TOKEN = $Token
}

Write-Host "Starting Local Voice Clone Server at http://$HostName`:$Port"
Write-Host "Device: $Device | Language: $Language"
Write-Host "Use this URL in Web Tool: http://$HostName`:$Port"

Push-Location $ServerDir
try {
  & $VenvPython server.py
} finally {
  Pop-Location
}
