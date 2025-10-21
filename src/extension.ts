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

// 워크스페이스에서 boot-firmware_tcn1000 폴더 검색 함수 (개선된 버전)
async function findBootFirmwareFolder(): Promise<string | null> {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		axonLog('❌ 워크스페이스 폴더를 찾을 수 없습니다.');
		return null;
	}

	axonLog(`🔍 워크스페이스 폴더에서 boot-firmware_tcn1000 검색 시작: ${workspaceFolders[0].uri.fsPath}`);
	axonLog(`📁 워크스페이스 URI: ${workspaceFolders[0].uri.toString()}`);

	// 디버깅: VS Code API 정보 확인
	axonLog(`🐛 디버깅 정보:`);
	axonLog(`  - VS Code 버전: ${vscode.version}`);
	axonLog(`  - 워크스페이스 개수: ${workspaceFolders.length}`);
	axonLog(`  - 첫 번째 워크스페이스: ${workspaceFolders[0].uri.fsPath}`);
	axonLog(`  - URI 스킴: ${workspaceFolders[0].uri.scheme}`);

	try {
		// 찾고자 하는 폴더 이름들
		const targetFolders = ['boot-firmware_tcn1000'];

		// 모든 워크스페이스 폴더에서 검색
		for (const workspaceFolder of workspaceFolders) {
			axonLog(`🔍 워크스페이스 "${workspaceFolder.uri.fsPath}"에서 검색 시작`);

			for (const folderName of targetFolders) {
				axonLog(`📋 "${folderName}" 폴더 검색 중...`);

				// ✅ 폴더 내부를 가리키도록 패턴 변경 (폴더 자체는 매칭 불가)
				const include = new vscode.RelativePattern(workspaceFolder, `**/${folderName}/**`);
				const hits = await vscode.workspace.findFiles(include, '**/node_modules/**', 1);

				axonLog(`📊 "${folderName}" 패턴 결과: ${hits.length}개 (base=${workspaceFolder.uri.toString()})`);

				if (hits.length > 0) {
					const hit = hits[0]; // 폴더 안의 임의의 파일/항목 URI
					const dirUri = uriUpToFolderName(hit, folderName); // 폴더 경로만 추출

					axonLog(`🎯 "${folderName}" 폴더 URI: ${dirUri.toString()}`);

					try {
						const stat = await vscode.workspace.fs.stat(dirUri);
						if (stat.type === vscode.FileType.Directory) {
							axonLog(`✅ ${folderName} 폴더를 찾았습니다: ${dirToDisplay(dirUri)}`);
							// file 스킴이 아니면 fsPath 사용이 위험하니, 필요 용도에 맞게 반환값 선택
							return dirUri.scheme === 'file' ? dirUri.fsPath : dirUri.path;
						} else {
							axonLog(`⚠️ ${folderName}이 폴더가 아닙니다: ${dirToDisplay(dirUri)}`);
						}
					} catch (statError) {
						axonLog(`⚠️ stat 실패: ${statError instanceof Error ? statError.message : String(statError)}`);
					}
				} else {
					axonLog(`❌ "${folderName}" 패턴으로 아무것도 찾을 수 없습니다.`);
				}
			}
		}

		// 추가: build-axon 폴더 내에서 검색
		axonLog(`🔍 build-axon 폴더에서 boot-firmware_tcn1000 검색 중...`);
		for (const workspaceFolder of workspaceFolders) {
			const buildAxonPattern = new vscode.RelativePattern(workspaceFolder, '**/build-axon/**');
			const buildAxonFiles = await vscode.workspace.findFiles(buildAxonPattern, '**/node_modules/**', 10);

			if (buildAxonFiles.length > 0) {
				axonLog(`✅ build-axon 폴더를 찾았습니다: ${buildAxonFiles.length}개`);

				for (const buildAxonFile of buildAxonFiles) {
					axonLog(`  - build-axon: ${buildAxonFile.fsPath}`);

					// build-axon 폴더를 정확히 찾기 위해 URI path 분해
					const buildAxonDir = uriUpToFolderName(buildAxonFile, 'build-axon');
					axonLog(`  🔍 build-axon 기준 디렉토리: ${dirToDisplay(buildAxonDir)}`);

					// build-axon 폴더 내에서 boot-firmware_tcn1000 검색
					const bootFirmwarePattern = new vscode.RelativePattern(buildAxonDir, `**/boot-firmware_tcn1000/**`);
					const bootFirmwareFiles = await vscode.workspace.findFiles(bootFirmwarePattern, null, 5);

					if (bootFirmwareFiles.length > 0) {
						const foundUri = bootFirmwareFiles[0];
						const bootFirmwareDir = uriUpToFolderName(foundUri, 'boot-firmware_tcn1000');
						axonLog(`🎯 build-axon 폴더 내에서 boot-firmware_tcn1000을 찾았습니다: ${dirToDisplay(bootFirmwareDir)}`);
						return bootFirmwareDir.scheme === 'file' ? bootFirmwareDir.fsPath : bootFirmwareDir.path;
					}
				}
			}
		}

		// 워크스페이스 폴더 자체가 관련 경로인지 확인
		const workspacePath = workspaceFolders[0].uri.fsPath;
		if (workspacePath.includes('linux_yp') || workspacePath.includes('cgw') || workspacePath.includes('build-axon')) {
			axonLog(`✅ 워크스페이스 폴더가 관련 경로에 있습니다: ${workspacePath}`);
			return workspacePath;
		}

		axonLog(`❌ boot-firmware_tcn1000 폴더를 찾을 수 없습니다.`);
		return null;

	} catch (error) {
		axonError(`Boot firmware 폴더 검색 중 오류 발생: ${error}`);
		return null;
	}
}

// --- Helper Functions ---

/**
 * URI에서 특정 폴더명까지의 상위 폴더 URI를 반환 (스킴 보존)
 */
function uriUpToFolderName(uri: vscode.Uri, folderName: string): vscode.Uri {
	// 스킴을 유지한 채로 경로만 잘라서 상위 폴더 URI를 만든다.
	const segments = uri.path.split('/').filter(Boolean); // POSIX 경로로 취급 (remote 포함)
	const index = segments.lastIndexOf(folderName);

	if (index >= 0) {
		const newPath = '/' + segments.slice(0, index + 1).join('/');
		return uri.with({ path: newPath });
	} else {
		// 폴더명을 찾지 못하면 원래 경로 반환
		return uri;
	}
}

/**
 * 로깅용 디스플레이 경로 반환 (원격 환경 대응)
 */
function dirToDisplay(uri: vscode.Uri): string {
	// 로깅용: 로컬이면 fsPath, 아니면 POSIX path
	return uri.scheme === 'file' ? uri.fsPath : `${uri.scheme}:${uri.path}`;
}

export function activate(context: vscode.ExtensionContext) {
	// Axon 전용 Output 채널 생성
	axonOutputChannel = vscode.window.createOutputChannel('Axon');
	
	// 버전 정보 표시
	const extension = vscode.extensions.getExtension('axon');
	const version = extension?.packageJSON.version || '0.2.0';
	
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


	// Boot Firmware 경로 자동 검색 명령
	const autoDetectBootFirmwareDisposable = vscode.commands.registerCommand(
		'axon.autoDetectBootFirmware',
		async () => {
			axonLog('🔍 Boot Firmware 폴더 자동 검색 시작');

			const foundPath = await findBootFirmwareFolder();

			if (foundPath) {
				await updateConfiguration('bootFirmware.path', foundPath, 'Boot Firmware (자동 감지)');
				vscode.window.showInformationMessage(`Boot Firmware 경로가 자동 설정되었습니다: ${foundPath}`);
			} else {
				axonError('Boot Firmware 폴더를 찾을 수 없습니다. 수동으로 설정해주세요.');
				vscode.window.showErrorMessage('Boot Firmware 폴더를 찾을 수 없습니다. 수동으로 설정해주세요.');
			}
		}
	);

        context.subscriptions.push(
		runFwdnMcuDisposable,
		runFwdnAllDisposable,
		configureBootFirmwareDisposable,
		configureFwdnExeDisposable,
		autoDetectBootFirmwareDisposable
        );
}

export function deactivate() {}
