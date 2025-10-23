# Axon

VS Code 확장 프로그램으로, FWDN 도구를 쉽게 실행하고 설정할 수 있도록 도와줍니다.

## 🌟 프로젝트 개요

Axon은 MCU 펌웨어 개발을 위한 VS Code 확장 프로그램으로, 복잡한 FWDN 도구의 실행과 설정을 간편하게 만들어줍니다. 특히 **원격 개발 환경(SSH/WSL/컨테이너)**과 **다양한 프로젝트 구조**에 최적화되어 있어 개발 생산성을 크게 향상시킵니다.

## ✨ 주요 기능

- **🚀 FWDN MCU 실행**: MCU 펌웨어 업데이트를 위한 FWDN Step 1-3 실행 (로컬 전용)
- **🚀 FWDN ALL 실행**: 전체 펌웨어 업데이트를 위한 FWDN Step 1-4 실행 (로컬 전용)
- **🔨 Build and Copy**: MCU 빌드 및 ROM 자동 복사 (원격 전용)
- **⚙️ FWDN 실행 파일 경로 설정**: FWDN 실행 파일의 경로를 설정하고 관리
- **🔍 Boot Firmware 경로 자동 감지**: 워크스페이스에서 boot-firmware_tcn1000 폴더를 **지능적으로 자동 검색**
- **⚙️ Boot Firmware 경로 수동 설정**: 부트 펌웨어가 위치한 폴더 경로를 수동으로 설정하고 관리
- **🖥️ 로컬 PowerShell 실행**: 로컬 환경에서 PowerShell을 통해 FWDN을 직접 실행

## 🎯 고급 기능

- **🌐 원격 개발 환경 지원**: SSH, WSL, 컨테이너 환경에서 URI 스킴을 보존하여 안정적 작동
  - **Samba 경로 자동 변환**: 원격 경로를 Windows Samba 드라이브(Z:)로 자동 변환
    - `/home/{사용자}/{프로젝트}/...` → `Z:\{프로젝트}\...` (사용자 이름 제외)
    - `/mnt/c/Users/...` → `C:\Users\...` (WSL 환경)
    - `/Users/...` → `Z:\Users\...` (macOS/Linux 환경)
    - `/{프로젝트}/...` → `Z:\{프로젝트}\...` (SSH 직접 매핑)
  - **유연한 프로젝트 디렉토리 인식**: work1, work, project, workspace, dev, autotest_cs, build-axon 등의 다양한 프로젝트 디렉토리 패턴 자동 인식
- **사용자 환경 특화**: `/home/id/{프로젝트}/...` → `Z:\{프로젝트}\...` 패턴 지원
  - **다양한 원격 패턴 지원**: 사용자 환경과 프로젝트 구조에 맞는 매핑 자동 인식
- **🔧 지능적 폴더 검색**: 다양한 프로젝트 구조 패턴을 자동으로 인식하고 검색
  - `**/boot-firmware_tcn1000` - 워크스페이스 내 어디든
  - `**/build-axon/**/boot-firmware_tcn1000` - build-axon 폴더 하위
  - **워크스페이스 내 build-axon 검색**: 워크스페이스 경로에 build-axon이 포함된 경우, workspace 안의 build-axon 폴더에서 boot-firmware_tcn1000 검색
  - `**/linux_yp*/**/boot-firmware_tcn1000` - linux_yp로 시작하는 폴더 하위
  - `**/*linux*yp*/**/boot-firmware_tcn1000` - linux가 포함된 폴더 하위
  - `**/cgw*/**/boot-firmware_tcn1000` - cgw 폴더 하위
- **🐛 상세 디버깅**: 실시간 로그와 디버깅 정보로 문제 진단
  - Output 패널의 Axon 채널에서 상세한 검색 과정 확인
  - 각 패턴의 검색 결과와 소요 시간 실시간 모니터링
  - VS Code 콘솔에서 직접 API 테스트 가능
- **📦 배치 파일 자동 포함**: FWDN 배치 파일을 익스텐션에 포함하여 배포
- **🔄 실시간 설정 동기화**: 설정 변경 시 즉시 모든 명령에 반영

## 요구사항

- VS Code 1.74.0 이상

## 📦 설치 방식

### Universal Extension (로컬 + 원격 자동 설치)

Axon은 **Universal Extension**으로 설정되어 있지만, **VSIX 파일로 설치한 경우**에도 다음과 같이 작동합니다:

- **🖥️ 로컬 환경**: Windows PowerShell 기반 FWDN 실행
- **🌐 원격 환경**: Remote-SSH 연결 시 **자동으로 설치되지 않습니다** (VSCode Remote-SSH 정책)

### 설치 방법

1. **로컬 VS Code에 설치**:
   ```bash
   # VS Code Extension Marketplace에서 "Axon" 검색 후 설치
   # 또는
   code --install-extension axon-0.3.5.vsix
   ```

2. **원격 서버에 수동 설치** (VSIX 파일로 설치한 경우 포함):
   ```bash
   # 1. 로컬에서 .vsix 파일 생성
   npm run compile && vsce package  # axon-0.3.5.vsix 생성

   # 2. .vsix 파일을 원격 서버로 복사
   scp axon-0.3.5.vsix user@remote-server:/tmp/

   # 3. 원격 서버에서 설치
   ssh user@remote-server
   code --install-extension /tmp/axon-0.3.5.vsix
   ```

   **또는**

   ```bash
   # 원격 서버에서 직접 .vsix 다운로드 후 설치
   code --install-extension axon-0.3.5.vsix
   ```

   **⚠️ 중요**: Extension Marketplace나 VSIX 파일로 설치한 경우, **원격 서버에 별도로 설치해야 합니다**

### 🔧 Extension Development 모드 (테스트용)

**Extension 개발 시 원격 자동 설치가 필요하다면:**

1. 이 저장소를 클론합니다
2. `npm install` 명령을 실행합니다
3. `F5` 키를 눌러 **Extension Development Host** 실행
4. **Extension Development Host**에서 Remote-SSH로 원격 서버 연결
5. **Axon extension이 자동으로 원격 서버에 설치됨**
6. Command Palette에서 "Axon" 명령어 테스트 가능

**⚠️ 주의**: Extension Development 모드에서만 원격에 자동 설치됩니다

## 사용법

### 🚀 FWDN 실행

1. Command Palette (`Ctrl+Shift+P`)를 열고 다음 명령 중 하나를 선택합니다:
   - **"Axon: FWDN MCU (Step 1-3)"**: MCU 펌웨어 업데이트 실행
   - **"Axon: FWDN ALL (Step 1-4)"**: 전체 펌웨어 업데이트 실행

### 🔨 Build and Copy (원격 전용)

**⚠️ Remote-SSH 환경에서만 실행됩니다**

**scripts/mcu_build_and_copy.py를 원격에서 실행하여 MCU 빌드와 ROM 복사를 자동화합니다!**

1. **Remote-SSH로 원격 서버에 연결된 상태**에서 Command Palette (`Ctrl+Shift+P`)를 엽니다
2. **"Axon: Build and Copy"** 명령을 실행합니다
3. **자동으로 다음 작업이 수행됩니다**:
   - **build-axon 폴더 지능적 검색**: 상위 경로 + depth 2까지 재귀 탐색
   - **MCU 빌드 디렉토리 자동 계산**: `linux_yp4.0_cgw_1.x.x_dev/build/tcn1000-mcu/tmp/work/...` 경로 생성
   - **make 실행**: 원격 bash 터미널에서 make 명령 실행
   - **ROM 파일 자동 복사**: tcn100x_snor.rom을 boot-firmware에서 찾아서 복사
     - 60초 timeout 기반 최신 파일 검증
     - 자동 대상 디렉토리 생성
     - 복사 완료 후 검증
4. **실시간 모니터링**:
   - VSCode 터미널에서 make 및 ROM 복사 과정 실시간 확인
   - Axon Output 채널에서 각 단계별 상세 로그 확인

#### 🔍 Build and Copy의 고급 기능

- **지능적 build-axon 검색**: 상위 경로부터 현재 디렉토리까지 depth 2까지 탐색
- **자동 타겟 경로 계산**: build-axon 위치로부터 MCU 빌드 경로 자동 생성
- **ROM 파일 검증**: 60초 timeout으로 최신 파일만 복사
- **자동 정리**: 임시 파일 자동 삭제

### ⚡ 빠른 실행

- **F5 키**: 디버깅 모드로 익스텐션 실행 및 테스트
- **Ctrl+Shift+P**: Command Palette에서 모든 Axon 명령어 접근
- **Output 패널 → Axon 채널**: 실시간 로그와 디버깅 정보 확인

### 🚀 모든 사용 가능한 명령어

| 명령어 | 설명 | 환경 |
|--------|------|------|
| **Axon: FWDN MCU (Step 1-3)** | MCU 펌웨어 업데이트 실행 | 로컬 |
| **Axon: FWDN ALL (Step 1-4)** | 전체 펌웨어 업데이트 실행 | 로컬 |
| **Axon: Build and Copy** | MCU 빌드 + ROM 자동 복사 | 원격 |
| **Axon: Configure FWDN Executable Path** | FWDN 실행 파일 경로 설정 | 로컬/원격 |

### 설정 구성

#### FWDN 실행 파일 경로 설정

1. Command Palette에서 **"Axon: Configure FWDN Executable Path"** 명령을 실행합니다
2. FWDN 실행 파일(fwdn.exe)을 선택합니다
3. 설정이 자동으로 저장됩니다

#### Boot Firmware 경로 자동 감지

1. Command Palette에서 **"Axon: Auto-detect Boot Firmware Path"** 명령을 실행합니다
2. **지능적 다중 패턴 검색**으로 `boot-firmware_tcn1000` 폴더를 자동으로 검색합니다:
   - `**/boot-firmware_tcn1000` - 워크스페이스 내 어디든
   - `**/build-axon/**/boot-firmware_tcn1000` - build-axon 폴더 하위
   - **워크스페이스 내 build-axon 검색** - 워크스페이스 경로에 build-axon이 포함된 경우, workspace 안의 build-axon 폴더에서 boot-firmware_tcn1000 검색
   - `**/linux_yp*/**/boot-firmware_tcn1000` - linux_yp로 시작하는 폴더 하위
   - `**/*linux*yp*/**/boot-firmware_tcn1000` - linux가 포함된 폴더 하위
   - `**/cgw*/**/boot-firmware_tcn1000` - cgw 폴더 하위
3. **원격 환경 대응**: SSH, WSL, 컨테이너 환경에서 URI 스킴을 보존하여 안정적 작동
4. **상세 디버깅 로그**: Output 패널에서 각 단계별 검색 과정을 실시간으로 확인 가능
5. 검색된 폴더가 Samba 경로로 자동 변환되어 설정됩니다

#### Boot Firmware 경로 수동 설정

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

## 🛠️ 개발

### 환경 설정

```bash
npm install
npm run compile
npm run watch
```

### 디버깅

#### VS Code 디버깅 모드

1. **F5 키**를 눌러 디버깅 모드 시작
2. 새 창에서 **c:\Users\jhlee17\work** 워크스페이스 열기
3. **F12 키** → **Console 탭**에서 실시간 디버깅

#### 콘솔에서 직접 테스트

디버깅 모드의 콘솔에서 실행할 수 있는 코드들:

```javascript
// 워크스페이스 정보 확인 (URI 스킴 포함)
vscode.workspace.workspaceFolders?.[0]?.uri?.toString()

// boot-firmware_tcn1000 검색
await vscode.workspace.findFiles('../**/boot-firmware_tcn1000', null, 5)

// build-axon 패턴 검색
await vscode.workspace.findFiles('**/build-axon/**/boot-firmware_tcn1000', null, 3)

// Samba 경로 변환 테스트 (원격 환경에서)
convertRemotePathToSamba('/home/id/autotest_cs/build-axon/linux_yp4.0_cgw_1.x.x_dev/boot-firmware_tcn1000')
// 결과: Z:\autotest_cs\build-axon\linux_yp4.0_cgw_1.x.x_dev\boot-firmware_tcn1000

// 다른 사용자/프로젝트 패턴들 테스트
convertRemotePathToSamba('/home/B030240/work1/autotest_cs/build-axon/boot-firmware_tcn1000')
// 결과: Z:\work1\autotest_cs\build-axon\boot-firmware_tcn1000

convertRemotePathToSamba('/home/developer/project_x/mytest/boot-firmware_tcn1000')
// 결과: Z:\project_x\mytest\boot-firmware_tcn1000

// SSH 직접 패턴
convertRemotePathToSamba('/id/autotest_cs/boot-firmware_tcn1000')
// 결과: Z:\autotest_cs\boot-firmware_tcn1000

// WSL 패턴 테스트
convertRemotePathToSamba('/mnt/c/Users/test/work1/project/boot-firmware_tcn1000')
// 결과: C:\Users\test\work1\project\boot-firmware_tcn1000

// 디렉토리 내용 확인
const entries = await vscode.workspace.fs.readDirectory(vscode.workspace.workspaceFolders[0].uri);
console.log('Directory:', entries.map(([name, type]) => `${type === 1 ? '📁' : '📄'} ${name}`))
```

#### 브레이크포인트 설정

- `src/extension.ts`의 193, 225, 249, 397번 라인에 브레이크포인트 설정
- 코드 실행을 한 줄씩 관찰하며 디버깅 가능

### 로그 확인

- **Output 패널** → **Axon 채널**에서 상세한 실행 로그 확인
- 각 패턴의 검색 결과와 소요 시간 실시간 모니터링
- 디버깅 정보로 문제 진단

## 📦 빌드 및 배포

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

## 🔧 문제 해결

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

**Boot Firmware 폴더를 찾을 수 없습니다:**
- Output 패널의 Axon 채널에서 상세한 검색 로그를 확인하세요
- `**/boot-firmware_tcn1000/**` 패턴으로 폴더 내부의 파일이 있는지 확인하세요
- 워크스페이스 경로에 `build-axon`이 포함되어 있는지 확인하고, 그 안에서 boot-firmware_tcn1000를 찾아보세요
- VS Code 콘솔에서 직접 검색 테스트: `vscode.workspace.findFiles('../**/boot-firmware_tcn1000', null, 5)`

**원격 환경(SSH/WSL/컨테이너)에서 작동하지 않습니다:**
- URI 스킴이 `vscode-remote://` 또는 `wsl://`로 시작하는지 확인하세요
- 디버깅 모드(F5)에서 콘솔을 열고 `vscode.workspace.workspaceFolders?.[0]?.uri?.toString()` 실행
- `vscode.workspace.findFiles` API가 원격 환경에서 올바르게 작동하는지 확인하세요

**Samba 경로 변환 오류:**
- 원격 경로가 Samba 드라이브(Z:)로 올바르게 변환되는지 확인하세요
- Output 패널에서 `📝 최종 설정 경로:` 로그를 확인하여 변환 결과 확인
- `📝 사용자: {사용자명}, 프로젝트: {프로젝트디렉토리}` 로그로 변환 과정 확인
- `/home/id/` 환경의 경우 `autotest_cs`, `build-axon` 등의 프로젝트 디렉토리가 올바르게 인식되는지 확인
- 사용자의 환경에 맞는 매핑 패턴이 필요하다면 코드의 `convertRemotePathToSamba` 함수 수정
- VS Code 콘솔에서 `convertRemotePathToSamba('/home/id/{프로젝트}/...')`로 직접 테스트

**익스텐션 명령이 나타나지 않습니다:**
- VS Code를 완전히 재시작하세요
- 새 패키지를 다시 설치하세요: `code --install-extension axon-0.3.5.vsix`
- Command Palette에서 "Axon"으로 검색하여 사용 가능한 명령 확인

**원격 서버에서 extension이 설치되지 않습니다:**
- Extension Marketplace나 VSIX 파일로 설치한 경우, 원격에 **자동으로 설치되지 않습니다**
- **Extension Development 모드(F5)에서만** 원격 연결 시 자동 설치됩니다
- 상단의 **"원격 서버에 수동 설치"** 방법을 따라해주세요
- 원격 서버에서 `code --list-extensions` 명령으로 설치 확인
- 원격 서버의 `~/.vscode-server/extensions/` 디렉토리 확인

**VSIX 파일로 설치한 경우:**
```bash
# 로컬에서 VSIX 생성
npm run compile && vsce package

# 원격 서버로 복사 후 설치
scp axon-0.3.5.vsix user@remote-server:/tmp/
ssh user@remote-server "code --install-extension /tmp/axon-0.3.5.vsix"
```

## 📋 버전 정보

현재 버전: **0.3.5**

### 🚀 최근 업데이트 (v0.3.5)
- 🌐 **Universal Extension**: 로컬과 원격 환경 모두에 자동 설치
  - **extensionKind**: `["ui", "workspace"]`로 변경
  - **자동 설치**: Remote-SSH 연결 시 원격 서버에 자동 설치
  - **환경별 기능**: 로컬/원격 전용 명령어 자동 활성화

### 🔄 이전 버전 (v0.3.1)
- ⚡ **초고속 검색**: 기존 findFiles 방식에서 직접 경로 탐색 방식으로 변경
  - depth 4까지 재귀적 폴더 탐색으로 더 깊고 빠른 검색
  - boot-firmware_tcn1000을 찾는 즉시 중단하여 불필요한 탐색 방지
- ⏱️ **성능 모니터링**: 검색 수행 시간 측정 및 로그 출력
  - 성공/실패/오류별로 소요 시간 확인 가능
  - 밀리초 단위의 정확한 시간 측정
- 🚫 **스마트 제외**: EXCLUDE_PATTERNS 기반으로 불필요한 폴더 자동 제외
  - node_modules, .git, build, dist, tools 등 13개 폴더 타입 자동 제외
  - 검색 속도 향상 및 오탐지 방지
- ⏰ **안전한 타임아웃**: 5초 타임아웃으로 무한 대기 방지
- 🔧 **VS Code 표준 API**: CancellationTokenSource를 통한 표준 취소 메커니즘

### 🔄 이전 버전 (v0.2.0)
- ✅ **지능적 폴더 검색**: `**/${name}/**` 패턴으로 폴더 자동 감지
- ✅ **원격 환경 대응**: SSH/WSL/컨테이너에서 URI 스킴 보존
- ✅ **사용자 환경 특화 Samba 변환**: `/home/id/{프로젝트}/...` → `Z:\{프로젝트}\...`
- ✅ **워크스페이스 내 build-axon 검색**: workspace 안의 build-axon 폴더에서 boot-firmware_tcn1000 자동 검색
- ✅ **상세 디버깅**: 실시간 로그와 콘솔 테스트 기능

### 🔄 이전 버전
- v0.1.0: 초기 FWDN 실행 기능
- v0.1.1: Boot Firmware 경로 설정 추가

## 라이선스

MIT
