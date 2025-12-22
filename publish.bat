@echo off
chcp 65001 >nul
echo ==========================================
echo Axon Extension Publish Script
echo ==========================================
echo.

REM 현재 버전 확인
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"\"version\"" package.json') do (
    set CURRENT_VERSION=%%a
)
set CURRENT_VERSION=%CURRENT_VERSION:"=%

echo [INFO] Current version: %CURRENT_VERSION%
echo.

REM 배포 타입 선택
echo Select publish type:
echo 1. Patch (0.4.8 -^> 0.4.9)
echo 2. Minor (0.4.8 -^> 0.5.0)
echo 3. Major (0.4.8 -^> 1.0.0)
echo 4. Specific version
echo 5. Cancel
echo.

set /p CHOICE="Enter choice (1-5): "

if "%CHOICE%"=="1" (
    set PUBLISH_TYPE=patch
    goto :publish
)
if "%CHOICE%"=="2" (
    set PUBLISH_TYPE=minor
    goto :publish
)
if "%CHOICE%"=="3" (
    set PUBLISH_TYPE=major
    goto :publish
)
if "%CHOICE%"=="4" (
    set /p NEW_VERSION="Enter version (e.g., 0.4.9): "
    goto :publish_version
)
if "%CHOICE%"=="5" (
    echo [INFO] Publish cancelled.
    pause
    exit /b 0
)

echo [ERROR] Invalid choice!
pause
exit /b 1

:publish
echo.
echo [1/3] Building optimized package...
call npm run build:full
if %errorlevel% neq 0 (
    echo [ERROR] Build failed!
    pause
    exit /b %errorlevel%
)
echo [SUCCESS] Build completed!
echo.

echo [2/3] Publishing to Marketplace (%PUBLISH_TYPE%)...
call npx vsce publish %PUBLISH_TYPE%
if %errorlevel% neq 0 (
    echo [ERROR] Publish failed!
    echo.
    echo [TIP] If login failed, run: npx vsce login justin-lee
    pause
    exit /b %errorlevel%
)
goto :success

:publish_version
echo.
echo [1/3] Building optimized package...
call npm run build:full
if %errorlevel% neq 0 (
    echo [ERROR] Build failed!
    pause
    exit /b %errorlevel%
)
echo [SUCCESS] Build completed!
echo.

echo [2/3] Publishing to Marketplace (version %NEW_VERSION%)...
call npx vsce publish %NEW_VERSION%
if %errorlevel% neq 0 (
    echo [ERROR] Publish failed!
    echo.
    echo [TIP] If login failed, run: npx vsce login justin-lee
    pause
    exit /b %errorlevel%
)
goto :success

:success
echo [SUCCESS] Publish completed!
echo.

echo [3/3] Verifying on Marketplace...
echo [INFO] Check your extension at:
echo https://marketplace.visualstudio.com/items?itemName=justin-lee.axon
echo.
echo [INFO] It may take a few minutes for the update to appear.
echo.

REM 새 버전 확인
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"\"version\"" package.json') do (
    set NEW_VERSION=%%a
)
set NEW_VERSION=%NEW_VERSION:"=%

echo ==========================================
echo Publish completed!
echo Version: %CURRENT_VERSION% -^> %NEW_VERSION%
echo ==========================================
echo.
echo [TIP] Don't forget to:
echo 1. Commit and push the version change
echo 2. Create a git tag: git tag v%NEW_VERSION%
echo 3. Push the tag: git push origin v%NEW_VERSION%
echo.
pause

