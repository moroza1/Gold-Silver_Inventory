@echo off
echo ========================================
echo Building PMIMS Backend...
echo ========================================
cd PMIMS.WebAPI
dotnet clean
dotnet build
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✓ Build succeeded! Starting server...
    echo.
    dotnet run
) else (
    echo.
    echo ✗ Build failed. Check errors above.
    echo.
    pause
)
