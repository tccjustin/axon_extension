import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';

// Axon 전용 Output 채널
let axonOutputChannel: vscode.OutputChannel;

// 현재 감지된 Boot Firmware 경로 (캐싱) - 사용하지 않음
let currentBootFirmwarePath: string | null = null;

// 제외할 폴더 패턴 (검색에서 제외할 폴더들)
const EXCLUDE_PATTERNS = '**/{node_modules,.git,.cache,build,dist,out,tmp,buildtools,fwdn-v8,mktcimg,poky,source-mirror,tools}/**';

// 제외할 폴더명들 (EXCLUDE_PATTERNS에서 추출)
const EXCLUDE_FOLDERS = [
	'node_modules',
	'.git',
	'.cache',
	'build',
	'dist',
	'out',
	'tmp',
	'buildtools',
	'fwdn-v8',
	'mktcimg',
	'poky',
	'source-mirror',
	'tools'
];

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

async function getFwdnConfig(): Promise<FwdnConfig> {
	const config = vscode.workspace.getConfiguration('axon');

	// Boot Firmware 경로는 매번 새로 검색 (캐시 사용하지 않음) - 빠른 방식 사용
	axonLog(`🔍 Boot Firmware 경로 자동 검색 시작 (빠른 방식)...`);
	const bootFirmwarePath = await findBootFirmwareFolder();

	if (!bootFirmwarePath) {
		axonLog(`❌ Boot Firmware 경로를 찾을 수 없습니다.`);
		throw new Error('Boot Firmware 경로를 찾을 수 없습니다. "Axon: Auto-detect Boot Firmware Path" 명령을 먼저 실행하거나 수동으로 설정해주세요.');
	}

	axonLog(`✅ Boot Firmware 경로를 찾았습니다: ${bootFirmwarePath}`);

	return {
		fwdnExePath: config.get<string>('fwdn.exePath', 'C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe'),
		bootFirmwarePath: bootFirmwarePath
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


// FWDN 실행 함수 (ALL 모드만)
async function executeFwdnCommand(extensionPath: string): Promise<void> {
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

		const successMsg = `FWDN ALL (Step 1-4)이 로컬 PowerShell에서 실행되었습니다!`;
			axonSuccess(successMsg);
			vscode.window.showInformationMessage(successMsg);

		axonLog(`✅ FWDN ALL (Step 1-4) 실행 완료`);

		} catch (error) {
		const errorMsg = `FWDN ALL (Step 1-4) 실행 중 오류가 발생했습니다: ${error}`;
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
	// 설정 파일에 저장
	const config = vscode.workspace.getConfiguration('axon');
	await config.update(key, value, vscode.ConfigurationTarget.Workspace);

	axonLog(`✅ ${label} 경로가 설정되었습니다: ${value}`);
	vscode.window.showInformationMessage(`${label} 경로가 설정되었습니다: ${value}`);
}

// 워크스페이스에서 boot-firmware_tcn1000 폴더 검색 함수 (원래 버전 - findFiles 사용)
async function findBootFirmwareFolderOriginal(): Promise<string | null> {
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

		// 워크스페이스 폴더 자체가 관련 경로인지 확인
		const workspaceUri = workspaceFolders[0].uri;
		const workspacePath = workspaceUri.scheme === 'file' ? workspaceUri.fsPath : workspaceUri.path; // 검색용으로는 원래 URI path 사용

		// 워크스페이스 경로에 build-axon이 포함되어 있다면 build-axon 폴더를 기준으로 검색
		if (workspacePath.includes('build-axon')) {
			axonLog(`✅ 워크스페이스 폴더에 build-axon이 포함되어 있습니다: ${workspacePath}`);

			// 워크스페이스 URI에서 build-axon 폴더까지의 경로 추출
			const buildAxonIndex = workspaceUri.path.indexOf('build-axon');
			if (buildAxonIndex !== -1) {
				const buildAxonPath = workspaceUri.path.substring(0, buildAxonIndex + 'build-axon'.length);
				const buildAxonUri = workspaceUri.with({ path: buildAxonPath });

				axonLog(`🔍 build-axon 폴더 기준으로 boot-firmware_tcn1000 검색: ${dirToDisplay(buildAxonUri)}`);

				// build-axon 폴더 내에서 boot-firmware_tcn1000 검색 (5초 타임아웃 + 시간 측정)
				const searchStartTime = Date.now();

				// 제외할 폴더 패턴 설정
				const bootFirmwarePattern = new vscode.RelativePattern(buildAxonUri, `**/boot-firmware_tcn1000/**`);
				const exclude = new vscode.RelativePattern(buildAxonUri, EXCLUDE_PATTERNS);

				// 취소 토큰과 타이머 설정
				const cts = new vscode.CancellationTokenSource();
				const timer = setTimeout(() => cts.cancel(), 5000); // 5초 타임아웃

				try {
					const bootFirmwareFiles = await vscode.workspace.findFiles(bootFirmwarePattern, exclude, 1, cts.token);
					const searchEndTime = Date.now();
					const searchDuration = searchEndTime - searchStartTime;
					axonLog(`⏱️ build-axon 폴더 boot-firmware 검색 시간: ${searchDuration}ms`);

					if (bootFirmwareFiles.length > 0) {
						const foundUri = bootFirmwareFiles[0];
						const bootFirmwareDir = uriUpToFolderName(foundUri, 'boot-firmware_tcn1000');
						axonLog(`🎯 build-axon 폴더 내에서 boot-firmware_tcn1000을 찾았습니다: ${dirToDisplay(bootFirmwareDir)}`);
						const finalPath = bootFirmwareDir.scheme === 'file' ? bootFirmwareDir.fsPath : convertRemotePathToSamba(bootFirmwareDir.path);
						axonLog(`📝 최종 설정 경로: ${finalPath}`);
						return finalPath;
					} else {
						axonLog(`❌ build-axon 폴더 내에서 boot-firmware_tcn1000를 찾을 수 없습니다.`);
					}
				} catch (e) {
					axonLog(`⏱️ build-axon findFiles 취소/실패: ${String(e)}`);
				} finally {
					clearTimeout(timer);
					cts.dispose();
				}
			}
		} else if (workspacePath.includes('linux_yp') || workspacePath.includes('cgw')) {
			// linux_yp나 cgw가 포함된 경우는 workspace 자체를 반환
			axonLog(`✅ 워크스페이스 폴더가 linux_yp/cgw 관련 경로에 있습니다: ${workspacePath}`);
			const finalPath = workspaceUri.scheme === 'file' ? workspaceUri.fsPath : convertRemotePathToSamba(workspaceUri.path);
			axonLog(`📝 최종 설정 경로: ${finalPath}`);
			return finalPath;
		}

		for (const workspaceFolder of workspaceFolders) {
			axonLog(`🔍 워크스페이스 "${workspaceFolder.uri.fsPath}"에서 검색 시작`);

			for (const folderName of targetFolders) {
				axonLog(`📋 "${folderName}" 폴더 검색 중...`);

				// ✅ 폴더 내부를 가리키도록 패턴 변경 (폴더 자체는 매칭 불가, 5초 타임아웃 + 시간 측정)
				const searchStartTime = Date.now();

				// 제외할 폴더 패턴 설정
				const include = new vscode.RelativePattern(workspaceFolder, `**/${folderName}/**`);
				const exclude = new vscode.RelativePattern(workspaceFolder, EXCLUDE_PATTERNS);

				// 취소 토큰과 타이머 설정
				const cts = new vscode.CancellationTokenSource();
				const timer = setTimeout(() => cts.cancel(), 5000); // 5초 타임아웃

				try {
					const hits = await vscode.workspace.findFiles(include, exclude, 1, cts.token);
					const searchEndTime = Date.now();
					const searchDuration = searchEndTime - searchStartTime;
					axonLog(`⏱️ ${folderName} 검색 시간: ${searchDuration}ms`);

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
								const finalPath = dirUri.scheme === 'file' ? dirUri.fsPath : convertRemotePathToSamba(dirUri.path);
								axonLog(`📝 최종 설정 경로: ${finalPath}`);
								return finalPath;
							} else {
								axonLog(`⚠️ ${folderName}이 폴더가 아닙니다: ${dirToDisplay(dirUri)}`);
							}
						} catch (statError) {
							axonLog(`⚠️ stat 실패: ${statError instanceof Error ? statError.message : String(statError)}`);
						}
					} else {
						axonLog(`❌ "${folderName}" 패턴으로 아무것도 찾을 수 없습니다.`);
					}
				} catch (e) {
					axonLog(`⏱️ findFiles 취소/실패: ${String(e)}`);
				} finally {
					clearTimeout(timer);
					cts.dispose();
				}
			}
		}


		axonLog(`❌ boot-firmware_tcn1000 폴더를 찾을 수 없습니다.`);
		return null;

	} catch (error) {
		axonError(`Boot firmware 폴더 검색 중 오류 발생: ${error}`);
		return null;
	}
}

/**
 * 지정된 디렉토리에서 boot-firmware_tcn1000 폴더를 재귀적으로 검색 (최대 depth 4)
 */
async function searchBootFirmwareInDirectory(baseUri: vscode.Uri, currentDepth: number = 0, maxDepth: number = 4): Promise<string | null> {
	try {
		// 현재 디렉토리에서 boot-firmware_tcn1000 확인
		const targetPath = baseUri.with({ path: `${baseUri.path.replace(/\/$/, '')}/boot-firmware_tcn1000` });

		try {
			const stat = await vscode.workspace.fs.stat(targetPath);
			if (stat.type === vscode.FileType.Directory) {
				const finalPath = targetPath.scheme === 'file' ? targetPath.fsPath : convertRemotePathToSamba(targetPath.path);
				axonLog(`✅ depth ${currentDepth}에서 boot-firmware_tcn1000 폴더를 찾았습니다: ${finalPath}`);
				return finalPath;
			}
		} catch {
			// 폴더가 없으면 계속 진행
		}

		// 최대 depth에 도달하지 않았으면 하위 폴더 탐색
		if (currentDepth < maxDepth) {
			try {
				const entries = await vscode.workspace.fs.readDirectory(baseUri);

				// 디렉토리만 필터링 (제외할 폴더 제외)
				const allDirectories = entries.filter(([name, type]) => type === vscode.FileType.Directory);
				const directories = allDirectories.filter(([dirName, dirType]) => !EXCLUDE_FOLDERS.includes(dirName));
				const excludedCount = allDirectories.length - directories.length;

				axonLog(`🔍 depth ${currentDepth}에서 ${directories.length}개 폴더를 탐색합니다... (${excludedCount}개 폴더 제외)`);

				// 각 디렉토리에서 재귀적으로 검색
				for (const [dirName, dirType] of directories) {
					const subDirUri = baseUri.with({ path: `${baseUri.path.replace(/\/$/, '')}/${dirName}` });

					const result = await searchBootFirmwareInDirectory(subDirUri, currentDepth + 1, maxDepth);
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
 * 워크스페이스에서 boot-firmware_tcn1000 폴더 검색 함수 (빠른 버전 - depth 4까지 재귀 탐색)
 * build-axon 폴더나 워크스페이스부터 depth 4까지 boot-firmware_tcn1000 폴더를 재귀적으로 검색
 */
async function findBootFirmwareFolder(): Promise<string | null> {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		axonLog('❌ 워크스페이스 폴더를 찾을 수 없습니다.');
		axonLog(`⏱️ 워크스페이스 없음 - 소요시간: 0ms`);
		return null;
	}

	const workspaceUri = workspaceFolders[0].uri;
	const workspacePath = workspaceUri.scheme === 'file' ? workspaceUri.fsPath : workspaceUri.path;

	// 수행 시간 측정 시작
	const searchStartTime = Date.now();
	axonLog(`🔍 빠른 방식으로 boot-firmware_tcn1000 검색 시작 (depth 4까지): ${workspacePath}`);

	try {
		let result: string | null = null;

		// 워크스페이스 경로에 build-axon이 포함되어 있다면 build-axon 폴더를 기준으로 검색
		if (workspacePath.includes('build-axon')) {
			axonLog(`✅ 워크스페이스 폴더에 build-axon이 포함되어 있습니다: ${workspacePath}`);

			// 워크스페이스 URI에서 build-axon 폴더까지의 경로 추출
			const buildAxonIndex = workspaceUri.path.indexOf('build-axon');
			if (buildAxonIndex !== -1) {
				const buildAxonPath = workspaceUri.path.substring(0, buildAxonIndex + 'build-axon'.length);
				const buildAxonUri = workspaceUri.with({ path: buildAxonPath });

				axonLog(`🔍 build-axon 폴더부터 depth 4까지 boot-firmware_tcn1000 검색: ${dirToDisplay(buildAxonUri)}`);

				// build-axon 폴더부터 depth 4까지 재귀 검색
				result = await searchBootFirmwareInDirectory(buildAxonUri, 0, 4);

				if (result) {
					const searchEndTime = Date.now();
					const searchDuration = searchEndTime - searchStartTime;
					axonLog(`✅ build-axon 폴더에서 boot-firmware_tcn1000 폴더를 찾았습니다: ${result}`);
					axonLog(`⏱️ build-axon 검색 완료 - 소요시간: ${searchDuration}ms`);
					return result;
				}
			}
		}

		// 일반적인 경우: 워크스페이스 폴더부터 depth 4까지 검색
		axonLog(`🔍 워크스페이스 폴더부터 depth 4까지 boot-firmware_tcn1000 검색: ${dirToDisplay(workspaceUri)}`);

		result = await searchBootFirmwareInDirectory(workspaceUri, 0, 4);

		if (result) {
			const searchEndTime = Date.now();
			const searchDuration = searchEndTime - searchStartTime;
			axonLog(`✅ 워크스페이스에서 boot-firmware_tcn1000 폴더를 찾았습니다: ${result}`);
			axonLog(`⏱️ 워크스페이스 검색 완료 - 소요시간: ${searchDuration}ms`);
			return result;
		}

		axonLog(`❌ depth 4까지 검색했지만 boot-firmware_tcn1000 폴더를 찾을 수 없습니다.`);

		const searchEndTime = Date.now();
		const searchDuration = searchEndTime - searchStartTime;
		axonLog(`⏱️ 전체 검색 완료 (실패) - 소요시간: ${searchDuration}ms`);
		return null;

	} catch (error) {
		const searchEndTime = Date.now();
		const searchDuration = searchEndTime - searchStartTime;
		axonError(`빠른 방식으로 Boot firmware 폴더 검색 중 오류 발생: ${error}`);
		axonLog(`⏱️ 검색 중단 (오류) - 소요시간: ${searchDuration}ms`);
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

/**
 * 원격 경로를 Samba 네트워크 드라이브 경로로 변환
 * SSH/WSL 환경에서 로컬 Samba 매핑으로 변환
 */
function convertRemotePathToSamba(remotePath: string): string {
	axonLog(`🔄 원격 경로를 Samba 경로로 변환: ${remotePath}`);

	try {
		// 사용자의 특정 환경: /home/id/{프로젝트}/... → Z:\{프로젝트}\...
		if (remotePath.startsWith('/home/id/')) {
			const afterId = remotePath.split('/home/id/')[1];
			if (afterId) {
				const sambaPath = `Z:\\${afterId.replace(/\//g, '\\')}`;
				axonLog(`✅ /home/id/ 패턴 매핑: ${remotePath} → ${sambaPath}`);
				axonLog(`📝 사용자: id, 프로젝트 시작: ${afterId.split('/')[0]}`);
				return sambaPath;
			}
		}

		// 사용자의 환경에 맞는 Samba 매핑 패턴들
		// /home/{사용자}/{프로젝트}/... → Z:\{프로젝트}\... (사용자 이름 제외)
		if (remotePath.startsWith('/home/')) {
			const pathParts = remotePath.split('/').filter(Boolean); // 빈 문자열 제거
			// pathParts: ['home', 'id', 'autotest_cs', ...]

			if (pathParts.length >= 3) { // /home/사용자/프로젝트/... 구조 확인
				const userName = pathParts[1]; // 사용자 이름 (id)
				const nextDir = pathParts[2]; // 그 다음 디렉토리 (autotest_cs, build-axon 등)

				// 더 광범위한 프로젝트 디렉토리 패턴들
				const projectPatterns = [
					'work1', 'work', 'project', 'workspace', 'projects', 'dev', 'development',
					'autotest', 'autotest_cs', 'test', 'tests', 'testing', 'build', 'linux', 'cgw',
					'mcu', 'firmware', 'boot', 'kernel', 'source', 'src', 'app', 'apps',
					'can2ethimp', 'tcn100x', 'mcu-tcn100x'
				];

				if (projectPatterns.some(pattern => nextDir.toLowerCase().includes(pattern.toLowerCase()))) {
					// 프로젝트 디렉토리부터 Samba 경로로 변환
					const remainingPath = pathParts.slice(2).join('/'); // autotest_cs/build-axon/...
					const sambaPath = `Z:\\${remainingPath.replace(/\//g, '\\')}`;
					axonLog(`✅ /home/${userName}/{프로젝트}/ 패턴 매핑: ${remotePath} → ${sambaPath}`);
					axonLog(`📝 사용자: ${userName}, 프로젝트: ${nextDir}`);
					return sambaPath;
				} else {
					// 프로젝트 디렉토리가 아니면 사용자 다음 디렉토리부터 변환
					// /home/id/autotest_cs/... → autotest_cs/... (사용자 제외)
					const afterUser = pathParts.slice(2).join('/');
					if (afterUser) {
						const sambaPath = `Z:\\${afterUser.replace(/\//g, '\\')}`;
						axonLog(`✅ /home/{사용자}/ 경로 변환: ${remotePath} → ${sambaPath}`);
						axonLog(`📝 사용자: ${userName}, 다음 디렉토리: ${nextDir}`);
						return sambaPath;
					}
				}
			}

			// /home/ 다음에 디렉토리가 없거나 부족한 경우
			const afterHome = remotePath.split('/home/')[1];
			if (afterHome) {
				const sambaPath = `Z:\\${afterHome.replace(/\//g, '\\')}`;
				axonLog(`⚠️ /home/ 패턴 (단순 변환): ${remotePath} → ${sambaPath}`);
				return sambaPath;
			}
		}

		// 일반적인 WSL 패턴: /mnt/c/Users/... → C:\Users\...
		if (remotePath.startsWith('/mnt/c/')) {
			const afterMntC = remotePath.split('/mnt/c/')[1];
			if (afterMntC) {
				const sambaPath = `C:\\${afterMntC.replace(/\//g, '\\')}`;
				axonLog(`✅ WSL /mnt/c/ 매핑: ${remotePath} → ${sambaPath}`);
				return sambaPath;
			}
		}

		// macOS/Linux 사용자 홈: /Users/... → Z:\...
		if (remotePath.startsWith('/Users/')) {
			const afterUsers = remotePath.split('/Users/')[1];
			if (afterUsers) {
				const sambaPath = `Z:\\${afterUsers.replace(/\//g, '\\')}`;
				axonLog(`✅ /Users/ 매핑: ${remotePath} → ${sambaPath}`);
				return sambaPath;
			}
		}

		// 기본 Samba 드라이브 문자들로 시도 (Z:, Y:, X: 등)
		const possibleDrives = ['Z:', 'Y:', 'X:', 'W:', 'V:'];
		for (const drive of possibleDrives) {
			if (remotePath.includes('/home/')) {
				const afterHome = remotePath.split('/home/')[1];
				if (afterHome) {
					const sambaPath = `${drive}\\${afterHome.replace(/\//g, '\\')}`;
					axonLog(`🔍 ${drive} 드라이브 시도: ${sambaPath}`);
					return sambaPath;
				}
			}
		}

		// 사용자의 SSH 환경: /id/{프로젝트}/... → Z:\{프로젝트}\...
		if (remotePath.startsWith('/id/')) {
			const afterId = remotePath.split('/id/')[1];
			if (afterId) {
				const sambaPath = `Z:\\${afterId.replace(/\//g, '\\')}`;
				axonLog(`✅ /id/ 패턴 매핑: ${remotePath} → ${sambaPath}`);
				axonLog(`📝 사용자: id, 프로젝트 시작: ${afterId.split('/')[0]}`);
				return sambaPath;
			}
		}

		// SSH 원격 환경의 일반적인 패턴들 (더 유연한 work1 패턴)
		if (remotePath.startsWith('/') && remotePath.includes('/work1/')) {
			// /work1/... → Z:\work1\...
			const work1Index = remotePath.indexOf('/work1/');
			if (work1Index !== -1) {
				const afterWork1 = remotePath.substring(work1Index + '/work1/'.length);
				const sambaPath = `Z:\\work1\\${afterWork1.replace(/\//g, '\\')}`;
				axonLog(`✅ SSH /work1/ 패턴 매핑: ${remotePath} → ${sambaPath}`);
				return sambaPath;
			}
		}

		// 더 일반적인 프로젝트 디렉토리 패턴들 (work, project, workspace 등)
		if (remotePath.startsWith('/')) {
			const pathParts = remotePath.split('/').filter(Boolean);
			if (pathParts.length >= 2) {
				const firstDir = pathParts[1]; // 첫 번째 디렉토리 (id, work1, project, workspace 등)
				const projectPatterns = [
					'work1', 'work', 'project', 'workspace', 'projects', 'dev', 'development',
					'autotest', 'autotest_cs', 'test', 'tests', 'testing', 'build', 'linux', 'cgw',
					'mcu', 'firmware', 'boot', 'kernel', 'source', 'src', 'app', 'apps',
					'can2ethimp', 'tcn100x', 'mcu-tcn100x'
				];

				if (projectPatterns.some(pattern => firstDir.toLowerCase().includes(pattern.toLowerCase()))) {
					// 프로젝트 디렉토리부터 Samba 경로로 변환
					const remainingPath = pathParts.slice(1).join('/'); // id/autotest_cs/... 또는 work1/autotest_cs/...
					const sambaPath = `Z:\\${remainingPath.replace(/\//g, '\\')}`;
					axonLog(`✅ SSH /{프로젝트}/ 패턴 매핑: ${remotePath} → ${sambaPath}`);
					axonLog(`📝 첫 번째 디렉토리: ${firstDir}`);
					return sambaPath;
				} else if (pathParts.length >= 3) {
					// 사용자의 환경: /id/autotest_cs/... → Z:\autotest_cs\...
					if (firstDir === 'id') {
						const secondDir = pathParts[2];
						const remainingPath = pathParts.slice(2).join('/');
						if (remainingPath) {
							const sambaPath = `Z:\\${remainingPath.replace(/\//g, '\\')}`;
							axonLog(`✅ SSH /id/{프로젝트}/ 패턴: ${remotePath} → ${sambaPath}`);
							axonLog(`📝 사용자: ${firstDir}, 프로젝트: ${secondDir}`);
							return sambaPath;
						}
					} else {
						// /home/가 없는 일반적인 경우 첫 번째 디렉토리 다음부터 변환
						const secondDir = pathParts[2];
						const remainingPath = pathParts.slice(2).join('/');
						if (remainingPath) {
							const sambaPath = `Z:\\${remainingPath.replace(/\//g, '\\')}`;
							axonLog(`✅ SSH /{사용자}/{프로젝트}/ 패턴: ${remotePath} → ${sambaPath}`);
							axonLog(`📝 사용자: ${firstDir}, 프로젝트: ${secondDir}`);
							return sambaPath;
						}
					}
				}
			}
		}

		// 일반적인 SSH 루트 패턴
		if (remotePath.startsWith('/')) {
			const firstDir = remotePath.split('/')[1];
			if (firstDir) {
				const sambaPath = `Z:\\${remotePath.substring(1).replace(/\//g, '\\')}`;
				axonLog(`✅ SSH 루트 패턴 매핑: ${remotePath} → ${sambaPath}`);
				return sambaPath;
			}
		}

		// 변환할 수 없으면 기본 Windows 경로로 변환
		const windowsPath = remotePath.replace(/\//g, '\\');
		axonLog(`⚠️ Samba 매핑을 찾을 수 없음, 기본 변환: ${windowsPath}`);
		return windowsPath;

	} catch (error) {
		axonError(`원격 경로 변환 중 오류: ${error}`);
		// 오류 시에는 안전하게 POSIX에서 Windows로 변환
		return remotePath.replace(/\//g, '\\');
	}
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


	// FWDN ALL 실행 명령
	const runFwdnAllDisposable = vscode.commands.registerCommand(
		'axon.FWDN_ALL',
		async () => executeFwdnCommand(context.extensionPath)
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
		runFwdnAllDisposable,
		configureFwdnExeDisposable
        );
}

export function deactivate() {}
