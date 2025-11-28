import * as vscode from 'vscode';
import { axonLog, axonError } from '../../logger';
import { getAxonConfig, dirToDisplay } from '../../utils';
import { executeShellTask } from '../common/shell-utils';

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
	 * buildAxonFolderName 설정 확인 및 선택
	 * (프로젝트 타입 기반으로 자동 설정)
	 */
	private static async ensureBuildAxonFolderName(): Promise<string | null> {
		const { ensureProjectType } = await import('../../utils');
		
		// 프로젝트 타입 선택 (자동으로 buildAxonFolderName도 설정됨)
		const projectType = await ensureProjectType();
		
		if (!projectType) {
			axonLog('❌ 프로젝트 타입 선택이 취소되었습니다.');
			return null;
		}
		
		// 설정된 buildAxonFolderName 반환
		const config = getAxonConfig();
		axonLog(`✅ buildAxonFolderName: ${config.buildAxonFolderName}`);
		
		return config.buildAxonFolderName;
	}

	/**
	 * 설정된 빌드 폴더를 찾는 재귀 검색 함수
	 */
	private static async searchMcuTcn100xInDirectory(
		baseUri: vscode.Uri, 
		currentDepth: number = 0, 
		maxDepth: number = 4
	): Promise<string | null> {
		const config = getAxonConfig();
		const mcuFolderName = config.buildAxonFolderName || 'mcu-tcn100x';

		try {
			// baseUri가 이미 mcu-tcn100x 폴더인지 확인
			const basePath = baseUri.path;
			if (basePath.endsWith('/' + mcuFolderName) || basePath.endsWith('\\' + mcuFolderName)) {
				// 로컬은 fsPath, 원격은 Unix 경로 사용 (터미널 명령용)
				const finalPath = baseUri.scheme === 'file' ? baseUri.fsPath : baseUri.path;
				axonLog(`✅ depth ${currentDepth}에서 baseUri가 이미 ${mcuFolderName} 폴더입니다: ${finalPath}`);
				return finalPath;
			}

			// 현재 디렉토리에서 mcu-tcn100x 폴더 확인
			const targetPath = baseUri.with({ path: `${baseUri.path.replace(/\/$/, '')}/${mcuFolderName}` });

			try {
				const stat = await vscode.workspace.fs.stat(targetPath);
				if (stat.type === vscode.FileType.Directory) {
					let finalPath: string;
					if (targetPath.scheme === 'file') {
						finalPath = targetPath.fsPath;
					} else {
						// 원격 경로일 경우, Unix 경로만 반환 (터미널 명령용)
						finalPath = targetPath.path;
					}

					axonLog(`✅ depth ${currentDepth}에서 ${mcuFolderName} 폴더를 찾았습니다: ${finalPath}`);
					return finalPath;
				}
			} catch {
				// 폴더가 없으면 계속 진행
			}

			// 최대 depth에 도달하지 않았으면 하위 폴더 탐색
			if (currentDepth < maxDepth) {
				try {
					const entries = await vscode.workspace.fs.readDirectory(baseUri);

					// 디렉토리만 필터링
					const allDirectories = entries.filter(([name, type]) => type === vscode.FileType.Directory);
					const directories = allDirectories.filter(([name]) => !name.startsWith('.'));

					for (const [dirName] of directories) {
						const subDirUri = baseUri.with({ path: baseUri.path + '/' + dirName });
						axonLog(`📁 depth ${currentDepth} - ${dirName} 폴더 탐색 중...`);

						const result = await this.searchMcuTcn100xInDirectory(subDirUri, currentDepth + 1, maxDepth);
						if (result) {
							return result; // 찾았으면 즉시 반환
						}
					}
				} catch (error) {
					axonLog(`⚠️ depth ${currentDepth} 폴더 읽기 실패: ${error}`);
				}
			}

			return null;
		} catch (error) {
			axonLog(`⚠️ depth ${currentDepth} 검색 중 오류: ${error}`);
			return null;
		}
	}

	/**
	 * 설정된 빌드 폴더를 찾는 함수 (MCU Standalone 또는 Yocto 프로젝트용)
	 */
	private static async findMcuTcn100xFolder(): Promise<string | null> {
		const config = getAxonConfig();
		const mcuFolderName = config.buildAxonFolderName || 'mcu-tcn100x';
		
		const workspaceFolders = vscode.workspace.workspaceFolders;
		
		if (!workspaceFolders || workspaceFolders.length === 0) {
			axonLog('❌ 워크스페이스 폴더를 찾을 수 없습니다.');
			return null;
		}
		
		const searchStartTime = Date.now();
		axonLog(`🔍 ${mcuFolderName} 폴더 검색 시작 (depth 4까지): ${workspaceFolders[0].uri.path}`);
		
		try {
			let result: string | null = null;
			const workspacePath = workspaceFolders[0].uri.path;
			
			// 워크스페이스 경로에 mcu-tcn100x 폴더명이 포함되어 있다면 해당 폴더부터 검색
			if (workspacePath.includes(mcuFolderName)) {
				axonLog(`✅ 워크스페이스에 ${mcuFolderName}이 포함되어 있습니다: ${workspacePath}`);
				
				const folderIndex = workspacePath.indexOf(mcuFolderName);
				if (folderIndex !== -1) {
					const folderPath = workspacePath.substring(0, folderIndex + mcuFolderName.length);
					const folderUri = workspaceFolders[0].uri.with({ path: folderPath });
					
					axonLog(`🔍 워크스페이스 내 ${mcuFolderName} 폴더부터 depth 4까지 검색: ${dirToDisplay(folderUri)}`);
					
					result = await this.searchMcuTcn100xInDirectory(folderUri, 0, 4);
					
					if (result) {
						const searchDuration = Date.now() - searchStartTime;
						axonLog(`✅ 워크스페이스 내 ${mcuFolderName} 폴더를 찾았습니다: ${result}`);
						axonLog(`⏱️ ${mcuFolderName} 검색 완료 - 소요시간: ${searchDuration}ms`);
						return result;
					}
				}
			}
			
			// 일반적인 경우: 워크스페이스 폴더부터 depth 4까지 검색
			axonLog(`🔍 워크스페이스 폴더부터 depth 4까지 ${mcuFolderName} 검색: ${dirToDisplay(workspaceFolders[0].uri)}`);
			
			result = await this.searchMcuTcn100xInDirectory(workspaceFolders[0].uri, 0, 4);
			
			if (result) {
				const searchDuration = Date.now() - searchStartTime;
				axonLog(`✅ 워크스페이스에서 ${mcuFolderName} 폴더를 찾았습니다: ${result}`);
				axonLog(`⏱️ 전체 검색 완료 - 소요시간: ${searchDuration}ms`);
				return result;
			}
			
			axonLog(`❌ depth 4까지 검색했지만 ${mcuFolderName} 폴더를 찾을 수 없습니다.`);
			
			const searchDuration = Date.now() - searchStartTime;
			axonLog(`⏱️ 전체 검색 완료 (실패) - 소요시간: ${searchDuration}ms`);
			return null;
		} catch (error) {
			const searchDuration = Date.now() - searchStartTime;
			axonError(`${mcuFolderName} 폴더 검색 중 오류 발생: ${error}`);
			axonLog(`⏱️ 검색 중단 (오류) - 소요시간: ${searchDuration}ms`);
			return null;
		}
	}

	/**
	 * MCU 작업 공통 실행 함수
	 */
	private static async executeMcuTask(config: McuTaskConfig): Promise<void> {
		axonLog(`🚀 ${config.taskName} 실행 명령 시작 (MCU Standalone 프로젝트)`);
		axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

		try {
			// buildAxonFolderName 설정 확인 및 선택
			const buildAxonFolderName = await this.ensureBuildAxonFolderName();
			if (!buildAxonFolderName) {
				vscode.window.showInformationMessage(config.cancelMsg);
				return;
			}
			
			// 빌드 폴더 찾기
			axonLog(`🔍 ${buildAxonFolderName} 폴더 자동 검색 시작...`);
			const mcuBuildPath = await this.findMcuTcn100xFolder();

			if (!mcuBuildPath) {
				axonLog(`❌ ${buildAxonFolderName} 폴더를 찾을 수 없습니다.`);
				vscode.window.showErrorMessage(`${buildAxonFolderName} 폴더를 찾을 수 없습니다. 워크스페이스를 확인해주세요.`);
				return;
			}

			axonLog(`✅ ${buildAxonFolderName} 폴더를 찾았습니다: ${mcuBuildPath}`);

			// 작업별 명령 및 메시지 생성
			const command = config.getCommand(mcuBuildPath);
			const configInfo = config.getConfigInfo(mcuBuildPath);
			const confirmMsg = config.getConfirmMsg(mcuBuildPath);
			
			axonLog(configInfo);
			
			// 사용자 확인
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
	 * MCU 클린 빌드 실행
	 */
	static async cleanBuild(): Promise<void> {
		await this.executeMcuTask({
			taskName: 'MCU Clean',
			taskId: 'mcuClean',
			cancelMsg: 'Clean이 취소되었습니다.',
			confirmButton: 'Clean 시작',
			getCommand: (mcuBuildPath) => `
#set -x
cd "${mcuBuildPath}"
make clean

echo ""
echo "=========================================="
echo "✅ MCU Clean이 완료되었습니다!"
echo "   빌드 파일들이 삭제되었습니다."
echo "=========================================="
echo ""
`,
			getConfigInfo: (mcuBuildPath) => [
				'',
				'==================================================',
				'         MCU Clean Configuration',
				'==================================================',
				`  빌드 경로: ${mcuBuildPath}`,
				`  명령: make clean`,
				'==================================================',
				''
			].join('\n'),
			getConfirmMsg: (mcuBuildPath) => 
				`MCU Clean을 시작하시겠습니까?\n\n경로: ${mcuBuildPath}\n명령: make clean\n\n빌드된 파일들이 삭제됩니다.`
		});
	}
}
