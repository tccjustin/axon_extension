#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# devtool modify 후 생성된 bbappend 파일을 자동으로 수정하는 스크립트
# 
# 사용법:
#   ./fix-devtool-bbappend.sh <recipe-name> [version]
#   
# 예제:
#   ./fix-devtool-bbappend.sh linux-telechips 5.10
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YOCTO_ROOT="${SCRIPT_DIR}"
POKY_DIR="${YOCTO_ROOT}/poky"

# 인자 확인
if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <recipe-name> [version]"
    echo "Example: $0 linux-telechips 5.10"
    exit 1
fi

RECIPE_PN="${1}"
RECIPE_VER="${2:-}"

# workspace layer 찾기
# build/tcn1000 또는 build/tcn1000-mcu 경로도 확인
WORKSPACE_LAYERS=(
    "${YOCTO_ROOT}/workspace"
    "${YOCTO_ROOT}/local-sources/${RECIPE_PN}"
    "${YOCTO_ROOT}/yocto-workspace/sources"
    "${YOCTO_ROOT}/build/tcn1000/local-sources/${RECIPE_PN}"
    "${YOCTO_ROOT}/build/tcn1000-mcu/local-sources/${RECIPE_PN}"
)

WORKSPACE_LAYER=""
for layer in "${WORKSPACE_LAYERS[@]}"; do
    if [[ -d "${layer}" ]]; then
        WORKSPACE_LAYER="${layer}"
        break
    fi
done

if [[ -z "${WORKSPACE_LAYER}" ]]; then
    echo "ERROR: workspace layer를 찾을 수 없습니다."
    echo "다음 경로들을 확인했습니다:"
    for layer in "${WORKSPACE_LAYERS[@]}"; do
        echo "  - ${layer}"
    done
    exit 1
fi

echo "Workspace layer: ${WORKSPACE_LAYER}"

# bbappend 파일 찾기
BBAPPEND_FILES=()
if [[ -n "${RECIPE_VER}" ]]; then
    # 버전 지정된 경우
    BBAPPEND_FILES+=("${WORKSPACE_LAYER}/appends/${RECIPE_PN}_${RECIPE_VER}.bbappend")
else
    # 버전 미지정 - 모든 버전 찾기
    while IFS= read -r -d '' file; do
        BBAPPEND_FILES+=("$file")
    done < <(find "${WORKSPACE_LAYER}/appends" -name "${RECIPE_PN}*.bbappend" -print0 2>/dev/null || true)
fi

if [[ ${#BBAPPEND_FILES[@]} -eq 0 ]]; then
    echo "ERROR: ${RECIPE_PN}에 대한 bbappend 파일을 찾을 수 없습니다."
    echo "경로: ${WORKSPACE_LAYER}/appends/"
    exit 1
fi

# 첫 번째 파일 사용
BBAPPEND_PATH="${BBAPPEND_FILES[0]}"
echo "Found bbappend: ${BBAPPEND_PATH}"

# 버전 추출 (파일명에서)
if [[ -z "${RECIPE_VER}" ]]; then
    RECIPE_VER=$(basename "${BBAPPEND_PATH}" | sed -n "s/${RECIPE_PN}_\(.*\)\.bbappend/\1/p")
    echo "Detected version: ${RECIPE_VER}"
fi

# 원본 레시피 파일 찾기
RECIPE_PATHS=(
    "${POKY_DIR}/meta-telechips-bsp/recipes-kernel/linux/${RECIPE_PN}_${RECIPE_VER}.bb"
    "${POKY_DIR}/meta-telechips/meta-core/recipes-kernel/linux/${RECIPE_PN}_${RECIPE_VER}.bb"
)

RECIPE_FILE=""
for recipe in "${RECIPE_PATHS[@]}"; do
    if [[ -f "${recipe}" ]]; then
        RECIPE_FILE="${recipe}"
        break
    fi
done

if [[ -z "${RECIPE_FILE}" ]]; then
    echo "WARNING: 원본 레시피 파일을 찾을 수 없습니다."
    echo "다음 경로들을 확인했습니다:"
    for recipe in "${RECIPE_PATHS[@]}"; do
        echo "  - ${recipe}"
    done
    SRC_URI_LINE=""
else
    echo "Found recipe: ${RECIPE_FILE}"
    
    # 원본 레시피에서 SRC_URI 추출
    SRC_URI_LINE=$(grep -m1 '^SRC_URI\s*=' "${RECIPE_FILE}" | sed 's/^SRC_URI\s*=\s*//; s/^"//; s/"$//' || true)
    echo "Original SRC_URI: ${SRC_URI_LINE}"
fi

# bbappend 파일 백업
BACKUP_PATH="${BBAPPEND_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
cp "${BBAPPEND_PATH}" "${BACKUP_PATH}"
echo "Backup created: ${BACKUP_PATH}"

# 임시 파일 생성
TEMP_FILE=$(mktemp)
trap "rm -f ${TEMP_FILE}" EXIT

# bbappend 파일 재구성
echo "Reconstructing bbappend file..."

# 1단계: 헤더 부분 복사 (FILESEXTRAPATHS, FILESPATH, srctreebase 주석)
while IFS= read -r line; do
    if [[ "$line" =~ ^FILESEXTRAPATHS ]] || \
       [[ "$line" =~ ^FILESPATH ]] || \
       [[ "$line" =~ ^#.*srctreebase ]]; then
        echo "$line" >> "${TEMP_FILE}"
    elif [[ "$line" =~ ^inherit.*externalsrc ]]; then
        break
    elif [[ -z "$line" ]]; then
        echo "$line" >> "${TEMP_FILE}"
    fi
done < "${BBAPPEND_PATH}"

# 2단계: 필터링 블록 추가
cat >> "${TEMP_FILE}" <<'EOF'

# externalsrc 사용 시 원격 git 항목은 Fetch 해석에서 제외
EOF

# SRC_URI:remove 추가 (원본 레시피의 URL이 있으면)
if [[ -n "${SRC_URI_LINE}" ]]; then
    echo "SRC_URI:remove = \"${SRC_URI_LINE}\"" >> "${TEMP_FILE}"
    echo "" >> "${TEMP_FILE}"
fi

# Python 필터 추가
cat >> "${TEMP_FILE}" <<'EOF'
# externalsrc 사용 시 SRC_URI에서 원격 git/ssh/http(s) 항목 완전히 제거
python () {
    src_uri = (d.getVar('SRC_URI') or '').split()
    filtered = []
    for u in src_uri:
        if u.startswith('git://') or u.startswith('ssh://') or u.startswith('http://') or u.startswith('https://'):
            continue
        if ('.git' in u) and (not u.startswith('file://')):
            continue
        filtered.append(u)
    d.setVar('SRC_URI', ' '.join(filtered))
}

EOF

# 3단계: 나머지 부분 (inherit externalsrc 이후) 추가
COPY_REST=false
while IFS= read -r line; do
    if [[ "$line" =~ ^inherit.*externalsrc ]]; then
        COPY_REST=true
    fi
    if [[ "${COPY_REST}" == true ]]; then
        echo "$line" >> "${TEMP_FILE}"
    fi
done < "${BBAPPEND_PATH}"

# 원본 파일 교체
mv "${TEMP_FILE}" "${BBAPPEND_PATH}"

echo ""
echo "✓ bbappend 파일이 성공적으로 수정되었습니다!"
echo ""
echo "수정된 파일: ${BBAPPEND_PATH}"
echo "백업 파일: ${BACKUP_PATH}"
echo ""
echo "다음 단계:"
echo "  1. bbappend 파일을 확인하세요: cat ${BBAPPEND_PATH}"
echo "  2. 빌드를 시도하세요: devtool build ${RECIPE_PN}"

