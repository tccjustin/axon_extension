param(
    [switch]$SkipMS,
    [switch]$SkipOVSX
)

$ErrorActionPreference = "Stop"

function Get-PlainTextFromSecureString([Security.SecureString]$Secure) {
    $bstr = [IntPtr]::Zero
    try {
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Axon publish environment variables (User scope)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "이 스크립트는 아래 환경변수를 Windows '사용자(User)' 범위로 저장합니다." -ForegroundColor Yellow
Write-Host " - VSCE_PAT (MS Marketplace publish PAT)" -ForegroundColor Yellow
Write-Host " - MS_PUBLISHER (예: justin-lee)" -ForegroundColor Yellow
Write-Host " - OVSX_PAT (Open VSX publish token)" -ForegroundColor Yellow
Write-Host ""
Write-Host "주의: Windows 환경변수에는 평문으로 저장됩니다. (권한/PC 보안 관리 필요)" -ForegroundColor Yellow
Write-Host ""

if (-not $SkipMS) {
    $msPublisher = Read-Host "MS Marketplace publisher ID 입력 (예: justin-lee)"
    if ([string]::IsNullOrWhiteSpace($msPublisher)) {
        throw "MS_PUBLISHER 값이 비었습니다."
    }

    $vsceSecure = Read-Host "VSCE_PAT 입력 (화면에 표시되지 않음)" -AsSecureString
    $vscePat = Get-PlainTextFromSecureString $vsceSecure
    if ([string]::IsNullOrWhiteSpace($vscePat)) {
        throw "VSCE_PAT 값이 비었습니다."
    }

    [Environment]::SetEnvironmentVariable("MS_PUBLISHER", $msPublisher.Trim(), "User")
    [Environment]::SetEnvironmentVariable("VSCE_PAT", $vscePat, "User")

    # 가능한 한 메모리에서 제거
    $vscePat = $null
    $vsceSecure = $null

    Write-Host "✅ MS Marketplace 환경변수 저장 완료: MS_PUBLISHER, VSCE_PAT" -ForegroundColor Green
}
else {
    Write-Host "ℹ️ SkipMS 지정: MS Marketplace 환경변수 설정을 건너뜁니다." -ForegroundColor DarkYellow
}

if (-not $SkipOVSX) {
    $ovsxSecure = Read-Host "OVSX_PAT 입력 (화면에 표시되지 않음)" -AsSecureString
    $ovsxPat = Get-PlainTextFromSecureString $ovsxSecure
    if ([string]::IsNullOrWhiteSpace($ovsxPat)) {
        throw "OVSX_PAT 값이 비었습니다."
    }

    [Environment]::SetEnvironmentVariable("OVSX_PAT", $ovsxPat, "User")

    $ovsxPat = $null
    $ovsxSecure = $null

    Write-Host "✅ Open VSX 환경변수 저장 완료: OVSX_PAT" -ForegroundColor Green
}
else {
    Write-Host "ℹ️ SkipOVSX 지정: Open VSX 환경변수 설정을 건너뜁니다." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "완료. 새 PowerShell/터미널을 열면 환경변수가 적용됩니다." -ForegroundColor Cyan
Write-Host "확인(값 출력 안 함):" -ForegroundColor Cyan
Write-Host "  Get-Item Env:VSCE_PAT,Env:OVSX_PAT,Env:MS_PUBLISHER" -ForegroundColor Cyan
Write-Host "배포:" -ForegroundColor Cyan
Write-Host "  cd axon_extension" -ForegroundColor Cyan
Write-Host "  npm run build:full" -ForegroundColor Cyan
Write-Host "  npm run package:ms" -ForegroundColor Cyan
Write-Host "  npm run publish:ms" -ForegroundColor Cyan
Write-Host "  npm run publish:ovsx" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan


