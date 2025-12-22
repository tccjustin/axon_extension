@echo off
REM ============================================
REM FWDN Read Partition (Dump)
REM ============================================
REM Usage: fwdn_read_partition.bat <boot_firmware_path> <fwdn_exe_path> <output_file> <storage_type> <partition_name>
REM Example: fwdn_read_partition.bat "Z:\boot-firmware" "fwdn.exe" "system_a_dump.bin" "emmc" "system_a"
REM Note: Only GPT format and eMMC/UFS user area supported

setlocal

set BOOT_FW_PATH=%~1
set FWDN_EXE=%~2
set OUTPUT_FILE=%~3
set STORAGE_TYPE=%~4
set PARTITION_NAME=%~5

echo ============================================
echo FWDN Read Partition (Dump)
echo ============================================
echo Boot Firmware Path: %BOOT_FW_PATH%
echo FWDN Executable: %FWDN_EXE%
echo Output File: %OUTPUT_FILE%
echo Storage Type: %STORAGE_TYPE%
echo Partition Name: %PARTITION_NAME%
echo ============================================
echo.

REM Boot Firmware 경로로 이동
cd /d "%BOOT_FW_PATH%"

REM Step 1. Connect FWDN
echo Step 1. Connect FWDN
"%FWDN_EXE%" --fwdn %BOOT_FW_PATH%\tcn100x_fwdn.json
if %errorlevel% neq 0 (
    echo ERROR: FWDN connection failed with error code %errorlevel%
    pause
    exit /b %errorlevel%
)
echo Step 1 completed successfully!
echo.

REM Step 2. FWDN Read 실행 (GPT format, --part 옵션 사용)
echo Step 2. Read Partition (Dump)
echo Command: "%FWDN_EXE%" -r "%OUTPUT_FILE%" -m %STORAGE_TYPE% -e user --part %PARTITION_NAME%
echo.

"%FWDN_EXE%" -r "%OUTPUT_FILE%" -m %STORAGE_TYPE% -e user --part %PARTITION_NAME%

if %errorlevel% neq 0 (
    echo ERROR: FWDN Read failed with error code %errorlevel%
    pause
    exit /b %errorlevel%
)
echo Step 2 completed successfully!
echo.

echo ============================================
echo [SUCCESS] FWDN Read completed successfully!
echo Output file: %OUTPUT_FILE%
echo ============================================
pause

endlocal

