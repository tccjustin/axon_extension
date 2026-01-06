param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('mcu', 'all', 'low-format')]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$BootFirmwarePath,

    [Parameter(Mandatory = $true)]
    [string]$FwdnExe
)

$ErrorActionPreference = 'Stop'

function Write-Header {
    param([string]$Title)
    Write-Host "========================================="
    Write-Host $Title
    Write-Host "========================================="
}

Write-Header ("FWDN {0}" -f $Mode.ToUpper())
Write-Host "Boot Firmware Path: $BootFirmwarePath"
Write-Host "FWDN Executable:    $FwdnExe"
Write-Host ""

if (-not (Test-Path -LiteralPath $FwdnExe)) {
    throw "FWDN executable not found: $FwdnExe"
}

$fwdnJson = Join-Path $BootFirmwarePath 'tcn100x_fwdn.json'
if (-not (Test-Path -LiteralPath $fwdnJson)) {
    throw "FWDN json not found: $fwdnJson"
}

Write-Host "Step 1. Connect FWDN"
& $FwdnExe --fwdn $fwdnJson
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Step 1 completed successfully!"
Write-Host ""

if ($Mode -eq 'low-format') {
    Write-Host "Low Level Format: eMMC"
    & $FwdnExe --low-format --storage emmc
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Low level format (eMMC) completed successfully!"
    Write-Host ""

    Write-Host "Low Level Format: SNOR"
    & $FwdnExe --low-format --storage snor
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Low level format (SNOR) completed successfully!"
    Write-Host ""

    Write-Header "FWDN Low Level Format completed successfully!"
} else {
    # Step 2. Download SNOR rom file
    Write-Host "Step 2. Download SNOR rom file"
    $snorRom = Join-Path $BootFirmwarePath 'tcn100x_snor.rom'
    if (-not (Test-Path -LiteralPath $snorRom)) {
        throw "SNOR rom not found: $snorRom"
    }
    & $FwdnExe -w $snorRom --storage snor --area die1
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Step 2 completed successfully!"
    Write-Host ""

    # Step 3. Download boot partition images to eMMC
    Write-Host "Step 3. Download boot partition images to eMMC"
    $bootJson = Join-Path $BootFirmwarePath 'tcn100x_boot.json'
    if (-not (Test-Path -LiteralPath $bootJson)) {
        throw "Boot json not found: $bootJson"
    }
    & $FwdnExe -w $bootJson
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Step 3 completed successfully!"
    Write-Host ""

    # Step 4. only in all mode
    if ($Mode -eq 'all') {
        Write-Host "Step 4. Download FAI file to eMMC"
        $fai = Join-Path $BootFirmwarePath 'SD_Data.fai'
        if (-not (Test-Path -LiteralPath $fai)) {
            throw "FAI file not found: $fai"
        }
        & $FwdnExe -w $fai --storage emmc --area user
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Host "Step 4 completed successfully!"
        Write-Host ""
    }

    Write-Header ("FWDN {0} completed successfully!" -f $Mode.ToUpper())
}

# completion signal for the VS Code extension auto-close flow
$signal = Join-Path $env:TEMP 'axon_fwdn_completed.txt'
'FWDN_COMPLETED' | Set-Content -LiteralPath $signal -Encoding ascii

exit 0


