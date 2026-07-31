$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path "$root\frontend\node_modules")) {
  Write-Host "Installing frontend dependencies..."
  Push-Location "$root\frontend"
  npm install
  Pop-Location
}

Write-Host "Starting ForgeFlow backend on http://127.0.0.1:8000 ..."
Start-Process -FilePath "python" `
  -ArgumentList "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000" `
  -WorkingDirectory $root `
  -WindowStyle Hidden

Write-Host "Starting ForgeFlow React frontend on http://127.0.0.1:5173 ..."
Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run", "dev" `
  -WorkingDirectory "$root\frontend" `
  -WindowStyle Hidden

Write-Host ""
Write-Host "ForgeFlow is ready:"
Write-Host "  Frontend: http://127.0.0.1:5173"
Write-Host "  Backend:  http://127.0.0.1:8000/docs"
