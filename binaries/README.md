# FWDN Binaries

이 폴더에는 Axon Extension과 함께 배포되는 FWDN 실행 파일이 포함되어 있습니다.

## 포함된 파일

- `fwdn.exe`: FWDN (Firmware Download) 실행 파일
- `VtcUsbPort.dll`: FWDN에 필요한 USB 포트 드라이버 DLL

## 자동 사용

Extension은 다음 우선순위로 FWDN 실행 파일을 찾습니다:

1. **사용자 설정 경로** (`axon.fwdn.exePath`)
2. **Extension 내장 버전** (이 폴더의 `fwdn.exe`)

별도 설정 없이 Extension을 설치하면 자동으로 내장된 FWDN이 사용됩니다.

## 사용자 정의 경로 설정

다른 버전의 FWDN을 사용하려면:

1. VS Code 설정 (`Ctrl+,`)을 엽니다
2. `axon.fwdn.exePath` 검색
3. 원하는 `fwdn.exe` 경로를 입력합니다

또는 Command Palette (`Ctrl+Shift+P`)에서:
- `Axon: Configure Settings` 실행
- `FWDN 실행 파일 경로 설정` 선택
- 파일 선택 다이얼로그에서 `fwdn.exe` 선택

## 주의사항

- FWDN은 로컬 Windows 환경에서만 실행됩니다
- SSH/WSL 원격 환경에서도 로컬 터미널을 통해 실행됩니다
- `VtcUsbPort.dll`은 `fwdn.exe`와 같은 폴더에 있어야 합니다

