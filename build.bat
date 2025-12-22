@echo off
chcp 65001 >nul
echo ==========================================
echo Axon Extension Build Script (Optimized)
echo ==========================================
echo.

REM 시작 시간 기록
set START_TIME=%TIME%

echo [1/3] Starting fast compilation (incremental)...
call npm run compile:fast
if %errorlevel% neq 0 (
    echo [ERROR] Compilation failed!
    pause
    exit /b %errorlevel%
)
echo [SUCCESS] Compilation completed!
echo.

echo [2/3] Starting package creation (no-deps)...
echo [INFO] Cleaning up old .vsix files...
del /F /Q axon-*.vsix 2>nul
echo.
call npm run package:no-deps
if %errorlevel% neq 0 (
    echo [ERROR] Package creation failed!
    pause
    exit /b %errorlevel%
)
echo [SUCCESS] Package creation completed!
echo.

echo [3/3] Installing extension to Cursor...
echo.

REM 생성된 .vsix 파일 찾기
for %%f in (axon-*.vsix) do set VSIX_FILE=%%f

if not defined VSIX_FILE (
    echo [ERROR] No .vsix file found!
    pause
    exit /b 1
)

echo [INFO] Found package: %VSIX_FILE%
echo [INFO] Installing to Cursor...
echo.

REM Cursor CLI로 Extension 설치
echo [INFO] Installing to Cursor...
call cursor --install-extension %VSIX_FILE% 2>&1
set CURSOR_RESULT=%errorlevel%

REM VS Code CLI로도 Extension 설치
echo [INFO] Installing to VS Code...
call code --install-extension %VSIX_FILE% 2>&1
set CODE_RESULT=%errorlevel%

REM 최종 완료 시간 계산
set HOUR=%TIME:~0,2%
set MIN=%TIME:~3,2%
set SEC=%TIME:~6,2%
if "%HOUR:~0,1%"==" " set HOUR=0%HOUR:~1,1%

echo.
if %CURSOR_RESULT% equ 0 (
    echo [%HOUR%:%MIN%:%SEC%] [SUCCESS] Extension installed to Cursor!
) else (
    echo [%HOUR%:%MIN%:%SEC%] [WARNING] Cursor installation failed or not found.
)

if %CODE_RESULT% equ 0 (
    echo [%HOUR%:%MIN%:%SEC%] [SUCCESS] Extension installed to VS Code!
) else (
    echo [%HOUR%:%MIN%:%SEC%] [WARNING] VS Code installation failed or not found.
)

if %CURSOR_RESULT% neq 0 (
    if %CODE_RESULT% neq 0 (
        echo.
        echo [%HOUR%:%MIN%:%SEC%] [ERROR] Extension installation failed for both Cursor and VS Code!
        echo [%HOUR%:%MIN%:%SEC%] [INFO] Please install manually: Extensions ^> Install from VSIX ^> %VSIX_FILE%
        pause
        exit /b 1
    )
)

REM 종료 시간 및 소요 시간 계산
set END_TIME=%TIME%

echo.
echo [%HOUR%:%MIN%:%SEC%] [INFO] Extension '%VSIX_FILE%' installation completed!
echo [INFO] Please reload window to activate the extension.
echo.
echo ==========================================
echo Build and Installation completed!
echo Start: %START_TIME%
echo End:   %END_TIME%
echo ==========================================
echo.
echo [TIP] For even faster builds, use: npm run build
pause
