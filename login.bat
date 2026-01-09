@echo off
chcp 65001 >nul
echo ==========================================
echo Marketplace Login Helper
echo ==========================================
echo.

echo [INFO] Publisher: justinlee-tcc
echo [INFO] Organization: jhlee17
echo.

echo Please follow these steps:
echo.
echo 1. Generate a new PAT at:
echo    https://dev.azure.com/jhlee17/_usersSettings/tokens
echo.
echo 2. Settings:
echo    - Name: VSCode Marketplace
echo    - Organization: All accessible organizations
echo    - Expiration: 90 days
echo    - Scopes: Full access
echo.
echo 3. Copy the generated token
echo.

pause

echo.
echo [INFO] Now logging in to justinlee-tcc...
echo.

npx @vscode/vsce login justinlee-tcc

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Login successful!
    echo.
    echo You can now publish with:
    echo   npm run publish:patch
    echo   or
    echo   .\publish.bat
) else (
    echo.
    echo [ERROR] Login failed!
    echo.
    echo Please check:
    echo 1. Token has Full access scope
    echo 2. Token organization is "All accessible organizations"
    echo 3. You have access to publisher "justinlee-tcc"
)

echo.
pause

