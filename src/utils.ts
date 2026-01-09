import * as vscode from 'vscode';
import { axonLog, axonError } from './logger';

/**
 * ============================================================================
 * 경로 처리 개발 지침 (중요!)
 * ============================================================================
 * 
 * 이 프로젝트는 리눅스 환경에서 실행되며, FWDN 기능을 제외한 모든 기능은
 * 리눅스 경로 형식을 사용해야 합니다.
 * 
 * ⚠️ 중요 규칙:
 * 1. FWDN을 제외한 모든 기능은 리눅스 경로 형식(슬래시 '/')을 사용해야 함
 * 2. Windows 경로 형식(역슬래시 '\')을 사용하면 안 됨
 * 3. VS Code URI에서 경로를 가져올 때:
 *    - 리눅스/원격 환경: uri.path 사용 (항상 슬래시)
 *    - Windows 환경: uri.fsPath 사용 후 필요시 정규화
 * 4. FWDN만 Windows 경로가 필요하므로 convertRemotePathToSamba() 함수 사용
 * 
 * 예시:
 *   ✅ 올바른 방법: "/home/user/project/path"
 *   ❌ 잘못된 방법: "\home\user\project\path"
 * 
 * 참고:
 * - FWDN 관련 경로 변환: convertRemotePathToSamba() 함수 사용
 * - 리눅스 경로 정규화: path.replace(/\\/g, '/')
 * ============================================================================
 */

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

// 프로젝트 타입
export type ProjectType = 'mcu_project' | 'yocto_project' | '';

// Axon 설정 인터페이스
export interface AxonConfig {
	fwdnExePath: string;
	projectType: ProjectType;
	buildAxonFolderName: string;
}

// 전체 Axon 설정 가져오기 함수
export function getAxonConfig(): AxonConfig {
	const config = vscode.workspace.getConfiguration('axon');

	return {
		fwdnExePath: config.get<string>('fwdn.exePath', 'C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe'),
		projectType: config.get<ProjectType>('projectType', ''),
		buildAxonFolderName: config.get<string>('buildAxonFolderName', '')
	};
}

/**
 * 프로젝트 타입에 따른 폴더명 매핑
 */
export const PROJECT_TYPE_FOLDERS = {
	mcu_project: {
		buildFolder: 'mcu-tcn100x'
	},
	yocto_project: {
		buildFolder: 'build-axon'
	}
} as const;

/**
 * 프로젝트 타입 선택 및 자동 설정
 * 설정이 없으면 QuickPick으로 선택하도록 유도하고, 선택한 타입에 따라 관련 폴더명들을 자동으로 설정
 * 
 * @returns 선택된 프로젝트 타입 또는 undefined (취소한 경우)
 */
export async function ensureProjectType(): Promise<ProjectType | undefined> {
	const config = vscode.workspace.getConfiguration('axon');
	let projectType = config.get<ProjectType>('projectType', '');
	
	// 설정이 없거나 빈 문자열이면 사용자에게 선택 요청
	if (!projectType || projectType.trim() === '') {
		axonLog(`⚠️ projectType 설정이 없습니다. 사용자 선택 요청...`);
		
		const selected = await vscode.window.showQuickPick(
			[
				{ 
					label: 'MCU Standalone Project', 
					value: 'mcu_project' as const,
					description: 'MCU 단독 프로젝트 (mcu-tcn100x + boot-firmware-tcn100x)',
					detail: '빌드 폴더: mcu-tcn100x, Boot Firmware: boot-firmware-tcn100x'
				},
				{ 
					label: 'Yocto Project', 
					value: 'yocto_project' as const,
					description: 'Yocto 프로젝트 (build-axon + boot-firmware_tcn1000)',
					detail: '빌드 폴더: build-axon, Boot Firmware: boot-firmware_tcn1000'
				}
			],
			{
				placeHolder: '프로젝트 타입을 선택하세요',
				title: 'Axon Project Type 선택',
				ignoreFocusOut: true
			}
		);
		
		if (!selected) {
			axonLog(`ℹ️ 사용자가 프로젝트 타입 선택을 취소했습니다.`);
			return undefined;
		}
		
	projectType = selected.value;
	
	// 프로젝트 타입에 따른 폴더명 가져오기
	const folders = PROJECT_TYPE_FOLDERS[projectType];
	
	// settings.json에 저장 (buildAxonFolderName은 제외)
	await config.update('projectType', projectType, vscode.ConfigurationTarget.Workspace);
	
	// Yocto 프로젝트 타입인 경우 apBuildScript, apImageName 기본값 저장
	if (projectType === 'yocto_project') {
		const yoctoConfig = vscode.workspace.getConfiguration('axon.yocto');
		await yoctoConfig.update(
			'apBuildScript', 
			'poky/meta-telechips/meta-dev/meta-cgw-dev/cgw-build.sh',
			vscode.ConfigurationTarget.Workspace
		);
		await yoctoConfig.update(
			'apImageName',
			'telechips-cgw-image',
			vscode.ConfigurationTarget.Workspace
		);
		axonLog(`💾 apBuildScript, apImageName 기본값 저장 완료`);
	}
	
	axonLog(`💾 프로젝트 타입 설정 저장: ${projectType}`);
	
	vscode.window.showInformationMessage(
		`프로젝트 타입이 설정되었습니다: ${selected.label}`
	);
}
	
	return projectType;
}

/**
 * 프로젝트 타입을 설정하고 관련 폴더명을 자동으로 설정
 * 
 * @param projectType - 설정할 프로젝트 타입 ('mcu_project' | 'yocto_project')
 */
export async function setProjectType(projectType: 'mcu_project' | 'yocto_project'): Promise<void> {
	const config = vscode.workspace.getConfiguration('axon');
	
	// 프로젝트 타입에 따른 폴더명 가져오기
	const folders = PROJECT_TYPE_FOLDERS[projectType];
	
	// settings.json에 저장 (buildAxonFolderName은 제외)
	await config.update('projectType', projectType, vscode.ConfigurationTarget.Workspace);
	
	const displayMap: { [key in 'mcu_project' | 'yocto_project']: string } = { 
		mcu_project: 'MCU Project', 
		yocto_project: 'Yocto Project' 
	};
	axonLog(`💾 프로젝트 타입 설정 저장: ${projectType}`);
	
	vscode.window.showInformationMessage(
		`프로젝트 타입이 설정되었습니다: ${displayMap[projectType]}`
	);
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
 * 원격 경로를 Windows에서 접근 가능한 경로로 변환
 * - SSH: Samba 네트워크 드라이브 경로 (Z:\...)
 * - WSL: \\wsl$\{distro}\... 형식
 * @param remotePath Unix 형식 경로
 * @param remoteType 'ssh' | 'wsl' | undefined
 */
export function convertRemotePathToSamba(remotePath: string, remoteType?: string): string {
	axonLog(`🔄 원격 경로 변환 시작: ${remotePath} (타입: ${remoteType || 'unknown'})`);

	try {
		// WSL 환경 처리
		if (remoteType === 'wsl') {
			axonLog(`🐧 WSL 환경 감지 - \\\\wsl$ 경로로 변환`);
			
			// WSL의 /mnt/c/... 패턴: C:\... 로 직접 변환
			if (remotePath.startsWith('/mnt/c/')) {
				const afterMntC = remotePath.split('/mnt/c/')[1];
				if (afterMntC) {
					const windowsPath = `C:\\${afterMntC.replace(/\//g, '\\')}`;
					axonLog(`✅ WSL /mnt/c/ → Windows: ${remotePath} → ${windowsPath}`);
					return windowsPath;
				}
			}
			
			// WSL의 다른 마운트 포인트: /mnt/d/, /mnt/e/ 등
			const mntMatch = remotePath.match(/^\/mnt\/([a-z])\/(.*)/);
			if (mntMatch) {
				const driveLetter = mntMatch[1].toUpperCase();
				const afterDrive = mntMatch[2];
				const windowsPath = `${driveLetter}:\\${afterDrive.replace(/\//g, '\\')}`;
				axonLog(`✅ WSL /mnt/${mntMatch[1]}/ → Windows: ${remotePath} → ${windowsPath}`);
				return windowsPath;
			}
			
			// WSL의 /home/... 또는 기타 경로: \\wsl$\{distro}\... 형식
			// distro 이름은 설정에서 가져오거나 기본값 사용
			const distroName = vscode.workspace.getConfiguration('axon').get<string>('wsl.distroName', 'Ubuntu');
			const wslPath = `\\\\wsl$\\${distroName}${remotePath.replace(/\//g, '\\')}`;
			axonLog(`✅ WSL 경로 → \\\\wsl$ 형식: ${remotePath} → ${wslPath}`);
			return wslPath;
		}
		
		// SSH 환경 처리 (기존 로직)
		axonLog(`🔐 SSH 환경 - Samba 경로로 변환`);
		
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


