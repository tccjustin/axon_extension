param(
    [Parameter(Mandatory = $true)]
    [string]$BootFirmwarePath,

    [Parameter(Mandatory = $true)]
    [string]$ConfigFilePath,

    [Parameter(Mandatory = $true)]
    [string]$FwdnExe,

    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string]$PartitionName,

    [int]$RetryCount = 3,
    [int]$DelaySec = 1
)

$ErrorActionPreference = 'Stop'

function Write-Header {
    param([string]$Title)
    Write-Host "=========================================="
    Write-Host $Title
    Write-Host "=========================================="
}

Write-Header "FWDN Download Partition (ps1)"
Write-Host "Boot Firmware Path: $BootFirmwarePath"
Write-Host "Config File Path:   $ConfigFilePath"
Write-Host "FWDN Executable:    $FwdnExe"
Write-Host "File Path:          $FilePath"
Write-Host "Partition Name:     $PartitionName"
Write-Host ""

if (-not (Test-Path -LiteralPath $FwdnExe)) {
    throw "FWDN executable not found: $FwdnExe"
}

if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "Image file not found: $FilePath"
}

# Use Config File Path for fwdn.json
$fwdnJson = Join-Path $ConfigFilePath 'tcn100x_fwdn.json'
if (-not (Test-Path -LiteralPath $fwdnJson)) {
    throw "FWDN json not found: $fwdnJson"
}

Write-Host "Step 1. Connect FWDN"
& $FwdnExe --fwdn $fwdnJson
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Step 1 completed successfully"
Start-Sleep -Seconds $DelaySec
Write-Host ""

Write-Host "Step 2. Download partition: $PartitionName"
Write-Host "Use file path directly (no local copy)"
$size = (Get-Item -LiteralPath $FilePath).Length
Write-Host "Image size bytes: $size"
if ($size -le 0) {
    throw "Image file is empty: $FilePath"
}

$rc = 0
for ($i = 1; $i -le $RetryCount; $i++) {
    Write-Host "Attempt $i/$RetryCount (reconnect + write)"

    & $FwdnExe --fwdn $fwdnJson
    $rc = $LASTEXITCODE
    if ($rc -ne 0) {
        Write-Host "WARN: reconnect failed rc=$rc; retry after ${DelaySec}s"
        Start-Sleep -Seconds $DelaySec
        continue
    }

    Start-Sleep -Seconds $DelaySec

    & $FwdnExe -w $FilePath -m emmc --area user --part $PartitionName
    $rc = $LASTEXITCODE
    if ($rc -eq 0) { break }

    Write-Host "WARN: write failed rc=$rc; retry after ${DelaySec}s"
    Start-Sleep -Seconds $DelaySec
}

if ($rc -ne 0) {
    Write-Host "ERROR: Download failed after $RetryCount attempts. last_rc=$rc"
    exit $rc
}

Write-Host "Step 2 completed successfully"
Write-Host ""
Write-Header "Download completed"
Write-Host "Partition: $PartitionName"
Write-Host "File:      $FilePath"
Write-Host ""

# completion signal for the VS Code extension
$signal = Join-Path $env:TEMP 'axon_fwdn_completed.txt'
'FWDN_COMPLETED' | Set-Content -LiteralPath $signal -Encoding ascii

exit 0


