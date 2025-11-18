import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { axonLog, axonError, axonSuccess, getAxonOutputChannel } from './logger';
import { getAxonConfig, findBootFirmwareFolder, convertRemotePathToSamba } from './utils';

// FWDN 설정 인터페이스
export interface FwdnConfig {
	fwdnExePath: string;
	bootFirmwarePath: string;
}

// FWDN 설정 가져오기
export async function getFwdnConfig(extensionPath: string): Promise<FwdnConfig> {
	const config = vscode.workspace.getConfiguration('axon');

	// Boot Firmware 경로는 매번 새로 검색 (캐시 사용하지 않음) - 빠른 방식 사용
	axonLog(`🔍 Boot Firmware 경로 자동 검색 시작 (빠른 방식)...`);
	const bootFirmwarePathOrUri = await findBootFirmwareFolder();

	if (!bootFirmwarePathOrUri) {
		axonLog(`❌ Boot Firmware 경로를 찾을 수 없습니다.`);
		throw new Error('Boot Firmware 경로를 찾을 수 없습니다. "Axon: Auto-detect Boot Firmware Path" 명령을 먼저 실행하거나 수동으로 설정해주세요.');
	}

	// FWDN은 로컬 Windows에서 실행되므로 Windows 경로 필요
	// URI 문자열(vscode-remote://...)이면 Samba 경로 또는 WSL 경로로 변환
	let bootFirmwarePath: string;
	if (bootFirmwarePathOrUri.startsWith('vscode-remote://')) {
		// URI 파싱하여 Unix 경로 추출
		const uri = vscode.Uri.parse(bootFirmwarePathOrUri);
		
		// 원격 환경 타입 감지 (WSL vs SSH)
		const remoteName = vscode.env.remoteName || '';
		const remoteType = remoteName.startsWith('wsl') ? 'wsl' : 'ssh';
		
		axonLog(`🌐 [FWDN] 원격 환경 감지: ${remoteName} → 타입: ${remoteType}`);
		
		// 환경에 맞는 경로 변환
		bootFirmwarePath = convertRemotePathToSamba(uri.path, remoteType);
		axonLog(`🔄 [FWDN] 원격 경로 변환 완료: ${uri.path} → ${bootFirmwarePath}`);
	} else {
		// 이미 Windows 경로
		bootFirmwarePath = bootFirmwarePathOrUri;
	}

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
	return new Promise((resolve) => {
		let isCompleted = false;

		try {
			axonLog('🔍 FWDN 완료 신호 파일 대기 중...');

			// 완료 신호 파일 경로 (배치 파일과 동일한 위치)
			const signalFile = path.join(os.tmpdir(), 'axon_fwdn_completed.txt');

			// 주기적으로 신호 파일 확인
			const checkSignalFile = () => {
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

							const successMsg = '✅ FWDN 실행 완료! 창을 자동으로 닫습니다.';
							axonSuccess(successMsg);
							vscode.window.showInformationMessage(successMsg);

							setTimeout(() => {
								try {
									terminal.dispose();
								} catch (disposeError) {
									axonLog(`⚠️ 터미널 종료 중 오류: ${disposeError}`);
								}
								resolve();
							}, 1000);
						}
					}
				} catch (error) {
					axonLog(`⚠️ 신호 파일 확인 중 오류: ${error}`);
				}
			};

			// 0.5초마다 신호 파일 확인
			const checkInterval = setInterval(checkSignalFile, 500);

			// 초기 확인 (즉시 실행)
			setTimeout(checkSignalFile, 200);

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

	// 필수 설정 확인 및 사용자 선택
	const workspaceConfig = vscode.workspace.getConfiguration('axon');
	
	// 현재 설정 상태 로깅 (디버깅용)
	axonLog(`📋 현재 설정 확인:`);
	axonLog(`  - buildAxonFolderName: ${workspaceConfig.get<string>('buildAxonFolderName') || '(없음)'}`);
	axonLog(`  - bootFirmwareFolderName: ${workspaceConfig.get<string>('bootFirmwareFolderName') || '(없음)'}`);
	
	// buildAxonFolderName 설정 확인
	let buildAxonFolderName = workspaceConfig.get<string>('buildAxonFolderName');
	if (!buildAxonFolderName || buildAxonFolderName.trim() === '') {
		axonLog(`⚠️ buildAxonFolderName이 설정되지 않았습니다. 사용자 선택을 요청합니다.`);
		
		const buildFolderOptions = [
			{ label: 'mcu-tcn100x', description: 'MCU Standalone 프로젝트용 폴더' },
			{ label: 'build-axon', description: 'Yocto 프로젝트용 폴더' }
		];
		
		const selectedBuildFolder = await vscode.window.showQuickPick(buildFolderOptions, {
			placeHolder: '빌드 폴더명을 선택하세요',
			title: 'Build Folder Name 선택',
			ignoreFocusOut: true
		});
		
		if (!selectedBuildFolder) {
			axonLog('❌ 사용자가 빌드 폴더 선택을 취소했습니다.');
			vscode.window.showInformationMessage('FWDN이 취소되었습니다.');
			return;
		}
		
		buildAxonFolderName = selectedBuildFolder.label;
		await updateConfiguration('buildAxonFolderName', buildAxonFolderName, 'Build 폴더명');
		axonLog(`✅ buildAxonFolderName 설정 완료: ${buildAxonFolderName}`);
	}
	
	// bootFirmwareFolderName 설정 확인
	let bootFirmwareFolderName = workspaceConfig.get<string>('bootFirmwareFolderName');
	if (!bootFirmwareFolderName || bootFirmwareFolderName.trim() === '') {
		axonLog(`⚠️ bootFirmwareFolderName이 설정되지 않았습니다. 사용자 선택을 요청합니다.`);
		
		const bootFirmwareOptions = [
			{ label: 'boot-firmware-tcn100x', description: 'MCU standalone project 용 Boot Firmware 폴더명' },
			{ label: 'boot-firmware_tcn1000', description: 'Yocto project 용 Boot Firmware 폴더명' }
		];
		
		const selectedBootFirmware = await vscode.window.showQuickPick(bootFirmwareOptions, {
			placeHolder: 'Boot Firmware 폴더명을 선택하세요',
			title: 'Boot Firmware Folder Name 선택',
			ignoreFocusOut: true
		});
		
		if (!selectedBootFirmware) {
			axonLog('❌ 사용자가 Boot Firmware 폴더 선택을 취소했습니다.');
			vscode.window.showInformationMessage('FWDN이 취소되었습니다.');
			return;
		}
		
		bootFirmwareFolderName = selectedBootFirmware.label;
		await updateConfiguration('bootFirmwareFolderName', bootFirmwareFolderName, 'Boot Firmware 폴더명');
		axonLog(`✅ bootFirmwareFolderName 설정 완료: ${bootFirmwareFolderName}`);
	}

	// 설정된 폴더로 FWDN 설정 가져오기
	let config: FwdnConfig;
	try {
		config = await getFwdnConfig(extensionPath);
		axonLog(`📋 설정 - FWDN 경로: ${config.fwdnExePath}, Boot Firmware 경로: ${config.bootFirmwarePath}`);
	} catch (error) {
		// 선택한 폴더를 찾을 수 없는 경우
		axonError(`설정 오류: ${error}`);
		
		const errorMsg = `Boot Firmware 폴더를 찾을 수 없습니다.\n\n` +
			`현재 설정:\n` +
			`- 빌드 폴더: ${buildAxonFolderName}\n` +
			`- Boot Firmware 폴더: ${bootFirmwareFolderName}\n\n` +
			`워크스페이스에 해당 폴더가 존재하는지 확인하거나,\n` +
			`다른 폴더명으로 다시 시도해주세요.`;
		
		vscode.window.showErrorMessage(errorMsg, '설정 변경', '다시 시도').then(selection => {
			if (selection === '설정 변경') {
				vscode.commands.executeCommand('axon.configureSettings');
			} else if (selection === '다시 시도') {
				// settings.json의 설정을 초기화하고 다시 시도
				workspaceConfig.update('buildAxonFolderName', undefined, vscode.ConfigurationTarget.Workspace);
				workspaceConfig.update('bootFirmwareFolderName', undefined, vscode.ConfigurationTarget.Workspace);
				vscode.commands.executeCommand('axon.FWDN_ALL');
			}
		});
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

		// 배치 파일 경로 생성 (익스텐션 설치 경로 기준)
		const batchFilePath = path.join(extensionPath, 'fwdn_all.bat');
		axonLog(`📝 배치 파일 경로: ${batchFilePath}`);

		// UNC 경로 처리 (Remote-SSH 환경에서 로컬 파일 접근용)
		const isUncPath = config.fwdnExePath.startsWith('\\\\tsclient\\');
		const processedFwdnExePath = isUncPath ? config.fwdnExePath : `"${config.fwdnExePath}"`;

		// PowerShell에서 배치 파일 실행 (ALL 모드로 고정)
		// 현재 터미널은 PowerShell이므로, & 연산자를 사용해 .bat 파일을 직접 호출합니다.
		const psCommand = `& "${batchFilePath}" all "${config.bootFirmwarePath}" "${config.fwdnExePath}"`;

		axonLog(`📋 실행 명령: ${psCommand}`);

		// PowerShell 실행 파일 경로 결정 (PowerShell 7 우선)
		const ps7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
		const ps5 = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

		const psExe = fs.existsSync(ps7) ? ps7 : (fs.existsSync(ps5) ? ps5 : null);
		if (!psExe) {
			throw new Error('로컬 PC에서 PowerShell 실행 파일을 찾지 못했습니다.');
		}

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

		terminal.sendText(psCommand, true);  // PS 문법 그대로 실행

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

