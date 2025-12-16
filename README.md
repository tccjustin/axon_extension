# Axon

VS Code 확장 프로그램으로, MCU/Yocto 펌웨어 개발을 위한 빌드 및 배포 자동화 도구입니다.

## ✨ 주요 기능

### 프로젝트 생성
- **MCU Standalone 프로젝트 생성**: MCU 개발 환경 자동 구성
- **Yocto 프로젝트 생성**: Yocto 빌드 환경 자동 구성

### MCU 빌드
- **MCU Build Make**: 선택한 코어(m7-0, m7-1, m5-0)에 대해 make 빌드 실행
- **MCU Build All**: 모든 defconfig(tcn100x_m70_defconfig, tcn100x_m71_defconfig, tcn100x_m50_defconfig)를 한번에 빌드
- **MCU Select Core**: 빌드할 MCU 코어 선택
- **MCU Clean**: 빌드 결과물 정리

### Yocto 빌드
- **Build Yocto AP**: AP 이미지 빌드
- **Build Yocto MCU**: MCU 이미지 빌드
- **Build Yocto Kernel**: 커널 빌드
- **Clean Yocto AP/MCU/All**: 빌드 결과물 정리
- **Edit AP/MCU local.conf**: Yocto 빌드 설정 파일 편집
- **Edit Branch/Srcrev**: 소스 버전 관리 파일 편집

### FWDN (펌웨어 다운로드)
- **FWDN ALL**: 전체 펌웨어 다운로드 (로컬 Windows 환경 전용)

### 설정 관리
- **Configure Settings**: FWDN 경로, 프로젝트 타입, WSL 설정 등 관리
- **Configure Project Folder**: 프로젝트 폴더명 설정
- **Configure Boot Firmware Folder**: Boot Firmware 폴더명 설정

### 스크립트 관리
- **Build and Copy Scripts**: MCU 빌드 스크립트 자동 복사

### 사이드바 뷰
- **Create Projects**: 프로젝트 생성 관련 명령어 모음
- **Configurations**: 설정 관련 명령어 모음
- **Build**: 빌드 관련 명령어 모음

## 📋 요구 사항

- **VS Code**: 1.74.0 이상
- **개발 환경**: WSL 또는 SSH 리눅스 환경 (FWDN 제외)
- **FWDN 실행**: Windows 로컬 환경 (fwdn.exe)
- **빌드/개발**: WSL 또는 SSH 리눅스 환경

## 📦 설치 방법

### 1. VSIX 파일로 설치

```bash
# 로컬 VS Code에 설치
code --install-extension axon-0.4.1.vsix
```

## 🚀 사용 방법

### 프로젝트 생성

1. **사이드바에서 Axon 아이콘 클릭**
2. **Create Projects 뷰에서 원하는 프로젝트 타입 선택**:
   - `Create MCU Standalone Project`: MCU 단독 개발 환경
   - `Create Yocto Project`: Yocto 통합 빌드 환경

### MCU 빌드

#### 특정 코어 빌드

1. **Command Palette** (`Ctrl+Shift+P`) 열기
2. **"Axon: MCU Select Core"** 실행
3. 빌드할 코어 선택 (m7-0, m7-1, m5-0)
4. **"Axon: MCU Build Make"** 실행

#### 전체 코어 빌드

1. **Command Palette** (`Ctrl+Shift+P`) 열기
2. **"Axon: MCU Build All"** 실행
   - 모든 defconfig(m70, m71, m50)를 순차적으로 빌드

#### 사이드바에서 빌드

1. **사이드바의 Build 뷰**에서 원하는 코어 클릭
2. 빌드가 자동으로 시작됨

### Yocto 빌드

#### AP 빌드

1. **Command Palette** (`Ctrl+Shift+P`) 열기
2. **"Axon: Build Yocto AP"** 실행

#### MCU 빌드

1. **Command Palette** (`Ctrl+Shift+P`) 열기
2. **"Axon: Build Yocto MCU"** 실행

#### 커널 빌드

1. **Command Palette** (`Ctrl+Shift+P`) 열기
2. **"Axon: Build Yocto Kernel"** 실행

#### 설정 파일 편집

1. **Command Palette** (`Ctrl+Shift+P`) 열기
2. 편집할 파일 선택:
   - **"Axon: Edit AP local.conf"**: AP 빌드 설정
   - **"Axon: Edit MCU local.conf"**: MCU 빌드 설정
   - **"Axon: Edit Branch/Srcrev"**: 소스 버전 관리

### FWDN 실행

**⚠️ 주의**: FWDN은 **로컬 Windows 환경**에서만 실행됩니다.

1. **Command Palette** (`Ctrl+Shift+P`) 열기
2. **"Axon: FWDN"** 실행
3. 펌웨어 다운로드가 자동으로 진행됨

### 설정 관리

1. **Command Palette** (`Ctrl+Shift+P`) 열기
2. **"Axon: Configure Settings"** 실행
3. 변경할 설정 선택:
   - **FWDN 실행 파일 경로**: fwdn.exe 위치 설정
   - **프로젝트 타입**: MCU 또는 Yocto 선택
   - **프로젝트 폴더명**: 빌드 폴더 이름 설정
   - **Boot Firmware 폴더명**: Boot Firmware 폴더 이름 설정
   - **WSL Distro 이름**: WSL 배포판 이름 설정

### 빠른 실행

- **사이드바 Axon 아이콘**: 모든 기능에 빠르게 접근
- **Build 뷰**: MCU 코어 클릭으로 즉시 빌드
- **Configurations 뷰**: 설정 관리
- **Create Projects 뷰**: 프로젝트 생성

### Output 로그 확인

1. **View** → **Output** (또는 `Ctrl+Shift+U`)
2. 드롭다운에서 **"Axon"** 선택
3. 모든 빌드 과정과 로그 실시간 확인

## 🔧 공통 함수 (Common Functions)

프로젝트에서 재사용 가능한 공통 함수들이 `src/projects/common/` 디렉토리에 있습니다.

### Shell 유틸리티 (`shell-utils.ts`)

#### `findProjectRootByShell()`

리눅스 shell의 `find` 명령어를 사용하여 프로젝트 루트를 찾는 공통 함수입니다.

**사용 예시:**

```typescript
import { findProjectRootByShell } from '../common/shell-utils';

// Yocto 프로젝트 루트 찾기
const yoctoRoot = await findProjectRootByShell({
  workspaceFolder,
  findPattern: 'poky',
  maxDepth: 3,
  findType: 'd',
  parentLevels: 1,
  excludePattern: '*/.repo/*',
  taskName: 'Find Yocto Project Root',
  taskId: 'find-yocto-root',
  resultFilePrefix: 'axon_project_root'
});

// MCU 프로젝트 루트 찾기
const mcuRoot = await findProjectRootByShell({
  workspaceFolder,
  findPattern: 'tcn100x_defconfig',
  maxDepth: 4,
  findType: 'f',
  parentLevels: 3,
  taskName: 'Find MCU Project Root',
  taskId: 'find-mcu-root',
  resultFilePrefix: 'axon_mcu_project_root'
});
```

**파라미터:**
- `findPattern`: 찾을 파일/디렉토리 이름
- `maxDepth`: 최대 탐색 깊이
- `findType`: 'd' (directory) 또는 'f' (file)
- `parentLevels`: 상위 몇 단계로 올라갈지
- `excludePattern`: 제외할 패턴 (선택적)

**참고:** 비슷한 기능이 필요할 때는 이 함수를 재사용하세요. 중복 구현을 방지합니다.

## 라이선스

MIT
