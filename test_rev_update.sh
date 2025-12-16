#!/bin/bash

# ==========================================================
# 테스트용 파라미터 설정 (사용자 환경에 맞게 수정 필요)
# ==========================================================

# 1. 레시피 이름 (테스트하려는 레시피)
RECIPE_PN="linux-telechips"

# 2. 소스 코드 경로 (Git 저장소가 있는 경로)
# 예: 현재 디렉토리를 소스 경로로 가정하거나, 실제 경로 입력
SRC_TREE_PATH="./mock_source_tree"

# 3. telechips-cgw-rev.inc 파일 경로 (테스트용 가짜 파일 생성 경로)
INC_FILE="./telechips-cgw-rev.inc"


# ==========================================================
# 테스트 환경 준비 (실제 환경에서는 불필요)
# ==========================================================
echo "🛠️  [테스트 환경 준비]"

# 가짜 소스 트리 및 git 환경 생성
if [ ! -d "${SRC_TREE_PATH}" ]; then
    mkdir -p "${SRC_TREE_PATH}"
    cd "${SRC_TREE_PATH}"
    git init -q
    touch README.md
    git add README.md
    git commit -m "Initial commit" -q
    cd - > /dev/null
    echo "✅ 가짜 Git 저장소 생성: ${SRC_TREE_PATH}"
fi

# 가짜 inc 파일 생성 (초기값 설정)
if [ ! -f "${INC_FILE}" ]; then
    echo 'KERNEL_BRANCH_DEV_SRC = "old_commit_id_12345"' > "${INC_FILE}"
    echo 'MCU_BRANCH_DEV = "old_commit_id_67890"' >> "${INC_FILE}"
    echo "✅ 가짜 inc 파일 생성: ${INC_FILE}"
fi

echo "----------------------------------------------------------"
echo ""

# ==========================================================
# [검증 대상 스크립트 시작]
# extension.ts에 포함된 로직과 동일
# ==========================================================

echo "🔍 Source Tree: ${SRC_TREE_PATH}"
echo "🔍 Target Inc File: ${INC_FILE}"

# 1. Git Commit ID 가져오기
if [ -d "${SRC_TREE_PATH}" ]; then
    cd "${SRC_TREE_PATH}"
    COMMIT_ID=$(git rev-parse HEAD)
    echo "✅ Git Commit ID: ${COMMIT_ID}"
    cd - > /dev/null # 다시 원래 위치로 복귀
else
    echo "❌ ERROR: 소스 디렉토리를 찾을 수 없습니다: ${SRC_TREE_PATH}"
    exit 1
fi

if [ ! -f "${INC_FILE}" ]; then
    echo "❌ ERROR: telechips-cgw-rev.inc 파일을 찾을 수 없습니다: ${INC_FILE}"
    exit 1
fi

# 2. 레시피별 변수명 결정
TARGET_VAR=""
case "${RECIPE_PN}" in
    "linux-telechips")
        TARGET_VAR="KERNEL_BRANCH_DEV_SRC"
        ;;
    "m7-0"|"m7-1"|"m7-2"|"m7-np")
        TARGET_VAR="MCU_BRANCH_DEV"
        ;;
    "dpi-app")
        TARGET_VAR="DPI_APP_BRANCH_DEV_SRC"
        ;;
    "tpa-app")
        TARGET_VAR="TPA_APP_BRANCH_DEV_SRC"
        ;;
    "u-boot-tcc")
        TARGET_VAR="UBOOT_BRANCH_DEV_SRC"
        ;;
    *)
        echo "⚠️ 알림: '${RECIPE_PN}' 레시피는 telechips-cgw-rev.inc 자동 업데이트 대상이 아닙니다."
        # 에러는 아님
        ;;
esac

# 3. 파일 수정
if [ -n "${TARGET_VAR}" ]; then
    echo "📝 ${INC_FILE} 업데이트 중..."
    echo "   변수: ${TARGET_VAR}"
    echo "   값: ${COMMIT_ID}"
    
    # 백업 생성
    cp "${INC_FILE}" "${INC_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    
    # sed를 사용하여 변수 값 변경 (공백 처리 강화)
    # VAR = "VALUE" 또는 VAR="VALUE" 형태 모두 처리
    # (주의: 스크립트 파일에서는 백슬래시 이스케이프가 extension.ts 문자열 내부와 다릅니다)
    sed -i "s/^\(\s*${TARGET_VAR}\s*=\s*\).*/\1\"${COMMIT_ID}\"/" "${INC_FILE}"
    
    # 변경 확인 (grep으로 찾기만 하지 않고, 실제 변경되었는지 체크)
    if grep -q "${TARGET_VAR}.*${COMMIT_ID}" "${INC_FILE}"; then
        echo "✅ 업데이트 완료: ${TARGET_VAR} = ${COMMIT_ID}"
    else
        echo "❌ 업데이트 실패: sed 치환이 적용되지 않았습니다."
        echo "   현재 파일 내용:"
        grep "${TARGET_VAR}" "${INC_FILE}"
        
        # 디버깅: 파일 전체 내용 출력
        echo "--- File Content ---"
        cat "${INC_FILE}"
        echo "--------------------"
        exit 1
    fi
fi




