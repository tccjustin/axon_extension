import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { axonLog, axonError, axonSuccess, getAxonOutputChannel } from './logger';
import { convertRemotePathToSamba } from './utils';
import { findProjectRootByShell } from './projects/common/shell-utils';

function escapeForSingleQuotedPowerShellString(value: string): string {
	// In PowerShell single-quoted strings, escape a single quote by doubling it.
	return value.replace(/'/g, "''");
}

function getLocalPowerShellExe(): string {
	const ps7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
	const ps5 = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
	if (fs.existsSync(ps7)) return ps7;
	if (fs.existsSync(ps5)) return ps5;
	throw new Error('로컬 PC에서 PowerShell 실행 파일을 찾지 못했습니다.');
}

// FWDN 설정 인터페이스
export interface FwdnConfig {
	fwdnExePath: string;
	bootFirmwarePath: string;
}

// 파티션 정보 인터페이스
export interface PartitionInfo {
	name: string;        // 예: "bl3_main_a"
	size: string;        // 예: "2M"
	filePath: string;    // 예: "/path/to/u-boot-tcn1000.rom"
	fileName: string;    // 예: "u-boot-tcn1000.rom"
}

/**
 * settings.json 업데이트 함수
 */
async function updateSettingsJson(
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
 * Boot Firmware 경로 가져오기
 * settings.json에 저장된 경로가 있으면 사용하고, 없으면 찾아서 저장
 * 
 * @returns Unix 경로 형식 문자열 (/home/..., /mnt/..., 등)
 */
async function getBootFirmwarePath(): Promise<string> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
	}
	
	// Unix 경로 사용 (원격 환경 기본)
	const workspacePath = workspaceFolder.uri.path;
	axonLog(`🌐 환경: WSL/SSH (scheme: ${workspaceFolder.uri.scheme})`);
	axonLog(`📁 워크스페이스 경로: ${workspacePath}`);
	
	// 1. settings.json 파일 직접 읽기
	const vscodeFolder = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
	const settingsFile = vscode.Uri.joinPath(vscodeFolder, 'settings.json');
	
	let savedBootFirmwarePath: string | undefined;
	
	try {
		const settingsContent = await vscode.workspace.fs.readFile(settingsFile);
		const settingsText = Buffer.from(settingsContent).toString('utf8');
		const settings = JSON.parse(settingsText);
		savedBootFirmwarePath = settings['axon.bootFirmware.path'];
		
		if (savedBootFirmwarePath && savedBootFirmwarePath.trim() !== '') {
			axonLog(`🔍 저장된 Boot Firmware 경로 확인 중: ${savedBootFirmwarePath}`);
			
			// 저장된 경로 유효성 검증
			try {
				const savedUri = vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: savedBootFirmwarePath
				});
				
				const prebuiltUri = vscode.Uri.joinPath(savedUri, 'prebuilt');
				const stat = await vscode.workspace.fs.stat(prebuiltUri);
				
				if (stat.type === vscode.FileType.Directory) {
					axonLog(`✅ 저장된 Boot Firmware 경로 사용: ${savedBootFirmwarePath}`);
					return savedBootFirmwarePath;
				}
			} catch {
				axonLog(`⚠️ 저장된 경로에 prebuilt 디렉토리가 없습니다. 재탐색을 시작합니다.`);
			}
		}
	} catch (error) {
		// settings.json 파일이 없거나 읽기 실패한 경우 (정상적인 경우)
		axonLog(`📝 settings.json 파일을 읽을 수 없습니다. 새로 탐색합니다.`);
	}
	
	// 2. root가 없으면 리눅스 shell 스크립트로 찾기
	axonLog('🔍 prebuilt 디렉토리를 찾아 Boot Firmware 경로 탐지 중...');
	const bootFirmwareRoot = await findProjectRootByShell({
		workspaceFolder,
		findPattern: 'prebuilt',
		maxDepth: 4,
		findType: 'd',
		parentLevels: 1,
		taskName: 'Find Boot Firmware Folder',
		taskId: 'find-boot-firmware-folder',
		resultFilePrefix: 'axon_boot_firmware_folder'
	});
	
	if (bootFirmwareRoot) {
		axonLog(`✅ Boot Firmware 경로 발견: ${bootFirmwareRoot}`);
		
		// 3. settings.json에 저장
		try {
			axonLog(`💾 settings.json에 Boot Firmware 경로 저장 시도: ${bootFirmwareRoot}`);
			await updateSettingsJson(workspaceFolder, { 'axon.bootFirmware.path': bootFirmwareRoot });
			axonLog(`✅ Boot Firmware 경로를 settings.json에 저장했습니다.`);
		} catch (error) {
			axonLog(`⚠️ settings.json 저장 실패: ${error}`);
			if (error instanceof Error) {
				axonLog(`   오류 상세: ${error.message}`);
				axonLog(`   스택: ${error.stack}`);
			}
			// 저장 실패해도 경로는 반환
		}
		
		return bootFirmwareRoot;
	}
	
	// 찾지 못한 경우
	throw new Error(
		`Boot Firmware 경로를 찾을 수 없습니다.\n\n` +
		`확인 사항:\n` +
		`- prebuilt 폴더가 워크스페이스 또는 그 하위 4단계까지 있는지 확인하세요.\n` +
		`- 워크스페이스: ${workspacePath}`
	);
}

// FWDN 설정 가져오기
export async function getFwdnConfig(extensionPath: string): Promise<FwdnConfig> {
	const config = vscode.workspace.getConfiguration('axon');

	// Boot Firmware 경로 가져오기 (settings.json 확인 후 없으면 찾기)
	const bootFirmwareRoot = await getBootFirmwarePath();

	// FWDN은 로컬 Windows에서 실행되므로 Windows 경로 필요
	// Unix 경로를 Samba 경로 또는 WSL 경로로 변환
	const remoteName = vscode.env.remoteName || '';
	const remoteType = remoteName.startsWith('wsl') ? 'wsl' : 'ssh';
	
	axonLog(`🌐 [FWDN] 원격 환경 감지: ${remoteName} → 타입: ${remoteType}`);
	
	// 환경에 맞는 경로 변환
	const bootFirmwarePath = convertRemotePathToSamba(bootFirmwareRoot, remoteType);
	axonLog(`🔄 [FWDN] 원격 경로 변환 완료: ${bootFirmwareRoot} → ${bootFirmwarePath}`);
	axonLog(`✅ Boot Firmware 경로 (FWDN용): ${bootFirmwarePath}`);

	// FWDN 실행 파일 경로 결정
	// 1. 사용자 설정 경로 확인
	let fwdnExePath = config.get<string>('fwdn.exePath', '');
	
	// 2. 설정이 없거나 파일이 존재하지 않으면 extension 내장 버전 사용
	if (!fwdnExePath || !fs.existsSync(fwdnExePath)) {
		const bundledFwdnPath = path.join(extensionPath, 'binaries', 'fwdn.exe');
		if (fs.existsSync(bundledFwdnPath)) {
			fwdnExePath = bundledFwdnPath;
			axonLog(`📦 Extension 내장 FWDN 사용: ${fwdnExePath}`);
		} else {
			axonLog(`⚠️ Extension 내장 FWDN을 찾을 수 없습니다: ${bundledFwdnPath}`);
		}
	} else {
		axonLog(`⚙️ 사용자 설정 FWDN 사용: ${fwdnExePath}`);
	}

	return {
		fwdnExePath: fwdnExePath,
		bootFirmwarePath: bootFirmwarePath
	};
}

// 설정 검증 함수
export function validateConfig(config: FwdnConfig): string | null {
	if (!config.fwdnExePath) {
		return 'FWDN 실행 파일 경로가 설정되지 않았습니다. 설정을 먼저 구성해주세요.';
	}
	if (!config.bootFirmwarePath) {
		return 'Boot Firmware 경로가 설정되지 않았습니다. 설정을 먼저 구성해주세요.';
	}
	return null;
}

// FWDN 실행 완료 후 자동 창 닫기 함수 (신호 파일 기반)
async function executeFwdnWithAutoClose(terminal: vscode.Terminal): Promise<void> {
	return new Promise(async (resolve) => {
		let isCompleted = false;

		try {
			axonLog('🔍 FWDN 완료 신호 파일 대기 중...');

			// 완료 신호 파일 경로 (배치 파일과 동일한 위치)
			const signalFile = path.join(os.tmpdir(), 'axon_fwdn_completed.txt');

			// 주기적으로 신호 파일 확인
			const checkSignalFile = async () => {
				try {
					if (fs.existsSync(signalFile)) {
						// 신호 파일 내용 확인
						const content = fs.readFileSync(signalFile, 'utf8').trim();
						if (content === 'FWDN_COMPLETED' && !isCompleted) {
							isCompleted = true;
							clearInterval(checkInterval!);

							// 신호 파일 삭제
							try {
								fs.unlinkSync(signalFile);
							} catch (deleteError) {
								axonLog(`⚠️ 신호 파일 삭제 실패: ${deleteError}`);
							}

							const successMsg = '✅ FWDN 실행 완료!';
							axonSuccess(successMsg);
							
						// 터미널 닫기 확인 팝업
						const result = await vscode.window.showInformationMessage(
							`FWDN이 완료되었습니다.\n터미널을 닫겠습니까?`,
							{ modal: true },
							'Yes',
							'No'
						);
						
						if (result === 'Yes') {
							try {
								terminal.dispose();
								axonLog(`✅ 사용자가 터미널 닫기를 선택했습니다. 터미널을 닫습니다.`);
							} catch (disposeError) {
								axonLog(`⚠️ 터미널 종료 중 오류: ${disposeError}`);
							}
						} else {
							axonLog(`ℹ️ 사용자가 터미널을 열어둡니다.`);
						}
							
							resolve();
						}
					}
				} catch (error) {
					axonLog(`⚠️ 신호 파일 확인 중 오류: ${error}`);
				}
			};

			// 0.5초마다 신호 파일 확인
			const checkInterval = setInterval(() => {
				checkSignalFile().catch(error => {
					axonLog(`⚠️ 신호 파일 확인 중 오류: ${error}`);
				});
			}, 500);

			// 초기 확인 (즉시 실행)
			setTimeout(() => {
				checkSignalFile().catch(error => {
					axonLog(`⚠️ 신호 파일 확인 중 오류: ${error}`);
				});
			}, 200);

			// 안전장치: 10분 후 강제 종료
			setTimeout(() => {
				if (!isCompleted) {
					axonLog('⏰ FWDN 실행 시간 초과로 정리합니다.');
					if (checkInterval) clearInterval(checkInterval);

					// 남은 신호 파일 정리
					try {
						if (fs.existsSync(signalFile)) {
							fs.unlinkSync(signalFile);
						}
					} catch (deleteError) {
						axonLog(`⚠️ 신호 파일 정리 실패: ${deleteError}`);
					}

					try {
						terminal.dispose();
					} catch (disposeError) {
						axonLog(`⚠️ 타임아웃 후 터미널 종료 중 오류: ${disposeError}`);
					}
					resolve();
				}
			}, 600000); // 10분 타임아웃

		} catch (error) {
			axonError(`FWDN 완료 처리 중 오류: ${error}`);
			try {
				terminal.dispose();
			} catch (disposeError) {
				axonLog(`⚠️ 에러 후 터미널 종료 중 오류: ${disposeError}`);
			}
			resolve();
		}
	});
}

// FWDN 실행 함수 (ALL 모드만)
export async function executeFwdnCommand(extensionPath: string): Promise<void> {
	axonLog(`🚀 FWDN ALL (Step 1-4) 실행 명령 시작`);

	// 사용자 확인 팝업
	const confirmResult = await vscode.window.showWarningMessage(
		'FWDN (펌웨어 다운로드)을 실행하시겠습니까?\n\n⚠️ 타겟 보드에 펌웨어가 다운로드됩니다.',
		{ modal: true },
		'실행',
		'취소'
	);

	if (confirmResult !== '실행') {
		axonLog('❌ 사용자가 FWDN 실행을 취소했습니다.');
		vscode.window.showInformationMessage('FWDN이 취소되었습니다.');
		return;
	}

	axonLog('✅ 사용자가 FWDN 실행을 확인했습니다.');

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	// FWDN 설정 가져오기
	let config: FwdnConfig;
	try {
		config = await getFwdnConfig(extensionPath);
		axonLog(`📋 설정 - FWDN 경로: ${config.fwdnExePath}, Boot Firmware 경로: ${config.bootFirmwarePath}`);
	} catch (error) {
		// Boot Firmware 폴더를 찾을 수 없는 경우
		axonError(`설정 오류: ${error}`);
		
		const errorMsg = `Boot Firmware 폴더를 찾을 수 없습니다.\n\n` +
			`prebuilt 폴더가 워크스페이스 또는 그 하위 4단계까지 있는지 확인하세요.\n\n` +
			`다시 시도하시겠습니까?`;
		
		const selection = await vscode.window.showErrorMessage(errorMsg, '다시 시도');
		if (selection === '다시 시도') {
			vscode.commands.executeCommand('axon.FWDN_ALL');
		}
		return;
	}

	// 설정 검증
	const validationError = validateConfig(config);
	if (validationError) {
		axonError(validationError);
		vscode.window.showErrorMessage(validationError);
			return;
		}

	try {
		axonLog(`🔧 로컬 PowerShell에서 직접 실행`);

		// ps1로 실행 (배치 대비 따옴표/파싱 안정성 개선)
		const psExe = getLocalPowerShellExe();
		const ps1Path = path.join(extensionPath, 'fwdn_all.ps1');
		axonLog(`📝 PS1 파일 경로: ${ps1Path}`);
		const psCommand =
			`& "${psExe}" -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}" ` +
			`-Mode "all" ` +
			`-BootFirmwarePath "${config.bootFirmwarePath}" ` +
			`-FwdnExe "${config.fwdnExePath}"`;
		axonLog(`📋 실행 명령(PowerShell-ps1): ${psCommand}`);

		// 환경 감지 및 터미널 생성
		const isRemote = vscode.env.remoteName !== undefined;
		let terminal: vscode.Terminal;

		if (isRemote) {
			// 원격 환경: 로컬 터미널 생성 명령 사용
			await vscode.commands.executeCommand('workbench.action.terminal.newLocal');
			const term = vscode.window.activeTerminal;
			if (!term) {
				throw new Error('로컬 터미널 생성에 실패했습니다.');
			}
			terminal = term;
		} else {
			// 로컬 환경: 기본 터미널 생성 시도
			try {
				await vscode.commands.executeCommand('workbench.action.terminal.new');
				const basicTerminal = vscode.window.activeTerminal;
				if (basicTerminal) {
					terminal = basicTerminal;
				} else {
					throw new Error('기본 터미널 생성에 실패했습니다.');
				}
			} catch {
				// 폴백: 직접 터미널 생성
				terminal = vscode.window.createTerminal({
					name: `FWDN ALL (Step 1-4)`,
					isTransient: true
				});
			}
		}

		terminal.sendText(psCommand, true);

		// Build View에 포커스 복원 (딜레이 후 실행하여 확실하게 포커스 이동)
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);

		// 배치 파일 완료 신호 대기 및 자동 창 닫기
		await executeFwdnWithAutoClose(terminal);

		axonLog(`✅ FWDN ALL (Step 1-4) 실행 완료`);

	} catch (error) {
		const errorMsg = `FWDN ALL (Step 1-4) 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

// FWDN Low Level Format 실행 함수
export async function executeFwdnLowFormat(extensionPath: string): Promise<void> {
	axonLog(`🚀 FWDN Low Level Format 실행 명령 시작`);

	// 사용자 확인 팝업 (데이터 삭제 경고)
	const confirmResult = await vscode.window.showWarningMessage(
		'FWDN Low Level Format을 실행하시겠습니까?\n\n⚠️ 경고: 이 작업은 eMMC와 SNOR의 모든 데이터를 영구적으로 삭제합니다!\n\n계속하시겠습니까?',
		{ modal: true },
		'실행',
		'취소'
	);

	if (confirmResult !== '실행') {
		axonLog('❌ 사용자가 Low Level Format 실행을 취소했습니다.');
		vscode.window.showInformationMessage('Low Level Format이 취소되었습니다.');
		return;
	}

	axonLog('✅ 사용자가 Low Level Format 실행을 확인했습니다.');

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	// FWDN 설정 가져오기
	let config: FwdnConfig;
	try {
		config = await getFwdnConfig(extensionPath);
		axonLog(`📋 설정 - FWDN 경로: ${config.fwdnExePath}, Boot Firmware 경로: ${config.bootFirmwarePath}`);
	} catch (error) {
		// Boot Firmware 폴더를 찾을 수 없는 경우
		axonError(`설정 오류: ${error}`);
		
		const errorMsg = `Boot Firmware 폴더를 찾을 수 없습니다.\n\n` +
			`prebuilt 폴더가 워크스페이스 또는 그 하위 4단계까지 있는지 확인하세요.\n\n` +
			`다시 시도하시겠습니까?`;
		
		const selection = await vscode.window.showErrorMessage(errorMsg, '다시 시도');
		if (selection === '다시 시도') {
			vscode.commands.executeCommand('axon.FWDN_LOW_FORMAT');
		}
		return;
	}

	// 설정 검증
	const validationError = validateConfig(config);
	if (validationError) {
		axonError(validationError);
		vscode.window.showErrorMessage(validationError);
		return;
	}

	try {
		axonLog(`🔧 로컬 PowerShell에서 직접 실행`);

		// ps1로 실행 (배치 대비 따옴표/파싱 안정성 개선)
		const psExe = getLocalPowerShellExe();
		const ps1Path = path.join(extensionPath, 'fwdn_all.ps1');
		axonLog(`📝 PS1 파일 경로: ${ps1Path}`);
		const psCommand =
			`& "${psExe}" -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}" ` +
			`-Mode "low-format" ` +
			`-BootFirmwarePath "${config.bootFirmwarePath}" ` +
			`-FwdnExe "${config.fwdnExePath}"`;
		axonLog(`📋 실행 명령(PowerShell-ps1): ${psCommand}`);

		// 환경 감지 및 터미널 생성
		const isRemote = vscode.env.remoteName !== undefined;
		let terminal: vscode.Terminal;

		if (isRemote) {
			// 원격 환경: 로컬 터미널 생성 명령 사용
			await vscode.commands.executeCommand('workbench.action.terminal.newLocal');
			const term = vscode.window.activeTerminal;
			if (!term) {
				throw new Error('로컬 터미널 생성에 실패했습니다.');
			}
			terminal = term;
		} else {
			// 로컬 환경: 기본 터미널 생성 시도
			try {
				await vscode.commands.executeCommand('workbench.action.terminal.new');
				const basicTerminal = vscode.window.activeTerminal;
				if (basicTerminal) {
					terminal = basicTerminal;
				} else {
					throw new Error('기본 터미널 생성에 실패했습니다.');
				}
			} catch {
				// 폴백: 직접 터미널 생성
				terminal = vscode.window.createTerminal({
					name: `FWDN Low Level Format`,
					isTransient: true
				});
			}
		}

		terminal.sendText(psCommand, true);

		// Build View에 포커스 복원 (딜레이 후 실행하여 확실하게 포커스 이동)
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);

		// 배치 파일 완료 신호 대기 및 자동 창 닫기
		await executeFwdnWithAutoClose(terminal);

		axonLog(`✅ FWDN Low Level Format 실행 완료`);

	} catch (error) {
		const errorMsg = `FWDN Low Level Format 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

// 설정 업데이트 공통 함수
export async function updateConfiguration(
	key: string,
	value: string,
	label: string
): Promise<void> {
	axonLog(`💾 [updateConfiguration] 시작 - key: ${key}, label: ${label}`);
	axonLog(`💾 [updateConfiguration] 설정할 값: ${value}`);
	
	// 설정 파일에 저장
	const config = vscode.workspace.getConfiguration('axon');
	axonLog(`💾 [updateConfiguration] config.update 호출 중...`);
	await config.update(key, value, vscode.ConfigurationTarget.Workspace);
	axonLog(`💾 [updateConfiguration] config.update 완료`);

	axonLog(`✅ ${label} 경로가 설정되었습니다: ${value}`);
	vscode.window.showInformationMessage(`${label} 경로가 설정되었습니다: ${value}`);
	axonLog(`🏁 [updateConfiguration] 종료`);
}

/**
 * partition.list 파일 파싱
 * 형식: partition_name:size@file_path
 */
function parsePartitionList(content: string): PartitionInfo[] {
	const lines = content.split('\n');
	const partitions: PartitionInfo[] = [];
	const excludeList = ['misc', 'data'];
	
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		
		// 형식: partition_name:size@file_path
		const match = trimmed.match(/^([^:]+):([^@]+)@(.+)$/);
		if (!match) continue;
		
		const [, name, size, filePath] = match;
		
		// misc, data 제외
		if (excludeList.includes(name.trim())) continue;
		
		// 파일명 추출
		const fileName = path.basename(filePath.trim());
		
		partitions.push({
			name: name.trim(),
			size: size.trim(),
			filePath: filePath.trim(),
			fileName: fileName
		});
	}
	
	return partitions;
}

/**
 * 선택한 파티션을 FWDN으로 다운로드
 */
async function executeFwdnDownloadPartition(
	extensionPath: string,
	partition: PartitionInfo,
	imagesDir: string
): Promise<void> {
	axonLog(`🚀 FWDN 파티션 다운로드 시작: ${partition.name}`);
	
	// FWDN 설정 가져오기
	let config: FwdnConfig;
	try {
		config = await getFwdnConfig(extensionPath);
		axonLog(`📋 설정 - FWDN 경로: ${config.fwdnExePath}, Boot Firmware 경로: ${config.bootFirmwarePath}`);
	} catch (error) {
		axonError(`설정 오류: ${error}`);
		const errorMsg = `Boot Firmware 폴더를 찾을 수 없습니다.\n\n` +
			`prebuilt 폴더가 워크스페이스 또는 그 하위 4단계까지 있는지 확인하세요.`;
		vscode.window.showErrorMessage(errorMsg);
		return;
	}
	
	// 설정 검증
	const validationError = validateConfig(config);
	if (validationError) {
		axonError(validationError);
		vscode.window.showErrorMessage(validationError);
		return;
	}
	
	// 경로 변환 (리눅스 → Windows/Samba)
	const remoteName = vscode.env.remoteName || '';
	const remoteType = remoteName.startsWith('wsl') ? 'wsl' : 'ssh';
	const windowsFilePath = convertRemotePathToSamba(partition.filePath, remoteType);
	
	axonLog(`🔄 경로 변환: ${partition.filePath} → ${windowsFilePath}`);
	
	try {
		axonLog(`🔧 로컬 PowerShell에서 직접 실행`);

		// 배치(.bat) 파일 대신 ps1 스크립트를 실행 (따옴표/파싱 이슈 최소화)
		const ps7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
		const ps5 = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
		const psExe = fs.existsSync(ps7) ? ps7 : (fs.existsSync(ps5) ? ps5 : null);
		if (!psExe) {
			throw new Error('로컬 PC에서 PowerShell 실행 파일을 찾지 못했습니다.');
		}

		const ps1Path = path.join(extensionPath, 'fwdn_download_partition.ps1');
		axonLog(`📝 PS1 파일 경로: ${ps1Path}`);

		const psCommand =
			`& "${psExe}" -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}" ` +
			`-BootFirmwarePath "${config.bootFirmwarePath}" ` +
			`-FwdnExe "${config.fwdnExePath}" ` +
			`-FilePath "${windowsFilePath}" ` +
			`-PartitionName "${partition.name}" ` +
			`-RetryCount 3 -DelaySec 1`;
		axonLog(`📋 실행 명령(PowerShell-ps1): ${psCommand}`);
		
		// 환경 감지 및 터미널 생성
		const isRemote = vscode.env.remoteName !== undefined;
		let terminal: vscode.Terminal;
		
		if (isRemote) {
			// 원격 환경: 로컬 터미널 생성 명령 사용
			await vscode.commands.executeCommand('workbench.action.terminal.newLocal');
			const term = vscode.window.activeTerminal;
			if (!term) {
				throw new Error('로컬 터미널 생성에 실패했습니다.');
			}
			terminal = term;
		} else {
			// 로컬 환경: 기본 터미널 생성 시도
			try {
				await vscode.commands.executeCommand('workbench.action.terminal.new');
				const basicTerminal = vscode.window.activeTerminal;
				if (basicTerminal) {
					terminal = basicTerminal;
				} else {
					throw new Error('기본 터미널 생성에 실패했습니다.');
				}
			} catch {
				// 폴백: 직접 터미널 생성
				terminal = vscode.window.createTerminal({
					name: `FWDN Download Partition: ${partition.name}`,
					isTransient: true
				});
			}
		}
		
		terminal.sendText(psCommand, true);
		
		// Build View에 포커스 복원
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);
		
		// 배치 파일 완료 신호 대기 및 자동 창 닫기
		await executeFwdnWithAutoClose(terminal);
		
		axonLog(`✅ FWDN 파티션 다운로드 완료: ${partition.name}`);
		
	} catch (error) {
		const errorMsg = `FWDN 파티션 다운로드 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

/**
 * FWDN Specific Image File 실행 함수
 * partition.list 파일을 읽어서 파티션 목록을 표시하고 선택한 파티션을 다운로드
 */
export async function executeFwdnAvailableImage(extensionPath: string): Promise<void> {
	axonLog(`🚀 FWDN Specific Image File 실행 명령 시작`);
	
	try {
		// 워크스페이스 폴더
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
		}
		
		// settings.json에서 Yocto 프로젝트 루트 가져오기
		const config = vscode.workspace.getConfiguration('axon');
		let projectRoot = config.get<string>('yocto.projectRoot');
		
		if (!projectRoot || projectRoot.trim() === '') {
			// settings.json에 없으면 찾기
			axonLog('⚠️ settings.json에 Yocto 프로젝트 루트가 없습니다. 자동 탐지를 시작합니다.');
			const { YoctoProjectBuilder } = await import('./projects/yocto/builder');
			projectRoot = await YoctoProjectBuilder.getYoctoProjectRoot();
		} else {
			axonLog(`✅ settings.json에서 Yocto 프로젝트 루트 사용: ${projectRoot}`);
		}
		
		axonLog(`📁 Yocto 프로젝트 루트: ${projectRoot}`);
	
	// SD_Data.gpt 파일이 있는 이미지 디렉토리 경로 가져오기
	// settings.json에 저장된 경로가 있으면 사용하고, 없으면 검색 후 저장
	axonLog('🔍 이미지 디렉토리 경로 확인 중...');
	
	let imagesDir: string | null = config.get<string>('yocto.imagesDir') || null;
	
	// settings.json에 저장된 경로가 있으면 유효성 검증
	if (imagesDir && imagesDir.trim() !== '') {
		axonLog(`🔍 저장된 이미지 디렉토리 확인 중: ${imagesDir}`);
		
		// SD_Data.gpt 파일 존재 여부 확인
		const gptFileUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: `${imagesDir}/SD_Data.gpt`
		});
		
		try {
			await vscode.workspace.fs.stat(gptFileUri);
			axonLog(`✅ 저장된 이미지 디렉토리 사용: ${imagesDir}`);
		} catch {
			axonLog(`⚠️ 저장된 경로에 SD_Data.gpt 파일이 없습니다. 재탐색을 시작합니다.`);
			imagesDir = null;
		}
	}
	
	// settings.json에 없거나 유효하지 않으면 검색
	if (!imagesDir) {
		axonLog('🔍 SD_Data.gpt 파일을 찾아 이미지 디렉토리 탐지 중...');
		const { findProjectRootByShell } = await import('./projects/common/shell-utils');
		
		// projectRoot가 워크스페이스와 같은지 확인
		const workspacePath = workspaceFolder.uri.path;
		const useAbsolutePath = projectRoot !== workspacePath;
		const searchPath = useAbsolutePath ? projectRoot : '.';
		
		imagesDir = await findProjectRootByShell({
			workspaceFolder,
			findPattern: 'SD_Data.gpt',
			maxDepth: 10,  // 충분히 깊게 검색 (하지만 -print -quit로 첫 번째 찾으면 즉시 종료)
			findType: 'f',
			parentLevels: 1,  // 파일이 있는 디렉토리 경로를 가져옴 (dirname 1번 적용)
			searchPath: searchPath,
			taskName: 'Find Images Directory',
			taskId: 'find-images-dir',
			resultFilePrefix: 'axon_images_dir'
		});
		
		if (!imagesDir) {
			const errorMsg = `SD_Data.gpt 파일을 찾을 수 없습니다.\n\n` +
				`Yocto AP 빌드를 먼저 실행하여 이미지 파일을 생성해주세요.`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		axonLog(`✅ 이미지 디렉토리 발견: ${imagesDir}`);
		
		// settings.json에 저장
		try {
			await updateSettingsJson(workspaceFolder, { 'axon.yocto.imagesDir': imagesDir });
			axonLog(`✅ 이미지 디렉토리를 settings.json에 저장했습니다.`);
		} catch (error) {
			axonLog(`⚠️ settings.json 저장 실패: ${error}`);
		}
	}
	
	const partitionListPath = `${imagesDir}/partition.list`;
	axonLog(`📁 partition.list 경로: ${partitionListPath}`);
		
		// partition.list 파일 읽기
		const partitionListUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: partitionListPath
		});
		
		let partitionListContent: string;
		try {
			const content = await vscode.workspace.fs.readFile(partitionListUri);
			partitionListContent = Buffer.from(content).toString('utf8');
			axonLog(`✅ partition.list 파일 읽기 성공`);
		} catch (error) {
			const errorMsg = `partition.list 파일을 찾을 수 없습니다.\n\n` +
				`경로: ${partitionListPath}\n\n` +
				`Yocto AP 빌드를 먼저 실행하여 이미지 파일을 생성해주세요.`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 파티션 목록 파싱
		const partitions = parsePartitionList(partitionListContent);
		axonLog(`📋 파싱된 파티션 개수: ${partitions.length}`);
		
		if (partitions.length === 0) {
			const errorMsg = `사용 가능한 파티션이 없습니다.\n\n` +
				`partition.list 파일에 유효한 파티션 정보가 없거나, 모든 파티션이 필터링되었습니다.`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 파티션 선택 메뉴 생성
		const items = partitions.map(p => ({
			label: `${p.name}`,
			description: `${p.fileName}`,
			detail: `${p.size} - ${p.filePath}`,
			partition: p
		}));
		
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: '다운로드할 파티션을 선택하세요...',
			canPickMany: false
		});
		
	if (!selected) {
		axonLog('❌ 사용자가 파티션 선택을 취소했습니다.');
		vscode.window.showInformationMessage('파티션 다운로드가 취소되었습니다.');
		return;
	}
	
	axonLog(`✅ 선택된 파티션: ${selected.partition.name}`);
	
	// 사용자 확인 팝업
	const confirmResult = await vscode.window.showWarningMessage(
		`선택한 파티션을 다운로드하시겠습니까?\n\n` +
		`파티션: ${selected.partition.name}\n` +
		`파일: ${selected.partition.fileName}\n` +
		`크기: ${selected.partition.size}\n\n` +
		`⚠️ 타겟 보드에 이미지가 다운로드됩니다.`,
		{ modal: true },
		'실행',
		'취소'
	);
	
	if (confirmResult !== '실행') {
		axonLog('❌ 사용자가 파티션 다운로드 실행을 취소했습니다.');
		vscode.window.showInformationMessage('파티션 다운로드가 취소되었습니다.');
		return;
	}
	
	axonLog('✅ 사용자가 파티션 다운로드 실행을 확인했습니다.');
	
	// 선택한 파티션 다운로드 실행
	await executeFwdnDownloadPartition(extensionPath, selected.partition, imagesDir);
		
	} catch (error) {
		const errorMsg = `FWDN Specific Image File 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

/**
 * FWDN Read Partition (Dump)
 * partition.list에서 파티션 크기를 읽어서 자동으로 덤프
 */
export async function executeFwdnReadPartition(extensionPath: string): Promise<void> {
	axonLog('🔧 FWDN Read Partition 시작');
	
	try {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
			return;
		}
		
		// 이미지 디렉토리 찾기
		let imagesDir = vscode.workspace.getConfiguration('axon.yocto').get<string>('imagesDir');
		
		if (!imagesDir) {
			axonLog('⚠️ 이미지 디렉토리가 설정되지 않았습니다. 자동 탐색을 시작합니다...');
			
			// SD_Data.gpt 파일 찾기
			const files = await vscode.workspace.findFiles('**/SD_Data.gpt', '**/node_modules/**', 1);
			
			if (files.length === 0) {
				const errorMsg = `SD_Data.gpt 파일을 찾을 수 없습니다.\n\n` +
					`Yocto AP 빌드를 먼저 실행하여 이미지 파일을 생성해주세요.`;
				axonError(errorMsg);
				vscode.window.showErrorMessage(errorMsg);
				return;
			}
			
			// SD_Data.gpt가 있는 디렉토리 = 이미지 디렉토리
			const sdDataPath = files[0].path;
			imagesDir = path.dirname(sdDataPath);
			
			if (!imagesDir) {
				const errorMsg = `이미지 디렉토리를 찾을 수 없습니다.`;
				axonError(errorMsg);
				vscode.window.showErrorMessage(errorMsg);
				return;
			}
			
			axonLog(`✅ 이미지 디렉토리 발견: ${imagesDir}`);
			
			// settings.json에 저장
			try {
				await updateSettingsJson(workspaceFolder, { 'axon.yocto.imagesDir': imagesDir });
				axonLog(`✅ 이미지 디렉토리를 settings.json에 저장했습니다.`);
			} catch (error) {
				axonLog(`⚠️ settings.json 저장 실패: ${error}`);
			}
		}
		
		const partitionListPath = `${imagesDir}/partition.list`;
		axonLog(`📁 partition.list 경로: ${partitionListPath}`);
		
		// partition.list 파일 읽기
		const partitionListUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: partitionListPath
		});
		
		let partitionListContent: string;
		try {
			const content = await vscode.workspace.fs.readFile(partitionListUri);
			partitionListContent = Buffer.from(content).toString('utf8');
			axonLog(`✅ partition.list 파일 읽기 성공`);
		} catch (error) {
			const errorMsg = `partition.list 파일을 찾을 수 없습니다.\n\n` +
				`경로: ${partitionListPath}\n\n` +
				`Yocto AP 빌드를 먼저 실행하여 이미지 파일을 생성해주세요.`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 파티션 목록 파싱
		const partitions = parsePartitionList(partitionListContent);
		axonLog(`📋 파싱된 파티션 개수: ${partitions.length}`);
		
		if (partitions.length === 0) {
			const errorMsg = `사용 가능한 파티션이 없습니다.\n\n` +
				`partition.list 파일에 유효한 파티션 정보가 없거나, 모든 파티션이 필터링되었습니다.`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 파티션 선택 메뉴 생성
		const items = partitions.map(p => ({
			label: `${p.name}`,
			description: `Size: ${p.size}`,
			detail: `Read dump from ${p.name} partition`,
			partition: p
		}));
		
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select partition to read (dump)',
			title: 'FWDN Read Partition'
		});
		
		if (!selected) {
			axonLog('❌ 파티션 선택이 취소되었습니다.');
			return;
		}
		
		axonLog(`✅ 선택된 파티션: ${selected.partition.name} (${selected.partition.size})`);
		
	// 저장할 파일명 입력
	const defaultFileName = `${selected.partition.name}_dump.bin`;
	const outputFileName = await vscode.window.showInputBox({
		prompt: 'Enter output file name',
		value: defaultFileName,
		placeHolder: 'e.g., system_a_dump.bin'
	});
	
	if (!outputFileName) {
		axonLog('❌ 파일명 입력이 취소되었습니다.');
		return;
	}
	
	// 저장 위치 선택
	const saveUri = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(path.join(os.homedir(), outputFileName)),
		filters: {
			'Binary files': ['bin'],
			'All files': ['*']
		}
	});
	
	if (!saveUri) {
		axonLog('❌ 저장 위치 선택이 취소되었습니다.');
		return;
	}
	
	axonLog(`💾 저장 경로: ${saveUri.fsPath}`);
	
	// 스토리지 타입 선택 (기본값: emmc)
	const storageType = await vscode.window.showQuickPick(
		[
			{ label: 'emmc', description: 'eMMC storage (GPT format, user area only)' },
			{ label: 'ufs', description: 'UFS storage (GPT format, user area only)' }
		],
		{
			placeHolder: 'Select storage type',
			title: 'Storage Type'
		}
	);
	
	if (!storageType) {
		axonLog('❌ 스토리지 타입 선택이 취소되었습니다.');
		return;
	}
	
	// 선택한 파티션 읽기 실행 (--part 옵션 사용)
	await executeFwdnReadDump(
		extensionPath,
		selected.partition,
		saveUri.fsPath,
		storageType.label
	);
		
	} catch (error) {
		const errorMsg = `FWDN Read Partition 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

/**
 * FWDN Read Dump 실행 (GPT format, --part 옵션 사용)
 */
async function executeFwdnReadDump(
	extensionPath: string,
	partition: PartitionInfo,
	outputPath: string,
	storageType: string
): Promise<void> {
	axonLog(`🔧 FWDN Read Dump 실행: ${partition.name}`);
	
	// FWDN 설정 가져오기
	let config: FwdnConfig;
	try {
		config = await getFwdnConfig(extensionPath);
		axonLog(`📋 설정 - FWDN 경로: ${config.fwdnExePath}, Boot Firmware 경로: ${config.bootFirmwarePath}`);
	} catch (error) {
		axonError(`설정 오류: ${error}`);
		const errorMsg = `Boot Firmware 폴더를 찾을 수 없습니다.\n\n` +
			`prebuilt 폴더가 워크스페이스 또는 그 하위 4단계까지 있는지 확인하세요.`;
		vscode.window.showErrorMessage(errorMsg);
		return;
	}
	
	// 설정 검증
	const validationError = validateConfig(config);
	if (validationError) {
		axonError(validationError);
		vscode.window.showErrorMessage(validationError);
		return;
	}
	
	try {
		axonLog(`🔧 로컬 PowerShell에서 PS1로 FWDN Read 실행`);

		const psExe = getLocalPowerShellExe();
		const ps1Path = path.join(extensionPath, 'fwdn_read_partition.ps1');
		axonLog(`📝 PS1 파일 경로: ${ps1Path}`);

		const psCommand =
			`& "${psExe}" -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}" ` +
			`-BootFirmwarePath "${config.bootFirmwarePath}" ` +
			`-FwdnExe "${config.fwdnExePath}" ` +
			`-OutputFile "${outputPath}" ` +
			`-StorageType "${storageType}" ` +
			`-PartitionName "${partition.name}"`;
		axonLog(`📋 실행 명령(PowerShell-ps1): ${psCommand}`);
		
		// 환경 감지 및 터미널 생성
		const isRemote = vscode.env.remoteName !== undefined;
		let terminal: vscode.Terminal;
		
		if (isRemote) {
			// 원격 환경: 로컬 터미널 생성 명령 사용
			await vscode.commands.executeCommand('workbench.action.terminal.newLocal');
			const term = vscode.window.activeTerminal;
			if (!term) {
				throw new Error('로컬 터미널 생성에 실패했습니다.');
			}
			terminal = term;
		} else {
			// 로컬 환경: 기본 터미널 생성 시도
			try {
				await vscode.commands.executeCommand('workbench.action.terminal.new');
				const basicTerminal = vscode.window.activeTerminal;
				if (basicTerminal) {
					terminal = basicTerminal;
				} else {
					throw new Error('기본 터미널 생성에 실패했습니다.');
				}
			} catch {
				// 폴백: 직접 터미널 생성
				terminal = vscode.window.createTerminal({
					name: `FWDN Read: ${partition.name}`,
					isTransient: true
				});
			}
		}
		
		terminal.sendText(psCommand, true);
		terminal.show();
		
		axonSuccess(`✅ FWDN Read Dump 명령이 실행되었습니다!\n\n` +
			`파티션: ${partition.name}\n` +
			`크기: ${partition.size}\n` +
			`출력 파일: ${outputPath}\n` +
			`스토리지: ${storageType} (GPT format, user area only)`);
		
	} catch (error) {
		const errorMsg = `FWDN Read Dump 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		throw error;
	}
}

