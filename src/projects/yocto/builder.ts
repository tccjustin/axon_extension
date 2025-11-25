import * as vscode from 'vscode';
import { axonLog, axonError, axonSuccess } from '../../logger';
import { executeShellTask } from '../common/shell-utils';
import { getAxonConfig, findBootFirmwareFolder } from '../../utils';

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
	 * AP 빌드용 MACHINE / VERSION 설정을 로드하거나 사용자에게 선택받고
	 * config.json에 저장까지 수행하는 공통 헬퍼
	 */
	private static async ensureApBuildConfig(
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
	 * AP 빌드 환경(oe-init-build-env + local.conf 캐시 경로)만 설정하는 헬퍼
	 * - bitbake 빌드는 실행하지 않음
	 */
	private static async setupApEnvironmentOnly(
		projectRoot: string,
		workspaceFolder: vscode.WorkspaceFolder,
		machine: string,
		cgwVersion: string
	): Promise<{ envPath: string; buildDir: string } | null> {
		// buildtools 환경 확인
		const envPath = await this.ensureBuildtoolsEnvironment(projectRoot, workspaceFolder);
		if (!envPath) {
			return null;
		}

		// 빌드 디렉토리 설정 (cgw-build.sh 실행)
		const buildDir = `${projectRoot}/build/${machine}`;
		axonLog(`📁 빌드 디렉토리: ${buildDir}`);

		const setupSuccess = await this.setupBuildDirectoryWithCgwScript(
			projectRoot,
			envPath,
			machine,
			cgwVersion,
			workspaceFolder
		);
		if (!setupSuccess) {
			return null;
		}

		// local.conf 파일 수정 (캐시 경로 설정)
		axonLog('📝 local.conf 파일 수정 중...');
		const updated = await this.updateLocalConfCachePaths(buildDir, workspaceFolder);
		if (!updated) {
			axonLog('⚠️ local.conf 캐시 경로 업데이트에 실패했습니다.');
			// 환경 초기화 자체는 완료되었을 수 있으므로, 여기서는 치명적 에러로 보지 않고 계속 진행
		}

		return { envPath, buildDir };
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
	 * MCU 빌드 환경(mcu-build.sh + local.conf 캐시 경로)만 설정하는 헬퍼
	 * - bitbake 빌드는 실행하지 않음
	 */
	private static async setupMcuEnvironmentOnly(
		projectRoot: string,
		workspaceFolder: vscode.WorkspaceFolder,
		mcuMachine: string,
		mcuVersion: string
	): Promise<{ envPath: string; buildDir: string } | null> {
		// buildtools 환경 확인 (Unix 경로)
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
			return null;
		}

		// 빌드 스크립트 및 디렉토리 경로 설정 (Unix 경로)
		const mcuBuildScript = `${projectRoot}/poky/meta-telechips/meta-dev/meta-mcu-dev/mcu-build.sh`;
		const mcuBuildScriptUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: mcuBuildScript
		});

		const buildDir = `${projectRoot}/build/${mcuMachine}`;

		try {
			await vscode.workspace.fs.stat(mcuBuildScriptUri);
			axonLog(`✅ MCU 빌드 스크립트 확인: ${mcuBuildScript}`);
		} catch {
			const errorMsg = `MCU 빌드 스크립트를 찾을 수 없습니다: ${mcuBuildScript}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return null;
		}

		axonLog(`📁 빌드 디렉토리: ${buildDir}`);

		// 환경만 설정 (bitbake 실행 없음)
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

		// MCU local.conf에도 캐시 경로 설정 시도
		const updated = await this.updateLocalConfCachePaths(buildDir, workspaceFolder);
		if (!updated) {
			axonLog('⚠️ MCU local.conf 캐시 경로 업데이트에 실패했습니다.');
		}

		return { envPath, buildDir };
	}

	/**
	 * bootFirmwareFolderName 설정 확인 및 선택
	 * (프로젝트 타입 기반으로 자동 설정)
	 */
	private static async ensureBootFirmwareFolderName(): Promise<string | undefined> {
		const { ensureProjectType, getAxonConfig } = await import('../../utils');
		
		// 프로젝트 타입 선택 (자동으로 bootFirmwareFolderName도 설정됨)
		const projectType = await ensureProjectType();
		
		if (!projectType) {
			axonLog('❌ 프로젝트 타입 선택이 취소되었습니다.');
			return undefined;
		}
		
		// 설정된 bootFirmwareFolderName 반환
		const config = getAxonConfig();
		axonLog(`✅ bootFirmwareFolderName: ${config.bootFirmwareFolderName}`);
		
		return config.bootFirmwareFolderName;
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
	 * 1. settings.json에 저장된 경로 확인 (빠름)
	 * 2. boot-firmware 폴더를 찾아서 그 부모 폴더 반환 (자동 탐지)
	 * 3. 찾은 경로를 settings.json에 저장 (다음번에 빠르게 사용)
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
		
		const config = vscode.workspace.getConfiguration('axon');
		
		// 1. settings.json에서 저장된 경로 확인
		const savedProjectRoot = config.get<string>('yocto.projectRoot');
		
		if (savedProjectRoot && savedProjectRoot.trim() !== '') {
			axonLog(`🔍 저장된 Yocto 프로젝트 루트 확인 중: ${savedProjectRoot}`);
			
			try {
				const savedUri = vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: savedProjectRoot
				});
				
				const pokyUri = vscode.Uri.joinPath(savedUri, 'poky');
				const axonConfig = getAxonConfig();
				const bootFirmwareUri = vscode.Uri.joinPath(savedUri, axonConfig.bootFirmwareFolderName);
				
				// 파일 존재 확인
				try {
					await vscode.workspace.fs.stat(pokyUri);
					axonLog(`✅ 저장된 Yocto 프로젝트 루트 사용: ${savedProjectRoot}`);
					return savedProjectRoot;
				} catch {
					try {
						await vscode.workspace.fs.stat(bootFirmwareUri);
						axonLog(`✅ 저장된 Yocto 프로젝트 루트 사용: ${savedProjectRoot}`);
						return savedProjectRoot;
					} catch {
						axonLog(`⚠️ 저장된 경로가 유효하지 않습니다. 재탐색을 시작합니다.`);
					}
				}
			} catch (error) {
				axonLog(`⚠️ 저장된 경로 검증 실패. 재탐색을 시작합니다: ${error}`);
			}
		}
		
		// 2. boot-firmware 폴더 찾기 (자동 탐지)
		axonLog('🔍 boot-firmware 폴더를 찾아 Yocto 프로젝트 루트 탐지 중...');
		const bootFirmwarePath = await findBootFirmwareFolder();
		
		if (bootFirmwarePath) {
			let projectRoot: string;
			
			// URI 문자열인지 확인 (원격 환경)
			if (bootFirmwarePath.startsWith('vscode-remote://')) {
				// URI를 파싱하여 부모 경로 가져오기
				const bootFirmwareUri = vscode.Uri.parse(bootFirmwarePath);
				const projectRootUri = vscode.Uri.joinPath(bootFirmwareUri, '..');
				projectRoot = projectRootUri.path; // Unix 경로 반환
				axonLog(`✅ Yocto 프로젝트 루트 발견: ${projectRoot}`);
			} else {
				// 일반 경로 - Unix 경로로 간주
				projectRoot = bootFirmwarePath.substring(0, bootFirmwarePath.lastIndexOf('/'));
				axonLog(`✅ Yocto 프로젝트 루트 발견: ${projectRoot}`);
			}
			
			// 3. settings.json에 저장 (다음번에 빠르게 사용)
			try {
				await config.update('yocto.projectRoot', projectRoot, vscode.ConfigurationTarget.Workspace);
				axonLog(`💾 Yocto 프로젝트 루트를 settings.json에 저장했습니다.`);
			} catch (error) {
				axonLog(`⚠️ settings.json 저장 실패 (무시): ${error}`);
			}
			
			return projectRoot;
		}
		
		// 3. 찾지 못한 경우
		throw new Error(
			`Yocto 프로젝트 루트를 찾을 수 없습니다.\n\n` +
			`확인 사항:\n` +
			`- boot-firmware_tcn1000 폴더가 있는지 확인하세요.\n` +
			`- 워크스페이스: ${workspacePath}`
		);
	}
	
	/**
	 * Yocto AP 빌드 실행
	 * build-axon.py의 action_choice==2 (build ap) 로직 구현
	 */
	static async buildAp(): Promise<void> {
		axonLog('🔨 Yocto AP 빌드 시작...');
		
		try {
			// 0. bootFirmwareFolderName 설정 확인 및 선택
			const bootFirmwareFolderName = await this.ensureBootFirmwareFolderName();
			if (!bootFirmwareFolderName) {
				vscode.window.showInformationMessage('빌드가 취소되었습니다.');
				return;
			}
			
			// 1. Yocto 프로젝트 루트 찾기 (Unix 경로)
			const projectRoot = await this.getYoctoProjectRoot();
			axonLog(`📁 Yocto 프로젝트 루트: ${projectRoot}`);
			
			// 워크스페이스 폴더
			const workspaceFolder = vscode.workspace.workspaceFolders![0];
			
			// 2. 빌드 설정 로드 또는 선택 (config.json)
			const apConfig = await this.ensureApBuildConfig(projectRoot, workspaceFolder);
			if (!apConfig) {
				return;
			}
			const { machine, cgwVersion } = apConfig;
			
			// 3. 빌드 설정 확인 표시
			const configInfo = [
				'',
				'==================================================',
				'           AP Build Configuration',
				'==================================================',
				`  AP MACHINE         : ${machine}`,
				`  AP SDK VERSION     : ${cgwVersion}`,
				'==================================================',
				''
			].join('\n');
			
			axonLog(configInfo);
			
			// 4. 사용자 확인
			const confirm = await vscode.window.showWarningMessage(
				`Yocto AP 빌드를 시작하시겠습니까?\n\nMACHINE: ${machine}\nSDK VERSION: ${cgwVersion}\n\n이 작업은 시간이 오래 걸릴 수 있습니다.`,
				{ modal: true },
				'빌드 시작',
				'취소'
			);
			
			if (confirm !== '빌드 시작') {
				axonLog('❌ 사용자 취소: 빌드가 취소되었습니다.');
				vscode.window.showInformationMessage('빌드가 취소되었습니다.');
				return;
			}

			// 5~7. AP 빌드 환경만 초기화 (buildDir/local.conf 포함)
			const envResult = await this.setupApEnvironmentOnly(projectRoot, workspaceFolder, machine, cgwVersion);
			if (!envResult) {
				return;
			}
			const { envPath, buildDir } = envResult;
			
			// 8. 빌드 명령 구성 및 실행
			const buildDirRelative = `build/${machine}`;
			const buildCommands = [
				`bitbake telechips-cgw-image`,
				`bitbake -f -c make_fai telechips-cgw-image`,
				`echo ""`,
				`echo "✅ Yocto AP 빌드가 완료되었습니다!"`,
				`echo "MACHINE: ${machine}"`,
				`echo "SDK VERSION: ${cgwVersion}"`,
				`echo ""`,
				`echo "Press any key to close..."`,
				`read -n1 -s -r`
			];
			
			vscode.window.showInformationMessage('Yocto AP 빌드가 시작되었습니다. 터미널을 확인하세요.');
			
			await this.executeBuildCommand(
				projectRoot,
				envPath,
				buildDirRelative,
				buildCommands,
				'Yocto AP Build',
				'yoctoApBuild',
				workspaceFolder
			);
		
		// Build View에 포커스 복원
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);
		
		// 9. 빌드 완료
		const successMsg = `✅ Yocto AP 빌드가 완료되었습니다!\n\nMACHINE: ${machine}\nSDK VERSION: ${cgwVersion}\n빌드 디렉토리: ${buildDir}`;
		axonSuccess(successMsg);
		vscode.window.showInformationMessage('Yocto AP 빌드가 완료되었습니다!');
			
		} catch (error) {
			const errorMsg = `Yocto AP 빌드 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * Yocto MCU 빌드 실행
	 * build-axon.py의 action_choice==3 (build mcu) 로직 구현
	 */
	static async buildMcu(): Promise<void> {
		axonLog('🔨 Yocto MCU 빌드 시작...');
		
		try {
			// 0. bootFirmwareFolderName 설정 확인 및 선택
			const bootFirmwareFolderName = await this.ensureBootFirmwareFolderName();
			if (!bootFirmwareFolderName) {
				vscode.window.showInformationMessage('빌드가 취소되었습니다.');
				return;
			}
			
			// 1. Yocto 프로젝트 루트 찾기 (Unix 경로)
			const projectRoot = await this.getYoctoProjectRoot();
			axonLog(`📁 Yocto 프로젝트 루트: ${projectRoot}`);
			
			// 워크스페이스 폴더
			const workspaceFolder = vscode.workspace.workspaceFolders![0];
			
			// 2. 빌드 설정 로드 또는 선택 (config.json)
			const mcuConfig = await this.ensureMcuBuildConfig(projectRoot, workspaceFolder);
			if (!mcuConfig) {
				return;
			}
			const { mcuMachine, mcuVersion } = mcuConfig;
			
			// 3. 빌드 설정 확인 표시
			const configInfo = [
				'',
				'==================================================',
				'           MCU Build Configuration',
				'==================================================',
				`  MCU MACHINE        : ${mcuMachine}`,
				`  MCU SDK VERSION    : ${mcuVersion}`,
				'==================================================',
				''
			].join('\n');
			
			axonLog(configInfo);
			
			// 4. 사용자 확인
			const confirm = await vscode.window.showWarningMessage(
				`Yocto MCU 빌드를 시작하시겠습니까?\n\nMACHINE: ${mcuMachine}\nSDK VERSION: ${mcuVersion}\n\n이 작업은 시간이 오래 걸릴 수 있습니다.`,
				{ modal: true },
				'빌드 시작',
				'취소'
			);
			
			if (confirm !== '빌드 시작') {
				axonLog('❌ 사용자 취소: 빌드가 취소되었습니다.');
				vscode.window.showInformationMessage('빌드가 취소되었습니다.');
				return;
			}
			
			// 5~7. MCU 빌드 환경만 초기화 (buildDir/local.conf 포함)
			const envResult = await this.setupMcuEnvironmentOnly(projectRoot, workspaceFolder, mcuMachine, mcuVersion);
			if (!envResult) {
				return;
			}
			const { envPath, buildDir } = envResult;
			
			// 7. 빌드 명령 구성 (원격 환경용 - Unix 경로)
			const buildCommands = [
				`cd "${projectRoot}"`,  // 프로젝트 루트로 이동
				`source "${envPath}"`,
				`cd "${buildDir}"`,
				`bitbake m7-0 m7-1 m7-2 m7-np -f -c compile`,
				`echo ""`,
				`echo "✅ Yocto MCU 빌드가 완료되었습니다!"`,
				`echo "MACHINE: ${mcuMachine}"`,
				`echo "SDK VERSION: ${mcuVersion}"`,
				`echo ""`,
				`echo "Press any key to close..."`,
				`read -n1 -s -r`
			];
			
			const fullCommand = buildCommands.join(' && ');
			
			axonLog('🚀 빌드 명령:');
			buildCommands.forEach(cmd => axonLog(`  ${cmd}`));
			
			// 8. 빌드 실행
			vscode.window.showInformationMessage('Yocto MCU 빌드가 시작되었습니다. 터미널을 확인하세요.');
			
			await executeShellTask({
				command: fullCommand,
				cwd: projectRoot,  // 원격 환경에서는 무시됨 (shell-utils.ts에서 처리)
				taskName: 'Yocto MCU Build',
				taskId: 'yoctoMcuBuild',
				showTerminal: true,
				useScriptFile: true
			});
		
		// Build View에 포커스 복원
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);
		
		// 9. 빌드 완료
		const successMsg = `✅ Yocto MCU 빌드가 완료되었습니다!\n\nMACHINE: ${mcuMachine}\nSDK VERSION: ${mcuVersion}\n빌드 디렉토리: ${buildDir}`;
		axonSuccess(successMsg);
		vscode.window.showInformationMessage('Yocto MCU 빌드가 완료되었습니다!');
			
		} catch (error) {
			const errorMsg = `Yocto MCU 빌드 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * Yocto Kernel 빌드 (AP Kernel + SD_fai.rom 생성)
	 * build-axon.py의 action_choice==8 (build kernel) 로직 구현
	 */
	static async buildKernel(): Promise<void> {
		axonLog('🔨 Yocto Kernel 빌드 시작...');
		
		try {
			// 0. bootFirmwareFolderName 설정 확인 및 선택
			const bootFirmwareFolderName = await this.ensureBootFirmwareFolderName();
			if (!bootFirmwareFolderName) {
				vscode.window.showInformationMessage('빌드가 취소되었습니다.');
				return;
			}
			
			// 1. Yocto 프로젝트 루트 찾기 (Unix 경로)
			const projectRoot = await this.getYoctoProjectRoot();
			axonLog(`📁 Yocto 프로젝트 루트: ${projectRoot}`);
			
			// 워크스페이스 폴더로 URI 구성
			const workspaceFolder = vscode.workspace.workspaceFolders![0];
			const projectRootUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: projectRoot
			});
			
			// 2. 빌드 설정 로드 또는 선택 (config.json)
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
						title: 'Yocto Kernel Build Configuration'
					});
					
					if (!machine) {
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
						title: 'Yocto Kernel Build Configuration'
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
					
					existingConfig.machine = machine;
					existingConfig.version = cgwVersion;
					
					const configJson = JSON.stringify(existingConfig, null, 2);
					await vscode.workspace.fs.writeFile(configUri, Buffer.from(configJson, 'utf8'));
					axonLog(`💾 빌드 설정을 config.json에 저장했습니다: MACHINE=${machine}, VERSION=${cgwVersion}`);
				} catch (error) {
					axonLog(`⚠️ config.json 저장 실패 (계속 진행): ${error}`);
				}
			}
			
			// 3. 빌드 설정 확인 표시
			const configInfo = [
				'',
				'==================================================',
				'      Kernel Build + make SD_fai.rom',
				'==================================================',
				`  AP MACHINE         : ${machine}`,
				`  AP SDK VERSION     : ${cgwVersion}`,
				'==================================================',
				''
			].join('\n');
			
			axonLog(configInfo);
			
			// 4. 사용자 확인
			const confirm = await vscode.window.showWarningMessage(
				`Yocto Kernel 빌드를 시작하시겠습니까?\n\nMACHINE: ${machine}\nSDK VERSION: ${cgwVersion}\n\n⚠️ Kernel 컴파일 후 이미지를 생성합니다.\n이 작업은 시간이 오래 걸릴 수 있습니다.`,
				{ modal: true },
				'빌드 시작',
				'취소'
			);
			
			if (confirm !== '빌드 시작') {
				axonLog('❌ 사용자 취소: 빌드가 취소되었습니다.');
				vscode.window.showInformationMessage('빌드가 취소되었습니다.');
				return;
			}
			
			// 5. buildtools 환경 확인
			const envPath = await this.ensureBuildtoolsEnvironment(projectRoot, workspaceFolder);
			if (!envPath) {
				return;
			}
			
			// 6. 빌드 디렉토리 설정 (cgw-build.sh 실행)
			const buildDir = `${projectRoot}/build/${machine}`;
			axonLog(`📁 빌드 디렉토리: ${buildDir}`);
			
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
			
			// 7. local.conf 파일 수정 (캐시 경로 설정)
			axonLog('📝 local.conf 파일 수정 중...');
			await this.updateLocalConfCachePaths(buildDir, workspaceFolder);
			
			// 8. 빌드 명령 구성 및 실행
			// Kernel 빌드 특화: linux-telechips 컴파일 후 이미지 생성
			const buildDirRelative = `build/${machine}`;
			const buildCommands = [
				`bitbake linux-telechips -f -c compile`,
				`bitbake telechips-cgw-image`,
				`bitbake -f -c make_fai telechips-cgw-image`,
				`echo ""`,
				`echo "✅ Yocto Kernel 빌드가 완료되었습니다!"`,
				`echo "MACHINE: ${machine}"`,
				`echo "SDK VERSION: ${cgwVersion}"`,
				`echo ""`,
				`echo "Press any key to close..."`,
				`read -n1 -s -r`
			];
			
			vscode.window.showInformationMessage('Yocto Kernel 빌드가 시작되었습니다. 터미널을 확인하세요.');
			
			await this.executeBuildCommand(
				projectRoot,
				envPath,
				buildDirRelative,
				buildCommands,
				'Yocto Kernel Build',
				'yoctoKernelBuild',
				workspaceFolder
			);
			
			// Build View에 포커스 복원
			setTimeout(async () => {
				await vscode.commands.executeCommand('axonBuildView.focus');
				axonLog(`🔄 Build View에 포커스를 복원했습니다`);
			}, 100);
			
			// 9. 빌드 완료
			const successMsg = `✅ Yocto Kernel 빌드가 완료되었습니다!\n\nMACHINE: ${machine}\nSDK VERSION: ${cgwVersion}\n빌드 디렉토리: ${buildDir}`;
			axonSuccess(successMsg);
			vscode.window.showInformationMessage('Yocto Kernel 빌드가 완료되었습니다!');
			
		} catch (error) {
			const errorMsg = `Yocto Kernel 빌드 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * Yocto AP 빌드 클린
	 * build-axon.py의 action_choice==5 (clean ap) 로직 구현
	 */
	static async cleanApBuild(): Promise<void> {
		axonLog('🧹 Yocto AP 빌드 클린 시작...');
		
		try {
			// 0. bootFirmwareFolderName 설정 확인 및 선택
			const bootFirmwareFolderName = await this.ensureBootFirmwareFolderName();
			if (!bootFirmwareFolderName) {
				vscode.window.showInformationMessage('작업이 취소되었습니다.');
				return;
			}
			
			// 1. Yocto 프로젝트 루트 찾기 (Unix 경로)
			const projectRoot = await this.getYoctoProjectRoot();
			axonLog(`📁 Yocto 프로젝트 루트: ${projectRoot}`);
			
			// 워크스페이스 폴더로 URI 구성
			const workspaceFolder = vscode.workspace.workspaceFolders![0];
			
			// 2. AP 빌드 디렉토리 확인
			const apBuildDir = `${projectRoot}/build/tcn1000`;
			const apBuildUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: apBuildDir
			});
			
			// 빌드 디렉토리 존재 확인
			try {
				await vscode.workspace.fs.stat(apBuildUri);
				axonLog(`✅ AP 빌드 폴더 확인: ${apBuildDir}`);
			} catch {
				const msg = 'AP 빌드 폴더를 찾을 수 없습니다. 이미 정리되었거나 빌드되지 않았습니다.';
				axonLog(`⚠️ ${msg}`);
				vscode.window.showWarningMessage(msg);
				return;
			}
			
			// 3. 사용자 확인
			const confirm = await vscode.window.showWarningMessage(
				`AP 빌드 폴더를 정리하시겠습니까?\n\n경로: ${apBuildDir}\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`,
				{ modal: true },
				'정리 시작',
				'취소'
			);
			
			if (confirm !== '정리 시작') {
				axonLog('❌ 사용자 취소: AP 빌드 정리가 취소되었습니다.');
				vscode.window.showInformationMessage('AP 빌드 정리가 취소되었습니다.');
				return;
			}
			
			// 4. 클린 명령 구성 (원격 환경용 - Unix 경로)
			//    build/tcn1000 디렉토리는 유지하고, 그 안에서 conf / downloads / sstate-cache 를 제외한 나머지만 삭제
			const cleanCommand = [
				`cd "${apBuildDir}"`,
				`echo "Cleaning Yocto AP build directory (except conf/downloads/sstate-cache)..."`,
				`find . -mindepth 1 -maxdepth 1 -not -name 'conf' -a -not -name 'downloads' -a -not -name 'sstate-cache' -exec rm -rf {} +`,
				`echo ""`,
				`echo "✅ AP 빌드 정리가 완료되었습니다!"`,
				`echo "Press any key to close..."`,
				`read -n1 -s -r`
			].join(' && ');
			
			axonLog('🚀 클린 명령:');
			axonLog(`  ${cleanCommand}`);
			
			// 5. 클린 실행
			vscode.window.showInformationMessage('AP 빌드 정리가 시작되었습니다. 터미널을 확인하세요.');
			
			await executeShellTask({
				command: cleanCommand,
				cwd: projectRoot,
				taskName: 'Yocto AP Clean',
				taskId: 'yoctoApClean',
				showTerminal: true,
				useScriptFile: true
			});
		
		// Build View에 포커스 복원
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);
			
			// 6. 완료
			const successMsg = `✅ AP 빌드 정리가 완료되었습니다!\n\n경로: ${apBuildDir}`;
			axonSuccess(successMsg);
			vscode.window.showInformationMessage('AP 빌드 정리가 완료되었습니다!');
			
		} catch (error) {
			const errorMsg = `AP 빌드 정리 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * Yocto MCU 빌드 클린
	 * build-axon.py의 action_choice==6 (clean mcu) 로직 구현
	 */
	static async cleanMcuBuild(): Promise<void> {
		axonLog('🧹 Yocto MCU 빌드 클린 시작...');
		
		try {
			// 0. bootFirmwareFolderName 설정 확인 및 선택
			const bootFirmwareFolderName = await this.ensureBootFirmwareFolderName();
			if (!bootFirmwareFolderName) {
				vscode.window.showInformationMessage('작업이 취소되었습니다.');
				return;
			}
			
			// 1. Yocto 프로젝트 루트 찾기 (Unix 경로)
			const projectRoot = await this.getYoctoProjectRoot();
			axonLog(`📁 Yocto 프로젝트 루트: ${projectRoot}`);
			
			// 워크스페이스 폴더로 URI 구성
			const workspaceFolder = vscode.workspace.workspaceFolders![0];
			
			// 2. MCU 빌드 디렉토리 확인
			const mcuBuildDir = `${projectRoot}/build/tcn1000-mcu`;
			const mcuBuildUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: mcuBuildDir
			});
			
			// 빌드 디렉토리 존재 확인
			try {
				await vscode.workspace.fs.stat(mcuBuildUri);
				axonLog(`✅ MCU 빌드 폴더 확인: ${mcuBuildDir}`);
			} catch {
				const msg = 'MCU 빌드 폴더를 찾을 수 없습니다. 이미 정리되었거나 빌드되지 않았습니다.';
				axonLog(`⚠️ ${msg}`);
				vscode.window.showWarningMessage(msg);
				return;
			}
			
			// 3. 사용자 확인
			const confirm = await vscode.window.showWarningMessage(
				`MCU 빌드 폴더를 정리하시겠습니까?\n\n경로: ${mcuBuildDir}\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`,
				{ modal: true },
				'정리 시작',
				'취소'
			);
			
			if (confirm !== '정리 시작') {
				axonLog('❌ 사용자 취소: MCU 빌드 정리가 취소되었습니다.');
				vscode.window.showInformationMessage('MCU 빌드 정리가 취소되었습니다.');
				return;
			}
			
			// 4. 클린 명령 구성 (원격 환경용 - Unix 경로)
			//    build/tcn1000-mcu 디렉토리는 유지하고, 그 안에서 conf / downloads / sstate-cache 를 제외한 나머지만 삭제
			const cleanCommand = [
				`cd "${mcuBuildDir}"`,
				`echo "Cleaning Yocto MCU build directory (except conf/downloads/sstate-cache)..."`,
				`find . -mindepth 1 -maxdepth 1 -not -name 'conf' -a -not -name 'downloads' -a -not -name 'sstate-cache' -exec rm -rf {} +`,
				`echo ""`,
				`echo "✅ MCU 빌드 정리가 완료되었습니다!"`,
				`echo "Press any key to close..."`,
				`read -n1 -s -r`
			].join(' && ');
			
			axonLog('🚀 클린 명령:');
			axonLog(`  ${cleanCommand}`);
			
			// 5. 클린 실행
			vscode.window.showInformationMessage('MCU 빌드 정리가 시작되었습니다. 터미널을 확인하세요.');
			
			await executeShellTask({
				command: cleanCommand,
				cwd: projectRoot,
				taskName: 'Yocto MCU Clean',
				taskId: 'yoctoMcuClean',
				showTerminal: true,
				useScriptFile: true
			});
		
		// Build View에 포커스 복원
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);
			
			// 6. 완료
			const successMsg = `✅ MCU 빌드 정리가 완료되었습니다!\n\n경로: ${mcuBuildDir}`;
			axonSuccess(successMsg);
			vscode.window.showInformationMessage('MCU 빌드 정리가 완료되었습니다!');
			
		} catch (error) {
			const errorMsg = `MCU 빌드 정리 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * Yocto AP + MCU 빌드 클린
	 * build-axon.py의 action_choice==7 (clean ap + mcu) 로직 구현
	 * Python에서는 두 함수를 순차 호출하므로, 여기서도 각각 실행
	 */
	static async cleanAllBuild(): Promise<void> {
		axonLog('🧹 Yocto AP + MCU 빌드 클린 시작...');
		
		try {
			// 0. bootFirmwareFolderName 설정 확인 및 선택
			const bootFirmwareFolderName = await this.ensureBootFirmwareFolderName();
			if (!bootFirmwareFolderName) {
				vscode.window.showInformationMessage('작업이 취소되었습니다.');
				return;
			}
			
			// 1. Yocto 프로젝트 루트 찾기 (Unix 경로)
			const projectRoot = await this.getYoctoProjectRoot();
			axonLog(`📁 Yocto 프로젝트 루트: ${projectRoot}`);
			
			// 워크스페이스 폴더로 URI 구성
			const workspaceFolder = vscode.workspace.workspaceFolders![0];
			
			// 2. 빌드 디렉토리 확인
			const apBuildDir = `${projectRoot}/build/tcn1000`;
			const mcuBuildDir = `${projectRoot}/build/tcn1000-mcu`;
			
			const apBuildUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: apBuildDir
			});
			
			const mcuBuildUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: mcuBuildDir
			});
			
			let apExists = false;
			let mcuExists = false;
			
			try {
				await vscode.workspace.fs.stat(apBuildUri);
				apExists = true;
				axonLog(`✅ AP 빌드 폴더 확인: ${apBuildDir}`);
			} catch {
				axonLog(`⚠️ AP 빌드 폴더 없음: ${apBuildDir}`);
			}
			
			try {
				await vscode.workspace.fs.stat(mcuBuildUri);
				mcuExists = true;
				axonLog(`✅ MCU 빌드 폴더 확인: ${mcuBuildDir}`);
			} catch {
				axonLog(`⚠️ MCU 빌드 폴더 없음: ${mcuBuildDir}`);
			}
			
			if (!apExists && !mcuExists) {
				const msg = 'AP/MCU 빌드 폴더를 찾을 수 없습니다. 이미 정리되었거나 빌드되지 않았습니다.';
				axonLog(`⚠️ ${msg}`);
				vscode.window.showWarningMessage(msg);
				return;
			}
			
			// 3. 사용자 확인
			const foldersToClean = [];
			if (apExists) foldersToClean.push('AP');
			if (mcuExists) foldersToClean.push('MCU');
			
			const confirm = await vscode.window.showWarningMessage(
				`${foldersToClean.join(' + ')} 빌드 폴더를 정리하시겠습니까?\n\n` +
				`${apExists ? `AP: ${apBuildDir}\n` : ''}` +
				`${mcuExists ? `MCU: ${mcuBuildDir}\n` : ''}` +
				`\n⚠️ 이 작업은 되돌릴 수 없습니다.`,
				{ modal: true },
				'정리 시작',
				'취소'
			);
			
			if (confirm !== '정리 시작') {
				axonLog('❌ 사용자 취소: 빌드 정리가 취소되었습니다.');
				vscode.window.showInformationMessage('빌드 정리가 취소되었습니다.');
				return;
			}
			
			// 4. 클린 실행 (각각 독립적으로 실행)
			vscode.window.showInformationMessage('빌드 정리가 시작되었습니다. 터미널을 확인하세요.');
			
			if (apExists) {
				const apCleanCommand = [
					`cd "${apBuildDir}"`,
					`echo "Cleaning Yocto AP build directory (except conf/downloads/sstate-cache)..."`,
					`find . -mindepth 1 -maxdepth 1 -not -name 'conf' -a -not -name 'downloads' -a -not -name 'sstate-cache' -exec rm -rf {} +`
				].join(' && ');
				
				axonLog('🚀 AP 클린 명령:');
				axonLog(`  ${apCleanCommand}`);
				
				await executeShellTask({
					command: apCleanCommand,
					cwd: projectRoot,
					taskName: 'Yocto AP Clean',
					taskId: 'yoctoApCleanInAll',
					showTerminal: true,
					useScriptFile: true
				});
			}
			
			if (mcuExists) {
				const mcuCleanCommand = [
					`cd "${mcuBuildDir}"`,
					`echo "Cleaning Yocto MCU build directory (except conf/downloads/sstate-cache)..."`,
					`find . -mindepth 1 -maxdepth 1 -not -name 'conf' -a -not -name 'downloads' -a -not -name 'sstate-cache' -exec rm -rf {} +`
				].join(' && ');
				
				axonLog('🚀 MCU 클린 명령:');
				axonLog(`  ${mcuCleanCommand}`);
				
				await executeShellTask({
					command: mcuCleanCommand,
					cwd: projectRoot,
					taskName: 'Yocto MCU Clean',
					taskId: 'yoctoMcuCleanInAll',
					showTerminal: true,
					useScriptFile: true
				});
			}
			
			// 모든 클린 작업 완료 후 사용자 확인 대기
			const waitCommand = `echo "" && echo "✅ 모든 빌드 정리가 완료되었습니다!" && echo "Press any key to close..." && read -n1 -s -r`;
			
			await executeShellTask({
				command: waitCommand,
				cwd: projectRoot,
				taskName: 'Yocto Clean All - Wait',
				taskId: 'yoctoCleanAllWait',
				showTerminal: true,
				useScriptFile: true
			});
		
		// Build View에 포커스 복원
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);
			
			// 5. 완료
			const successMsg = `✅ ${foldersToClean.join(' + ')} 빌드 정리가 완료되었습니다!`;
			axonSuccess(successMsg);
			vscode.window.showInformationMessage(successMsg);
			
		} catch (error) {
			const errorMsg = `빌드 정리 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
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

				const envResult = await this.setupApEnvironmentOnly(projectRoot, workspaceFolder, machine, cgwVersion);
				if (!envResult) {
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

				const envResult = await this.setupMcuEnvironmentOnly(projectRoot, workspaceFolder, mcuMachine, mcuVersion);
				if (!envResult) {
					return;
				}

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





