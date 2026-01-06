param(
    [Parameter(Mandatory = $true)]
    [string]$BootFirmwarePath,

    [Parameter(Mandatory = $true)]
    [string]$FwdnExe,

    [Parameter(Mandatory = $true)]
    [string]$OutputFile,

    [Parameter(Mandatory = $true)]
    [ValidateSet('emmc', 'ufs')]
    [string]$StorageType,

    [Parameter(Mandatory = $true)]
    [string]$PartitionName
)

$ErrorActionPreference = 'Stop'

function Write-Header {
    param([string]$Title)
    Write-Host "==========================================="
    Write-Host $Title
    Write-Host "==========================================="
}

Write-Header "FWDN Read Partition (Dump) (ps1)"
Write-Host "Boot Firmware Path: $BootFirmwarePath"
Write-Host "FWDN Executable:    $FwdnExe"
Write-Host "Output File:        $OutputFile"
Write-Host "Storage Type:       $StorageType"
Write-Host "Partition Name:     $PartitionName"
Write-Host "==========================================="
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

Write-Host "Step 2. Read Partition (Dump)"
Write-Host ("Command: {0} -r {1} -m {2} -e user --part {3}" -f $FwdnExe, $OutputFile, $StorageType, $PartitionName)
Write-Host ""

& $FwdnExe -r $OutputFile -m $StorageType -e user --part $PartitionName
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Step 2 completed successfully!"
Write-Host ""
Write-Header "[SUCCESS] FWDN Read completed successfully!"
Write-Host "Output file: $OutputFile"

exit 0


