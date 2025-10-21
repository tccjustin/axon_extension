@echo off
chcp 65001 >nul
echo ==========================================
echo Axon Extension Build Script
echo ==========================================
echo.

echo [1/3] Starting compilation...
call npm run compile
if %errorlevel% neq 0 (
    echo [ERROR] Compilation failed!
    pause
    exit /b %errorlevel%
)
echo [SUCCESS] Compilation completed!
echo.

echo [2/3] Starting package creation...
call npm run package:auto
if %errorlevel% neq 0 (
    echo [ERROR] Package creation failed!
    pause
    exit /b %errorlevel%
)
echo [SUCCESS] Package creation completed!
echo.

echo [3/3] Build completed!
echo [INFO] Generated package: axon-*.vsix
echo.
echo ==========================================
echo Build completed successfully!
echo ==========================================
pause
