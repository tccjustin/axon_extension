import * as vscode from 'vscode';
import { axonLog, axonError, axonSuccess } from '../../logger';
import { executeShellTask, findProjectRootByShell, executePythonScript } from '../common/shell-utils';

/**
 * MCU 작업 설정 인터페이스
 */
interface McuTaskConfig {
	taskName: string;
	taskId: string;
	cancelMsg: string;
	confirmButton: string;
	getCommand: (mcuBuildPath: string) => string;
	getConfigInfo: (mcuBuildPath: string) => string;
	getConfirmMsg: (mcuBuildPath: string) => string;
}

/**
 * MCU 프로젝트 빌드 관련 기능
 */
export class McuProjectBuilder {
	/**
	 * 작업 완료 후 터미널 닫기 확인 팝업
	 */
	private static async askToCloseTerminal(taskName: string): Promise<void> {
		const result = await vscode.window.showInformationMessage(
			`${taskName}가 완료되었습니다.\n터미널을 닫겠습니까?`,
			{ modal: true },
			'Yes',
			'No'
		);
		
		if (result === 'Yes') {
			const activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal) {
				axonLog(`✅ 사용자가 터미널 닫기를 선택했습니다. 터미널을 닫습니다.`);
				activeTerminal.dispose();
			} else {
				axonLog(`⚠️ 활성 터미널이 없습니다.`);
			}
		} else {
			axonLog(`ℹ️ 사용자가 터미널을 열어둡니다.`);
		}
	}

	/**
	 * settings.json 업데이트 함수
	 */
	private static async updateSettingsJson(
		workspaceFolder: vscode.WorkspaceFolder,
		settings: Record<string, any>
	): Promise<void> {
		const vscodeFolder = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
		
		// .vscode 폴더 생성
		try {
			await vscode.workspace.fs.createDirectory(vscodeFolder);
		} catch {
			// 이미 존재하는 경우 무시
		}
		
		// settings.json 파일 경로
		const settingsFile = vscode.Uri.joinPath(vscodeFolder, 'settings.json');
		
		// 기존 settings.json 읽기 (있으면)
		let existingSettings: any = {};
		try {
			const existingContent = await vscode.workspace.fs.readFile(settingsFile);
			let existingText = Buffer.from(existingContent).toString('utf8');
			
			if (existingText.trim() === '') {
				axonLog(`⚠️ settings.json 파일이 비어있습니다.`);
			} else {
				// VS Code settings.json은 주석과 trailing comma를 허용하므로 전처리 필요
				// 1. 줄 단위 주석 제거 (// 로 시작하는 주석)
				existingText = existingText.replace(/\/\/.*$/gm, '');
				// 2. 블록 주석 제거 (/* ... */)
				existingText = existingText.replace(/\/\*[\s\S]*?\*\//g, '');
				// 3. trailing comma 제거 (객체/배열의 마지막 쉼표)
				existingText = existingText.replace(/,(\s*[}\]])/g, '$1');
				
				existingSettings = JSON.parse(existingText);
				axonLog(`📖 기존 settings.json 파일을 읽었습니다.`);
				axonLog(`   기존 설정 키 개수: ${Object.keys(existingSettings).length}`);
				axonLog(`   기존 설정 키 목록: ${Object.keys(existingSettings).join(', ')}`);
			}
		} catch (error) {
			// 파일이 없거나 파싱 실패한 경우 빈 객체 사용
			if (error instanceof Error) {
				axonLog(`⚠️ settings.json 읽기 실패: ${error.message}`);
			} else {
				axonLog(`⚠️ settings.json 읽기 실패: ${error}`);
			}
			axonLog(`📝 새로운 settings.json 파일을 생성합니다.`);
		}
		
		// 설정 추가 또는 업데이트
		axonLog(`➕ 추가할 설정: ${JSON.stringify(settings)}`);
		Object.assign(existingSettings, settings);
		axonLog(`📋 병합 후 설정 키 개수: ${Object.keys(existingSettings).length}`);
		axonLog(`📋 병합 후 설정 키 목록: ${Object.keys(existingSettings).join(', ')}`);
		
		// JSON 문자열로 변환 (들여쓰기 포함)
		const settingsContent = JSON.stringify(existingSettings, null, 4);
		
		// 파일 쓰기
		try {
			await vscode.workspace.fs.writeFile(settingsFile, Buffer.from(settingsContent, 'utf8'));
			axonLog(`✅ settings.json 파일 저장 완료: ${settingsFile.path}`);
		} catch (error) {
			axonLog(`❌ settings.json 파일 쓰기 실패: ${error}`);
			if (error instanceof Error) {
				axonLog(`   오류 상세: ${error.message}`);
			}
			throw error;
		}
	}

	/**
	 * 리눅스 shell 스크립트로 MCU 프로젝트 루트 찾기
	 * tcn100x_defconfig 파일을 찾아서 상위 3단계 디렉토리의 절대 경로를 계산하고 임시 파일에 저장
	 * 
	 * 예: ./mcu-tcn100x/build/configs/tcn100x_defconfig → ./mcu-tcn100x
	 * 
	 * @param workspaceFolder - 워크스페이스 폴더
	 * @returns 프로젝트 루트의 절대 경로 또는 null
	 */
	private static async findMcuProjectRootByShell(workspaceFolder: vscode.WorkspaceFolder): Promise<string | null> {
		return await findProjectRootByShell({
			workspaceFolder,
			findPattern: 'tcn100x_defconfig',
			maxDepth: 4,
			findType: 'f',
			parentLevels: 3,
			taskName: 'Find MCU Project Root',
			taskId: 'find-mcu-root',
			resultFilePrefix: 'axon_mcu_project_root'
		});
	}

	/**
	 * MCU 프로젝트 루트 경로 찾기
	 * 
	 * 전략:
	 * 1. .vscode/settings.json 파일을 직접 읽어서 axon.mcu.projectRoot 확인
	 * 2. root가 있으면 반환
	 * 3. root가 없으면 리눅스 shell 스크립트로 tcn100x_defconfig 찾기 + 절대 경로 계산 + 임시 파일 저장
	 * 4. 임시 파일 읽어서 settings.json에 저장 후 반환
	 * 
	 * @returns Unix 경로 형식 문자열 (/home/..., /mnt/..., 등)
	 */
	static async getMcuProjectRoot(): Promise<string> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error(
				'워크스페이스 폴더를 찾을 수 없습니다.\n\n' +
				'해결 방법:\n' +
				'1. VS Code에서 "파일 > 폴더 열기"를 선택하세요.\n' +
				'2. MCU 프로젝트가 있는 폴더를 선택하세요.\n' +
				'3. 폴더가 열린 후 다시 빌드를 실행하세요.'
			);
		}
		
		// Unix 경로 사용 (원격 환경 기본)
		const workspacePath = workspaceFolder.uri.path;
		axonLog(`🌐 환경: WSL/SSH (scheme: ${workspaceFolder.uri.scheme})`);
		axonLog(`📁 워크스페이스 경로: ${workspacePath}`);
		
		// 1. settings.json 파일 직접 읽기
		const vscodeFolder = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
		const settingsFile = vscode.Uri.joinPath(vscodeFolder, 'settings.json');
		
		let savedProjectRoot: string | undefined;
		
		try {
			const settingsContent = await vscode.workspace.fs.readFile(settingsFile);
			const settingsText = Buffer.from(settingsContent).toString('utf8');
			const settings = JSON.parse(settingsText);
			savedProjectRoot = settings['axon.mcu.projectRoot'];
			
			if (savedProjectRoot && savedProjectRoot.trim() !== '') {
				axonLog(`🔍 저장된 MCU 프로젝트 루트 확인 중: ${savedProjectRoot}`);
				
				// 저장된 경로 유효성 검증
				try {
					const savedUri = vscode.Uri.from({
						scheme: workspaceFolder.uri.scheme,
						authority: workspaceFolder.uri.authority,
						path: savedProjectRoot
					});
					
					const defconfigUri = vscode.Uri.joinPath(savedUri, 'build/configs/tcn100x_defconfig');
					const stat = await vscode.workspace.fs.stat(defconfigUri);
					
					if (stat.type === vscode.FileType.File) {
						axonLog(`✅ 저장된 MCU 프로젝트 루트 사용: ${savedProjectRoot}`);
						return savedProjectRoot;
					}
				} catch {
					axonLog(`⚠️ 저장된 경로에 tcn100x_defconfig 파일이 없습니다. 재탐색을 시작합니다.`);
				}
			}
		} catch (error) {
			// settings.json 파일이 없거나 읽기 실패한 경우 (정상적인 경우)
			axonLog(`📝 settings.json 파일을 읽을 수 없습니다. 새로 탐색합니다.`);
		}
		
		// 2. root가 없으면 리눅스 shell 스크립트로 찾기
		axonLog('🔍 tcn100x_defconfig 파일을 찾아 MCU 프로젝트 루트 탐지 중...');
		const projectRoot = await this.findMcuProjectRootByShell(workspaceFolder);
		
		if (projectRoot) {
			axonLog(`✅ MCU 프로젝트 루트 발견: ${projectRoot}`);
			
			// 3. settings.json에 저장
			try {
				axonLog(`💾 settings.json에 프로젝트 루트 저장 시도: ${projectRoot}`);
				await this.updateSettingsJson(workspaceFolder, { 'axon.mcu.projectRoot': projectRoot });
				axonLog(`✅ MCU 프로젝트 루트를 settings.json에 저장했습니다.`);
			} catch (error) {
				axonLog(`⚠️ settings.json 저장 실패: ${error}`);
				if (error instanceof Error) {
					axonLog(`   오류 상세: ${error.message}`);
					axonLog(`   스택: ${error.stack}`);
				}
				// 저장 실패해도 경로는 반환
			}
			
			return projectRoot;
		}
		
		// 찾지 못한 경우
		throw new Error(
			`MCU 프로젝트 루트를 찾을 수 없습니다.\n\n` +
			`확인 사항:\n` +
			`- tcn100x_defconfig 파일이 워크스페이스 또는 그 하위 4단계까지 있는지 확인하세요.\n` +
			`- 워크스페이스: ${workspacePath}`
		);
	}

	/**
	 * MCU 작업 공통 실행 함수
	 */
	private static async executeMcuTask(config: McuTaskConfig): Promise<void> {
		axonLog(`🚀 ${config.taskName} 실행 명령 시작 (MCU Standalone 프로젝트)`);
		axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

		try {
			// 프로젝트 타입 확인
			const { ensureProjectType } = await import('../../utils');
			const projectType = await ensureProjectType();
			if (!projectType) {
				axonLog('❌ 프로젝트 타입 선택이 취소되었습니다.');
				vscode.window.showInformationMessage(config.cancelMsg);
				return;
			}
			
			// 1. MCU 프로젝트 루트 찾기 (Unix 경로)
			const projectRoot = await this.getMcuProjectRoot();
			axonLog(`📁 MCU 프로젝트 루트: ${projectRoot}`);
			
			// 워크스페이스 폴더
			const workspaceFolder = vscode.workspace.workspaceFolders![0];
			
			// 2. 빌드 경로 계산 (프로젝트 루트가 빌드 경로)
			const mcuBuildPath = projectRoot;
			axonLog(`📁 빌드 경로: ${mcuBuildPath}`);

			// 3. 작업별 명령 및 메시지 생성
			const command = config.getCommand(mcuBuildPath);
			const configInfo = config.getConfigInfo(mcuBuildPath);
			const confirmMsg = config.getConfirmMsg(mcuBuildPath);
			
			axonLog(configInfo);
			
			// 4. 사용자 확인
			const confirm = await vscode.window.showWarningMessage(
				confirmMsg,
				{ modal: true },
				config.confirmButton,
				'취소'
			);
			
			if (confirm !== config.confirmButton) {
				axonLog(`❌ 사용자 취소: ${config.cancelMsg}`);
				vscode.window.showInformationMessage(config.cancelMsg);
				return;
			}

		axonLog(`🔨 실행할 명령 준비 완료`);
		
		await executeShellTask({
			command: command,
			cwd: mcuBuildPath,
			taskName: config.taskName,
			taskId: config.taskId,
			showTerminal: true,
			useScriptFile: true
		});
		
		// Build View에 포커스 복원
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);
		
		axonLog(`✅ ${config.taskName} 실행 완료`);
		vscode.window.showInformationMessage(`${config.taskName}이 완료되었습니다!`);
		
		// 터미널 닫기 확인 팝업
		await this.askToCloseTerminal(config.taskName);

	} catch (error) {
		const errorMsg = `${config.taskName} 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
	}

	/**
	 * MCU 빌드 make 실행 (단일 코어)
	 */
	static async buildMake(core: string): Promise<void> {
		// 선택한 코어 확인
		if (!core) {
			axonLog('❌ 선택된 코어가 없습니다.');
			vscode.window.showErrorMessage('빌드할 코어를 선택해주세요.');
			return;
		}
		
		axonLog(`🎯 선택된 코어: ${core}`);
		const defconfig = `tcn100x_${core}_defconfig`;
		
		await this.executeMcuTask({
			taskName: `MCU Build Make: ${core} (${defconfig})`,
			taskId: `mcuBuildMake_${core}`,
			cancelMsg: '빌드가 취소되었습니다.',
			confirmButton: '빌드 시작',
			getCommand: (mcuBuildPath) => `
#set -x
cd "${mcuBuildPath}"
make ${defconfig}
make

echo ""
echo "=========================================="
echo "✅ MCU Build Make가 완료되었습니다!"
echo "   코어: ${core}"
echo "   Defconfig: ${defconfig}"
echo "=========================================="
echo ""
`,
			getConfigInfo: (mcuBuildPath) => [
				'',
				'==================================================',
				'         MCU Build Make Configuration',
				'==================================================',
				`  빌드 경로: ${mcuBuildPath}`,
				`  선택된 코어: ${core}`,
				`  Defconfig: ${defconfig}`,
				`  명령: make ${defconfig} && make`,
				'==================================================',
				''
			].join('\n'),
			getConfirmMsg: (mcuBuildPath) => 
				`MCU Build Make를 시작하시겠습니까?\n\n경로: ${mcuBuildPath}\n코어: ${core}\n명령: make ${defconfig} && make\n\n이 작업은 시간이 걸릴 수 있습니다.`
		});
	}

	/**
	 * MCU 전체 빌드 실행
	 */
	static async buildAll(): Promise<void> {
		await this.executeMcuTask({
			taskName: 'MCU Build All',
			taskId: 'mcuBuildAll',
			cancelMsg: '빌드가 취소되었습니다.',
			confirmButton: '빌드 시작',
			getCommand: (mcuBuildPath) => `
#set -x
cd "${mcuBuildPath}"

echo "=========================================="
echo "🔨 MCU Build All 시작"
echo "=========================================="
echo ""

echo "1/4: Building m7-np..."
make tcn100x_m7-np_defconfig
make

echo ""
echo "2/4: Building m7-0..."
make tcn100x_m7-0_defconfig
make

echo ""
echo "3/4: Building m7-2..."
make tcn100x_m7-2_defconfig
make

echo ""
echo "4/4: Building m7-1..."
make tcn100x_m7-1_defconfig
make

echo ""
echo "=========================================="
echo "✅ MCU Build All이 완료되었습니다!"
echo "   빌드된 코어: m7-np, m7-0, m7-2, m7-1"
echo "=========================================="
echo ""
`,
			getConfigInfo: (mcuBuildPath) => [
				'',
				'==================================================',
				'        MCU Build All Configuration',
				'==================================================',
				`  빌드 경로: ${mcuBuildPath}`,
				`  실행 순서:`,
				`    1. make tcn100x_m7-np_defconfig && make`,
				`    2. make tcn100x_m7-0_defconfig && make`,
				`    3. make tcn100x_m7-2_defconfig && make`,
				`    4. make tcn100x_m7-1_defconfig && make`,
				'==================================================',
				''
			].join('\n'),
			getConfirmMsg: (mcuBuildPath) => 
				`MCU Build All을 시작하시겠습니까?\n\n경로: ${mcuBuildPath}\n\n실행 순서:\n1. m7-np (defconfig + make)\n2. m7-0 (defconfig + make)\n3. m7-2 (defconfig + make)\n4. m7-1 (defconfig + make)\n\n이 작업은 시간이 오래 걸릴 수 있습니다.`
		});
	}

	/**
	 * MCU 클린 빌드 실행 (JSON 기반)
	 */
	static async cleanBuild(): Promise<void> {
		// mcu.commands.json의 'clean' 그룹 실행
		await this.runMcuJsonGroup('clean');
	}

	/**
	 * Bear 설치 확인 및 설치
	 * @returns Bear가 설치되어 있으면 true, 설치 실패 시 false
	 */
	private static async ensureBearInstalled(): Promise<boolean> {
		axonLog('🔍 Bear 설치 확인 중...');
		
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
		}

		// Bear 설치 확인: bear --version 명령어 실행
		// 성공하면 설치되어 있음, 실패하면 설치되지 않음
		const checkScript = `#!/bin/bash
bear --version > /dev/null 2>&1
exit $?
`;

		try {
			await executeShellTask({
				command: checkScript,
				cwd: workspaceFolder.uri.path,
				taskName: 'Check Bear Installation',
				taskId: 'check-bear',
				showTerminal: false,
				useScriptFile: true
			});

			// executeShellTask가 성공적으로 완료되면 (exit code 0) Bear가 설치되어 있음
			axonLog('✅ Bear가 이미 설치되어 있습니다.');
			return true;
		} catch {
			// executeShellTask가 실패하면 (exit code != 0) Bear가 설치되어 있지 않음
			axonLog('⚠️ Bear가 설치되어 있지 않습니다.');
		}

		// Bear 설치 확인 메시지 표시
		const installConfirm = await vscode.window.showWarningMessage(
			'Bear가 설치되어 있지 않습니다.\n\nBear는 compile_commands.json을 생성하기 위한 도구입니다.\n\nBear를 설치하시겠습니까?',
			{ modal: true },
			'설치',
			'취소'
		);

		if (installConfirm !== '설치') {
			axonLog('❌ Bear 설치가 취소되었습니다.');
			return false;
		}

		// Bear 설치 실행
		axonLog('📦 Bear 설치 중...');
		const installScript = `#!/bin/bash
set -e

echo "=========================================="
echo "📦 Bear 설치 시작"
echo "=========================================="
echo ""

# 패키지 매니저 확인 및 설치
if command -v apt-get &> /dev/null; then
    echo "apt-get을 사용하여 Bear 설치 중..."
    sudo apt-get update
    sudo apt-get install -y bear
elif command -v apt &> /dev/null; then
    echo "apt를 사용하여 Bear 설치 중..."
    sudo apt update
    sudo apt install -y bear
elif command -v yum &> /dev/null; then
    echo "yum을 사용하여 Bear 설치 중..."
    sudo yum install -y bear
elif command -v dnf &> /dev/null; then
    echo "dnf를 사용하여 Bear 설치 중..."
    sudo dnf install -y bear
else
    echo "❌ 지원되는 패키지 매니저를 찾을 수 없습니다."
    echo "   수동으로 Bear를 설치해주세요."
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ Bear 설치 완료"
echo "=========================================="
echo ""
bear --version
`;

		try {
			await executeShellTask({
				command: installScript,
				cwd: workspaceFolder.uri.path,
				taskName: 'Install Bear',
				taskId: 'install-bear',
				showTerminal: true,
				useScriptFile: true
			});
			axonLog('✅ Bear 설치가 완료되었습니다.');
			return true;
		} catch (error) {
			const errorMsg = `Bear 설치 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return false;
		}
	}

	/**
	 * Build Option Extraction 실행
	 * MCU 프로젝트 루트에서 bear make를 실행하여 compile_commands.json 생성
	 */
	static async buildOptionExtraction(): Promise<void> {
		axonLog('🔧 Build Option Extraction 시작');

		try {
			// 프로젝트 타입 확인
			const { ensureProjectType } = await import('../../utils');
			const projectType = await ensureProjectType();
			if (!projectType) {
				axonLog('❌ 프로젝트 타입 선택이 취소되었습니다.');
				vscode.window.showInformationMessage('프로젝트 타입을 선택해야 합니다.');
				return;
			}

			if (projectType !== 'mcu_project') {
				vscode.window.showErrorMessage('Build Option Extraction은 MCU 프로젝트에서만 사용할 수 있습니다.');
				return;
			}

			// MCU 프로젝트 루트 찾기
			const projectRoot = await this.getMcuProjectRoot();
			axonLog(`📁 MCU 프로젝트 루트: ${projectRoot}`);

			// Bear 설치 확인 및 설치
			const bearInstalled = await this.ensureBearInstalled();
			if (!bearInstalled) {
				vscode.window.showErrorMessage('Bear 설치가 필요합니다. Build Option Extraction을 실행할 수 없습니다.');
				return;
			}

			// 사용자 확인
			const confirm = await vscode.window.showWarningMessage(
				`Build Option Extraction을 시작하시겠습니까?\n\n경로: ${projectRoot}\n명령: bear make\n\n이 작업은 전체 빌드를 수행하며 시간이 걸릴 수 있습니다.`,
				{ modal: true },
				'시작',
				'취소'
			);

			if (confirm !== '시작') {
				axonLog('❌ Build Option Extraction이 취소되었습니다.');
				vscode.window.showInformationMessage('Build Option Extraction이 취소되었습니다.');
				return;
			}

			// bear make 실행
			const command = `
#set -x
cd "${projectRoot}"

echo "=========================================="
echo "🔧 Build Option Extraction 시작"
echo "=========================================="
echo ""
echo "Bear를 사용하여 compile_commands.json 생성 중..."
echo ""

bear make

echo ""
echo "=========================================="
echo "✅ Build Option Extraction 완료"
echo "=========================================="
echo ""

# compile_commands.json 파일 확인
if [ -f "compile_commands.json" ]; then
    echo "✅ compile_commands.json 파일이 생성되었습니다!"
    echo "   위치: ${projectRoot}/compile_commands.json"
    FILE_SIZE=$(stat -c%s "compile_commands.json" 2>/dev/null || stat -f%z "compile_commands.json" 2>/dev/null || echo "unknown")
    echo "   파일 크기: \${FILE_SIZE} bytes"
else
    echo "⚠️ compile_commands.json 파일이 생성되지 않았습니다."
    echo "   빌드가 성공적으로 완료되었는지 확인하세요."
fi

echo ""
`;

			await executeShellTask({
				command: command,
				cwd: projectRoot,
				taskName: 'Build Option Extraction',
				taskId: 'buildOptionExtraction',
				showTerminal: true,
				useScriptFile: true
			});

			// compile_commands.json 파일 확인
			const workspaceFolder = vscode.workspace.workspaceFolders![0];
			const compileCommandsUri = vscode.Uri.joinPath(
				vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: projectRoot
				}),
				'compile_commands.json'
			);

			try {
				const stat = await vscode.workspace.fs.stat(compileCommandsUri);
				if (stat.type === vscode.FileType.File) {
					axonLog('✅ compile_commands.json 파일이 생성되었습니다.');
					
					// compile_commands.json에서 defines 추출하여 c_cpp_properties.json 업데이트
					await this.updateCppPropertiesFromCompileCommands(projectRoot, workspaceFolder);
					
					axonSuccess(`✅ Build Option Extraction이 완료되었습니다!\ncompile_commands.json 파일이 생성되었습니다.\nc_cpp_properties.json이 업데이트되었습니다.\n위치: ${projectRoot}/compile_commands.json`);
				} else {
					axonLog('⚠️ compile_commands.json 파일이 생성되지 않았습니다.');
					vscode.window.showWarningMessage('compile_commands.json 파일이 생성되지 않았습니다. 빌드가 성공적으로 완료되었는지 확인하세요.');
				}
			} catch {
				axonLog('⚠️ compile_commands.json 파일을 확인할 수 없습니다.');
				vscode.window.showWarningMessage('compile_commands.json 파일을 확인할 수 없습니다.');
			}

		} catch (error) {
			const errorMsg = `Build Option Extraction 실행 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
		}
	}

	/**
	 * compile_commands.json에서 defines를 추출하여 c_cpp_properties.json 업데이트
	 * @param projectRoot - MCU 프로젝트 루트 경로 (Makefile이 있는 폴더)
	 * @param workspaceFolder - 워크스페이스 폴더
	 */
	private static async updateCppPropertiesFromCompileCommands(
		projectRoot: string,
		workspaceFolder: vscode.WorkspaceFolder
	): Promise<void> {
		axonLog('🔧 c_cpp_properties.json 업데이트 시작...');
		
		// 워크스페이스 루트 경로
		const workspaceRoot = workspaceFolder.uri.path;
		axonLog(`📁 워크스페이스 루트: ${workspaceRoot}`);
		axonLog(`📁 프로젝트 루트: ${projectRoot}`);

		const pythonCode = `
import json
import os
import re

# 경로 설정
# compile_commands.json은 프로젝트 루트(현재 작업 디렉토리)에 있음
compile_commands_path = 'compile_commands.json'

# c_cpp_properties.json은 워크스페이스 루트의 .vscode 폴더에 있어야 함
workspace_root = '${workspaceRoot}'
vscode_folder = os.path.join(workspace_root, '.vscode')
c_cpp_properties_path = os.path.join(vscode_folder, 'c_cpp_properties.json')

print(f"📁 compile_commands.json 경로: {os.path.abspath(compile_commands_path)}")
print(f"📁 c_cpp_properties.json 경로: {c_cpp_properties_path}")

# compile_commands.json 파일 읽기
try:
    with open(compile_commands_path, 'r') as f:
        compile_commands = json.load(f)
except FileNotFoundError:
    print(f"❌ compile_commands.json 파일을 찾을 수 없습니다: {compile_commands_path}")
    exit(1)
except json.JSONDecodeError as e:
    print(f"❌ compile_commands.json 파싱 오류: {e}")
    exit(1)

# defines 추출 (-D로 시작하는 옵션)
defines = set()
# 패턴: -D 뒤에 매크로 이름 (언더스코어, 숫자, 알파벳 포함)
# 예: -DMACRO, -D MACRO, -DMACRO=value, -D__MACRO__, -D MACRO=VALUE
define_pattern1 = re.compile(r'-D([A-Za-z_][A-Za-z0-9_]*)')  # -DMACRO 형식 (언더스코어 포함)
define_pattern2 = re.compile(r'-D\s+([A-Za-z_][A-Za-z0-9_]*)')  # -D MACRO 형식 (공백 포함)

print(f"📋 compile_commands.json 항목 개수: {len(compile_commands)}")

for idx, command in enumerate(compile_commands):
    arguments = command.get('arguments', [])
    if not arguments:
        # arguments가 없으면 command 문자열에서 추출
        command_str = command.get('command', '')
        if command_str:
            arguments = command_str.split()
            print(f"  [{idx}] command 문자열에서 추출: {len(arguments)}개 인자")
    else:
        print(f"  [{idx}] arguments 배열 사용: {len(arguments)}개 인자")
    
    if not arguments:
        print(f"  [{idx}] ⚠️ 인자를 찾을 수 없습니다.")
        continue
    
    # 디버깅: 처음 몇 개 항목만 출력
    if idx < 3:
        print(f"  [{idx}] 처음 10개 인자: {arguments[:10]}")
    
    for arg_idx, arg in enumerate(arguments):
        # 패턴 1: -DMACRO 또는 -DMACRO=value 또는 -D__MACRO__
        match1 = define_pattern1.match(arg)
        if match1:
            define_name = match1.group(1)
            defines.add(define_name)
            if len(defines) <= 20:  # 처음 20개만 출력
                print(f"    ✅ 매칭: {arg} -> {define_name}")
            continue
        
        # 패턴 2: -D MACRO (공백 포함) - 다음 인자가 매크로 이름일 수 있음
        if arg == '-D' and arg_idx + 1 < len(arguments):
            next_arg = arguments[arg_idx + 1]
            # 다음 인자가 매크로 이름인지 확인 (언더스코어, 알파벳, 숫자로 시작)
            if re.match(r'^[A-Za-z_][A-Za-z0-9_]*', next_arg):
                # = 포함 여부 확인
                if '=' in next_arg:
                    define_name = next_arg.split('=', 1)[0]
                else:
                    define_name = next_arg
                defines.add(define_name)
                if len(defines) <= 20:
                    print(f"    ✅ 매칭: {arg} {next_arg} -> {define_name}")
            continue
        
        # 패턴 3: -D로 시작하지만 = 포함 (예: -DMACRO=VALUE)
        if arg.startswith('-D') and '=' in arg:
            # -DMACRO=VALUE 형식에서 MACRO만 추출
            # = 앞의 부분에서 매크로 이름 추출
            value_part = arg[2:]  # -D 제거
            equal_idx = value_part.find('=')
            if equal_idx > 0:
                define_name = value_part[:equal_idx]
                # 매크로 이름이 유효한지 확인 (언더스코어, 알파벳, 숫자만)
                if re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', define_name):
                    defines.add(define_name)
                    if len(defines) <= 20:
                        print(f"    ✅ 매칭: {arg} -> {define_name}")

# defines를 정렬된 리스트로 변환
defines_list = sorted(list(defines))
print(f"✅ 추출된 defines 개수: {len(defines_list)}")
if defines_list:
    print(f"   처음 10개: {defines_list[:10]}")

# 워크스페이스 루트의 .vscode 폴더가 없으면 생성
if not os.path.exists(vscode_folder):
    os.makedirs(vscode_folder)
    print(f"✅ 워크스페이스 루트의 .vscode 폴더 생성: {vscode_folder}")
else:
    print(f"✅ 워크스페이스 루트의 .vscode 폴더 존재 확인: {vscode_folder}")

# c_cpp_properties.json 파일 읽기 또는 생성
if os.path.exists(c_cpp_properties_path):
    try:
        with open(c_cpp_properties_path, 'r') as f:
            c_cpp_properties = json.load(f)
        print(f"✅ 기존 c_cpp_properties.json 파일 읽기 완료")
    except json.JSONDecodeError as e:
        print(f"⚠️ 기존 c_cpp_properties.json 파싱 오류: {e}")
        print("   기본 템플릿으로 재생성합니다.")
        c_cpp_properties = None
else:
    print(f"✅ 새 c_cpp_properties.json 파일 생성")
    c_cpp_properties = None

# 기본 템플릿 (파일이 없거나 파싱 실패한 경우)
if c_cpp_properties is None:
    c_cpp_properties = {
        "configurations": [
            {
                "name": "Linux",
                "includePath": [
                    "\${workspaceFolder}/**"
                ],
                "defines": [],
                "compilerPath": "/usr/bin/gcc",
                "cStandard": "c11",
                "cppStandard": "c++17",
                "intelliSenseMode": "linux-gcc-x64"
            }
        ],
        "version": 4
    }

# configurations가 없으면 기본 구조 생성
if 'configurations' not in c_cpp_properties:
    c_cpp_properties['configurations'] = [
        {
            "name": "Linux",
            "includePath": ["\${workspaceFolder}/**"],
            "defines": [],
            "compilerPath": "/usr/bin/gcc",
            "cStandard": "c11",
            "cppStandard": "c++17",
            "intelliSenseMode": "linux-gcc-x64"
        }
    ]

# 모든 configuration의 defines를 업데이트 (기존 defines 삭제 후 새로 추가)
for config in c_cpp_properties.get('configurations', []):
    # 기존 defines 삭제하고 새로 추가
    config['defines'] = defines_list
    print(f"✅ Configuration '{config.get('name', 'Unknown')}'의 defines 업데이트 완료")

# c_cpp_properties.json 파일 쓰기
try:
    with open(c_cpp_properties_path, 'w') as f:
        json.dump(c_cpp_properties, f, indent=4)
    print(f"✅ c_cpp_properties.json 파일 저장 완료: {c_cpp_properties_path}")
except Exception as e:
    print(f"❌ c_cpp_properties.json 파일 쓰기 오류: {e}")
    exit(1)

print("✅ c_cpp_properties.json 업데이트가 완료되었습니다.")
`;

		try {
			await executePythonScript({
				pythonCode: pythonCode,
				cwd: projectRoot,
				taskName: 'Update c_cpp_properties',
				taskId: 'update-cpp-properties',
				showTerminal: false
			});
			axonLog('✅ c_cpp_properties.json 업데이트 완료');
		} catch (error) {
			const errorMsg = `c_cpp_properties.json 업데이트 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * commands.json 파일 1-depth 검색 (제외 폴더 스킵)
	 */
	private static async searchCommandsJsonInDirectory(
		dir: vscode.Uri, 
		fileName: string
	): Promise<vscode.Uri | null> {
		const excludeDirs = [
			'node_modules', '.git', 'build', 'tmp', 'downloads', 'sstate-cache',
			'.vscode', 'dist', 'out', '.next', 'target', 'bin', 'obj'
		];

		try {
			const entries = await vscode.workspace.fs.readDirectory(dir);
			
			for (const [name, type] of entries) {
				if (excludeDirs.includes(name)) {
					continue;
				}

				if (type === vscode.FileType.Directory) {
					if (name === 'vsebuildscript' || name === 'buildscript') {
						const jsonPath = vscode.Uri.joinPath(dir, name, fileName);
						try {
							await vscode.workspace.fs.stat(jsonPath);
							axonLog(`✅ ${fileName} 발견 (1-depth 검색): ${jsonPath.path}`);
							return jsonPath;
						} catch {
							// 파일 없으면 계속
						}
					}
				}
			}
		} catch (error) {
			axonLog(`⚠️ 디렉토리 읽기 실패 (무시): ${dir.path}`);
		}
		
		return null;
	}

	/**
	 * commands.json 파일 찾기 (통합 유틸리티)
	 */
	private static async findCommandsJsonFile(fileName: string): Promise<vscode.Uri | null> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		
		// 1단계: 정의된 workspace 폴더에서 검색
		if (workspaceFolders && workspaceFolders.length > 0) {
			for (const folder of workspaceFolders) {
				// vsebuildscript/xxx.commands.json 확인
				const vsebuildscriptPath = vscode.Uri.joinPath(folder.uri, 'vsebuildscript', fileName);
				try {
					await vscode.workspace.fs.stat(vsebuildscriptPath);
					axonLog(`✅ ${fileName} 발견 (workspace folder/vsebuildscript): ${folder.name}`);
					return vsebuildscriptPath;
				} catch {
					// 없으면 buildscript 확인
				}

				// buildscript/xxx.commands.json 확인
				const buildscriptPath = vscode.Uri.joinPath(folder.uri, 'buildscript', fileName);
				try {
					await vscode.workspace.fs.stat(buildscriptPath);
					axonLog(`✅ ${fileName} 발견 (workspace folder/buildscript): ${folder.name}`);
					return buildscriptPath;
				} catch {
					continue;
				}
			}
			
			axonLog(`⚠️ Workspace 폴더에서 ${fileName}을 찾지 못함: ${workspaceFolders.map(f => f.name).join(', ')}`);
		}

		// 2단계: .code-workspace 파일 위치 기준 1-depth 검색
		const workspaceFile = vscode.workspace.workspaceFile;
		if (workspaceFile && workspaceFile.scheme === 'file') {
			axonLog(`🔍 .code-workspace 파일 위치에서 ${fileName} 1-depth 검색 시작...`);
			const workspaceDir = vscode.Uri.joinPath(workspaceFile, '..');
			
			const result = await this.searchCommandsJsonInDirectory(workspaceDir, fileName);
			if (result) {
				return result;
			}
			
			axonLog(`⚠️ .code-workspace 위치에서도 ${fileName}을 찾지 못함: ${workspaceDir.path}`);
		}

		// 3단계: 못 찾았으면 null 반환
		return null;
	}

	/**
	 * buildscript/mcu.commands.json의 group을 실행
	 * - Yocto와 동일한 패턴으로 JSON 기반 빌드 명령 실행
	 */
	static async runMcuJsonGroup(groupName: string): Promise<void> {
		try {
			axonLog(`🎯 [MCU JSON] runMcuJsonGroup 호출됨 - groupName: "${groupName}"`);

			// MCU 프로젝트 루트 (Unix 경로)
			const projectRoot = await this.getMcuProjectRoot();

			// JSON 파일 로드 (통합 검색 로직 사용)
			const jsonUri = await this.findCommandsJsonFile('mcu.commands.json');
			
			if (!jsonUri) {
				throw new Error('mcu.commands.json을 찾을 수 없습니다. vsebuildscript/ 또는 buildscript/ 폴더에 파일을 생성하세요.');
			}

			const jsonBytes = await vscode.workspace.fs.readFile(jsonUri);
			const spec = JSON.parse(Buffer.from(jsonBytes).toString('utf8'));
			const loadedFrom = jsonUri;

			const groups: Record<string, string[]> | undefined = spec?.groups;
			if (!groups || typeof groups !== 'object') {
				throw new Error('mcu.commands.json에 groups가 없습니다.');
			}

			const commands = groups[groupName];
			if (!commands || !Array.isArray(commands)) {
				throw new Error(`mcu.commands.json에 group이 없습니다: ${groupName}`);
			}

			// env 구성 (MCU는 간단하므로 기본 치환만)
			const env: Record<string, string> = {
				projectRoot: projectRoot
			};

			// commands 치환
			const resolvedCommands: string[] = commands.map(line => {
				if (typeof line !== 'string') return '';
				return this.interpolate(line, env);
			}).filter(Boolean);

			if (resolvedCommands.length === 0) {
				throw new Error(`실행할 commands가 비어있습니다: ${groupName}`);
			}

			const script = resolvedCommands.join('\n');

			axonLog(`🚀 [MCU JSON] 실행: ${groupName} (from ${loadedFrom.toString()})`);
			axonLog(`📋 [MCU JSON] 원본 commands (${commands.length}개):`);
			commands.forEach((cmd, i) => axonLog(`  [${i}] ${cmd}`));
			axonLog(`📋 [MCU JSON] 치환된 commands (${resolvedCommands.length}개):`);
			resolvedCommands.forEach((cmd, i) => axonLog(`  [${i}] ${cmd}`));
			
			// 사용자 확인 팝업
			const previewCommands = resolvedCommands.slice(0, 3).map(cmd => {
				return cmd.length > 80 ? cmd.substring(0, 77) + '...' : cmd;
			});
			const moreCount = resolvedCommands.length > 3 ? `\n... 외 ${resolvedCommands.length - 3}개 명령` : '';
			
			const confirmMsg = 
				`${groupName} 작업을 시작하시겠습니까?\n\n` +
				`실행할 명령: ${resolvedCommands.length}개\n` +
				`━━━━━━━━━━━━━━━━━━━━━━\n` +
				`${previewCommands.join('\n')}${moreCount}\n` +
				`━━━━━━━━━━━━━━━━━━━━━━\n\n` +
				`⚠️ 이 작업은 시간이 걸릴 수 있습니다.`;
			
			const confirm = await vscode.window.showWarningMessage(
				confirmMsg,
				{ modal: true },
				'시작',
				'취소'
			);
			
			if (confirm !== '시작') {
				axonLog('❌ 사용자 취소: 작업이 취소되었습니다.');
				vscode.window.showInformationMessage('작업이 취소되었습니다.');
				return;
			}
			
			// 명령 실행 시작 메시지
			const taskDisplayName = `MCU (JSON): ${groupName}`;
			vscode.window.showInformationMessage(`${taskDisplayName}가 시작되었습니다. 터미널을 확인하세요.`);
			
			await executeShellTask({
				command: script,
				cwd: projectRoot,
				taskName: taskDisplayName,
				taskId: `mcuJson:${groupName}`,
				showTerminal: true,
				useScriptFile: true
			});
			
			axonLog('✅ executeShellTask 완료됨!');

			// Build View에 포커스 복원
			setTimeout(async () => {
				await vscode.commands.executeCommand('axonBuildView.focus');
				axonLog(`🔄 Build View에 포커스를 복원했습니다`);
			}, 100);
			
			// 완료 메시지 출력
			axonLog('📢 빌드 완료 메시지 출력 시작...');
			const successMsg = `✅ ${taskDisplayName}가 완료되었습니다!`;
			axonSuccess(successMsg);
			vscode.window.showInformationMessage(`${taskDisplayName}가 완료되었습니다!`);
			
			axonLog('🔔 터미널 닫기 팝업 표시 시작...');
			await this.askToCloseTerminal(taskDisplayName);
			axonLog('✅ 터미널 닫기 팝업 완료');
			
		} catch (error) {
			const errorMsg = `MCU JSON group 실행 중 오류: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	private static interpolate(
		input: string,
		env: Record<string, string>
	): string {
		return input.replace(/\$\{([^}]+)\}/g, (_m, exprRaw) => {
			const expr = String(exprRaw || '').trim();
			if (expr.startsWith('env:')) {
				const key = expr.slice('env:'.length).trim();
				return env[key] ?? '';
			}
			if (expr.startsWith('config:')) {
				const key = expr.slice('config:'.length).trim();
				const v = vscode.workspace.getConfiguration().get<any>(key);
				return v === undefined || v === null ? '' : String(v);
			}
			return '';
		});
	}
}

