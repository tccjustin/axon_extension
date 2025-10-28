import * as vscode from 'vscode';
import { axonLog, axonError } from './logger';

// 제외할 폴더 패턴 (검색에서 제외할 폴더들)
export const EXCLUDE_PATTERNS = '**/{node_modules,.git,.cache,build,dist,out,tmp,buildtools,fwdn-v8,mktcimg,poky,source-mirror,tools}/**';

// 제외할 폴더명들 (EXCLUDE_PATTERNS에서 추출)
export const EXCLUDE_FOLDERS = [
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

// Axon 설정 인터페이스
export interface AxonConfig {
	fwdnExePath: string;
	buildAxonFolderName: string;
	bootFirmwareFolderName: string;
}

// 전체 Axon 설정 가져오기 함수
export function getAxonConfig(): AxonConfig {
	const config = vscode.workspace.getConfiguration('axon');

	return {
		fwdnExePath: config.get<string>('fwdn.exePath', 'C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe'),
		buildAxonFolderName: config.get<string>('buildAxonFolderName', 'build-axon'),
		bootFirmwareFolderName: config.get<string>('bootFirmwareFolderName', 'boot-firmware_tcn1000')
	};
}

/**
 * URI에서 특정 폴더명까지의 상위 폴더 URI를 반환 (스킴 보존)
 */
export function uriUpToFolderName(uri: vscode.Uri, folderName: string): vscode.Uri {
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
export function dirToDisplay(uri: vscode.Uri): string {
	// 로깅용: 로컬이면 fsPath, 아니면 POSIX path
	return uri.scheme === 'file' ? uri.fsPath : `${uri.scheme}:${uri.path}`;
}

/**
 * 원격 경로를 Samba 네트워크 드라이브 경로로 변환
 * SSH/WSL 환경에서 로컬 Samba 매핑으로 변환
 */
export function convertRemotePathToSamba(remotePath: string): string {
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

/**
 * 지정된 디렉토리에서 설정 가능한 boot firmware 폴더를 재귀적으로 검색 (최대 depth 4)
 */
export async function searchBootFirmwareInDirectory(baseUri: vscode.Uri, currentDepth: number = 0, maxDepth: number = 4): Promise<string | null> {
	const config = getAxonConfig();
	const bootFirmwareFolderName = config.bootFirmwareFolderName;

	try {
		// 현재 디렉토리에서 설정된 boot firmware 폴더 확인
		const targetPath = baseUri.with({ path: `${baseUri.path.replace(/\/$/, '')}/${bootFirmwareFolderName}` });

		try {
			const stat = await vscode.workspace.fs.stat(targetPath);
			if (stat.type === vscode.FileType.Directory) {
				const finalPath = targetPath.scheme === 'file' ? targetPath.fsPath : convertRemotePathToSamba(targetPath.path);
				axonLog(`✅ depth ${currentDepth}에서 ${bootFirmwareFolderName} 폴더를 찾았습니다: ${finalPath}`);
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
 * 워크스페이스에서 설정 가능한 boot firmware 폴더 검색 함수 (빠른 버전 - depth 4까지 재귀 탐색)
 * 설정된 build 폴더나 워크스페이스부터 depth 4까지 boot firmware 폴더를 재귀적으로 검색
 */
export async function findBootFirmwareFolder(): Promise<string | null> {
	const config = getAxonConfig();
	const buildAxonFolderName = config.buildAxonFolderName;
	const bootFirmwareFolderName = config.bootFirmwareFolderName;

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
	axonLog(`🔍 빠른 방식으로 ${bootFirmwareFolderName} 검색 시작 (depth 4까지): ${workspacePath}`);

	try {
		let result: string | null = null;

		// 워크스페이스 경로에 설정된 build 폴더명이 포함되어 있다면 해당 폴더를 기준으로 검색
		if (workspacePath.includes(buildAxonFolderName)) {
			axonLog(`✅ 워크스페이스 폴더에 ${buildAxonFolderName}이 포함되어 있습니다: ${workspacePath}`);

			// 워크스페이스 URI에서 설정된 폴더명까지의 경로 추출
			const folderIndex = workspaceUri.path.indexOf(buildAxonFolderName);
			if (folderIndex !== -1) {
				const folderPath = workspaceUri.path.substring(0, folderIndex + buildAxonFolderName.length);
				const folderUri = workspaceUri.with({ path: folderPath });

				axonLog(`🔍 ${buildAxonFolderName} 폴더부터 depth 4까지 ${bootFirmwareFolderName} 검색: ${dirToDisplay(folderUri)}`);

				// 설정된 build 폴더부터 depth 4까지 재귀 검색
				result = await searchBootFirmwareInDirectory(folderUri, 0, 4);

				if (result) {
					const searchEndTime = Date.now();
					const searchDuration = searchEndTime - searchStartTime;
					axonLog(`✅ ${buildAxonFolderName} 폴더에서 ${bootFirmwareFolderName} 폴더를 찾았습니다: ${result}`);
					axonLog(`⏱️ ${buildAxonFolderName} 검색 완료 - 소요시간: ${searchDuration}ms`);
					return result;
				}
			}
		}

		// 일반적인 경우: 워크스페이스 폴더부터 depth 4까지 검색
		axonLog(`🔍 워크스페이스 폴더부터 depth 4까지 ${bootFirmwareFolderName} 검색: ${dirToDisplay(workspaceUri)}`);

		result = await searchBootFirmwareInDirectory(workspaceUri, 0, 4);

		if (result) {
			const searchEndTime = Date.now();
			const searchDuration = searchEndTime - searchStartTime;
			axonLog(`✅ 워크스페이스에서 ${bootFirmwareFolderName} 폴더를 찾았습니다: ${result}`);
			axonLog(`⏱️ 워크스페이스 검색 완료 - 소요시간: ${searchDuration}ms`);
			return result;
		}

		axonLog(`❌ depth 4까지 검색했지만 ${bootFirmwareFolderName} 폴더를 찾을 수 없습니다.`);

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

