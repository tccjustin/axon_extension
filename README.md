# Axon Dev

Telechips MCU/Yocto 펌웨어 개발을 위한 통합 개발 도구입니다. WSL/SSH 원격 환경에서 MCU 빌드, Yocto 빌드, FWDN 펌웨어 다운로드를 간편하게 수행할 수 있습니다.

## ✨ 주요 기능

### 🚀 프로젝트 생성

#### MCU Standalone 프로젝트
- Git 저장소에서 MCU 프로젝트 자동 클론
- 빌드 도구 자동 설정
- 개발 환경 즉시 구성

#### Yocto 프로젝트 (Autolinux)

- Manifest 기반 Yocto 프로젝트 생성
- SDK, Manifest, Machine 선택
- Source Mirror 및 Build Tools 재사용
- 자동 configure 실행

### 🔨 MCU 빌드

- **MCU Build Make**: 선택한 코어(M7-NP, M7-0, M7-2, M7-1) 빌드
- **MCU Build All**: 모든 코어를 한 번에 순차 빌드
- **MCU Clean**: 빌드 결과물 정리
- **빌드 옵션 추출**: defconfig에서 빌드 옵션 자동 추출 (compile_commands.json 생성)

### 🏗️ Yocto 빌드

#### 빌드 명령어
- **Build Yocto AP**: Application Processor 이미지 빌드
- **Build Yocto MCU**: MCU 펌웨어 빌드
- **Build Yocto Kernel**: 리눅스 커널 빌드

#### 정리 명령어
- **Clean Yocto AP**: AP 빌드 결과물 정리
- **Clean Yocto MCU**: MCU 빌드 결과물 정리
- **Clean Yocto All**: 모든 빌드 결과물 정리

#### 설정 관리
- **Edit AP local.conf**: AP 빌드 설정 파일 편집
- **Edit MCU local.conf**: MCU 빌드 설정 파일 편집
- **Edit Branch/Srcrev**: Git 브랜치 및 리비전 관리

#### DevTool 지원
- **DevTool Create & Modify**: 레시피 생성 및 소스 수정
- **DevTool Build**: 개발 중인 레시피 빌드

### 📥 FWDN (펌웨어 다운로드)

**⚠️ Windows 로컬 환경 전용**

- **FWDN**: 전체 펌웨어 다운로드
- **FWDN Low Level Format**: 저수준 포맷 후 다운로드
- **FWDN Specific Image**: 특정 이미지 파일만 선택하여 다운로드

### ⚙️ 설정 관리

- **FWDN 실행 파일 경로**: 커스텀 fwdn.exe 경로 설정
- **프로젝트 타입**: MCU/Yocto 프로젝트 타입 선택
- **WSL Distro 이름**: WSL 배포판 이름 설정
- **Source Mirror**: Yocto 다운로드 시간 단축
- **Build Tools**: 빌드 도구 재사용 설정
- **Git Repository URL**: MCU/Yocto Git 저장소 URL 설정

### 🎨 사이드바 UI

Activity Bar에 Axon 아이콘이 추가되어 모든 기능에 빠르게 접근할 수 있습니다:

- **Create Projects**: 프로젝트 생성 대화상자
- **Build**: MCU 코어별 빌드 버튼
- **Configurations**: 설정 관리

## 📋 요구 사항

### 필수 환경
- **VS Code**: 1.74.0 이상
- **원격 환경**: WSL 또는 SSH 리눅스 환경
- **OS**: Windows (로컬) + Linux (원격)

### 권장 환경
- **WSL2**: Ubuntu 20.04 이상
- **Git**: 2.0 이상
- **Python**: 3.6 이상 (Yocto 빌드용)

## 📦 설치 방법

### Marketplace에서 설치 (추천)

1. VS Code Extensions에서 "Axon Dev" 검색
2. Install 클릭
3. 원격 환경(WSL/SSH)에도 설치 필요 시 "Install in WSL" 클릭

### 명령어로 설치

```bash
code --install-extension JustinLee-tcc.axon-dev
```

## 🚀 빠른 시작

### 1. MCU 프로젝트 시작하기

1. **Command Palette** (`Ctrl+Shift+P`) 열기
2. **"Axon: Create MCU Standalone Project"** 실행
3. Git URL, 브랜치, 저장 경로 입력
4. 프로젝트 자동 생성 완료!

### 2. MCU 빌드하기

**방법 1: 사이드바 사용**
1. Activity Bar에서 Axon 아이콘 클릭
2. Build 섹션에서 원하는 코어 클릭 (M7-NP, M7-0, M7-2, M7-1)

**방법 2: Command Palette 사용**
1. `Ctrl+Shift+P` → **"Axon: MCU Build All"**
2. 모든 코어가 순차적으로 빌드됨

### 3. Yocto 프로젝트 시작하기

1. **Command Palette** (`Ctrl+Shift+P`) 열기
2. **"Axon: Create Yocto Project"** 실행
3. 대화상자에서 설정:
   - SDK 경로 선택
   - Manifest URL 및 브랜치 입력
   - Machine 선택
   - Source Mirror/Build Tools 설정 (선택사항)
4. Configure 자동 실행

### 4. Yocto 빌드하기

```
Ctrl+Shift+P → "Axon: Build Yocto AP"
Ctrl+Shift+P → "Axon: Build Yocto MCU"
```

### 5. FWDN 펌웨어 다운로드

**⚠️ 주의**: Windows 로컬 환경에서만 실행됩니다.

1. Yocto 빌드 완료 후 이미지 파일 생성 확인
2. `Ctrl+Shift+P` → **"Axon: FWDN"**
3. 자동으로 SD_Data.gpt 파일 찾아서 다운로드

## 💡 사용 팁

### Output 로그 확인

모든 빌드 과정을 실시간으로 확인할 수 있습니다:

1. **View** → **Output** (또는 `Ctrl+Shift+U`)
2. 드롭다운에서 **"Axon"** 선택
3. 빌드 진행 상황, 에러 메시지 확인

### DevTool로 레시피 개발

Yocto 레시피를 개발할 때 유용합니다:

1. `Ctrl+Shift+P` → **"Axon: DevTool Create & Modify"**
2. 레시피 이름 입력 (예: `my-app`)
3. 소스 수정 후 `Ctrl+Shift+P` → **"Axon: DevTool Build"**
4. 빠르게 테스트 가능

### 설정 파일 편집

Yocto 빌드 설정을 쉽게 변경할 수 있습니다:

- **AP local.conf**: `Ctrl+Shift+P` → "Axon: Edit AP local.conf"
- **MCU local.conf**: `Ctrl+Shift+P` → "Axon: Edit MCU local.conf"
- **Branch/Srcrev**: Git 브랜치 및 리비전 관리

### 폴더 제외 설정

Yocto 빌드 폴더는 용량이 크므로 VS Code 검색에서 제외하는 것이 좋습니다:

`Ctrl+Shift+P` → **"Axon: VSCode - Exclude Folders"**

## 🔧 고급 기능

### Source Mirror 설정

Yocto 다운로드 시간을 대폭 단축할 수 있습니다:

1. Settings에서 `axon.yocto.sourceMirror` 설정
2. 기존 프로젝트의 `downloads` 폴더 경로 입력
3. 새 프로젝트 생성 시 자동으로 재사용

### Build Tools 재사용

빌드 도구를 재사용하여 설치 시간을 절약할 수 있습니다:

1. Settings에서 `axon.yocto.buildtool` 설정
2. 기존 프로젝트의 `buildtools` 경로 입력
3. 새 프로젝트에서 자동으로 심볼릭 링크 생성

### Git Repository URL 커스터마이징

회사 내부 Git 서버를 사용하는 경우:

- `axon.yocto.autolinuxGitUrl`: Autolinux 스크립트 URL
- `axon.yocto.manifestGitUrl`: Manifest 저장소 URL
- `axon.mcu.gitUrl`: MCU 프로젝트 URL

## 🐛 문제 해결

### FWDN이 실행되지 않을 때

1. Windows 로컬 환경에서 실행 중인지 확인
2. Settings에서 `axon.fwdn.exePath` 확인
3. 비어있으면 내장 fwdn.exe 사용 (권장)

### 빌드가 실패할 때

1. Output 로그 확인 (`Ctrl+Shift+U` → "Axon")
2. 원격 환경(WSL/SSH) 연결 확인
3. 프로젝트 경로가 올바른지 확인

### 프로젝트 루트를 찾지 못할 때

1. 워크스페이스 폴더가 프로젝트 루트 또는 상위 폴더인지 확인
2. `mcu-tcn100x` 또는 `build-axon` 폴더가 있는지 확인

## 📚 추가 정보

### 지원하는 프로젝트 타입

- **MCU Standalone**: Cortex-M 기반 MCU 개발
- **Yocto (Autolinux)**: Embedded Linux 시스템 개발

### 지원하는 MCU 코어

- **M7-NP**: Cortex-M7 Non-Preemptive
- **M7-0**: Cortex-M7 Core 0
- **M7-2**: Cortex-M7 Core 2
- **M7-1**: Cortex-M7 Core 1

### 원격 환경 지원

이 확장 프로그램은 원격 개발 환경을 완벽하게 지원합니다:

- **WSL (Windows Subsystem for Linux)**
- **SSH Remote**
- **Dev Containers**

모든 빌드 작업은 원격 리눅스 환경에서 실행되며, FWDN만 Windows 로컬에서 실행됩니다.

## 📄 라이선스

MIT License

## 🤝 기여

버그 리포트나 기능 제안은 환영합니다!

---

**Axon Dev** - Telechips 펌웨어 개발을 더 쉽고 빠르게! 🚀
