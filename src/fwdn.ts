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
export async function getFwdnConfig(): Promise<FwdnConfig> {
	const config = vscode.workspace.getConfiguration('axon');

	// Boot Firmware 경로는 매번 새로 검색 (캐시 사용하지 않음) - 빠른 방식 사용
	axonLog(`🔍 Boot Firmware 경로 자동 검색 시작 (빠른 방식)...`);
	const bootFirmwarePathOrUri = await findBootFirmwareFolder();

	if (!bootFirmwarePathOrUri) {
		axonLog(`❌ Boot Firmware 경로를 찾을 수 없습니다.`);
		throw new Error('Boot Firmware 경로를 찾을 수 없습니다. "Axon: Auto-detect Boot Firmware Path" 명령을 먼저 실행하거나 수동으로 설정해주세요.');
	}

	// FWDN은 로컬 Windows에서 실행되므로 Windows 경로 필요
	// URI 문자열(vscode-remote://...)이면 Samba 경로(Z:\...)로 변환
	let bootFirmwarePath: string;
	if (bootFirmwarePathOrUri.startsWith('vscode-remote://')) {
		// URI 파싱하여 Unix 경로 추출 후 Samba 경로로 변환
		const uri = vscode.Uri.parse(bootFirmwarePathOrUri);
		bootFirmwarePath = convertRemotePathToSamba(uri.path);
		axonLog(`🔄 [FWDN] 원격 경로를 Samba 경로로 변환: ${uri.path} → ${bootFirmwarePath}`);
	} else {
		// 이미 Windows 경로
		bootFirmwarePath = bootFirmwarePathOrUri;
	}

	axonLog(`✅ Boot Firmware 경로 (FWDN용): ${bootFirmwarePath}`);

	return {
		fwdnExePath: config.get<string>('fwdn.exePath', 'C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe'),
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

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	// 설정 가져오기
	let config: FwdnConfig;
	try {
		config = await getFwdnConfig();
		axonLog(`📋 설정 - FWDN 경로: ${config.fwdnExePath}, Boot Firmware 경로: ${config.bootFirmwarePath}`);
	} catch (error) {
		// Boot Firmware 경로가 설정되지 않은 경우
		axonError(`설정 오류: ${error}`);
		vscode.window.showErrorMessage(`Boot Firmware 경로가 설정되지 않았습니다. "Axon: Auto-detect Boot Firmware Path" 명령을 먼저 실행해주세요.`);
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

		// CMD를 통해 배치 파일 실행 (ALL 모드로 고정)
		const psCommand = `cmd /c "${batchFilePath}" all "${config.bootFirmwarePath}" "${config.fwdnExePath}"`;

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

