#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
telechips-cgw-rev.inc 파일 업데이트 스크립트

사용법:
    python3 update_telechips_cgw_rev.py <recipe_name> <source_path> <inc_file_path>

예시:
    python3 update_telechips_cgw_rev.py linux-telechips /path/to/sources/linux-telechips /path/to/telechips-cgw-rev.inc

⚠️ Python 3.6 호환성 유지
"""
import os
import re
import subprocess
import sys
from datetime import datetime


def main():
    if len(sys.argv) != 4:
        print("❌ ERROR: 잘못된 인자 개수")
        print("사용법: python3 update_telechips_cgw_rev.py <recipe_name> <source_path> <inc_file_path>")
        sys.exit(1)

    RECIPE_PN = sys.argv[1]
    SRC_TREE_PATH = sys.argv[2]
    INC_FILE = sys.argv[3]

    print(f"🔍 Source Tree: {SRC_TREE_PATH}")
    print(f"🔍 Target Inc File: {INC_FILE}")

    # 1. Git Commit ID 가져오기
    if not os.path.isdir(SRC_TREE_PATH):
        print(f"❌ ERROR: 소스 디렉토리를 찾을 수 없습니다: {SRC_TREE_PATH}")
        sys.exit(1)

    try:
        # Python 3.6 호환: capture_output 대신 stdout, stderr 사용
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=SRC_TREE_PATH,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,  # Python 3.6에서 text=True 대신 사용
            check=True
        )
        COMMIT_ID = result.stdout.strip()
        print(f"✅ Git Commit ID: {COMMIT_ID}")
    except subprocess.CalledProcessError as e:
        print(f"❌ ERROR: Git commit ID를 가져올 수 없습니다: {e}")
        sys.exit(1)

    if not os.path.isfile(INC_FILE):
        print(f"❌ ERROR: telechips-cgw-rev.inc 파일을 찾을 수 없습니다: {INC_FILE}")
        sys.exit(1)

    # 2. 레시피별 변수명 결정
    # ⚠️ 실제 파일의 변수명 형식: *_BRANCH_DEV_SRC
    # 예: UBOOT_BRANCH_DEV_SRC ?= "${AUTOREV}"
    TARGET_VAR = None
    RECIPE_VAR_MAP = {
        "linux-telechips": "KERNEL_BRANCH_DEV_SRC",
        "m7-0": "MCU_BRANCH_DEV_SRC",
        "m7-1": "MCU_BRANCH_DEV_SRC",
        "m7-2": "MCU_BRANCH_DEV_SRC",
        "m7-np": "MCU_BRANCH_DEV_SRC",
        "dpi-app": "DPI_APP_BRANCH_DEV_SRC",
        "tpa-app": "TPA_APP_BRANCH_DEV_SRC",
        "u-boot-tcc": "UBOOT_BRANCH_DEV_SRC"
    }

    TARGET_VAR = RECIPE_VAR_MAP.get(RECIPE_PN)

    if not TARGET_VAR:
        print(f"⚠️ 알림: '{RECIPE_PN}' 레시피는 telechips-cgw-rev.inc 자동 업데이트 대상이 아닙니다.")
        sys.exit(0)

    # 3. 파일 읽기 및 수정
    print(f"📝 {INC_FILE} 업데이트 체크 중...")
    print(f"   변수: {TARGET_VAR}")

    try:
        with open(INC_FILE, 'r', encoding='utf-8') as f:
            content = f.read()
            lines = content.splitlines()
    except Exception as e:
        print(f"❌ ERROR: 파일을 읽을 수 없습니다: {e}")
        sys.exit(1)

    # 패턴: TARGET_VAR = "${AUTOREV}" 또는 TARGET_VAR ?= "${AUTOREV}"
    # 정규식으로 찾기 (공백, ?=, := 등 모두 허용)
    pattern = re.compile(
        r'^(\s*)(' + re.escape(TARGET_VAR) + r')(\s*)([?:]?=)(\s*)"?\$\{AUTOREV\}"?(.*)$'
    )

    updated = False
    new_lines = []

    for line in lines:
        match = pattern.match(line)
        if match:
            # AUTOREV를 COMMIT_ID로 변경
            indent = match.group(1)
            var_name = match.group(2)
            space1 = match.group(3)
            operator = match.group(4)
            space2 = match.group(5)
            comment = match.group(6)
            
            new_line = f'{indent}{var_name} = "{COMMIT_ID}"{comment}'
            new_lines.append(new_line)
            
            print('   현재 값이 "' + '${AUTOREV}"입니다. 업데이트를 진행합니다.')
            print(f"   새로운 값: {COMMIT_ID}")
            print(f"   이전: {line}")
            print(f"   이후: {new_line}")
            updated = True
        else:
            new_lines.append(line)

    if updated:
        # 백업 생성
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = f"{INC_FILE}.backup.{timestamp}"
        try:
            with open(backup_file, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"   백업 생성: {backup_file}")
        except Exception as e:
            print(f"⚠️ 백업 생성 실패: {e}")
        
        # 파일 쓰기
        try:
            with open(INC_FILE, 'w', encoding='utf-8') as f:
                f.write('\n'.join(new_lines) + '\n')
            print(f"✅ 업데이트 완료: {TARGET_VAR} = {COMMIT_ID}")
        except Exception as e:
            print(f"❌ ERROR: 파일 쓰기 실패: {e}")
            sys.exit(1)
    else:
        print(f'⚠️  업데이트 건너뜀: {TARGET_VAR}의 값이 "' + '${AUTOREV}"가 아닙니다.')
        print("   현재 설정값:")
        # 현재 설정값 출력
        found = False
        for line in lines:
            if TARGET_VAR in line:
                print(f"   {line}")
                found = True
        if not found:
            print("   (변수를 찾을 수 없습니다)")


if __name__ == "__main__":
    main()

