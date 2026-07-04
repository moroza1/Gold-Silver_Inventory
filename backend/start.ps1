#!/usr/bin/env pwsh
# KFHOnline Backend - Start Script

Write-Host "KFHOnline Backend Startup" -ForegroundColor Cyan
Write-Host ""

# Step 1: Kill any running dotnet processes
Write-Host "Stopping any running dotnet processes..." -ForegroundColor Yellow
$processes = Get-Process dotnet -ErrorAction SilentlyContinue
if ($processes) {
    $processes | Stop-Process -Force
    Write-Host "OK - Stopped running processes" -ForegroundColor Green
    Start-Sleep -Seconds 2
} else {
    Write-Host "OK - No running processes found" -ForegroundColor Green
}

Write-Host ""

# Step 2: Navigate to backend
Write-Host "Navigating to backend directory..." -ForegroundColor Yellow
$backendPath = "D:\Projects\Gold2\backend\PMIMS.WebAPI"
if (-not (Test-Path $backendPath)) {
    Write-Host "ERROR - Backend path not found" -ForegroundColor Red
    exit 1
}
Set-Location $backendPath
Write-Host "OK - Current directory: $(Get-Location)" -ForegroundColor Green
Write-Host ""

# Step 3: Clean
Write-Host "Cleaning build artifacts..." -ForegroundColor Yellow
dotnet clean --nologo -q
Write-Host "OK - Clean complete" -ForegroundColor Green
Write-Host ""

# Step 4: Build
Write-Host "Building backend..." -ForegroundColor Yellow
dotnet build --nologo
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR - Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "OK - Build successful" -ForegroundColor Green
Write-Host ""

# Step 5: Run
Write-Host "Starting backend server..." -ForegroundColor Yellow
Write-Host ""
dotnet run --no-build --launch-profile PMIMS.WebAPI
