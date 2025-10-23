@echo off
setlocal enabledelayedexpansion

set MODE=%~1
set BOOT_FIRMWARE_PATH=%~2
set FWDN_EXE=%~3

if "%MODE%"=="" (
    echo ERROR: MODE argument required
    echo Usage: fwdn_all.bat [mcu^|all] [boot-firmware-path] [fwdn-exe-path]
    pause
    exit /b 1
)

if "%BOOT_FIRMWARE_PATH%"=="" (
    echo ERROR: BOOT_FIRMWARE_PATH argument required
    echo Usage: fwdn_all.bat [mcu^|all] [boot-firmware-path] [fwdn-exe-path]
    pause
    exit /b 1
)

if "%FWDN_EXE%"=="" (
    echo ERROR: FWDN_EXE argument required
    echo Usage: fwdn_all.bat [mcu^|all] [boot-firmware-path] [fwdn-exe-path]
    pause
    exit /b 1
)

if "%MODE%"=="mcu" goto MODE_MCU
if "%MODE%"=="all" goto MODE_ALL

echo ERROR: Invalid MODE '%MODE%'. Use 'mcu' or 'all'
echo Usage: fwdn_all.bat [mcu^|all] [boot-firmware-path] [fwdn-exe-path]
pause
exit /b 1

:MODE_MCU
echo ==========================================
echo FWDN MCU (Step 1-3)
echo ==========================================
goto START_FWDN

:MODE_ALL
echo ==========================================
echo FWDN ALL (Step 1-4)
echo ==========================================
goto START_FWDN

:START_FWDN
echo Boot Firmware Path: %BOOT_FIRMWARE_PATH%
echo FWDN Executable: %FWDN_EXE%
echo.

:: Step 1. Connect FWDN
echo Step 1. Connect FWDN
"%FWDN_EXE%" --fwdn %BOOT_FIRMWARE_PATH%\tcn100x_fwdn.json
if %errorlevel% neq 0 (
    echo ERROR: FWDN connection failed with error code %errorlevel%
    pause
    exit /b %errorlevel%
)
echo Step 1 completed successfully!
echo.

:: Step 2. Download SNOR rom file
echo Step 2. Download SNOR rom file
"%FWDN_EXE%" -w %BOOT_FIRMWARE_PATH%\tcn100x_snor.rom --storage snor --area die1
if %errorlevel% neq 0 (
    echo ERROR: SNOR download failed with error code %errorlevel%
    pause
    exit /b %errorlevel%
)
echo Step 2 completed successfully!
echo.

:: Step 3. Download boot partition images to eMMC
echo Step 3. Download boot partition images to eMMC
"%FWDN_EXE%" -w %BOOT_FIRMWARE_PATH%\tcn100x_boot.json
if %errorlevel% neq 0 (
    echo ERROR: Boot partition download failed with error code %errorlevel%
    pause
    exit /b %errorlevel%
)
echo Step 3 completed successfully!
echo.

:: Step 4 is executed only in 'all' mode
if /i "%MODE%"=="all" (
    echo Step 4. Download FAI file to eMMC
    "%FWDN_EXE%" -w %BOOT_FIRMWARE_PATH%\SD_Data.fai --storage emmc --area user
    if %errorlevel% neq 0 (
        echo ERROR: FAI download failed with error code %errorlevel%
        pause
        exit /b %errorlevel%
    )
    echo Step 4 completed successfully!
    echo.
)

::fwdn --low-format --storage emmc
::fwdn --low-format --storage snor

echo ==========================================
if /i "%MODE%"=="mcu" (
    echo FWDN MCU completed successfully!
) else (
    echo FWDN ALL completed successfully!
)
echo ==========================================

REM 완료 신호 파일 생성 (VS Code 익스텐션에서 감지용)
echo FWDN_COMPLETED > "%TEMP%\axon_fwdn_completed.txt"

pause
endlocal