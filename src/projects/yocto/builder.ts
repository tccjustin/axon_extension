import * as vscode from 'vscode';
import { axonLog, axonError, axonSuccess } from '../../logger';
import { executeShellTask, findProjectRootByShell } from '../common/shell-utils';

/**
 * Yocto 빌드 작업 설정 인터페이스
 */
interface YoctoBuildTaskConfig {
	taskName: string;
	taskId: string;
	buildType: 'ap' | 'mcu' | 'kernel';
	getConfigInfo: (machine: string, version: string) => string;
	getConfirmMsg: (machine: string, version: string) => string;
	getBuildCommands: (machine: string, version: string, projectRoot: string, envPath: string, buildDir: string) => string;
}

/**
 * Yocto 클린 작업 설정 인터페이스
 */
interface YoctoCleanTaskConfig {
	taskName: string;
	taskId: string;
	cleanType: 'ap' | 'mcu' | 'all';
	getBuildDir: (projectRoot: string) => string | string[];
	getConfirmMsg: (buildDir: string | string[]) => string;
	getCleanCommand: (buildDir: string) => string;
}

/**
 * Yocto 프로젝트 빌드 관련 기능
 * 
 * ⚠️ 중요: 이 모듈은 원격 환경(WSL/SSH)을 기본으로 설계되었습니다.
 * - 모든 경로는 Unix 형식으로 처리됩니다
 * - 파일 시스템 접근은 vscode.workspace.fs API를 사용합니다
 */
export class YoctoProjectBuilder {
	/**
	 * Yocto AP 빌드 설정 타입
	 */
	private static readonly DEFAULT_MACHINE = 'tcn1000';
	private static readonly DEFAULT_VERSION = 'dev';

	/**
	 * 작업 완료 후 터미널 닫기 확인 팝업
	 */
	private static async askToCloseTerminal(taskName: string): Promise<void> {
		const result = await vscode.window.showInformationMessage(
			`${taskName}가 완료되었습니다.\n터미널을 닫겠습니까?`,
			{ modal: false },
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
	 * AP 빌드용 MACHINE / VERSION 설정을 로드하거나 사용자에게 선택받고
	 * config.json에 저장까지 수행하는 공통 헬퍼
	 */
	static async ensureApBuildConfig(
		projectRoot: string,
		workspaceFolder: vscode.WorkspaceFolder
	): Promise<{ machine: string; cgwVersion: string } | null> {
		// config.json 경로 구성
		const projectRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: projectRoot
		});

		const configUri = vscode.Uri.joinPath(projectRootUri, 'config.json');
		let machine: string | undefined;
		let cgwVersion: string | undefined;

		// config.json 읽기 시도
		try {
			const configContent = await vscode.workspace.fs.readFile(configUri);
			const config = JSON.parse(Buffer.from(configContent).toString('utf8'));
			machine = config.machine;
			cgwVersion = config.version;

			if (machine && cgwVersion) {
				axonLog(`✅ 설정 로드: MACHINE=${machine}, CGW_SDK_VERSION=${cgwVersion}`);
			}
		} catch (error) {
			axonLog(`⚠️ config.json 읽기 실패 또는 없음`);
		}

		// machine 또는 version이 없으면 사용자에게 선택받기
		if (!machine || !cgwVersion) {
			axonLog('📋 빌드 설정을 선택해주세요...');

			// machine 선택
			if (!machine) {
				const supportedMachines = ['tcn1000'];
				machine = await vscode.window.showQuickPick(supportedMachines, {
					placeHolder: 'AP MACHINE을 선택하세요',
					title: 'Yocto AP Build Configuration'
				});

				if (!machine) {
					axonLog('❌ 사용자 취소: MACHINE 선택이 취소되었습니다.');
					vscode.window.showInformationMessage('빌드가 취소되었습니다.');
					return null;
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
					return null;
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

				existingConfig.machine = machine;
				existingConfig.version = cgwVersion;

				const configJson = JSON.stringify(existingConfig, null, 2);
				await vscode.workspace.fs.writeFile(configUri, Buffer.from(configJson, 'utf8'));
				axonLog(`💾 빌드 설정을 config.json에 저장했습니다: MACHINE=${machine}, VERSION=${cgwVersion}`);
			} catch (error) {
				axonLog(`⚠️ config.json 저장 실패 (계속 진행): ${error}`);
			}
		}

		return { machine: machine!, cgwVersion: cgwVersion! };
	}

	/**
	 * MCU 빌드용 MACHINE / VERSION 설정을 로드하거나 사용자에게 선택받고
	 * config.json에 저장까지 수행하는 공통 헬퍼
	 */
	private static async ensureMcuBuildConfig(
		projectRoot: string,
		workspaceFolder: vscode.WorkspaceFolder
	): Promise<{ mcuMachine: string; mcuVersion: string } | null> {
		const projectRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: projectRoot
		});

		const configUri = vscode.Uri.joinPath(projectRootUri, 'config.json');
		let mcuMachine: string | undefined;
		let mcuVersion: string | undefined;

		// config.json 읽기 시도
		try {
			const configContent = await vscode.workspace.fs.readFile(configUri);
			const config = JSON.parse(Buffer.from(configContent).toString('utf8'));
			mcuMachine = config.mcu_machine;
			mcuVersion = config.mcu_version;

			if (mcuMachine && mcuVersion) {
				axonLog(`✅ 설정 로드: MCU_MACHINE=${mcuMachine}, MCU_SDK_VERSION=${mcuVersion}`);
			}
		} catch (error) {
			axonLog(`⚠️ config.json 읽기 실패 또는 없음`);
		}

		// mcu_machine 또는 mcu_version이 없으면 사용자에게 선택받기
		if (!mcuMachine || !mcuVersion) {
			axonLog('📋 빌드 설정을 선택해주세요...');

			// mcu_machine 선택
			if (!mcuMachine) {
				const supportedMcuMachines = ['tcn1000-mcu'];
				mcuMachine = await vscode.window.showQuickPick(supportedMcuMachines, {
					placeHolder: 'MCU MACHINE을 선택하세요',
					title: 'Yocto MCU Build Configuration'
				});

				if (!mcuMachine) {
					axonLog('❌ 사용자 취소: MCU MACHINE 선택이 취소되었습니다.');
					vscode.window.showInformationMessage('빌드가 취소되었습니다.');
					return null;
				}
			}

			// mcu_version 선택
			if (!mcuVersion) {
				const supportedVersions = ['dev', 'qa', 'release'];
				mcuVersion = await vscode.window.showQuickPick(supportedVersions, {
					placeHolder: 'MCU SDK VERSION을 선택하세요',
					title: 'Yocto MCU Build Configuration'
				});

				if (!mcuVersion) {
					axonLog('❌ 사용자 취소: MCU VERSION 선택이 취소되었습니다.');
					vscode.window.showInformationMessage('빌드가 취소되었습니다.');
					return null;
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

				existingConfig.mcu_machine = mcuMachine;
				existingConfig.mcu_version = mcuVersion;

				const configJson = JSON.stringify(existingConfig, null, 2);
				await vscode.workspace.fs.writeFile(configUri, Buffer.from(configJson, 'utf8'));
				axonLog(`💾 빌드 설정을 config.json에 저장했습니다: MCU_MACHINE=${mcuMachine}, MCU_VERSION=${mcuVersion}`);
			} catch (error) {
				axonLog(`⚠️ config.json 저장 실패 (계속 진행): ${error}`);
			}
		}

		return { mcuMachine: mcuMachine!, mcuVersion: mcuVersion! };
	}

	/**
	 * buildtools 환경 확인 및 경로 반환
	 * 
	 * @param projectRoot - Yocto 프로젝트 루트 경로
	 * @param workspaceFolder - 워크스페이스 폴더 (URI 생성용)
	 * @returns buildtools 환경 경로 (실패 시 null)
	 */
	static async ensureBuildtoolsEnvironment(
		projectRoot: string,
		workspaceFolder: vscode.WorkspaceFolder
	): Promise<string | null> {
		const envPath = `${projectRoot}/buildtools/environment-setup-x86_64-pokysdk-linux`;
		const envUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: envPath
		});
		
		try {
			await vscode.workspace.fs.stat(envUri);
			axonLog(`✅ Buildtools 환경 확인: ${envPath}`);
			return envPath;
		} catch {
			const errorMsg = 'Buildtools 환경이 설정되지 않았습니다. 먼저 "build toolchain"을 실행해야 합니다.';
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return null;
		}
	}

	/**
	 * CGW 빌드 스크립트를 사용하여 빌드 디렉토리 설정
	 * 
	 * @param projectRoot - Yocto 프로젝트 루트 경로
	 * @param envPath - buildtools 환경 경로
	 * @param machine - MACHINE 값
	 * @param version - SDK VERSION 값
	 * @param workspaceFolder - 워크스페이스 폴더
	 * @returns 성공 여부
	 */
	private static async setupBuildDirectoryWithCgwScript(
		projectRoot: string,
		envPath: string,
		machine: string,
		version: string,
		workspaceFolder: vscode.WorkspaceFolder
	): Promise<boolean> {
		const cgwBuildScript = `${projectRoot}/poky/meta-telechips/meta-dev/meta-cgw-dev/cgw-build.sh`;
		const cgwBuildScriptUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: cgwBuildScript
		});
		
		try {
			await vscode.workspace.fs.stat(cgwBuildScriptUri);
			axonLog(`✅ CGW 빌드 스크립트 확인: ${cgwBuildScript}`);
		} catch {
			const errorMsg = `CGW 빌드 스크립트를 찾을 수 없습니다: ${cgwBuildScript}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return false;
		}
		
		const setupCommands = [
			`cd "${projectRoot}"`,
			`source "${envPath}"`,
			`source "${cgwBuildScript}" ${machine} ${version}`,
			`echo "✅ 빌드 디렉토리 설정 완료"`
		];
		
		const setupCommand = setupCommands.join(' && ');
		
		axonLog('🚀 빌드 디렉토리 설정 명령:');
		setupCommands.forEach(cmd => axonLog(`  ${cmd}`));
		
		await executeShellTask({
			command: setupCommand,
			cwd: projectRoot,
			taskName: 'Yocto Build Setup',
			taskId: 'yoctoBuildSetup',
			showTerminal: true,
			useScriptFile: true
		});
		
		return true;
	}

	/**
	 * oe-init-build-env를 사용하여 빌드 디렉토리 설정
	 * 
	 * @param projectRoot - Yocto 프로젝트 루트 경로
	 * @param envPath - buildtools 환경 경로
	 * @param buildDir - 빌드 디렉토리 (상대 경로, 예: build/tcn1000)
	 * @param workspaceFolder - 워크스페이스 폴더
	 * @returns 성공 여부
	 */
	static async setupBuildDirectoryWithOeInit(
		projectRoot: string,
		envPath: string,
		buildDir: string,
		workspaceFolder: vscode.WorkspaceFolder
	): Promise<boolean> {
		const yoctoRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: projectRoot
		});
		
		const setupCommand = `cd "${projectRoot}"
source "${envPath}"
source poky/oe-init-build-env ${buildDir}
echo "✅ 빌드 환경 초기화 완료"`;
		
		axonLog(`🔨 빌드 환경 초기화 중...`);
		await executeShellTask({
			command: setupCommand,
			cwd: projectRoot,
			taskName: 'Yocto Build Setup',
			taskId: 'yoctoBuildSetup',
			showTerminal: true,
			useScriptFile: true,
			cwdUri: yoctoRootUri
		});
		
		return true;
	}

	/**
	 * local.conf 파일에 DL_DIR과 SSTATE_DIR 설정 추가/수정
	 * 
	 * @param buildDir - 빌드 디렉토리 경로 (예: /path/to/project/build/tcn1000)
	 * @param workspaceFolder - 워크스페이스 폴더 (URI 생성용)
	 * @returns 성공 여부
	 */
	static async updateLocalConfCachePaths(
		buildDir: string,
		workspaceFolder: vscode.WorkspaceFolder
	): Promise<boolean> {
		try {
			// 1. settings.json에서 axon.yocto.cachePath 확인
			const config = vscode.workspace.getConfiguration('axon');
			const cachePath = config.get<string>('yocto.cachePath', '');
			
			if (!cachePath || cachePath.trim() === '') {
				axonLog('ℹ️ axon.yocto.cachePath가 설정되지 않았습니다. local.conf 수정을 건너뜁니다.');
				return true; // 설정이 없어도 에러는 아님
			}
			
			axonLog(`📋 캐시 경로 설정 확인: ${cachePath}`);
			
			// 2. local.conf 파일 경로 구성
			const localConfPath = `${buildDir}/conf/local.conf`;
			const localConfUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: localConfPath
			});
			
			// 3. local.conf 파일 존재 확인
			let localConfContent: string;
			try {
				const fileContent = await vscode.workspace.fs.readFile(localConfUri);
				localConfContent = Buffer.from(fileContent).toString('utf8');
			} catch (error) {
				axonLog(`⚠️ local.conf 파일을 읽을 수 없습니다: ${localConfPath}`);
				return false;
			}
			
			// 4. 설정할 경로 계산
			const dlDir = `${cachePath}/downloads`;
			const sstateDir = `${cachePath}/sstate-cache`;
			
			// 5. 기존 설정 확인 (정규식으로 찾기)
			const dlDirRegex = /^DL_DIR\s*=\s*["']([^"']+)["']/m;
			const sstateDirRegex = /^SSTATE_DIR\s*=\s*["']([^"']+)["']/m;
			
			const existingDlDir = localConfContent.match(dlDirRegex);
			const existingSstateDir = localConfContent.match(sstateDirRegex);
			
			// 6. 이미 동일한 경로가 설정되어 있으면 스킵
			if (existingDlDir && existingDlDir[1] === dlDir) {
				axonLog(`ℹ️ DL_DIR이 이미 설정되어 있습니다: ${dlDir}`);
			} else {
				// DL_DIR 추가/수정
				if (existingDlDir) {
					// 기존 설정 수정
					localConfContent = localConfContent.replace(
						dlDirRegex,
						`DL_DIR = "${dlDir}"`
					);
					axonLog(`✅ DL_DIR 수정: ${dlDir}`);
				} else {
					// 새로 추가 (파일 끝에 추가)
					localConfContent += `\n# Yocto cache directories\nDL_DIR = "${dlDir}"\n`;
					axonLog(`✅ DL_DIR 추가: ${dlDir}`);
				}
			}
			
			if (existingSstateDir && existingSstateDir[1] === sstateDir) {
				axonLog(`ℹ️ SSTATE_DIR이 이미 설정되어 있습니다: ${sstateDir}`);
			} else {
				// SSTATE_DIR 추가/수정
				if (existingSstateDir) {
					// 기존 설정 수정
					localConfContent = localConfContent.replace(
						sstateDirRegex,
						`SSTATE_DIR = "${sstateDir}"`
					);
					axonLog(`✅ SSTATE_DIR 수정: ${sstateDir}`);
				} else {
					// 새로 추가 (DL_DIR 다음에 추가)
					if (localConfContent.includes('DL_DIR')) {
						localConfContent = localConfContent.replace(
							/(DL_DIR\s*=\s*"[^"]+")/,
							`$1\nSSTATE_DIR = "${sstateDir}"`
						);
					} else {
						localConfContent += `\nSSTATE_DIR = "${sstateDir}"\n`;
					}
					axonLog(`✅ SSTATE_DIR 추가: ${sstateDir}`);
				}
			}
			
			// 7. 파일 저장
			await vscode.workspace.fs.writeFile(
				localConfUri,
				Buffer.from(localConfContent, 'utf8')
			);
			
			axonLog(`✅ local.conf 파일 업데이트 완료: ${localConfPath}`);
			return true;
			
		} catch (error) {
			axonError(`local.conf 업데이트 중 오류 발생: ${error}`);
			return false;
		}
	}

	/**
	 * 환경 설정을 포함한 빌드 명령 실행
	 * 
	 * @param projectRoot - Yocto 프로젝트 루트 경로
	 * @param envPath - buildtools 환경 경로
	 * @param buildDirRelative - 빌드 디렉토리 (상대 경로, 예: build/tcn1000)
	 * @param buildCommands - 빌드 명령어 배열 (환경 설정 제외)
	 * @param taskName - 작업 이름
	 * @param taskId - 작업 ID
	 * @param workspaceFolder - 워크스페이스 폴더
	 */
	static async executeBuildCommand(
		projectRoot: string,
		envPath: string,
		buildDirRelative: string,
		buildCommands: string[],
		taskName: string,
		taskId: string,
		workspaceFolder: vscode.WorkspaceFolder
	): Promise<void> {
		// 환경 설정을 포함한 전체 명령 구성
		const fullBuildCommands = [
			`cd "${projectRoot}"`,
			`source "${envPath}"`,
			`source poky/oe-init-build-env ${buildDirRelative}`,
			...buildCommands
		];
		
		const fullCommand = fullBuildCommands.join(' && ');
		
		axonLog('🚀 빌드 명령:');
		fullBuildCommands.forEach(cmd => axonLog(`  ${cmd}`));
		
		const yoctoRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: projectRoot
		});
		
		await executeShellTask({
			command: fullCommand,
			cwd: projectRoot,
			taskName: taskName,
			taskId: taskId,
			showTerminal: true,
			useScriptFile: true,
			cwdUri: yoctoRootUri
		});
	}

	/**
	 * Yocto 프로젝트 루트 경로 찾기
	 * 
	 * 전략:
	 * 1. .vscode/settings.json 파일을 직접 읽어서 axon.yocto.projectRoot 확인
	 * 2. root가 있으면 반환
	 * 3. root가 없으면 리눅스 shell 스크립트로 poky 찾기 + 절대 경로 계산 + 임시 파일 저장
	 * 4. 임시 파일 읽어서 settings.json에 저장 후 반환
	 * 
	 * @returns Unix 경로 형식 문자열 (/home/..., /mnt/..., 등)
	 */
	static async getYoctoProjectRoot(): Promise<string> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error(
				'워크스페이스 폴더를 찾을 수 없습니다.\n\n' +
				'해결 방법:\n' +
				'1. VS Code에서 "파일 > 폴더 열기"를 선택하세요.\n' +
				'2. Yocto 프로젝트가 있는 폴더를 선택하세요.\n' +
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
			savedProjectRoot = settings['axon.yocto.projectRoot'];
			
			if (savedProjectRoot && savedProjectRoot.trim() !== '') {
				axonLog(`🔍 저장된 Yocto 프로젝트 루트 확인 중: ${savedProjectRoot}`);
				
				// 저장된 경로 유효성 검증
				try {
					const savedUri = vscode.Uri.from({
						scheme: workspaceFolder.uri.scheme,
						authority: workspaceFolder.uri.authority,
						path: savedProjectRoot
					});
					
					const pokyUri = vscode.Uri.joinPath(savedUri, 'poky');
					const stat = await vscode.workspace.fs.stat(pokyUri);
					
					if (stat.type === vscode.FileType.Directory) {
						axonLog(`✅ 저장된 Yocto 프로젝트 루트 사용: ${savedProjectRoot}`);
						return savedProjectRoot;
					}
				} catch {
					axonLog(`⚠️ 저장된 경로에 poky 디렉토리가 없습니다. 재탐색을 시작합니다.`);
				}
			}
		} catch (error) {
			// settings.json 파일이 없거나 읽기 실패한 경우 (정상적인 경우)
			axonLog(`📝 settings.json 파일을 읽을 수 없습니다. 새로 탐색합니다.`);
		}
		
		// 2. root가 없으면 리눅스 shell 스크립트로 찾기
		axonLog('🔍 poky 디렉토리를 찾아 Yocto 프로젝트 루트 탐지 중...');
		const projectRoot = await this.findYoctoProjectRootByShell(workspaceFolder);
		
		if (projectRoot) {
			axonLog(`✅ Yocto 프로젝트 루트 발견: ${projectRoot}`);
			
			// 3. settings.json에 저장
			try {
				axonLog(`💾 settings.json에 프로젝트 루트 저장 시도: ${projectRoot}`);
				await this.updateSettingsJson(workspaceFolder, { 'axon.yocto.projectRoot': projectRoot });
				axonLog(`✅ Yocto 프로젝트 루트를 settings.json에 저장했습니다.`);
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
			`Yocto 프로젝트 루트를 찾을 수 없습니다.\n\n` +
			`확인 사항:\n` +
			`- poky 디렉토리가 워크스페이스 또는 그 하위 2단계까지 있는지 확인하세요.\n` +
			`- .repo 폴더 내부의 poky는 제외됩니다.\n` +
			`- 워크스페이스: ${workspacePath}`
		);
	}

	/**
	 * 리눅스 shell 스크립트로 Yocto 프로젝트 루트 찾기
	 * poky 디렉토리를 찾아서 상위 디렉토리의 절대 경로를 계산하고 임시 파일에 저장
	 * 
	 * @param workspaceFolder - 워크스페이스 폴더
	 * @returns 프로젝트 루트의 절대 경로 또는 null
	 */
	private static async findYoctoProjectRootByShell(workspaceFolder: vscode.WorkspaceFolder): Promise<string | null> {
		return await findProjectRootByShell({
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
	}

	/**
	 * settings.json 파일 업데이트
	 * 기존 설정을 보존하면서 새로운 설정을 추가/업데이트
	 * 
	 * @param workspaceFolder - 워크스페이스 폴더
	 * @param settings - 추가/업데이트할 설정 객체
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
	 * Yocto 빌드 작업 공통 실행 함수
	 */
	private static async executeYoctoBuildTask(config: YoctoBuildTaskConfig): Promise<void> {
		axonLog(`🔨 ${config.taskName} 시작...`);
		
		try {
			// 프로젝트 타입 확인
			const { ensureProjectType } = await import('../../utils');
			const projectType = await ensureProjectType();
			if (!projectType) {
				axonLog('❌ 프로젝트 타입 선택이 취소되었습니다.');
				vscode.window.showInformationMessage('빌드가 취소되었습니다.');
				return;
			}
			
			// 1. Yocto 프로젝트 루트 찾기 (Unix 경로)
			const projectRoot = await this.getYoctoProjectRoot();
			axonLog(`📁 Yocto 프로젝트 루트: ${projectRoot}`);
			
			// 워크스페이스 폴더
			const workspaceFolder = vscode.workspace.workspaceFolders![0];
			
			// 2. 빌드 설정 로드 또는 선택 (config.json)
			let machine: string, version: string, envPath: string, buildDir: string;
			
			if (config.buildType === 'mcu') {
				const mcuConfig = await this.ensureMcuBuildConfig(projectRoot, workspaceFolder);
				if (!mcuConfig) return;
				
				const { mcuMachine, mcuVersion } = mcuConfig;
				machine = mcuMachine;
				version = mcuVersion;
			} else {
				// AP or Kernel (동일한 설정 사용)
				const apConfig = await this.ensureApBuildConfig(projectRoot, workspaceFolder);
				if (!apConfig) return;
				
				const { machine: apMachine, cgwVersion } = apConfig;
				machine = apMachine;
				version = cgwVersion;
			}
			
			// buildtools 환경 경로 확인
			const envPathResult = await this.ensureBuildtoolsEnvironment(projectRoot, workspaceFolder);
			if (!envPathResult) return;
			envPath = envPathResult;
			
			// 빌드 디렉토리 계산
			buildDir = `${projectRoot}/build/${machine}`;
			axonLog(`📁 빌드 디렉토리: ${buildDir}`);
			
			// 3. 빌드 설정 확인 표시
			const configInfo = config.getConfigInfo(machine, version);
			axonLog(configInfo);
			
			// 4. 사용자 확인
			const confirmMsg = config.getConfirmMsg(machine, version);
			const confirm = await vscode.window.showWarningMessage(
				confirmMsg,
				{ modal: true },
				'빌드 시작',
				'취소'
			);
			
			if (confirm !== '빌드 시작') {
				axonLog('❌ 사용자 취소: 빌드가 취소되었습니다.');
				vscode.window.showInformationMessage('빌드가 취소되었습니다.');
				return;
			}
			
		// 5. 빌드 명령 구성 및 실행
		vscode.window.showInformationMessage(`${config.taskName}가 시작되었습니다. 터미널을 확인하세요.`);
		
		// 모든 빌드 타입에 대해 fullCommand 생성
		const fullCommand = config.getBuildCommands(machine, version, projectRoot, envPath, buildDir);
		
		axonLog('🚀 빌드 명령:');
		axonLog(fullCommand);
		
		await executeShellTask({
			command: fullCommand,
			cwd: projectRoot,
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
			
			// 6. 빌드 완료
			const successMsg = `✅ ${config.taskName}가 완료되었습니다!\n\nMACHINE: ${machine}\nSDK VERSION: ${version}\n빌드 디렉토리: ${buildDir}`;
			axonSuccess(successMsg);
			vscode.window.showInformationMessage(`${config.taskName}가 완료되었습니다!`);
			
			// 터미널 닫기 확인 팝업
			await this.askToCloseTerminal(config.taskName);
			
		} catch (error) {
			const errorMsg = `${config.taskName} 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * Yocto 클린 작업 공통 실행 함수
	 */
	private static async executeYoctoCleanTask(config: YoctoCleanTaskConfig): Promise<void> {
		axonLog(`🧹 ${config.taskName} 시작...`);
		
		try {
			// 프로젝트 타입 확인
			const { ensureProjectType } = await import('../../utils');
			const projectType = await ensureProjectType();
			if (!projectType) {
				axonLog('❌ 프로젝트 타입 선택이 취소되었습니다.');
				vscode.window.showInformationMessage('작업이 취소되었습니다.');
				return;
			}
			
			// 1. Yocto 프로젝트 루트 찾기 (Unix 경로)
			const projectRoot = await this.getYoctoProjectRoot();
			axonLog(`📁 Yocto 프로젝트 루트: ${projectRoot}`);
			
			// 워크스페이스 폴더로 URI 구성
			const workspaceFolder = vscode.workspace.workspaceFolders![0];
			
			// 2. 빌드 디렉토리 확인
			const buildDirs = config.getBuildDir(projectRoot);
			const buildDirArray = Array.isArray(buildDirs) ? buildDirs : [buildDirs];
			
			// 디렉토리 존재 확인
			const existingDirs: string[] = [];
			for (const buildDir of buildDirArray) {
				const buildUri = vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: buildDir
				});
				
				try {
					await vscode.workspace.fs.stat(buildUri);
					existingDirs.push(buildDir);
					axonLog(`✅ 빌드 폴더 확인: ${buildDir}`);
				} catch {
					axonLog(`⚠️ 빌드 폴더 없음: ${buildDir}`);
				}
			}
			
			if (existingDirs.length === 0) {
				const msg = '빌드 폴더를 찾을 수 없습니다. 이미 정리되었거나 빌드되지 않았습니다.';
				axonLog(`⚠️ ${msg}`);
				vscode.window.showWarningMessage(msg);
				return;
			}
			
			// 3. 사용자 확인
			const confirmMsg = config.getConfirmMsg(existingDirs.length > 1 ? existingDirs : existingDirs[0]);
			const confirm = await vscode.window.showWarningMessage(
				confirmMsg,
				{ modal: true },
				'정리 시작',
				'취소'
			);
			
			if (confirm !== '정리 시작') {
				axonLog(`❌ 사용자 취소: ${config.taskName}가 취소되었습니다.`);
				vscode.window.showInformationMessage(`${config.taskName}가 취소되었습니다.`);
				return;
			}
			
			// 4. 클린 명령 실행
			vscode.window.showInformationMessage(`${config.taskName}가 시작되었습니다. 터미널을 확인하세요.`);
			
			for (const buildDir of existingDirs) {
				const cleanCommand = config.getCleanCommand(buildDir);
				axonLog('🚀 클린 명령:');
				axonLog(`  ${cleanCommand}`);
				
				await executeShellTask({
					command: cleanCommand,
					cwd: projectRoot,
					taskName: `${config.taskName} - ${buildDir.split('/').pop()}`,
					taskId: `${config.taskId}_${buildDir.split('/').pop()}`,
					showTerminal: true,
					useScriptFile: true
				});
			}
			
			// Build View에 포커스 복원
			setTimeout(async () => {
				await vscode.commands.executeCommand('axonBuildView.focus');
				axonLog(`🔄 Build View에 포커스를 복원했습니다`);
			}, 100);
			
			// 5. 완료
			const successMsg = `✅ ${config.taskName}가 완료되었습니다!\n\n경로: ${existingDirs.join(', ')}`;
			axonSuccess(successMsg);
			vscode.window.showInformationMessage(`${config.taskName}가 완료되었습니다!`);
			
			// 터미널 닫기 확인 팝업
			await this.askToCloseTerminal(config.taskName);
			
		} catch (error) {
			const errorMsg = `${config.taskName} 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}
	
	/**
	 * Yocto AP 빌드 실행
	 * build-axon.py의 action_choice==2 (build ap) 로직 구현
	 */
	static async buildAp(): Promise<void> {
		await this.executeYoctoBuildTask({
			taskName: 'Yocto AP Build',
			taskId: 'yoctoApBuild',
			buildType: 'ap',
			getConfigInfo: (machine, version) => [
				'',
				'==================================================',
				'           AP Build Configuration',
				'==================================================',
				`  AP MACHINE         : ${machine}`,
				`  AP SDK VERSION     : ${version}`,
				'==================================================',
				''
			].join('\n'),
			getConfirmMsg: (machine, version) => 
				`Yocto AP 빌드를 시작하시겠습니까?\n\nMACHINE: ${machine}\nSDK VERSION: ${version}\n\n이 작업은 시간이 오래 걸릴 수 있습니다.`,
			getBuildCommands: (machine, version, projectRoot, envPath) => {
			const apBuildScript = `${projectRoot}/poky/meta-telechips/meta-dev/meta-cgw-dev/cgw-build.sh`;
			return `
#set -x
cd "${projectRoot}"
source "${envPath}"
source "${apBuildScript}" ${machine} ${version}
bitbake telechips-cgw-image
bitbake -f -c make_fai telechips-cgw-image

echo ""
echo "✅ Yocto AP 빌드가 완료되었습니다!"
echo "MACHINE: ${machine}"
echo "SDK VERSION: ${version}"
echo ""
echo "Press any key to close..."
read -n1 -s -r
`;
		}
		});
	}

	/**
	 * Yocto MCU 빌드 실행
	 * build-axon.py의 action_choice==3 (build mcu) 로직 구현
	 */
	static async buildMcu(): Promise<void> {
		await this.executeYoctoBuildTask({
			taskName: 'Yocto MCU Build',
			taskId: 'yoctoMcuBuild',
			buildType: 'mcu',
			getConfigInfo: (machine, version) => [
				'',
				'==================================================',
				'           MCU Build Configuration',
				'==================================================',
				`  MCU MACHINE        : ${machine}`,
				`  MCU SDK VERSION    : ${version}`,
				'==================================================',
				''
			].join('\n'),
			getConfirmMsg: (machine, version) => 
				`Yocto MCU 빌드를 시작하시겠습니까?\n\nMACHINE: ${machine}\nSDK VERSION: ${version}\n\n이 작업은 시간이 오래 걸릴 수 있습니다.`,
			getBuildCommands: (machine, version, projectRoot, envPath) => {
				const mcuBuildScript = `${projectRoot}/poky/meta-telechips/meta-dev/meta-mcu-dev/mcu-build.sh`;
				return `
#set -x
cd "${projectRoot}"
source "${envPath}"
source "${mcuBuildScript}" ${machine} ${version}
bitbake m7-0 m7-1 m7-2 m7-np -f -c compile

echo ""
echo "✅ Yocto MCU 빌드가 완료되었습니다!"
echo "MACHINE: ${machine}"
echo "SDK VERSION: ${version}"
echo ""
echo "Press any key to close..."
read -n1 -s -r
`;
			}
		});
	}

	/**
	 * Yocto Kernel 빌드 (AP Kernel + SD_fai.rom 생성)
	 * build-axon.py의 action_choice==8 (build kernel) 로직 구현
	 */
	static async buildKernel(): Promise<void> {
		await this.executeYoctoBuildTask({
			taskName: 'Yocto Kernel Build',
			taskId: 'yoctoKernelBuild',
			buildType: 'kernel',
			getConfigInfo: (machine, version) => [
				'',
				'==================================================',
				'      Kernel Build + make SD_fai.rom',
				'==================================================',
				`  AP MACHINE         : ${machine}`,
				`  AP SDK VERSION     : ${version}`,
				'==================================================',
				''
			].join('\n'),
			getConfirmMsg: (machine, version) => 
				`Yocto Kernel 빌드를 시작하시겠습니까?\n\nMACHINE: ${machine}\nSDK VERSION: ${version}\n\n⚠️ Kernel 컴파일 후 이미지를 생성합니다.\n이 작업은 시간이 오래 걸릴 수 있습니다.`,
			getBuildCommands: (machine, version, projectRoot, envPath) => {
			const apBuildScript = `${projectRoot}/poky/meta-telechips/meta-dev/meta-cgw-dev/cgw-build.sh`;
			return `
#set -x
cd "${projectRoot}"
source "${envPath}"
source "${apBuildScript}" ${machine} ${version}
bitbake linux-telechips -f -c compile
bitbake linux-telechips -c deploy
#bitbake telechips-cgw-image
#bitbake -f -c make_fai telechips-cgw-image

echo ""
echo "✅ Yocto Kernel 빌드가 완료되었습니다!"
echo "MACHINE: ${machine}"
echo "SDK VERSION: ${version}"
echo ""
echo "Press any key to close..."
read -n1 -s -r
`;
		}
		});
	}

	/**
	 * Yocto AP 빌드 클린
	 * build-axon.py의 action_choice==5 (clean ap) 로직 구현
	 */
	static async cleanApBuild(): Promise<void> {
		await this.executeYoctoCleanTask({
			taskName: 'Yocto AP Clean',
			taskId: 'yoctoApClean',
			cleanType: 'ap',
			getBuildDir: (projectRoot) => `${projectRoot}/build/tcn1000`,
			getConfirmMsg: (buildDir) => 
				`AP 빌드 폴더를 정리하시겠습니까?\n\n경로: ${buildDir}\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`,
			getCleanCommand: (buildDir) => `
cd "${buildDir}"
echo "Cleaning Yocto AP build directory (except conf/downloads/sstate-cache)..."
find . -mindepth 1 -maxdepth 1 -not -name 'conf' -a -not -name 'downloads' -a -not -name 'sstate-cache' -exec rm -rf {} +

echo ""
echo "✅ AP 빌드 정리가 완료되었습니다!"
echo "Press any key to close..."
read -n1 -s -r
`
		});
	}

	/**
	 * Yocto MCU 빌드 클린
	 * build-axon.py의 action_choice==6 (clean mcu) 로직 구현
	 */
	static async cleanMcuBuild(): Promise<void> {
		await this.executeYoctoCleanTask({
			taskName: 'Yocto MCU Clean',
			taskId: 'yoctoMcuClean',
			cleanType: 'mcu',
			getBuildDir: (projectRoot) => `${projectRoot}/build/tcn1000-mcu`,
			getConfirmMsg: (buildDir) => 
				`MCU 빌드 폴더를 정리하시겠습니까?\n\n경로: ${buildDir}\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`,
			getCleanCommand: (buildDir) => `
cd "${buildDir}"
echo "Cleaning Yocto MCU build directory (except conf/downloads/sstate-cache)..."
find . -mindepth 1 -maxdepth 1 -not -name 'conf' -a -not -name 'downloads' -a -not -name 'sstate-cache' -exec rm -rf {} +

echo ""
echo "✅ MCU 빌드 정리가 완료되었습니다!"
echo "Press any key to close..."
read -n1 -s -r
`
		});
	}

	/**
	 * Yocto AP + MCU 빌드 클린
	 * build-axon.py의 action_choice==7 (clean ap + mcu) 로직 구현
	 * Python에서는 두 함수를 순차 호출하므로, 여기서도 각각 실행
	 */
	static async cleanAllBuild(): Promise<void> {
		await this.executeYoctoCleanTask({
			taskName: 'Yocto All Clean',
			taskId: 'yoctoAllClean',
			cleanType: 'all',
			getBuildDir: (projectRoot) => [
				`${projectRoot}/build/tcn1000`,
				`${projectRoot}/build/tcn1000-mcu`
			],
			getConfirmMsg: (buildDirs) => {
				const dirs = Array.isArray(buildDirs) ? buildDirs : [buildDirs];
				return `AP + MCU 빌드 폴더를 정리하시겠습니까?\n\n경로:\n${dirs.join('\n')}\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`;
			},
			getCleanCommand: (buildDir) => `
cd "${buildDir}"
echo "Cleaning Yocto build directory (except conf/downloads/sstate-cache)..."
find . -mindepth 1 -maxdepth 1 -not -name 'conf' -a -not -name 'downloads' -a -not -name 'sstate-cache' -exec rm -rf {} +

echo ""
echo "✅ ${buildDir.split('/').pop()} 빌드 정리가 완료되었습니다!"
`
		});
	}

	/**
	 * AP의 conf/local.conf 파일 편집
	 * build/tcn1000/conf/local.conf 파일을 VS Code 에디터로 엽니다.
	 */
	static async editApLocalConf(): Promise<void> {
		try {
			axonLog('📝 AP conf/local.conf 편집을 시작합니다...');
			
			// 1. 프로젝트 루트 찾기
			const projectRoot = await this.getYoctoProjectRoot();
			
			// 2. local.conf 파일 경로 구성
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
			}
			
			const localConfPath = `${projectRoot}/build/tcn1000/conf/local.conf`;
			const localConfUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: localConfPath
			});
			
			axonLog(`📂 파일 경로: ${localConfPath}`);
			
			// 3. 파일 존재 확인
			try {
				await vscode.workspace.fs.stat(localConfUri);
				axonLog('✅ 파일이 존재합니다.');
			} catch {
				// 파일이 없으면 AP 빌드 환경만 초기화해서 local.conf를 생성할지 물어봄
				const choice = await vscode.window.showWarningMessage(
					'AP의 local.conf 파일을 찾을 수 없습니다.\n\n' +
					'파일 경로: build/tcn1000/conf/local.conf\n\n' +
					'AP 빌드 환경을 초기화하여 conf/local.conf를 생성하시겠습니까?\n' +
					'(bitbake 빌드는 실행하지 않습니다.)',
					{ modal: true },
					'환경 초기화',
					'취소'
				);

				if (choice !== '환경 초기화') {
					axonLog('❌ 사용자 취소: AP local.conf 자동 생성이 취소되었습니다.');
					return;
				}

			// AP 빌드 설정 로드 및 환경 초기화
			const apConfig = await this.ensureApBuildConfig(projectRoot, workspaceFolder);
			if (!apConfig) {
				return;
			}
			const { machine, cgwVersion } = apConfig;

			// buildtools 환경 확인
			const envPath = await this.ensureBuildtoolsEnvironment(projectRoot, workspaceFolder);
			if (!envPath) {
				return;
			}

			// 빌드 디렉토리 설정 (cgw-build.sh 실행)
			const setupSuccess = await this.setupBuildDirectoryWithCgwScript(
				projectRoot,
				envPath,
				machine,
				cgwVersion,
				workspaceFolder
			);
			if (!setupSuccess) {
				return;
			}

				// 환경 초기화 후 local.conf가 생성되었는지 다시 확인
				try {
					await vscode.workspace.fs.stat(localConfUri);
					axonLog('✅ AP 환경 초기화 후 local.conf 파일이 생성되었습니다.');
				} catch {
					const errorMsg = 
						'AP 빌드 환경을 초기화했지만 local.conf 파일을 찾을 수 없습니다.\n\n' +
						'build/tcn1000/conf/local.conf 경로를 수동으로 확인해주세요.';
					axonError(errorMsg);
					vscode.window.showErrorMessage(errorMsg);
					return;
				}
			}
			
			// 4. VS Code 에디터로 파일 열기
			axonLog('📝 VS Code 에디터로 파일을 엽니다...');
			const document = await vscode.workspace.openTextDocument(localConfUri);
			await vscode.window.showTextDocument(document);
			
			axonSuccess('✅ AP local.conf 파일이 열렸습니다.');
			
		} catch (error) {
			const errorMsg = `AP local.conf 편집 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * MCU의 conf/local.conf 파일 편집
	 * build/tcn1000-mcu/conf/local.conf 파일을 VS Code 에디터로 엽니다.
	 */
	static async editMcuLocalConf(): Promise<void> {
		try {
			axonLog('📝 MCU conf/local.conf 편집을 시작합니다...');
			
			// 1. 프로젝트 루트 찾기
			const projectRoot = await this.getYoctoProjectRoot();
			
			// 2. local.conf 파일 경로 구성
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
			}
			
			const localConfPath = `${projectRoot}/build/tcn1000-mcu/conf/local.conf`;
			const localConfUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: localConfPath
			});
			
			axonLog(`📂 파일 경로: ${localConfPath}`);
			
			// 3. 파일 존재 확인
			try {
				await vscode.workspace.fs.stat(localConfUri);
				axonLog('✅ 파일이 존재합니다.');
			} catch {
				// 파일이 없으면 MCU 빌드 환경만 초기화해서 local.conf를 생성할지 물어봄
				const choice = await vscode.window.showWarningMessage(
					'MCU의 local.conf 파일을 찾을 수 없습니다.\n\n' +
					'파일 경로: build/tcn1000-mcu/conf/local.conf\n\n' +
					'MCU 빌드 환경을 초기화하여 conf/local.conf를 생성하시겠습니까?\n' +
					'(bitbake 빌드는 실행하지 않습니다.)',
					{ modal: true },
					'환경 초기화',
					'취소'
				);

				if (choice !== '환경 초기화') {
					axonLog('❌ 사용자 취소: MCU local.conf 자동 생성이 취소되었습니다.');
					return;
				}

			// MCU 빌드 설정 로드 및 환경 초기화
			const mcuConfig = await this.ensureMcuBuildConfig(projectRoot, workspaceFolder);
			if (!mcuConfig) {
				return;
			}
			const { mcuMachine, mcuVersion } = mcuConfig;

			// buildtools 환경 확인
			const envPath = `${projectRoot}/buildtools/environment-setup-x86_64-pokysdk-linux`;
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

			// MCU 빌드 스크립트 확인
			const mcuBuildScript = `${projectRoot}/poky/meta-telechips/meta-dev/meta-mcu-dev/mcu-build.sh`;
			const mcuBuildScriptUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: mcuBuildScript
			});

			try {
				await vscode.workspace.fs.stat(mcuBuildScriptUri);
				axonLog(`✅ MCU 빌드 스크립트 확인: ${mcuBuildScript}`);
			} catch {
				const errorMsg = `MCU 빌드 스크립트를 찾을 수 없습니다: ${mcuBuildScript}`;
				axonError(errorMsg);
				vscode.window.showErrorMessage(errorMsg);
				return;
			}

			// MCU 환경 설정 (local.conf 생성)
			const commands = [
				`cd "${projectRoot}"`,
				`source "${envPath}"`,
				`source "${mcuBuildScript}" ${mcuMachine} ${mcuVersion}`,
				`echo "✅ MCU 빌드 환경 설정 완료"`
			];

			const fullCommand = commands.join(' && ');

			axonLog('🚀 MCU 빌드 환경 설정 명령:');
			commands.forEach(cmd => axonLog(`  ${cmd}`));

			await executeShellTask({
				command: fullCommand,
				cwd: projectRoot,
				taskName: 'Yocto MCU Build Setup',
				taskId: 'yoctoMcuBuildSetup',
				showTerminal: true,
				useScriptFile: true
			});

				// 환경 초기화 후 local.conf가 생성되었는지 다시 확인
				try {
					await vscode.workspace.fs.stat(localConfUri);
					axonLog('✅ MCU 환경 초기화 후 local.conf 파일이 생성되었습니다.');
				} catch {
					const errorMsg = 
						'MCU 빌드 환경을 초기화했지만 local.conf 파일을 찾을 수 없습니다.\n\n' +
						'build/tcn1000-mcu/conf/local.conf 경로를 수동으로 확인해주세요.';
					axonError(errorMsg);
					vscode.window.showErrorMessage(errorMsg);
					return;
				}
			}
			
			// 4. VS Code 에디터로 파일 열기
			axonLog('📝 VS Code 에디터로 파일을 엽니다...');
			const document = await vscode.workspace.openTextDocument(localConfUri);
			await vscode.window.showTextDocument(document);
			
			axonSuccess('✅ MCU local.conf 파일이 열렸습니다.');
			
		} catch (error) {
			const errorMsg = `MCU local.conf 편집 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * branch/srcrev 설정 파일 편집
	 * poky/meta-telechips/meta-dev/telechips-cgw-rev.inc 파일을 VS Code 에디터로 엽니다.
	 */
	static async editBranchSrcrev(): Promise<void> {
		try {
			axonLog('📝 branch/srcrev 설정 파일 편집을 시작합니다...');
			
			// 1. 프로젝트 루트 찾기
			const projectRoot = await this.getYoctoProjectRoot();
			
			// 2. telechips-cgw-rev.inc 파일 경로 구성
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
			}
			
			const revIncPath = `${projectRoot}/poky/meta-telechips/meta-dev/telechips-cgw-rev.inc`;
			const revIncUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: revIncPath
			});
			
			axonLog(`📂 파일 경로: ${revIncPath}`);
			
			// 3. 파일 존재 확인
			try {
				await vscode.workspace.fs.stat(revIncUri);
				axonLog('✅ 파일이 존재합니다.');
			} catch {
				const errorMsg = 
					'branch/srcrev 설정 파일을 찾을 수 없습니다.\n\n' +
					'파일 경로: poky/meta-telechips/meta-dev/telechips-cgw-rev.inc\n\n' +
					'Yocto 프로젝트 구조가 올바른지 확인하세요.';
				
				axonError(errorMsg);
				vscode.window.showErrorMessage(errorMsg);
				return;
			}
			
			// 4. VS Code 에디터로 파일 열기
			axonLog('📝 VS Code 에디터로 파일을 엽니다...');
			const document = await vscode.workspace.openTextDocument(revIncUri);
			await vscode.window.showTextDocument(document);
			
			axonSuccess('✅ telechips-cgw-rev.inc 파일이 열렸습니다.');
			
		} catch (error) {
			const errorMsg = `branch/srcrev 파일 편집 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}
}





