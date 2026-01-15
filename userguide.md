# Axon VS Code Extension - 사용자 가이드

## 목차
- [소개](#소개)
- [시작하기](#시작하기)
- [Create Projects View](#create-projects-view)
- [Configurations View](#configurations-view)
- [Build View](#build-view)
  - [MCU 메뉴](#mcu-메뉴)
  - [Yocto 메뉴](#yocto-메뉴)
  - [DevTool 메뉴](#devtool-메뉴)
- [설정 가이드](#설정-가이드)
- [FAQ](#faq)

---

## 소개

Axon VS Code Extension은 Telechips MCU 및 Yocto 프로젝트 개발을 위한 통합 개발 환경을 제공합니다. 이 확장 프로그램은 프로젝트 생성, 빌드, 설정 관리, 펌웨어 다운로드 등의 작업을 GUI 환경에서 간편하게 수행할 수 있도록 지원합니다.

### 주요 기능
- MCU Standalone 및 Yocto 프로젝트 생성
- 빌드 자동화 (AP, MCU, Kernel)
- DevTool을 통한 외부 소스 관리
- FWDN 펌웨어 다운로드
- 설정 파일 관리
- WSL 및 SSH 원격 환경 지원

---

## 시작하기

### 설치
1. VS Code 좌측 Activity Bar에서 **Axon** 아이콘을 클릭합니다.
2. 세 가지 뷰가 표시됩니다:
   - **Create Projects**: 프로젝트 생성
   - **Configurations**: 설정 관리
   - **Build**: 빌드 및 실행

### 초기 설정
처음 사용 시 다음 항목들을 설정해야 합니다:
1. **FWDN 실행 파일 경로**: `fwdn.exe` 위치 지정
2. **Build 폴더명**: `mcu-tcn100x` 또는 `build-axon`
3. **Boot Firmware 폴더명**: `boot-firmware-tcn100x` 또는 `boot-firmware_tcn1000`

> **팁**: 대부분의 설정은 자동으로 감지되며, 필요 시에만 수동 설정이 요구됩니다.

---

## Create Projects View

프로젝트 생성을 위한 위저드를 제공합니다.

### MCU Standalone Project

**용도**: MCU 독립형 프로젝트를 생성합니다.

**실행 방법**:
1. `Create Projects` → `MCU Standalone Project` 클릭
2. 위저드 다이얼로그가 표시됩니다:
   - **프로젝트 이름**: 새로 생성할 프로젝트 이름 입력
   - **Base 프로젝트**: 복사할 기존 프로젝트 선택
   - **저장 위치**: 프로젝트를 생성할 폴더 선택

**생성 결과**:
- 선택한 base 프로젝트가 복사됩니다.
- 프로젝트 구조가 자동으로 설정됩니다.
- 워크스페이스에 새 프로젝트가 추가됩니다.

**사용 시나리오**:
- 새로운 MCU 펌웨어 개발 시작
- 기존 프로젝트를 템플릿으로 활용
- 멀티 코어(M7-NP, M7-0, M7-1, M7-2) 개발

---

### Yocto Project

**용도**: Yocto 기반 리눅스 프로젝트를 생성합니다.

**실행 방법**:
1. `Create Projects` → `Yocto Project` 클릭
2. 위저드 다이얼로그가 표시됩니다:
   - **프로젝트 이름**: 새로 생성할 프로젝트 이름 입력
   - **Base 프로젝트**: 복사할 기존 프로젝트 선택
   - **저장 위치**: 프로젝트를 생성할 폴더 선택

**생성 결과**:
- Yocto 프로젝트 구조가 복사됩니다.
- `poky`, `build-axon`, `boot-firmware_tcn1000` 등의 폴더 구조
- 빌드 환경 초기화 준비 완료

**사용 시나리오**:
- 리눅스 기반 AP 개발
- Yocto 레이어 커스터마이징
- 커널 및 루트 파일시스템 빌드

---

## Configurations View

Yocto 프로젝트의 설정 파일을 편집할 수 있는 메뉴입니다.

### Yocto 설정

#### 1. AP : conf/local.conf

**파일 경로**: `build-axon/build/tcn1000/conf/local.conf`

**용도**: Yocto AP(Application Processor) 빌드 설정을 구성합니다.

**주요 설정 항목**:
- `MACHINE`: 타겟 머신 정의
- `DISTRO`: 배포판 설정
- `PARALLEL_MAKE`: 병렬 빌드 작업 수
- `BB_NUMBER_THREADS`: BitBake 스레드 수
- `SSTATE_DIR`, `DL_DIR`: 캐시 디렉토리 경로

**수정 시나리오**:
- 빌드 성능 최적화 (병렬 작업 수 조정)
- 추가 레이어나 패키지 포함
- 디버그 모드 활성화

---

#### 2. MCU : conf/local.conf

**파일 경로**: `build-axon/build/tcn1000-mcu/conf/local.conf`

**용도**: Yocto MCU 빌드 설정을 구성합니다.

**주요 설정 항목**:
- MCU 펌웨어 빌드 관련 설정
- 멀티 코어 빌드 옵션
- 최적화 플래그

**수정 시나리오**:
- MCU 펌웨어 빌드 옵션 변경
- 코어별 빌드 설정 조정

---

#### 3. Modify : branch/srcrev

**파일 경로**: `poky/meta-telechips/meta-dev/telechips-cgw-rev.inc`

**용도**: Git 브랜치 및 소스 리비전(SRCREV)을 관리합니다.

**주요 설정 항목**:
```bash
BRANCH_pn-<recipe-name> = "develop"
SRCREV_pn-<recipe-name> = "${AUTOREV}"
```

**수정 시나리오**:
- 특정 소스 버전 고정
- 개발 브랜치 전환
- 의존성 레시피 버전 관리

**주의사항**:
- `${AUTOREV}` 사용 시 항상 최신 커밋을 가져옵니다.
- 특정 커밋을 사용하려면 커밋 해시로 변경하세요.

---

## Build View

프로젝트 빌드 및 실행을 위한 메인 메뉴입니다.

---

## MCU 메뉴

MCU Standalone 프로젝트 빌드를 위한 메뉴입니다.

### Select Core

**용도**: 빌드할 MCU 코어를 선택합니다.

**지원 코어**:
- `m7-np`: M7 Non-secure Processing
- `m7-0`: M7 Core 0
- `m7-1`: M7 Core 1
- `m7-2`: M7 Core 2

**실행 방법**:
1. `Build` → `MCU` → `Select Core` 클릭
2. QuickPick에서 원하는 코어 선택
3. 선택된 코어가 메뉴에 표시됩니다: `Select Core (현재: m7-0)`

**참고**:
- 선택한 코어는 `Build Make` 명령에서 사용됩니다.
- 코어를 변경하지 않으면 마지막 선택이 유지됩니다.

---

### Build All

**용도**: 모든 MCU 코어를 순차적으로 빌드합니다.

**빌드 순서**:
1. m7-np
2. m7-0
3. m7-2
4. m7-1

**실행 명령**:
```bash
cd mcu-tcn100x && make clean && make all
```

**사용 시나리오**:
- 전체 펌웨어 통합 빌드
- 릴리스 빌드 생성
- 모든 코어 동기화

**소요 시간**: 프로젝트 규모에 따라 5~15분

---

### Build Make

**용도**: 선택된 단일 코어만 빌드합니다.

**실행 명령**:
```bash
cd mcu-tcn100x && make clean_<core> && make <core>
```

**사용 시나리오**:
- 특정 코어만 수정 후 빌드
- 빠른 반복 개발
- 개별 코어 테스트

**주의사항**:
- 먼저 `Select Core`로 코어를 선택해야 합니다.
- 선택된 코어가 없으면 경고 메시지가 표시됩니다.

---

### Clean

**용도**: MCU 빌드 산출물을 삭제합니다.

**실행 명령**:
```bash
cd mcu-tcn100x && make clean
```

**삭제 대상**:
- 컴파일된 오브젝트 파일 (`.o`)
- 링크된 바이너리 (`.bin`, `.elf`)
- 임시 파일

**사용 시나리오**:
- 빌드 오류 해결
- 클린 빌드 수행
- 디스크 공간 확보

---

### FWDN

**용도**: MCU 펌웨어를 타겟 보드에 다운로드합니다.

**실행 방법**:
1. `Build` → `MCU` → `FWDN` 클릭
2. **확인 팝업**이 표시됩니다:
   > FWDN (펌웨어 다운로드)을 실행하시겠습니까?
   > 
   > [경고] 타겟 보드에 펌웨어가 다운로드됩니다.
3. **실행** 버튼을 클릭하면 FWDN이 시작됩니다.

**다운로드 단계** (FWDN ALL):
1. **Step 1**: Boot Firmware 다운로드
2. **Step 2**: DRAM 초기화
3. **Step 3**: AP 펌웨어 다운로드
4. **Step 4**: MCU 펌웨어 다운로드

**완료 후**:
- 자동으로 터미널 창이 닫힙니다.
- 성공 메시지가 표시됩니다.

**사전 요구사항**:
- `fwdn.exe` 경로 설정
- Boot Firmware 폴더 존재
- USB 연결된 타겟 보드

**주의사항**:
- [경고] 다운로드 중 USB 연결을 해제하지 마세요.
- [경고] 타겟 보드의 기존 펌웨어가 덮어씌워집니다.

---

## Yocto 메뉴

Yocto 프로젝트 빌드를 위한 메뉴입니다.

### Build AP

**용도**: Yocto AP(Application Processor) 이미지를 빌드합니다.

**실행 명령**:
```bash
cd build-axon
source poky/oe-init-build-env build/tcn1000
bitbake telechips-cgw-image-dev-qt
```

**빌드 결과**:
- 루트 파일시스템 이미지
- 커널 이미지 (uImage)
- 디바이스 트리 (DTB)
- 부트로더 (U-Boot)

**생성 위치**: `build-axon/build/tcn1000/tmp/deploy/images/`

**소요 시간**: 
- 초기 빌드: 2~4시간
- 증분 빌드: 10~30분

**사용 시나리오**:
- 리눅스 시스템 이미지 생성
- 애플리케이션 통합
- 시스템 업데이트

---

### Build MCU

**용도**: Yocto 환경에서 MCU 펌웨어를 빌드합니다.

**실행 명령**:
```bash
cd build-axon
source poky/oe-init-build-env build/tcn1000-mcu
bitbake telechips-cgw-mcu-image
```

**빌드 결과**:
- MCU 펌웨어 바이너리
- 각 코어별 펌웨어 (m7-np, m7-0, m7-1, m7-2)

**사용 시나리오**:
- Yocto 통합 빌드 환경에서 MCU 펌웨어 빌드
- AP-MCU 통합 시스템 구성

---

### Build Kernel

**용도**: 리눅스 커널을 빌드하고 `SD_fai.rom` 파일을 생성합니다.

**실행 명령**:
```bash
cd build-axon
source poky/oe-init-build-env build/tcn1000
bitbake linux-telechips
bitbake linux-telechips -c make_fai
```

**빌드 결과**:
- `linux-telechips` 커널 이미지
- `SD_fai.rom`: FWDN용 커널 이미지 파일

**사용 시나리오**:
- 커널 수정 후 빌드
- 커널 모듈 업데이트
- 드라이버 개발

**주의사항**:
- `make_fai` 태스크는 `linux-telechips` 레시피에서만 실행됩니다.

---

### FWDN

**용도**: Yocto 빌드 결과물을 타겟 보드에 다운로드합니다.

**실행 방법**:
1. `Build` → `Yocto` → `FWDN` 클릭
2. **확인 팝업**이 표시됩니다
3. **실행** 버튼 클릭

**다운로드 내용**:
- Boot Firmware
- AP 이미지 (루트 파일시스템, 커널)
- MCU 펌웨어

**사용 시나리오**:
- Yocto 빌드 후 보드에 배포
- 통합 시스템 테스트

---

### Clean AP

**용도**: Yocto AP 빌드 디렉토리를 정리합니다.

**실행 명령**:
```bash
cd build-axon
source poky/oe-init-build-env build/tcn1000
bitbake telechips-cgw-image-dev-qt -c clean
```

**삭제 대상**:
- 컴파일된 패키지
- 임시 빌드 파일

**주의사항**:
- shared state cache는 유지됩니다.
- 다음 빌드가 증분 빌드로 진행됩니다.

---

### Clean MCU

**용도**: Yocto MCU 빌드 디렉토리를 정리합니다.

**실행 명령**:
```bash
cd build-axon
source poky/oe-init-build-env build/tcn1000-mcu
bitbake telechips-cgw-mcu-image -c clean
```

**사용 시나리오**:
- MCU 펌웨어 클린 빌드

---

### Clean All

**용도**: AP와 MCU 빌드 디렉토리를 모두 정리합니다.

**실행 순서**:
1. Clean AP
2. Clean MCU
3. 완료 대기 (5초)

**사용 시나리오**:
- 전체 클린 빌드 준비
- 빌드 오류 해결
- 디스크 공간 확보

**소요 시간**: 5~15분

---

## DevTool 메뉴

외부 소스 코드를 Yocto 프로젝트에 통합하여 개발하는 메뉴입니다.

### Setup External Source (modify)

**용도**: `devtool modify`를 실행하여 외부 소스를 Yocto 워크스페이스에 설정합니다.

**실행 방법**:
1. `Build` → `DevTool` → `Setup External Source (modify)` 클릭
2. **레시피 이름** 입력 (예: `telechips-cgw-app`)
3. **빌드 타입** 선택:
   - AP: `build/tcn1000`
   - MCU: `build/tcn1000-mcu`

**실행 명령**:
```bash
cd build-axon
source poky/oe-init-build-env <build-dir>
devtool create-workspace local-sources/<recipe-name>
devtool modify <recipe-name>
```

**결과**:
- `local-sources/<recipe-name>` 폴더에 소스 코드가 복사됩니다.
- `.bbappend` 파일이 자동 생성됩니다.
- 소스 수정 후 바로 빌드 가능한 환경이 구성됩니다.

**자동 수정 스크립트**:
- `fix-devtool-bbappend.sh` 스크립트가 실행되어 `.bbappend` 파일을 올바르게 수정합니다.

**성공 메시지**:
```
==========================================
DevTool Setup이 성공적으로 완료되었습니다!
   레시피: telechips-cgw-app
   빌드 환경: build/tcn1000
==========================================
```

**사용 시나리오**:
- 외부 Git 저장소의 소스 코드 개발
- 레시피 소스를 로컬에서 수정
- 반복적인 빌드-테스트 사이클

---

### {레시피명} build

**용도**: DevTool로 설정된 레시피를 빌드합니다.

**실행 방법**:
1. `Build` → `DevTool` → `{레시피명} build` 클릭
2. 자동으로 해당 레시피가 빌드됩니다.

**실행 명령**:
```bash
cd build-axon
source poky/oe-init-build-env <build-dir>
devtool build <recipe-name>
```

**추가 동작** (linux-telechips 레시피):
```bash
bitbake linux-telechips -c make_fai
```

**성공 메시지**:
```
==========================================
DevTool Build가 성공적으로 완료되었습니다!
   레시피: telechips-cgw-app
   빌드 환경: build/tcn1000
==========================================
```

**사용 시나리오**:
- 소스 수정 후 증분 빌드
- 빠른 반복 개발
- 특정 컴포넌트만 빌드

**장점**:
- 전체 이미지 빌드보다 훨씬 빠름
- 수정한 소스만 재컴파일
- 즉시 결과 확인 가능

---

### FWDN

**용도**: DevTool 빌드 후 타겟 보드에 펌웨어를 다운로드합니다.

**실행 방법**:
1. `Build` → `DevTool` → `FWDN` 클릭
2. 확인 팝업에서 **실행** 클릭

**사용 시나리오**:
- DevTool 빌드 후 즉시 보드에 배포
- 반복 개발 워크플로우: 수정 → 빌드 → FWDN → 테스트

---

## 설정 가이드

### FWDN 실행 파일 경로 설정

**설정 위치**: `.vscode/settings.json`

```json
{
  "axon.fwdn.exePath": "C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe"
}
```

**설정 방법**:
1. Command Palette (`Ctrl+Shift+P`) 실행
2. `Axon: Configure Settings` 선택
3. `FWDN 실행 파일 경로 설정` 선택
4. `fwdn.exe` 파일 선택

---

### Boot Firmware 폴더명 설정

**설정 위치**: `.vscode/settings.json`

```json
{
  "axon.bootFirmwareFolderName": "boot-firmware_tcn1000"
}
```

**선택 가능한 값**:
- `boot-firmware-tcn100x`: MCU Standalone 프로젝트용
- `boot-firmware_tcn1000`: Yocto 프로젝트용

---

### WSL Distro 이름 설정

**설정 위치**: `.vscode/settings.json`

```json
{
  "axon.wsl.distroName": "Ubuntu"
}
```

**용도**: WSL 환경에서 `\\wsl$` 경로 변환에 사용됩니다.

**일반적인 값**:
- `Ubuntu`
- `Ubuntu-20.04`
- `Debian`

---

## FAQ

### Q1. FWDN이 실행되지 않아요.

**A**: 다음 항목들을 확인하세요:
1. `fwdn.exe` 경로가 올바르게 설정되었는지 확인
2. Boot Firmware 폴더가 워크스페이스에 존재하는지 확인
3. USB 케이블이 타겟 보드에 연결되었는지 확인
4. 타겟 보드가 FWDN 모드로 부팅되었는지 확인

---

### Q2. Yocto 빌드가 너무 오래 걸려요.

**A**: 빌드 성능 최적화 방법:
1. `conf/local.conf`에서 병렬 작업 수 증가:
   ```bash
   BB_NUMBER_THREADS = "8"
   PARALLEL_MAKE = "-j 8"
   ```
2. SSD에 빌드 디렉토리 위치시키기
3. Shared State Cache (`SSTATE_DIR`) 활용
4. Docker 대신 WSL 또는 네이티브 리눅스 사용

---

### Q3. DevTool modify 후 소스가 보이지 않아요.

**A**: 다음을 확인하세요:
1. `local-sources/<recipe-name>` 폴더 확인
2. DevTool 실행 로그에서 오류 메시지 확인
3. 레시피 이름이 올바른지 확인
4. 빌드 타입(AP/MCU)이 올바른지 확인

---

### Q4. MCU Build Make가 "코어를 선택하세요" 오류가 나요.

**A**: 먼저 `Select Core` 메뉴에서 빌드할 코어를 선택하세요.

---

### Q5. SSH 원격 환경에서 FWDN이 실행되지 않아요.

**A**: FWDN은 로컬 Windows 환경에서만 실행됩니다. SSH 환경에서는 자동으로 로컬 터미널을 생성하여 실행합니다. Samba 경로 설정을 확인하세요.

---

### Q6. 빌드 중 "No such file or directory" 오류가 발생해요.

**A**: 원격 환경 설정을 확인하세요:
1. SSH 또는 WSL 연결이 정상인지 확인
2. 프로젝트 경로에 공백이나 특수문자가 없는지 확인
3. 파일 시스템 권한 확인

---

### Q7. DevTool 레시피 목록에서 항목을 삭제하고 싶어요.

**A**: `.vscode/settings.json` 파일을 열어 `axon.devtool.recipes` 배열에서 항목을 직접 삭제하세요:

```json
{
  "axon.devtool.recipes": [
    "telechips-cgw-app",
    "linux-telechips"
  ]
}
```

---

### Q8. Yocto 빌드가 디스크 공간 부족으로 실패해요.

**A**: 다음 방법으로 공간을 확보하세요:
1. `Clean All` 실행
2. `tmp` 폴더 삭제: `rm -rf build/tcn1000/tmp`
3. `sstate-cache` 정리: `rm -rf build/sstate-cache/*`
4. `downloads` 폴더 정리 (선택사항)

**권장 여유 공간**: 최소 100GB 이상

---

## 문의 및 지원

이슈나 문의사항이 있으시면 다음 채널을 이용해주세요:
- GitHub Issues: [axon_extension](https://github.com/tccjustin/axon_extension)
- 이메일: [지원팀 이메일]

---

## 버전 정보

**현재 버전**: 0.4.1

**주요 업데이트**:
- FWDN 확인 팝업 추가
- DevTool 메뉴에 FWDN 추가
- 모든 빌드 명령어 스크립트 파일 방식으로 실행
- DevTool UI 텍스트 개선
- 빌드 완료 메시지 추가

---

**마지막 업데이트**: 2024년 11월 12일
