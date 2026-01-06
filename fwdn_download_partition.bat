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
timeout /t 1 /nobreak >nul

:: Step 2. Download partition
echo Step 2. Download partition: %PARTITION_NAME%
echo File Path: %FILE_PATH%

:: Copy image to local temp to avoid SMB timing issues
set "LOCAL_IMG=%TEMP%\axon_%PARTITION_NAME%_%RANDOM%%RANDOM%.img"
echo Copy image to local temp: "%LOCAL_IMG%"
copy /y "%FILE_PATH%" "%LOCAL_IMG%" >nul
if %errorlevel% neq 0 (
    echo ERROR: Failed to copy image to local temp. errorlevel=%errorlevel%
    pause
    exit /b %errorlevel%
)

for %%I in ("%LOCAL_IMG%") do set "LOCAL_SIZE=%%~zI"
echo Local image size bytes: !LOCAL_SIZE!
if "!LOCAL_SIZE!"=="0" (
    echo ERROR: Local image file size is 0 bytes. Aborting.
    del /f /q "%LOCAL_IMG%" >nul 2>&1
    pause
    exit /b 4
)

:: Retry write with reconnect each time (fwdn.exe can crash intermittently)
set "STEP2_RC=0"
set "STEP2_MAX_RETRY=3"
for /L %%R in (1,1,%STEP2_MAX_RETRY%) do (
    echo Step 2 attempt %%R/%STEP2_MAX_RETRY% ...

    echo Reconnect FWDN...
    "%FWDN_EXE%" --fwdn %BOOT_FIRMWARE_PATH%\tcn100x_fwdn.json
    set "STEP2_RC=!errorlevel!"
    if not "!STEP2_RC!"=="0" (
        echo WARN: Reconnect failed rc=!STEP2_RC! , retrying after 1s...
        timeout /t 1 /nobreak >nul
    ) else (
        timeout /t 1 /nobreak >nul
        "%FWDN_EXE%" -w "%LOCAL_IMG%" -m emmc --area user --part %PARTITION_NAME%
        set "STEP2_RC=!errorlevel!"
        if "!STEP2_RC!"=="0" goto STEP2_OK
        echo WARN: Step 2 failed rc=!STEP2_RC! , retrying after 1s...
        timeout /t 1 /nobreak >nul
    )
)

echo ERROR: Download failed after %STEP2_MAX_RETRY% attempts. last_rc=%STEP2_RC%
del /f /q "%LOCAL_IMG%" >nul 2>&1
pause
exit /b %STEP2_RC%

:STEP2_OK
del /f /q "%LOCAL_IMG%" >nul 2>&1
echo Step 2 completed successfully!
echo.

echo ==========================================
echo Download completed!
echo ==========================================
echo Partition: %PARTITION_NAME%
echo File: %FILE_PATH%
echo.

:: Create completion signal file
set SIGNAL_FILE=%TEMP%\axon_fwdn_completed.txt
echo FWDN_COMPLETED > "%SIGNAL_FILE%"

pause
endlocal


