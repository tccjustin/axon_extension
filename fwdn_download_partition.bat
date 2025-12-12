@echo off
setlocal enabledelayedexpansion

set BOOT_FIRMWARE_PATH=%~1
set FWDN_EXE=%~2
set FILE_PATH=%~3
set PARTITION_NAME=%~4

if "%BOOT_FIRMWARE_PATH%"=="" (
    echo ERROR: BOOT_FIRMWARE_PATH argument required
    echo Usage: fwdn_download_partition.bat [boot-firmware-path] [fwdn-exe-path] [file-path] [partition-name]
    pause
    exit /b 1
)

if "%FWDN_EXE%"=="" (
    echo ERROR: FWDN_EXE argument required
    echo Usage: fwdn_download_partition.bat [boot-firmware-path] [fwdn-exe-path] [file-path] [partition-name]
    pause
    exit /b 1
)

if "%FILE_PATH%"=="" (
    echo ERROR: FILE_PATH argument required
    echo Usage: fwdn_download_partition.bat [boot-firmware-path] [fwdn-exe-path] [file-path] [partition-name]
    pause
    exit /b 1
)

if "%PARTITION_NAME%"=="" (
    echo ERROR: PARTITION_NAME argument required
    echo Usage: fwdn_download_partition.bat [boot-firmware-path] [fwdn-exe-path] [file-path] [partition-name]
    pause
    exit /b 1
)

echo ==========================================
echo FWDN Download Partition
echo ==========================================
echo Boot Firmware Path: %BOOT_FIRMWARE_PATH%
echo FWDN Executable: %FWDN_EXE%
echo File Path: %FILE_PATH%
echo Partition Name: %PARTITION_NAME%
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

:: Step 2. Download partition
echo Step 2. Download partition: %PARTITION_NAME%
"%FWDN_EXE%" -w "%FILE_PATH%" -m emmc --area user --part %PARTITION_NAME%
if %errorlevel% neq 0 (
    echo ERROR: Download failed with error code %errorlevel%
    pause
    exit /b %errorlevel%
)
echo Step 2 completed successfully!
echo.

echo ==========================================
echo ✅ Download completed!
echo ==========================================
echo Partition: %PARTITION_NAME%
echo File: %FILE_PATH%
echo.

:: Create completion signal file
set SIGNAL_FILE=%TEMP%\axon_fwdn_completed.txt
echo FWDN_COMPLETED > "%SIGNAL_FILE%"

pause

