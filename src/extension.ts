import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';

// Axon 전용 Output 채널
let axonOutputChannel: vscode.OutputChannel;

// 로그 함수들
function logWithTimestamp(message: string, prefix: string = ''): string {
	const timestamp = new Date().toLocaleTimeString();
	return `${prefix}[${timestamp}] ${message}`;
}
	
function axonLog(message: string) {
	const logMessage = logWithTimestamp(message);
	if (axonOutputChannel) {
		axonOutputChannel.appendLine(logMessage);
	}
	console.log(`[Axon] ${logMessage}`);
}

function axonError(message: string) {
	const logMessage = logWithTimestamp(message, '❌ ');
	if (axonOutputChannel) {
		axonOutputChannel.appendLine(logMessage);
	}
	console.error(`[Axon] ${logMessage}`);
}

function axonSuccess(message: string) {
	const logMessage = logWithTimestamp(message, '✅ ');
	if (axonOutputChannel) {
		axonOutputChannel.appendLine(logMessage);
	}
	console.log(`[Axon] ${logMessage}`);
}

// 설정 가져오기 헬퍼 함수
interface FwdnConfig {
	fwdnExePath: string;
	bootFirmwarePath: string;
}

function getFwdnConfig(): FwdnConfig {
		const config = vscode.workspace.getConfiguration('axon');
	return {
		fwdnExePath: config.get<string>('fwdn.exePath', 'C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe'),
		bootFirmwarePath: config.get<string>('bootFirmware.path', 'Z:\\work1\\can2ethimp\\mcu-tcn100x\\boot-firmware-tcn100x')
	};
}

// 설정 검증 함수
function validateConfig(config: FwdnConfig): string | null {
	if (!config.fwdnExePath) {
		return 'FWDN 실행 파일 경로가 설정되지 않았습니다. 설정을 먼저 구성해주세요.';
	}
	if (!config.bootFirmwarePath) {
		return 'Boot Firmware 경로가 설정되지 않았습니다. 설정을 먼저 구성해주세요.';
	}
	return null;
}

// 워크스페이스 폴더 가져오기
function getWorkspaceFolder(): vscode.WorkspaceFolder | null {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			const errorMsg = '워크스페이스 폴더를 찾을 수 없습니다.';
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
		return null;
	}
	return workspaceFolder;
}


// FWDN 실행 공통 함수 (진정한 로컬 실행)
async function executeFwdnCommand(
	mode: 'mcu' | 'all',
	extensionPath: string
): Promise<void> {
	const modeLabel = mode === 'mcu' ? 'MCU (Step 1-3)' : 'ALL (Step 1-4)';
	axonLog(`🚀 FWDN ${modeLabel} 실행 명령 시작`);

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	// 설정 가져오기
	const config = getFwdnConfig();
	axonLog(`📋 설정 정보 - FWDN 경로: ${config.fwdnExePath}, Boot Firmware 경로: ${config.bootFirmwarePath}`);

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

		// CMD를 통해 배치 파일 실행 (간단한 인용부호 처리)
		const psCommand = `cmd /c "${batchFilePath}" ${mode} "${config.bootFirmwarePath}" "${config.fwdnExePath}"`;

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
					name: `FWDN ${modeLabel}`,
					isTransient: true
				});
			}
		}

		terminal.sendText(psCommand, true);  // PS 문법 그대로 실행

		const successMsg = `FWDN ${modeLabel}이 로컬 PowerShell에서 실행되었습니다!`;
			axonSuccess(successMsg);
			vscode.window.showInformationMessage(successMsg);

		axonLog(`✅ FWDN ${modeLabel} 실행 완료`);

		} catch (error) {
		const errorMsg = `FWDN ${modeLabel} 실행 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
		}
}



// 설정 업데이트 공통 함수
async function updateConfiguration(
	key: string,
	value: string,
	label: string
): Promise<void> {
		const config = vscode.workspace.getConfiguration('axon');
	await config.update(key, value, vscode.ConfigurationTarget.Workspace);
	axonLog(`✅ ${label} 경로가 저장되었습니다: ${value}`);
	vscode.window.showInformationMessage(`${label} 경로가 저장되었습니다: ${value}`);
}

export function activate(context: vscode.ExtensionContext) {
	// Axon 전용 Output 채널 생성
	axonOutputChannel = vscode.window.createOutputChannel('Axon');
	
	// 버전 정보 표시
	const extension = vscode.extensions.getExtension('axon');
	const version = extension?.packageJSON.version || '0.1.14';
	
	axonLog('===========================================');
	axonLog('Axon extension is now active!');
	axonLog(`Version: ${version}`);
	axonLog('===========================================');
	axonOutputChannel.show();

	// FWDN MCU 실행 명령
	const runFwdnMcuDisposable = vscode.commands.registerCommand(
		'axon.FWDN_MCU',
		async () => executeFwdnCommand('mcu', context.extensionPath)
	);

	// FWDN ALL 실행 명령
	const runFwdnAllDisposable = vscode.commands.registerCommand(
		'axon.FWDN_ALL',
		async () => executeFwdnCommand('all', context.extensionPath)
	);

	// Boot Firmware 경로 설정 명령
	const configureBootFirmwareDisposable = vscode.commands.registerCommand(
		'axon.configureBootFirmware',
		async () => {
		const config = vscode.workspace.getConfiguration('axon');
		
			const selectedFolders = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: 'Boot Firmware 폴더 선택',
				title: 'Boot Firmware 경로를 선택하세요',
				defaultUri: vscode.Uri.file(config.get<string>('bootFirmware.path', 'Z:\\work1\\can2ethimp\\mcu-tcn100x\\boot-firmware-tcn100x'))
			});

			if (selectedFolders && selectedFolders.length > 0) {
				await updateConfiguration('bootFirmware.path', selectedFolders[0].fsPath, 'Boot Firmware');
			}
		}
	);

	// FWDN 실행 파일 경로 설정 명령
	const configureFwdnExeDisposable = vscode.commands.registerCommand(
		'axon.configureFwdnExe',
		async () => {
			const config = vscode.workspace.getConfiguration('axon');

			const selectedFiles = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				openLabel: 'FWDN 실행 파일 선택',
				title: 'FWDN 실행 파일을 선택하세요',
				filters: {
					'Executable': ['exe'],
					'All Files': ['*']
				},
				defaultUri: vscode.Uri.file(config.get<string>('fwdn.exePath', 'C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe'))
			});

			if (selectedFiles && selectedFiles.length > 0) {
				await updateConfiguration('fwdn.exePath', selectedFiles[0].fsPath, 'FWDN 실행 파일');
			}
		}
	);

        context.subscriptions.push(
		runFwdnMcuDisposable,
		runFwdnAllDisposable,
		configureBootFirmwareDisposable,
		configureFwdnExeDisposable
        );
}

export function deactivate() {}
