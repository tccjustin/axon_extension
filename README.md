# Axon

VS Code 확장 프로그램으로, FWDN 도구를 쉽게 실행하고 설정할 수 있도록 도와줍니다.

## 기능

- **FWDN MCU 실행**: MCU 펌웨어 업데이트를 위한 FWDN Step 1-3 실행
- **FWDN ALL 실행**: 전체 펌웨어 업데이트를 위한 FWDN Step 1-4 실행
- **FWDN 실행 파일 경로 설정**: FWDN 실행 파일의 경로를 설정하고 관리
- **Boot Firmware 경로 설정**: 부트 펌웨어가 위치한 폴더 경로를 설정하고 관리
- **로컬 PowerShell 실행**: 로컬 환경에서 PowerShell을 통해 FWDN을 직접 실행

## 요구사항

- VS Code 1.74.0 이상

## 설치

1. 이 저장소를 클론합니다
2. `npm install` 명령을 실행합니다
3. `F5` 키를 눌러 확장 프로그램이 로드된 새 창을 엽니다

## 사용법

### FWDN 실행

1. Command Palette (`Ctrl+Shift+P`)를 열고 다음 명령 중 하나를 선택합니다:
   - **"Axon: FWDN MCU (Step 1-3)"**: MCU 펌웨어 업데이트 실행
   - **"Axon: FWDN ALL (Step 1-4)"**: 전체 펌웨어 업데이트 실행

### 설정 구성

#### FWDN 실행 파일 경로 설정

1. Command Palette에서 **"Axon: Configure FWDN Executable Path"** 명령을 실행합니다
2. FWDN 실행 파일(fwdn.exe)을 선택합니다
3. 설정이 자동으로 저장됩니다

#### Boot Firmware 경로 설정

1. Command Palette에서 **"Axon: Configure Boot Firmware Path"** 명령을 실행합니다
2. Boot Firmware가 위치한 폴더를 선택합니다
3. 설정이 자동으로 저장됩니다

### 기본 설정값

**FWDN 실행 파일 경로 (기본값):**
```
C:\Users\jhlee17\work\FWDN\fwdn.exe
```

**Boot Firmware 경로 (기본값):**
```
Z:\work1\can2ethimp\mcu-tcn100x\boot-firmware-tcn100x
```

### VS Code 설정

다음 설정 항목들이 VS Code 설정에서 관리됩니다:

**FWDN 설정:**
- `axon.fwdn.exePath`: FWDN 실행 파일 경로
- `axon.bootFirmware.path`: Boot Firmware 폴더 경로

## 개발

```bash
npm install
npm run compile
npm run watch
```

## 빌드 및 배포

```bash
# 컴파일 후 패키징
npm run build

# 자동 패치 버전 업데이트 후 패키징
npm run package:auto

# 특정 버전 업데이트 후 패키징
npm run package:patch    # 패치 버전 증가
npm run package:minor    # 마이너 버전 증가
npm run package:major    # 메이저 버전 증가
```

## 문제 해결

### 일반적인 에러 해결 방법

**드라이브 연결 오류 (시스템이 지정된 드라이브를 찾을 수 없습니다):**
- Z: 드라이브가 네트워크로 연결되어 있는지 확인하세요
- 네트워크 드라이브가 매핑되어 있는지 확인하세요

**환경변수 오류:**
- 배치 파일에서 환경변수가 제대로 설정되어 있는지 확인하세요
- `%USERPROFILE%` 등의 환경변수가 올바른 값으로 설정되어 있는지 확인하세요

**경로 오류:**
- 모든 경로가 올바르게 설정되어 있는지 확인하세요
- 특히 Boot Firmware 경로와 FWDN 실행 파일 경로를 확인하세요

## 버전

현재 버전: 0.1.14

## 라이선스

MIT
