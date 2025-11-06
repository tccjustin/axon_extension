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
	 * Yocto 프로젝트 루트 경로 찾기
	 * 
	 * 전략:
	 * 1. settings.json에 저장된 경로 확인 (빠름)
	 * 2. boot-firmware 폴더를 찾아서 그 부모 폴더 반환 (자동 탐지)
	 * 3. 찾은 경로를 settings.json에 저장 (다음번에 빠르게 사용)
	 * 
	 * @returns Unix 경로 형식 문자열 (/home/..., /mnt/..., 등)
	 */
	private static async getYoctoProjectRoot(): Promise<string> {
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
			
			// 2. 빌드 설정 로드 (config.json)
			const configUri = vscode.Uri.joinPath(projectRootUri, 'config.json');
			let machine = this.DEFAULT_MACHINE;
			let cgwVersion = this.DEFAULT_VERSION;
			
			try {
				const configContent = await vscode.workspace.fs.readFile(configUri);
				const config = JSON.parse(Buffer.from(configContent).toString('utf8'));
				machine = config.machine || this.DEFAULT_MACHINE;
				cgwVersion = config.version || this.DEFAULT_VERSION;
				axonLog(`✅ 설정 로드: MACHINE=${machine}, CGW_SDK_VERSION=${cgwVersion}`);
			} catch (error) {
				axonLog(`⚠️ config.json 읽기 실패 또는 없음, 기본값 사용: MACHINE=${machine}, VERSION=${cgwVersion}`);
			}
			
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
			
			// 5. buildtools 환경 확인 (Unix 경로)
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
			
			// 6. 빌드 스크립트 및 디렉토리 경로 설정 (Unix 경로)
			const cgwBuildScript = `${projectRoot}/poky/meta-telechips/meta-dev/meta-cgw-dev/cgw-build.sh`;
			const cgwBuildScriptUri = vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: cgwBuildScript
			});
			
			const buildDir = `${projectRoot}/build/${machine}`;
			
			try {
				await vscode.workspace.fs.stat(cgwBuildScriptUri);
				axonLog(`✅ CGW 빌드 스크립트 확인: ${cgwBuildScript}`);
			} catch {
				const errorMsg = `CGW 빌드 스크립트를 찾을 수 없습니다: ${cgwBuildScript}`;
				axonError(errorMsg);
				vscode.window.showErrorMessage(errorMsg);
				return;
			}
			
			axonLog(`📁 빌드 디렉토리: ${buildDir}`);
			
			// 7. 빌드 명령 구성 (원격 환경용 - Unix 경로)
			const buildCommands = [
				`cd "${projectRoot}"`,  // 프로젝트 루트로 이동
				`source "${envPath}"`,
				`source "${cgwBuildScript}" ${machine} ${cgwVersion}`,
				`cd "${buildDir}"`,
				`bitbake telechips-cgw-image`,
				`bitbake -f -c make_fai telechips-cgw-image`
			];
			
			const fullCommand = buildCommands.join(' && ');
			
			axonLog('🚀 빌드 명령:');
			buildCommands.forEach(cmd => axonLog(`  ${cmd}`));
			
			// 8. 빌드 실행
			vscode.window.showInformationMessage('Yocto AP 빌드가 시작되었습니다. 터미널을 확인하세요.');
			
			await executeShellTask({
				command: fullCommand,
				cwd: projectRoot,  // 원격 환경에서는 무시됨 (shell-utils.ts에서 처리)
				taskName: 'Yocto AP Build',
				taskId: 'yoctoApBuild',
				showTerminal: true
			});
			
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
			
			// 2. 빌드 설정 로드 (config.json)
			const configUri = vscode.Uri.joinPath(projectRootUri, 'config.json');
			let mcuMachine = 'tcn1000-mcu';  // MCU 기본 머신
			let mcuVersion = 'dev';
			
			try {
				const configContent = await vscode.workspace.fs.readFile(configUri);
				const config = JSON.parse(Buffer.from(configContent).toString('utf8'));
				mcuMachine = config.mcu_machine || 'tcn1000-mcu';
				mcuVersion = config.mcu_version || 'dev';
				axonLog(`✅ 설정 로드: MCU_MACHINE=${mcuMachine}, MCU_SDK_VERSION=${mcuVersion}`);
			} catch (error) {
				axonLog(`⚠️ config.json 읽기 실패 또는 없음, 기본값 사용: MCU_MACHINE=${mcuMachine}, MCU_VERSION=${mcuVersion}`);
			}
			
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
			
			// 5. buildtools 환경 확인 (Unix 경로)
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
			
			// 6. 빌드 스크립트 및 디렉토리 경로 설정 (Unix 경로)
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
				return;
			}
			
			axonLog(`📁 빌드 디렉토리: ${buildDir}`);
			
			// 7. 빌드 명령 구성 (원격 환경용 - Unix 경로)
			const buildCommands = [
				`cd "${projectRoot}"`,  // 프로젝트 루트로 이동
				`source "${envPath}"`,
				`source "${mcuBuildScript}" ${mcuMachine} ${mcuVersion}`,
				`cd "${buildDir}"`,
				`bitbake m7-0 m7-1 m7-2 m7-np -f -c compile`
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
				showTerminal: true
			});
			
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
	 * Yocto 이미지 생성
	 * (향후 구현)
	 */
	static async buildImage(): Promise<void> {
		axonLog('📦 Yocto 이미지 생성 - 향후 구현 예정');
		throw new Error('Not implemented yet');
	}

	/**
	 * 클린 빌드 실행
	 * (향후 구현)
	 */
	static async cleanBuild(): Promise<void> {
		axonLog('🧹 Yocto 프로젝트 클린 빌드 - 향후 구현 예정');
		throw new Error('Not implemented yet');
	}
}





