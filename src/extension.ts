import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { initializeLogger, axonLog, axonError, axonSuccess } from './logger';
import { executeFwdnCommand, updateConfiguration } from './fwdn';
import { 
	getAxonConfig, 
	findBootFirmwareFolder, 
	EXCLUDE_FOLDERS, 
	EXCLUDE_PATTERNS,
	AxonConfig,
	uriUpToFolderName,
	dirToDisplay,
	convertRemotePathToSamba,
	searchBootFirmwareInDirectory,
	setProjectType
} from './utils';
import { McuProjectDialog } from './projects/mcu/dialog';
import { McuProjectBuilder } from './projects/mcu/builder';
import { YoctoProjectDialog } from './projects/yocto/dialog';
import { YoctoProjectBuilder } from './projects/yocto/builder';
import { executeShellTask } from './projects/common/shell-utils';
import { AxonSidebarProvider } from './AxonSidebarProvider';


// MCU Project Creation Dialog - 이제 projects/mcu/dialog.ts에 있음

// 현재 감지된 Boot Firmware 경로 (캐싱) - 사용하지 않음

// 워크스페이스 폴더 가져오기
function getWorkspaceFolder(): vscode.WorkspaceFolder | null {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		const errorMsg = '워크스페이스 폴더를 찾을 수 없습니다.\n\n' +
			'해결 방법:\n' +
			'1. VS Code에서 "파일 > 폴더 열기"를 선택하세요.\n' +
			'2. 프로젝트가 있는 폴더를 선택하세요.\n' +
			'3. 폴더가 열린 후 다시 시도하세요.';
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
		return null;
	}
	return workspaceFolder;
}


// VS Code exclude 설정 적용
async function configureVscodeExcludeFolders(): Promise<void> {
	try {
		const workspaceFolder = getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}

		const config = vscode.workspace.getConfiguration();

		// files.exclude
		const filesExcludePatterns: string[] = [
			// ===== tcn1000 =====
			"**/build/tcn1000/buildhistory/**",
			"**/build/tcn1000/cache/**",
			"**/build/tcn1000/downloads/**",
			"**/build/tcn1000/sstate-cache/**",
			"**/build/tcn1000/tmp/**",
			"**/build/tcn1000/workspace/**",
			// ===== tcn1000-mcu =====
			"**/build/tcn1000-mcu/buildhistory/**",
			"**/build/tcn1000-mcu/cache/**",
			"**/build/tcn1000-mcu/downloads/**",
			"**/build/tcn1000-mcu/hashserve.sock",
			"**/build/tcn1000-mcu/sstate-cache/**",
			"**/build/tcn1000-mcu/tmp/**",
			"**/source-mirror/**",
			"**/.repo/**",
			"**/boot-firmware_tcn1000/**",
			"**/buildtools/**",
			"**/fwdn-v8/**",
			"**/mktcimg/**"
		];

		// search.exclude
		const searchExcludePatterns: string[] = [
			// ===== tcn1000 =====
			"**/build/tcn1000/buildhistory/**",
			"**/build/tcn1000/cache/**",
			"**/build/tcn1000/downloads/**",
			"**/build/tcn1000/sstate-cache/**",
			"**/build/tcn1000/tmp/**",
			"**/build/tcn1000/workspace/**",
			// ===== tcn1000-mcu =====
			"**/build/tcn1000-mcu/bitbake-cookerdaemon.log",
			"**/build/tcn1000-mcu/bitbake.lock",
			"**/build/tcn1000-mcu/bitbake.sock",
			"**/build/tcn1000-mcu/buildhistory/**",
			"**/build/tcn1000-mcu/cache/**",
			"**/build/tcn1000-mcu/downloads/**",
			"**/build/tcn1000-mcu/hashserve.sock",
			"**/build/tcn1000-mcu/sstate-cache/**",
			"**/build/tcn1000-mcu/tmp/**",
			"**/source-mirror/**",
			"**/.repo/**",
			"**/boot-firmware_tcn1000/**",
			"**/buildtools/**",
			"**/fwdn-v8/**",
			"**/mktcimg/**"
		];

		// files.watcherExclude
		const watcherExcludePatterns: string[] = [
			// ===== tcn1000 =====
			"**/build/tcn1000/bitbake-cookerdaemon.log",
			"**/build/tcn1000/buildhistory/**",
			"**/build/tcn1000/cache/**",
			"**/build/tcn1000/downloads/**",
			"**/build/tcn1000/sstate-cache/**",
			"**/build/tcn1000/tmp/**",
			"**/build/tcn1000/workspace/**",
			// ===== tcn1000-mcu =====
			"**/build/tcn1000-mcu/bitbake-cookerdaemon.log",
			"**/build/tcn1000-mcu/bitbake.lock",
			"**/build/tcn1000-mcu/bitbake.sock",
			"**/build/tcn1000-mcu/buildhistory/**",
			"**/build/tcn1000-mcu/cache/**",
			"**/build/tcn1000-mcu/downloads/**",
			"**/build/tcn1000-mcu/hashserve.sock",
			"**/build/tcn1000-mcu/sstate-cache/**",
			"**/build/tcn1000-mcu/tmp/**",
			"**/source-mirror/**",
			"**/.repo/**",
			"**/boot-firmware_tcn1000/**",
			"**/buildtools/**",
			"**/fwdn-v8/**",
			"**/mktcimg/**"
		];

		let updated = false;

		// files.exclude 업데이트
		const currentFilesExclude = config.get<Record<string, boolean>>('files.exclude') ?? {};
		const newFilesExclude = { ...currentFilesExclude };
		for (const pattern of filesExcludePatterns) {
			if (!(pattern in newFilesExclude)) {
				newFilesExclude[pattern] = true;
				updated = true;
			}
		}
		if (updated) {
			await config.update('files.exclude', newFilesExclude, vscode.ConfigurationTarget.Workspace);
			axonLog('✅ files.exclude 설정에 Yocto 관련 폴더를 추가했습니다.');
		}

		// search.exclude 업데이트
		let searchUpdated = false;
		const currentSearchExclude = config.get<Record<string, boolean>>('search.exclude') ?? {};
		const newSearchExclude = { ...currentSearchExclude };
		for (const pattern of searchExcludePatterns) {
			if (!(pattern in newSearchExclude)) {
				newSearchExclude[pattern] = true;
				searchUpdated = true;
			}
		}
		if (searchUpdated) {
			await config.update('search.exclude', newSearchExclude, vscode.ConfigurationTarget.Workspace);
			axonLog('✅ search.exclude 설정에 Yocto 관련 폴더를 추가했습니다.');
			updated = true;
		}

		// files.watcherExclude 업데이트
		let watcherUpdated = false;
		const currentWatcherExclude = config.get<Record<string, boolean>>('files.watcherExclude') ?? {};
		const newWatcherExclude = { ...currentWatcherExclude };
		for (const pattern of watcherExcludePatterns) {
			if (!(pattern in newWatcherExclude)) {
				newWatcherExclude[pattern] = true;
				watcherUpdated = true;
			}
		}
		if (watcherUpdated) {
			await config.update('files.watcherExclude', newWatcherExclude, vscode.ConfigurationTarget.Workspace);
			axonLog('✅ files.watcherExclude 설정에 Yocto 관련 폴더를 추가했습니다.');
			updated = true;
		}

		if (!updated) {
			const msg = '이미 VS Code exclude 설정이 모두 적용되어 있습니다.';
			axonLog(`ℹ️ ${msg}`);
			vscode.window.showInformationMessage(msg);
		} else {
			const msg = 'VS Code exclude 설정을 업데이트했습니다. (files.exclude, search.exclude, files.watcherExclude)';
			axonSuccess(`🎯 ${msg}`);
			vscode.window.showInformationMessage(msg);
		}
	} catch (error) {
		const errorMsg = `VS Code exclude 설정 적용 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

/**
 * DevTool Create & Modify 실행
 * 
 * AP 및 MCU 레시피 모두 지원합니다.
 * 
 * 실행 단계:
 * 1. 드롭박스에서 레시피 선택 (또는 직접 입력)
 * 2. MCU 레시피인 경우 에러 메시지 표시 및 종료
 * 3. AP 빌드 설정 및 빌드 디렉토리 생성 (build/tcn1000)
 * 4. Yocto 환경 초기화 (source poky/oe-init-build-env)
 * 5. devtool create-workspace 실행 (workspace가 없을 때만)
 * 6. devtool modify 실행
 * 7. bbappend 파일 수정 스크립트 실행
 */
async function executeDevtoolCreateModify(extensionPath: string): Promise<void> {
	axonLog('🔧 [DevTool Create & Modify] 시작');

	try {
		// Yocto 프로젝트 루트 경로 확인 (build AP와 동일한 방식 사용)
		const { YoctoProjectBuilder } = await import('./projects/yocto/builder');
		
		// bootFirmwareFolderName 설정 확인 (build AP와 동일)
		const bootFirmwareFolderName = await YoctoProjectBuilder['ensureBootFirmwareFolderName']();
		if (!bootFirmwareFolderName) {
			vscode.window.showInformationMessage('빌드가 취소되었습니다.');
			return;
		}
		
		// Yocto 프로젝트 루트 자동 탐지 (build AP와 동일)
		const yoctoRoot = await YoctoProjectBuilder.getYoctoProjectRoot();
		axonLog(`📁 Yocto 프로젝트 루트: ${yoctoRoot}`);
		
		// 1. 레시피 선택
		const recipes = [
			{ label: 'linux-telechips', description: 'Kernel 레시피' },
			{ label: 'm7-0', description: 'MCU Core 0 레시피' },
			{ label: 'm7-1', description: 'MCU Core 1 레시피' },
			{ label: 'm7-2', description: 'MCU Core 2 레시피' },
			{ label: 'm7-np', description: 'MCU Non-Processor 레시피' }
		];

		const manualInputItem = { label: '직접 입력...', description: '레시피명을 직접 입력' };
		const quickPickItems = [...recipes, manualInputItem];

		const selected = await vscode.window.showQuickPick(quickPickItems, {
			placeHolder: 'devtool modify할 레시피를 선택하거나 "직접 입력..."을 선택하세요',
			ignoreFocusOut: true
		});

		if (!selected) {
			axonLog('❌ 사용자가 레시피 선택을 취소했습니다.');
			return;
		}

		let recipeName: string;
		let isManualInput = false;
		if (selected.label === manualInputItem.label) {
			const input = await vscode.window.showInputBox({
				title: '레시피명 직접 입력',
				placeHolder: '예: telechips-cgw-app',
				prompt: 'Yocto devtool modify에 사용할 레시피명을 입력하세요',
				ignoreFocusOut: true,
				validateInput: (value: string) => {
					const trimmed = value.trim();
					if (!trimmed) return '레시피명을 입력하세요';
					// 간단 검증: 공백 금지
					if (/\s/.test(trimmed)) return '공백 없이 입력하세요';
					return null;
				}
			});

			if (!input) {
				axonLog('❌ 사용자가 레시피 입력을 취소했습니다.');
				return;
			}

			recipeName = input.trim();
			isManualInput = true;
		} else {
			recipeName = selected.label;
		}

		axonLog(`✅ 선택된 레시피: ${recipeName}`);
		
		// MCU 레시피도 지원함 (주석 처리된 부분 제거 또는 수정)
		// const mcuRecipes = ['m7-0', 'm7-1', 'm7-2', 'm7-np'];
		// if (mcuRecipes.includes(recipeName)) { ... } -> 삭제됨
		
		// 빌드 디렉토리 결정
		// MCU 레시피의 경우 build/tcn1000-mcu, AP는 build/tcn1000
		const mcuRecipes = ['m7-0', 'm7-1', 'm7-2', 'm7-np'];
		let buildDir = 'build/tcn1000';
		let workspaceName = 'tcn1000';
		
		if (mcuRecipes.includes(recipeName)) {
			buildDir = 'build/tcn1000-mcu';
			workspaceName = 'tcn1000-mcu';
			axonLog(`ℹ️ MCU 레시피 감지: 빌드 디렉토리를 ${buildDir}로 설정합니다.`);
		}
		
		// workspaceFolder 가져오기
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
		}
		
		// 2. AP 빌드 설정 및 빌드 디렉토리 생성 (builder.ts 174-260 참고)
		const projectRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: yoctoRoot
		});
		
		const configUri = vscode.Uri.joinPath(projectRootUri, 'config.json');
		let apMachine: string | undefined;
		let cgwVersion: string | undefined;
		
		// config.json 읽기 시도
		try {
			const configContent = await vscode.workspace.fs.readFile(configUri);
			const config = JSON.parse(Buffer.from(configContent).toString('utf8'));
			apMachine = config.machine;
			cgwVersion = config.version;
			
			if (apMachine && cgwVersion) {
				axonLog(`✅ 설정 로드: MACHINE=${apMachine}, CGW_SDK_VERSION=${cgwVersion}`);
			}
		} catch (error) {
			axonLog(`⚠️ config.json 읽기 실패 또는 없음`);
		}
		
		// machine 또는 version이 없으면 사용자에게 선택받기
		if (!apMachine || !cgwVersion) {
			axonLog('📋 빌드 설정을 선택해주세요...');
			
			// machine 선택
			if (!apMachine) {
				const supportedMachines = ['tcn1000'];
				apMachine = await vscode.window.showQuickPick(supportedMachines, {
					placeHolder: 'AP MACHINE을 선택하세요',
					title: 'Yocto AP Build Configuration'
				});
				
				if (!apMachine) {
					axonLog('❌ 사용자 취소: MACHINE 선택이 취소되었습니다.');
					vscode.window.showInformationMessage('빌드가 취소되었습니다.');
					return;
				}
			}
			
			// version 선택
			if (!cgwVersion) {
				const supportedVersions = ['dev', 'qa', 'release'];
				cgwVersion = await vscode.window.showQuickPick(supportedVersions, {
					placeHolder: 'CGW SDK VERSION을 선택하세요',
					title: 'Yocto AP Build Configuration'
				});
				
				if (!cgwVersion) {
					axonLog('❌ 사용자 취소: VERSION 선택이 취소되었습니다.');
					vscode.window.showInformationMessage('빌드가 취소되었습니다.');
					return;
				}
			}
			
			// 선택한 설정을 config.json에 저장
			try {
				let existingConfig: any = {};
				try {
					const configContent = await vscode.workspace.fs.readFile(configUri);
					existingConfig = JSON.parse(Buffer.from(configContent).toString('utf8'));
				} catch {
					// config.json이 없으면 빈 객체 사용
				}
				
				existingConfig.machine = apMachine;
				existingConfig.version = cgwVersion;
				
				const configJson = JSON.stringify(existingConfig, null, 2);
				await vscode.workspace.fs.writeFile(configUri, Buffer.from(configJson, 'utf8'));
				axonLog(`💾 빌드 설정을 config.json에 저장했습니다: MACHINE=${apMachine}, VERSION=${cgwVersion}`);
			} catch (error) {
				axonLog(`⚠️ config.json 저장 실패 (계속 진행): ${error}`);
			}
		}
		
		const machine = mcuRecipes.includes(recipeName) ? 'tcn1000-mcu' : apMachine!;
		const version = cgwVersion!;
		const buildScript = `${yoctoRoot}/poky/meta-telechips/meta-dev/meta-cgw-dev/cgw-build.sh`;
		
		axonLog(`📂 빌드 디렉토리: ${buildDir}`);
		axonLog(`📋 빌드 설정: MACHINE=${machine}, VERSION=${version}`);
		
		// 3. buildtools 환경 확인 (builder.ts 498-514 또는 276-292 참고)
		const envPath = `${yoctoRoot}/buildtools/environment-setup-x86_64-pokysdk-linux`;
		const envUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: envPath
		});
		
		try {
			await vscode.workspace.fs.stat(envUri);
			axonLog(`✅ Buildtools 환경 확인: ${envPath}`);
		} catch {
			const errorMsg = 'Buildtools 환경이 설정되지 않았습니다. 먼저 "build toolchain"을 실행해야 합니다.';
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 4. 빌드 스크립트 확인 (builder.ts 516-534 또는 294-312 참고)
		const buildScriptUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: buildScript
		});
		
		try {
			await vscode.workspace.fs.stat(buildScriptUri);
			axonLog(`✅ 빌드 스크립트 확인: ${buildScript}`);
		} catch {
			const errorMsg = `빌드 스크립트를 찾을 수 없습니다: ${buildScript}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 5. 빌드 스크립트 실행하여 빌드 디렉토리 생성 (builder.ts 539-543 또는 317-321 참고)
		// 빌드 디렉토리와 local.conf 파일을 생성하기 위해 빌드 스크립트만 실행
		axonLog(`🔨 빌드 디렉토리 생성 중...`);
		const { executeShellTask } = await import('./projects/common/shell-utils');
		
		const yoctoRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: yoctoRoot
		});
		
		const setupBuildDirCommand = `cd "${yoctoRoot}"
#set -x		
source "${envPath}"
source "${buildScript}" ${machine} ${version}`;
		
		await executeShellTask({
			command: setupBuildDirCommand,
			cwd: yoctoRoot,
			taskName: `Setup Build Directory: ${buildDir}`,
			taskId: `setupBuildDir_${buildDir.replace(/\//g, '_')}`,
			showTerminal: true,
			useScriptFile: true,
			cwdUri: yoctoRootUri
		});
		
		axonLog(`✅ 빌드 디렉토리 생성 완료: ${buildDir}`);
		
		// 실행 확인 다이얼로그
		const confirmMessage = `'${recipeName}' 레시피에 대해 DevTool Create & Modify를 실행하시겠습니까?\n\n` +
			`빌드 환경: ${buildDir}\n` +
			`MACHINE: ${machine}, VERSION: ${version}\n` +
			`DevTool workspace: external-workspace/${workspaceName}\n\n` +
			`실행 단계:\n` +
			`1. devtool create-workspace (workspace가 없을 때만)\n` +
			`2. devtool modify\n` +
			`3. telechips-cgw-rev.inc 파일 수정 (Git HEAD 반영)`;
		
		const confirm = await vscode.window.showInformationMessage(
			confirmMessage,
			{ modal: true },
			'확인',
			'취소'
		);
		
		if (confirm !== '확인') {
			axonLog('❌ 사용자가 실행을 취소했습니다.');
			return;
		}
		
		// 6. DevTool workspace 경로 결정 (빌드 디렉토리 기반)
		// workspaceName은 이미 위에서 결정됨
		const workspacePath = `${yoctoRoot}/external-workspace/${workspaceName}`;
		const workspaceSourcePath = `${workspacePath}/sources`;
		const recipeSourcePath = `${workspaceSourcePath}/${recipeName}`;
		axonLog(`📁 DevTool workspace: ${workspacePath}`);
		axonLog(`📁 Source path: ${recipeSourcePath}`);
		
		// 6-1. workspace 존재 여부 확인
		const workspaceUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: workspacePath
		});
		
		let workspaceExists = false;
		try {
			const stat = await vscode.workspace.fs.stat(workspaceUri);
			workspaceExists = (stat.type & vscode.FileType.Directory) === vscode.FileType.Directory;
		} catch {
			workspaceExists = false;
		}
		
		if (workspaceExists) {
			axonLog(`✅ DevTool workspace가 이미 존재합니다: ${workspacePath}`);
		} else {
			axonLog(`📝 새 DevTool workspace를 생성합니다: ${workspacePath}`);
		}
		
		// 3. telechips-cgw-rev.inc 파일 수정을 위한 인라인 bash 스크립트
		axonLog(`📋 telechips-cgw-rev.inc 업데이트 스크립트 준비 중...`);
		
		const updateRevIncScript = `
#set -x # 디버깅을 위해 실행 명령 출력
RECIPE_PN="${recipeName}"
SRC_TREE_PATH="${recipeSourcePath}"
INC_FILE="${yoctoRoot}/poky/meta-telechips/meta-dev/telechips-cgw-rev.inc"

echo "🔍 Source Tree: \${SRC_TREE_PATH}"
echo "🔍 Target Inc File: \${INC_FILE}"

# 1. Git Commit ID 가져오기
if [ -d "\${SRC_TREE_PATH}" ]; then
    cd "\${SRC_TREE_PATH}"
    COMMIT_ID=$(git rev-parse HEAD)
    echo "✅ Git Commit ID: \${COMMIT_ID}"
else
    echo "❌ ERROR: 소스 디렉토리를 찾을 수 없습니다: \${SRC_TREE_PATH}"
    exit 1
fi

if [ ! -f "\${INC_FILE}" ]; then
    echo "❌ ERROR: telechips-cgw-rev.inc 파일을 찾을 수 없습니다: \${INC_FILE}"
    exit 1
fi

# 2. 레시피별 변수명 결정
TARGET_VAR=""
case "\${RECIPE_PN}" in
    "linux-telechips")
        TARGET_VAR="KERNEL_SRC_DEV"
        ;;
    "m7-0"|"m7-1"|"m7-2"|"m7-np")
        TARGET_VAR="MCU_SRC_DEV"
        ;;
    "dpi-app")
        TARGET_VAR="DPI_APP_SRC_DEV"
        ;;
    "tpa-app")
        TARGET_VAR="TPA_APP_SRC_DEV"
        ;;
    "u-boot-tcc")
        TARGET_VAR="UBOOT_SRC_DEV"
        ;;
    *)
        echo "⚠️ 알림: '\${RECIPE_PN}' 레시피는 telechips-cgw-rev.inc 자동 업데이트 대상이 아닙니다."
        # 에러는 아님
        ;;
esac

# 3. 파일 수정
if [ -n "\${TARGET_VAR}" ]; then
    echo "📝 \${INC_FILE} 업데이트 체크 중..."
    echo "   변수: \${TARGET_VAR}"
    
    # 해당 변수의 값이 "\${AUTOREV}" 인지 확인
    # 정규식: 시작(^) + 공백 + 변수명 + 공백 + [?:]=(할당) + 공백 + "\${AUTOREV}" (이스케이프 주의)
    # 쉘 변수 확장을 막기 위해 single quote 사용하거나, escape 처리를 확실히 해야 함.
    # 하지만 여기서는 double quote 안에서 \${TARGET_VAR}는 확장되고, \${AUTOREV}는 문자 그대로 grep 패턴에 들어가야 함.
    # grep 패턴에서 $는 라인 끝을 의미하므로, 리터럴 $를 찾으려면 \$로 이스케이프해야 함.
    # 또한 double quote 안에서 backslash 자체도 이스케이프해야 하므로 \\$가 됨.
    if grep -q "^\\s*\${TARGET_VAR}\\s*[?:]*=\\s*\\\"\\\${AUTOREV}\\\"" "\${INC_FILE}"; then
        echo "   현재 값이 \"\${AUTOREV}\"입니다. 업데이트를 진행합니다."
        echo "   새로운 값: \${COMMIT_ID}"
    
        # 백업 생성
        cp "\${INC_FILE}" "\${INC_FILE}.backup.\$(date +%Y%m%d_%H%M%S)"
        
        # sed를 사용하여 변수 값 변경 (AUTOREV -> COMMIT_ID)
        # 검색 패턴에서도 동일하게 리터럴 $를 매칭하기 위해 이스케이프 필요
        sed -i "s/^\\s*\${TARGET_VAR}\\s*[?:]*=\\s*\\\"\\\${AUTOREV}\\\"/\${TARGET_VAR} = \\\"\${COMMIT_ID}\\\"/" "\${INC_FILE}"
        
        # 변경 확인
        if grep -q "\${TARGET_VAR}.*\${COMMIT_ID}" "\${INC_FILE}"; then
            echo "✅ 업데이트 완료: \${TARGET_VAR} = \${COMMIT_ID}"
        else
            echo "❌ 업데이트 실패: sed 치환이 적용되지 않았습니다."
            
            echo "--- [Debug Info] ---"
            grep "\${TARGET_VAR}" "\${INC_FILE}"
            echo "--------------------"
            
            exit 1
        fi
    else
        echo "⚠️  업데이트 건너뜀: \${TARGET_VAR}의 값이 \"\${AUTOREV}\"가 아닙니다."
        echo "   현재 설정값:"
        grep "\${TARGET_VAR}" "\${INC_FILE}" || echo "   (변수를 찾을 수 없습니다)"
    fi
fi
`;
		
		// 7. executeShellTask를 사용하여 명령 실행
		const { executeShellTask: devtoolExecuteShellTask } = await import('./projects/common/shell-utils');
		
		const devtoolYoctoRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: yoctoRoot
		});
		
		// workspace가 없을 때만 create-workspace 실행
		const createWorkspaceCommand = workspaceExists 
			? `echo "ℹ️  DevTool workspace가 이미 존재하므로 create-workspace를 건너뜁니다: ${workspacePath}"`
			: `devtool create-workspace ${workspacePath}`;
		
		// devtool modify는 항상 external-workspace/sources/<레시피명> 에 풀도록 명시적 지정
		const devtoolModifyCommand = `devtool modify ${recipeName} "${recipeSourcePath}"`;
		
		const fullCommand = `cd "${yoctoRoot}"
source poky/oe-init-build-env ${buildDir}
${createWorkspaceCommand}
#${devtoolModifyCommand}
${updateRevIncScript}
echo ""
echo "=========================================="
echo "✅ DevTool Setup이 성공적으로 완료되었습니다!"
echo "   레시피: ${recipeName}"
echo "   빌드 환경: ${buildDir}"
echo "   DevTool workspace: ${workspacePath}"
echo "=========================================="
echo ""`;
		
		axonLog(`🔨 실행할 명령 준비 완료`);
		
		await devtoolExecuteShellTask({
			command: fullCommand,
			cwd: yoctoRoot,
			taskName: `DevTool: ${recipeName}`,
			taskId: `devtoolCreateModify_${recipeName}`,
			showTerminal: true,
			useScriptFile: true,  // 긴 명령어를 스크립트 파일로 실행
			cwdUri: devtoolYoctoRootUri
		});
		
		// 작업 성공적으로 종료됨 (exit code 0) → 메뉴에 동적으로 추가
		if (globalBuildProvider) {
			globalBuildProvider.addDevtoolRecipe(recipeName);
			try {
				await vscode.commands.executeCommand('axonBuildView.focus');
			} catch {}
		}

		axonSuccess(`✅ DevTool Create & Modify가 완료되었습니다!\n레시피: ${recipeName}\n빌드 디렉토리: ${buildDir}`);
		
	} catch (error) {
		const errorMsg = `DevTool Create & Modify 실행 중 오류 발생: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

/**
 * DevTool Build 실행
 * 
 * @param recipeName - 빌드할 레시피 이름
 */
async function executeDevtoolBuild(recipeName: string): Promise<void> {
	axonLog(`🔨 [DevTool Build] 시작: ${recipeName}`);

	try {
		// 실행 확인 다이얼로그
		let confirmMessage = `'${recipeName}' 레시피를 빌드하시겠습니까?\n\n실행 명령:\n- devtool build ${recipeName}`;
		
		// linux-telechips인 경우 추가 정보 표시
		if (recipeName === 'linux-telechips') {
			confirmMessage += `\n- bitbake -f -c make_fai telechips-cgw-image`;
		}
		
		const confirm = await vscode.window.showInformationMessage(
			confirmMessage,
			{ modal: true },
			'확인',
			'취소'
		);
		
		if (confirm !== '확인') {
			axonLog('❌ 사용자가 빌드를 취소했습니다.');
			return;
		}
		
		// Yocto 프로젝트 루트 경로 확인
		const config = vscode.workspace.getConfiguration('axon');
		const yoctoRoot = config.get<string>('yocto.projectRoot', '');
		
		if (!yoctoRoot || yoctoRoot.trim() === '') {
			const errorMsg = 'Yocto 프로젝트 루트가 설정되지 않았습니다.';
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 빌드 환경 결정
		// MCU 레시피 (m7-0, m7-1, m7-2, m7-np)만 build/tcn1000-mcu 사용
		// 나머지 모든 레시피는 build/tcn1000 사용
		const mcuRecipes = ['m7-0', 'm7-1', 'm7-2', 'm7-np'];
		const buildDir = mcuRecipes.includes(recipeName)
			? 'build/tcn1000-mcu'
			: 'build/tcn1000';
		axonLog(`📂 빌드 디렉토리: ${buildDir}`);
		
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
		}
		
		// YoctoProjectBuilder의 공통 함수 사용
		const { YoctoProjectBuilder } = await import('./projects/yocto/builder');
		
		// buildtools 환경 확인
		const envPath = await YoctoProjectBuilder.ensureBuildtoolsEnvironment(yoctoRoot, workspaceFolder);
		if (!envPath) {
			return;
		}
		
		// 빌드 디렉토리 설정 (oe-init-build-env 실행)
		const setupSuccess = await YoctoProjectBuilder.setupBuildDirectoryWithOeInit(
			yoctoRoot,
			envPath,
			buildDir,
			workspaceFolder
		);
		if (!setupSuccess) {
			return;
		}
		
		// local.conf 파일 수정 (캐시 경로 설정)
		const fullBuildDir = `${yoctoRoot}/${buildDir}`;
		axonLog('📝 local.conf 파일 수정 중...');
		await YoctoProjectBuilder.updateLocalConfCachePaths(fullBuildDir, workspaceFolder);
		
		// 빌드 명령 구성
		const buildCommands: string[] = [
			`devtool build ${recipeName}`
		];
		
		// linux-telechips인 경우 추가 bitbake 명령어 실행
		if (recipeName === 'linux-telechips') {
			buildCommands.push(`bitbake -f -c make_fai telechips-cgw-image`);
			axonLog(`📦 linux-telechips 감지: bitbake make_fai 명령어 추가`);
		}
		
		// 성공 메시지 추가
		buildCommands.push(
			`echo ""`,
			`echo "=========================================="`,
			`echo "✅ DevTool Build가 성공적으로 완료되었습니다!"`,
			`echo "   레시피: ${recipeName}"`,
			`echo "   빌드 환경: ${buildDir}"`,
			`echo "=========================================="`,
			`echo ""`
		);
		
		// 빌드 명령 실행
		await YoctoProjectBuilder.executeBuildCommand(
			yoctoRoot,
			envPath,
			buildDir,
			buildCommands,
			`DevTool Build: ${recipeName}`,
			`devtoolBuild_${recipeName}`,
			workspaceFolder
		);
		
		axonSuccess(`✅ DevTool Build가 시작되었습니다!\n레시피: ${recipeName}`);
		
	} catch (error) {
		const errorMsg = `DevTool Build 실행 중 오류 발생: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

// 전역 SidebarProvider (devtool modify 후 레시피 추가를 위해 필요)
let globalBuildProvider: AxonSidebarProvider | undefined;



export async function activate(context: vscode.ExtensionContext) {
	// Axon 전용 Output 채널 생성 및 로거 초기화
	const axonOutputChannel = vscode.window.createOutputChannel('Axon');
	initializeLogger(axonOutputChannel);
	
	// 버전 정보 표시
	const extension = vscode.extensions.getExtension('justin-lee.axon');
	const version = extension?.packageJSON.version || 'not defined';
	
	axonLog('===========================================');
	axonLog('Axon extension is now active!');
	axonLog(`Version: ${version}`);
	axonLog('===========================================');
	axonOutputChannel.show();

	// Axon Sidebar Provider 등록 (Webview)
	const axonSidebarProvider = new AxonSidebarProvider(context.extensionUri);
	globalBuildProvider = axonSidebarProvider; // 전역 변수 호환성 유지 (이름은 BuildProvider지만 실제로는 SidebarProvider)
	
    vscode.window.registerWebviewViewProvider(AxonSidebarProvider.viewType, axonSidebarProvider);

	// MCU Project Dialog Provider 등록
	const mcuProjectDialog = new McuProjectDialog(context);
	
	// Yocto Project Dialog Provider 등록
	const yoctoProjectDialog = new YoctoProjectDialog(context);

	// FWDN ALL 실행 명령
	const runFwdnAllDisposable = vscode.commands.registerCommand(
		'axon.FWDN_ALL',
		async () => executeFwdnCommand(context.extensionPath)
	);

	// MCU Build Make 실행 명령
	const mcuBuildMakeDisposable = vscode.commands.registerCommand(
		'axon.mcuBuildMake',
		async (core?: string) => {
			if (core) {
				await McuProjectBuilder.buildMake(core);
			} else {
				vscode.window.showErrorMessage('빌드할 코어를 선택해주세요.');
			}
		}
	);

	// MCU Build All 실행 명령
	const mcuBuildAllDisposable = vscode.commands.registerCommand(
		'axon.mcuBuildAll',
		async () => await McuProjectBuilder.buildAll()
	);


	// MCU Clean 실행 명령
	const mcuCleanDisposable = vscode.commands.registerCommand(
		'axon.mcuClean',
		async () => await McuProjectBuilder.cleanBuild()
	);

	// Create MCU Standalone Project 명령
	const createMcuStandaloneProjectDisposable = vscode.commands.registerCommand(
		'axon.createMcuStandaloneProject',
		async () => {
			await mcuProjectDialog.showProjectCreationWebView();
		}
	);

	// Create Yocto Project 명령
	const createYoctoProjectDisposable = vscode.commands.registerCommand(
		'axon.createYoctoProject',
		async () => {
			await yoctoProjectDialog.showProjectCreationWebView();
		}
	);

	// Build Yocto AP 명령
	const buildYoctoApDisposable = vscode.commands.registerCommand(
		'axon.buildYoctoAp',
		async () => {
			await YoctoProjectBuilder.buildAp();
		}
	);

	// Build Yocto MCU 명령
	const buildYoctoMcuDisposable = vscode.commands.registerCommand(
		'axon.buildYoctoMcu',
		async () => {
			await YoctoProjectBuilder.buildMcu();
		}
	);

	// Build Yocto Kernel 명령
	const buildYoctoKernelDisposable = vscode.commands.registerCommand(
		'axon.buildYoctoKernel',
		async () => {
			await YoctoProjectBuilder.buildKernel();
		}
	);

	// DevTool Create & Modify 명령
	const devtoolCreateModifyDisposable = vscode.commands.registerCommand(
		'axon.devtoolCreateModify',
		async () => executeDevtoolCreateModify(context.extensionPath)
	);

	// Clean Yocto AP 명령
	const cleanYoctoApDisposable = vscode.commands.registerCommand(
		'axon.cleanYoctoAp',
		async () => {
			await YoctoProjectBuilder.cleanApBuild();
		}
	);

	// Clean Yocto MCU 명령
	const cleanYoctoMcuDisposable = vscode.commands.registerCommand(
		'axon.cleanYoctoMcu',
		async () => {
			await YoctoProjectBuilder.cleanMcuBuild();
		}
	);

	// Clean Yocto All 명령
	const cleanYoctoAllDisposable = vscode.commands.registerCommand(
		'axon.cleanYoctoAll',
		async () => {
			await YoctoProjectBuilder.cleanAllBuild();
		}
	);

	// Edit AP local.conf 명령
	const editApLocalConfDisposable = vscode.commands.registerCommand(
		'axon.editApLocalConf',
		async () => {
			await YoctoProjectBuilder.editApLocalConf();
		}
	);

	// Edit MCU local.conf 명령
	const editMcuLocalConfDisposable = vscode.commands.registerCommand(
		'axon.editMcuLocalConf',
		async () => {
			await YoctoProjectBuilder.editMcuLocalConf();
		}
	);

	// Edit Branch/Srcrev 명령
	const editBranchSrcrevDisposable = vscode.commands.registerCommand(
		'axon.editBranchSrcrev',
		async () => {
			await YoctoProjectBuilder.editBranchSrcrev();
		}
	);

	// DevTool Build 명령
	const devtoolBuildDisposable = vscode.commands.registerCommand(
		'axon.devtoolBuild',
		async (recipeName: string) => executeDevtoolBuild(recipeName)
	);

	// VSCode exclude folders 설정 명령
	const vscodeExcludeFoldersDisposable = vscode.commands.registerCommand(
		'axon.vscodeExcludeFolders',
		async () => {
			await configureVscodeExcludeFolders();
		}
	);

	// Set Project Type 명령
	const setProjectTypeDisposable = vscode.commands.registerCommand(
		'axon.setProjectType',
		async (projectType: string) => {
			if (projectType !== 'mcu_project' && projectType !== 'yocto_project') {
				vscode.window.showErrorMessage(`잘못된 프로젝트 타입입니다: ${projectType}`);
				return;
			}
			
			await setProjectType(projectType as 'mcu_project' | 'yocto_project');
			
			// webview에 상태 동기화
			if (globalBuildProvider) {
				globalBuildProvider.sendProjectType();
			}
		}
	);

	context.subscriptions.push(
		runFwdnAllDisposable,
		mcuBuildMakeDisposable,
		mcuBuildAllDisposable,
		mcuCleanDisposable,
		// 새로운 프로젝트 생성 명령어들
		createMcuStandaloneProjectDisposable,
		createYoctoProjectDisposable,
		// 빌드 명령어들
		buildYoctoApDisposable,
		buildYoctoMcuDisposable,
		buildYoctoKernelDisposable,
		// DevTool 명령어들
		devtoolCreateModifyDisposable,
		devtoolBuildDisposable,
		vscodeExcludeFoldersDisposable,
		// 클린 명령어들
		cleanYoctoApDisposable,
		cleanYoctoMcuDisposable,
		cleanYoctoAllDisposable,
		// 설정 편집 명령어들
		editApLocalConfDisposable,
		editMcuLocalConfDisposable,
		editBranchSrcrevDisposable,
		// 프로젝트 타입 설정 명령어
		setProjectTypeDisposable
	);
}

export function deactivate() {}
