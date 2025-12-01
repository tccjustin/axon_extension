import * as vscode from 'vscode';
import { axonLog, axonError, axonSuccess } from '../../logger';
import { executeShellTask } from '../common/shell-utils';
import { YoctoProjectBuilder } from './builder';

/**
 * DevTool 관련 기능
 */
export class DevToolManager {
	/**
	 * MCU 레시피 목록
	 */
	private static readonly MCU_RECIPES = ['m7-0', 'm7-1', 'm7-2', 'm7-np'];

	/**
	 * 기본 레시피 목록
	 */
	private static readonly DEFAULT_RECIPES = [
		{ label: 'linux-telechips', description: 'Kernel 레시피' },
		{ label: 'm7-0', description: 'MCU Core 0 레시피' },
		{ label: 'm7-1', description: 'MCU Core 1 레시피' },
		{ label: 'm7-2', description: 'MCU Core 2 레시피' },
		{ label: 'm7-np', description: 'MCU Non-Processor 레시피' }
	];

	/**
	 * 레시피 선택 (QuickPick 또는 직접 입력)
	 */
	private static async selectRecipe(): Promise<string | null> {
		const manualInputItem = { label: '직접 입력...', description: '레시피명을 직접 입력' };
		const quickPickItems = [...this.DEFAULT_RECIPES, manualInputItem];

		const selected = await vscode.window.showQuickPick(quickPickItems, {
			placeHolder: 'devtool modify할 레시피를 선택하거나 "직접 입력..."을 선택하세요',
			ignoreFocusOut: true
		});

		if (!selected) {
			axonLog('❌ 사용자가 레시피 선택을 취소했습니다.');
			return null;
		}

		if (selected.label === manualInputItem.label) {
			const input = await vscode.window.showInputBox({
				title: '레시피명 직접 입력',
				placeHolder: '예: telechips-cgw-app',
				prompt: 'Yocto devtool modify에 사용할 레시피명을 입력하세요',
				ignoreFocusOut: true,
				validateInput: (value: string) => {
					const trimmed = value.trim();
					if (!trimmed) return '레시피명을 입력하세요';
					if (/\s/.test(trimmed)) return '공백 없이 입력하세요';
					return null;
				}
			});

			if (!input) {
				axonLog('❌ 사용자가 레시피 입력을 취소했습니다.');
				return null;
			}

			return input.trim();
		}

		return selected.label;
	}

	/**
	 * 빌드 디렉토리 및 workspace 이름 결정
	 */
	private static getBuildDirAndWorkspace(recipeName: string): { buildDir: string; workspaceName: string } {
		if (this.MCU_RECIPES.includes(recipeName)) {
			return {
				buildDir: 'build/tcn1000-mcu',
				workspaceName: 'tcn1000-mcu'
			};
		}
		return {
			buildDir: 'build/tcn1000',
			workspaceName: 'tcn1000'
		};
	}

	/**
	 * 빌드 스크립트 경로 확인
	 */
	private static async ensureBuildScript(
		yoctoRoot: string,
		workspaceFolder: vscode.WorkspaceFolder
	): Promise<boolean> {
		const buildScript = `${yoctoRoot}/poky/meta-telechips/meta-dev/meta-cgw-dev/cgw-build.sh`;
		const buildScriptUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: buildScript
		});

		try {
			await vscode.workspace.fs.stat(buildScriptUri);
			axonLog(`✅ 빌드 스크립트 확인: ${buildScript}`);
			return true;
		} catch {
			const errorMsg = `빌드 스크립트를 찾을 수 없습니다: ${buildScript}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return false;
		}
	}

	/**
	 * 빌드 디렉토리 생성 (cgw-build.sh 사용)
	 */
	private static async setupBuildDirectory(
		yoctoRoot: string,
		envPath: string,
		buildScript: string,
		machine: string,
		version: string,
		workspaceFolder: vscode.WorkspaceFolder
	): Promise<boolean> {
		const yoctoRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: yoctoRoot
		});

		const setupBuildDirCommand = `cd "${yoctoRoot}"
source "${envPath}"
source "${buildScript}" ${machine} ${version}`;

		axonLog(`🔨 빌드 디렉토리 생성 중...`);
		await executeShellTask({
			command: setupBuildDirCommand,
			cwd: yoctoRoot,
			taskName: `Setup Build Directory`,
			taskId: `setupBuildDir`,
			showTerminal: true,
			useScriptFile: true,
			cwdUri: yoctoRootUri
		});

		axonLog(`✅ 빌드 디렉토리 생성 완료`);
		return true;
	}

	/**
	 * telechips-cgw-rev.inc 파일 업데이트 스크립트 생성
	 */
	private static createUpdateRevIncScript(
		recipeName: string,
		recipeSourcePath: string,
		yoctoRoot: string
	): string {
		return `
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
        ;;
esac

# 3. 파일 수정
if [ -n "\${TARGET_VAR}" ]; then
    echo "📝 \${INC_FILE} 업데이트 체크 중..."
    echo "   변수: \${TARGET_VAR}"
    
    if grep -q "^\\s*\${TARGET_VAR}\\s*[?:]*=\\s*\\\"\\\${AUTOREV}\\\"" "\${INC_FILE}"; then
        echo "   현재 값이 \"\${AUTOREV}\"입니다. 업데이트를 진행합니다."
        echo "   새로운 값: \${COMMIT_ID}"
    
        # 백업 생성
        cp "\${INC_FILE}" "\${INC_FILE}.backup.\$(date +%Y%m%d_%H%M%S)"
        
        # sed를 사용하여 변수 값 변경 (AUTOREV -> COMMIT_ID)
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
	}

	/**
	 * DevTool Create & Modify 실행
	 * 
	 * AP 및 MCU 레시피 모두 지원합니다.
	 * 
	 * 실행 단계:
	 * 1. 레시피 선택 (전달되지 않은 경우에만)
	 * 2. 빌드 설정 확인 및 빌드 디렉토리 생성
	 * 3. devtool create-workspace 실행 (workspace가 없을 때만)
	 * 4. devtool modify 실행
	 * 5. telechips-cgw-rev.inc 파일 수정
	 * 
	 * @param onRecipeAdded - 레시피 추가 콜백
	 * @param selectedRecipeName - 선택적 레시피 이름 (webview에서 선택한 경우)
	 */
	static async createAndModify(onRecipeAdded?: (recipeName: string) => void, selectedRecipeName?: string): Promise<void> {
		axonLog('🔧 [DevTool Create & Modify] 시작');

		try {
			// 프로젝트 타입 확인
			const { ensureProjectType } = await import('../../utils');
			const projectType = await ensureProjectType();
			if (!projectType) {
				axonLog('❌ 프로젝트 타입 선택이 취소되었습니다.');
				vscode.window.showInformationMessage('빌드가 취소되었습니다.');
				return;
			}

			// Yocto 프로젝트 루트 자동 탐지
			const yoctoRoot = await YoctoProjectBuilder.getYoctoProjectRoot();
			axonLog(`📁 Yocto 프로젝트 루트: ${yoctoRoot}`);

			// 레시피 선택 (전달되지 않았거나 빈 문자열이거나 "manual"인 경우에만)
			let recipeName: string;
			const trimmedRecipeName = selectedRecipeName?.trim() || '';
			
			// 유효한 레시피 이름인지 확인 (빈 문자열, "manual", "none", "select" 등이 아닌 경우)
			if (trimmedRecipeName !== '' && 
				trimmedRecipeName !== 'manual' && 
				trimmedRecipeName !== 'none' && 
				trimmedRecipeName !== 'select') {
				recipeName = trimmedRecipeName;
				axonLog(`✅ webview에서 선택된 레시피 사용: ${recipeName}`);
			} else {
				axonLog(`📋 레시피 선택 다이얼로그를 표시합니다. (전달된 값: "${trimmedRecipeName}")`);
				const selectedRecipe = await this.selectRecipe();
				if (!selectedRecipe) {
					return;
				}
				recipeName = selectedRecipe;
			}

			axonLog(`✅ 선택된 레시피: ${recipeName}`);

			// 빌드 디렉토리 및 workspace 결정
			const { buildDir, workspaceName } = this.getBuildDirAndWorkspace(recipeName);
			if (this.MCU_RECIPES.includes(recipeName)) {
				axonLog(`ℹ️ MCU 레시피 감지: 빌드 디렉토리를 ${buildDir}로 설정합니다.`);
			}

			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
			}

			// 빌드 설정 확인 (MCU 레시피는 tcn1000-mcu, AP는 config.json에서 가져오기)
			let machine: string;
			let version: string;

			if (this.MCU_RECIPES.includes(recipeName)) {
				machine = 'tcn1000-mcu';
				// MCU 버전은 기본값 사용 (나중에 필요하면 config.json에서 가져오기)
				version = 'dev';
			} else {
				// AP 빌드 설정 확인 (공통 함수 사용)
				const apConfig = await YoctoProjectBuilder.ensureApBuildConfig(yoctoRoot, workspaceFolder);
				if (!apConfig) {
					return;
				}
				machine = apConfig.machine;
				version = apConfig.cgwVersion;
			}

			axonLog(`📂 빌드 디렉토리: ${buildDir}`);
			axonLog(`📋 빌드 설정: MACHINE=${machine}, VERSION=${version}`);

			// buildtools 환경 확인 (공통 함수 사용)
			const envPath = await YoctoProjectBuilder.ensureBuildtoolsEnvironment(yoctoRoot, workspaceFolder);
			if (!envPath) {
				return;
			}

			// 빌드 스크립트 확인
			const buildScript = `${yoctoRoot}/poky/meta-telechips/meta-dev/meta-cgw-dev/cgw-build.sh`;
			if (!(await this.ensureBuildScript(yoctoRoot, workspaceFolder))) {
				return;
			}

			// 빌드 디렉토리 생성
			await this.setupBuildDirectory(yoctoRoot, envPath, buildScript, machine, version, workspaceFolder);

			// DevTool workspace 경로 결정
			const workspacePath = `${yoctoRoot}/external-workspace/${workspaceName}`;
			const workspaceSourcePath = `${workspacePath}/sources`;
			const recipeSourcePath = `${workspaceSourcePath}/${recipeName}`;
			axonLog(`📁 DevTool workspace: ${workspacePath}`);
			axonLog(`📁 Source path: ${recipeSourcePath}`);

			// workspace 존재 여부 확인
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

			// telechips-cgw-rev.inc 업데이트 스크립트 생성
			const updateRevIncScript = this.createUpdateRevIncScript(recipeName, recipeSourcePath, yoctoRoot);

			// workspace가 없을 때만 create-workspace 실행
			const createWorkspaceCommand = workspaceExists
				? `echo "ℹ️  DevTool workspace가 이미 존재하므로 create-workspace를 건너뜁니다: ${workspacePath}"`
				: `devtool create-workspace ${workspacePath}`;

			// devtool modify는 주석 처리됨 (실제로는 수동 실행)
			const devtoolModifyCommand = `devtool modify ${recipeName} "${recipeSourcePath}"`;

			const fullCommand = `cd "${yoctoRoot}"
source poky/oe-init-build-env ${buildDir}
${createWorkspaceCommand}
${devtoolModifyCommand}
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

			const yoctoRootUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: yoctoRoot
			});

			await executeShellTask({
				command: fullCommand,
				cwd: yoctoRoot,
				taskName: `DevTool: ${recipeName}`,
				taskId: `devtoolCreateModify_${recipeName}`,
				showTerminal: true,
				useScriptFile: true,
				cwdUri: yoctoRootUri
			});

			// 레시피 추가 콜백 호출
			if (onRecipeAdded) {
				onRecipeAdded(recipeName);
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
	static async build(recipeName: string): Promise<void> {
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

			// Yocto 프로젝트 루트 자동 탐지 (공통 함수 사용)
			const yoctoRoot = await YoctoProjectBuilder.getYoctoProjectRoot();

			// 빌드 디렉토리 결정
			const { buildDir } = this.getBuildDirAndWorkspace(recipeName);
			axonLog(`📂 빌드 디렉토리: ${buildDir}`);

			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
			}

			// buildtools 환경 확인 (공통 함수 사용)
			const envPath = await YoctoProjectBuilder.ensureBuildtoolsEnvironment(yoctoRoot, workspaceFolder);
			if (!envPath) {
				return;
			}

			// 빌드 디렉토리 설정 (공통 함수 사용)
			const setupSuccess = await YoctoProjectBuilder.setupBuildDirectoryWithOeInit(
				yoctoRoot,
				envPath,
				buildDir,
				workspaceFolder
			);
			if (!setupSuccess) {
				return;
			}

			// local.conf 파일 수정 (공통 함수 사용)
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

			// 빌드 명령 실행 (공통 함수 사용)
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

	/**
	 * DevTool Update-Recipe 실행
	 * 
	 * @param recipeName - 업데이트할 레시피 이름
	 */
	static async updateRecipe(recipeName: string): Promise<void> {
		axonLog(`🔄 [DevTool Update-Recipe] 시작: ${recipeName}`);

		try {
			// 실행 확인 다이얼로그
			const confirmMessage = `'${recipeName}' 레시피를 업데이트하시겠습니까?\n\n실행 명령:\n- devtool update-recipe ${recipeName}`;

			const confirm = await vscode.window.showInformationMessage(
				confirmMessage,
				{ modal: true },
				'확인',
				'취소'
			);

			if (confirm !== '확인') {
				axonLog('❌ 사용자가 업데이트를 취소했습니다.');
				return;
			}

			// Yocto 프로젝트 루트 자동 탐지 (공통 함수 사용)
			const yoctoRoot = await YoctoProjectBuilder.getYoctoProjectRoot();

			// 빌드 디렉토리 결정
			const { buildDir } = this.getBuildDirAndWorkspace(recipeName);
			axonLog(`📂 빌드 디렉토리: ${buildDir}`);

			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
			}

			// buildtools 환경 확인 (공통 함수 사용)
			const envPath = await YoctoProjectBuilder.ensureBuildtoolsEnvironment(yoctoRoot, workspaceFolder);
			if (!envPath) {
				return;
			}

			// 빌드 디렉토리 설정 (공통 함수 사용)
			const setupSuccess = await YoctoProjectBuilder.setupBuildDirectoryWithOeInit(
				yoctoRoot,
				envPath,
				buildDir,
				workspaceFolder
			);
			if (!setupSuccess) {
				return;
			}

			// local.conf 파일 수정 (공통 함수 사용)
			const fullBuildDir = `${yoctoRoot}/${buildDir}`;
			axonLog('📝 local.conf 파일 수정 중...');
			await YoctoProjectBuilder.updateLocalConfCachePaths(fullBuildDir, workspaceFolder);

			// 업데이트 명령 구성
			const updateCommands: string[] = [
				`devtool update-recipe ${recipeName}`
			];

			// 성공 메시지 추가
			updateCommands.push(
				`echo ""`,
				`echo "=========================================="`,
				`echo "✅ DevTool Update-Recipe가 성공적으로 완료되었습니다!"`,
				`echo "   레시피: ${recipeName}"`,
				`echo "   빌드 환경: ${buildDir}"`,
				`echo "=========================================="`,
				`echo ""`
			);

			// 업데이트 명령 실행 (공통 함수 사용)
			await YoctoProjectBuilder.executeBuildCommand(
				yoctoRoot,
				envPath,
				buildDir,
				updateCommands,
				`DevTool Update-Recipe: ${recipeName}`,
				`devtoolUpdateRecipe_${recipeName}`,
				workspaceFolder
			);

			axonSuccess(`✅ DevTool Update-Recipe가 시작되었습니다!\n레시피: ${recipeName}`);

		} catch (error) {
			const errorMsg = `DevTool Update-Recipe 실행 중 오류 발생: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
		}
	}

	/**
	 * DevTool Finish 실행
	 * 
	 * @param recipeName - finish할 레시피 이름
	 * @param layerPath - 레이어 경로 (선택적, 없으면 다이얼로그 표시)
	 */
	static async finish(recipeName: string, layerPath?: string): Promise<void> {
		axonLog(`✅ [DevTool Finish] 시작: ${recipeName}`);

		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
			}

			// Layer 경로 선택 (전달되지 않은 경우 파일 탐색기로 선택)
			// ⚠️ 중요: 리눅스 환경이므로 항상 슬래시('/') 형식의 경로를 사용해야 함
			// Windows 경로 형식(역슬래시 '\')을 사용하면 안 됨
			let selectedLayerPath: string;
			if (layerPath && layerPath.trim() !== '') {
				selectedLayerPath = layerPath.trim();
				axonLog(`✅ webview에서 선택된 layer 경로 사용: ${selectedLayerPath}`);
			} else {
				// 파일 탐색기를 열어서 폴더 선택 (워크스페이스 루트를 시작 위치로 설정)
				const folders = await vscode.window.showOpenDialog({
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
					openLabel: 'Layer 폴더 선택',
					title: `'${recipeName}' 레시피를 위한 layer 폴더를 선택하세요`,
					defaultUri: workspaceFolder.uri // 워크스페이스 루트를 시작 위치로 설정
				});

				if (!folders || folders.length === 0) {
					axonLog('❌ 사용자가 layer 폴더 선택을 취소했습니다.');
					return;
				}

				// 리눅스/원격 환경에서는 path 속성 사용 (항상 슬래시)
				// fsPath는 Windows 스타일(역슬래시)로 변환될 수 있으므로 사용하지 않음
				const folderUri = folders[0];
				if (folderUri.scheme === 'file' || folderUri.scheme.startsWith('vscode-remote')) {
					// Unix 스타일 경로로 정규화 (역슬래시를 슬래시로 변환)
					selectedLayerPath = folderUri.path;
					// 원격 환경에서 path는 /home/... 형식이므로 그대로 사용
				} else {
					// 기타 환경에서는 fsPath 사용 후 정규화
					selectedLayerPath = folderUri.fsPath.replace(/\\/g, '/');
				}
				axonLog(`✅ 선택된 layer 경로: ${selectedLayerPath}`);
			}

			// 실행 확인 다이얼로그
			const confirmMessage = `'${recipeName}' 레시피를 finish하시겠습니까?\n\n실행 명령:\n- devtool finish ${recipeName} "${selectedLayerPath}"`;

			const confirm = await vscode.window.showInformationMessage(
				confirmMessage,
				{ modal: true },
				'확인',
				'취소'
			);

			if (confirm !== '확인') {
				axonLog('❌ 사용자가 finish를 취소했습니다.');
				return;
			}

			// Yocto 프로젝트 루트 자동 탐지 (공통 함수 사용)
			const yoctoRoot = await YoctoProjectBuilder.getYoctoProjectRoot();

			// 빌드 디렉토리 결정
			const { buildDir } = this.getBuildDirAndWorkspace(recipeName);
			axonLog(`📂 빌드 디렉토리: ${buildDir}`);

			// buildtools 환경 확인 (공통 함수 사용)
			const envPath = await YoctoProjectBuilder.ensureBuildtoolsEnvironment(yoctoRoot, workspaceFolder);
			if (!envPath) {
				return;
			}

			// 빌드 디렉토리 설정 (공통 함수 사용)
			const setupSuccess = await YoctoProjectBuilder.setupBuildDirectoryWithOeInit(
				yoctoRoot,
				envPath,
				buildDir,
				workspaceFolder
			);
			if (!setupSuccess) {
				return;
			}

			// local.conf 파일 수정 (공통 함수 사용)
			const fullBuildDir = `${yoctoRoot}/${buildDir}`;
			axonLog('📝 local.conf 파일 수정 중...');
			await YoctoProjectBuilder.updateLocalConfCachePaths(fullBuildDir, workspaceFolder);

			// finish 명령 구성 (경로에 공백이 있을 수 있으므로 따옴표로 감싸기)
			const finishCommands: string[] = [
				`devtool finish ${recipeName} "${selectedLayerPath}"`
			];

			// 성공 메시지 추가
			finishCommands.push(
				`echo ""`,
				`echo "=========================================="`,
				`echo "✅ DevTool Finish가 성공적으로 완료되었습니다!"`,
				`echo "   레시피: ${recipeName}"`,
				`echo "   Layer: ${selectedLayerPath}"`,
				`echo "   빌드 환경: ${buildDir}"`,
				`echo "=========================================="`,
				`echo ""`
			);

			// finish 명령 실행 (공통 함수 사용)
			await YoctoProjectBuilder.executeBuildCommand(
				yoctoRoot,
				envPath,
				buildDir,
				finishCommands,
				`DevTool Finish: ${recipeName}`,
				`devtoolFinish_${recipeName}`,
				workspaceFolder
			);

			axonSuccess(`✅ DevTool Finish가 시작되었습니다!\n레시피: ${recipeName}\nLayer: ${selectedLayerPath}`);

		} catch (error) {
			const errorMsg = `DevTool Finish 실행 중 오류 발생: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
		}
	}
}

