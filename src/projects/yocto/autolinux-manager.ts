import * as vscode from 'vscode';
import { axonLog, axonSuccess, axonError } from '../../logger';
import { executeShellTask } from '../common/shell-utils';

/**
 * Autolinux 프로젝트 관리 (update, clean, make_fai, info 등)
 * 
 * ⚠️ 중요: 이 모듈은 원격 환경(WSL/SSH)을 기본으로 설계되었습니다.
 * - 모든 경로는 Unix 형식으로 처리됩니다
 * - build-autolinux 디렉토리에서 ./autolinux 스크립트 실행
 */
export class AutolinuxProjectManager {
	/**
	 * 디렉토리에서 build-autolinux 검색 (1-depth만, 재귀 없음)
	 * @param dir 검색할 디렉토리
	 * @returns build-autolinux 경로 또는 null
	 */
	private static async searchBuildAutolinuxInDirectory(dir: vscode.Uri): Promise<string | null> {
		// 제외할 폴더 목록 (성능 최적화)
		const excludeDirs = [
			'node_modules', '.git', 'build', 'tmp', 'downloads', 'sstate-cache',
			'.vscode', 'dist', 'out', '.next', 'target', 'bin', 'obj'
		];

		try {
			const entries = await vscode.workspace.fs.readDirectory(dir);
			
			for (const [name, type] of entries) {
				// 제외 폴더는 스킵
				if (excludeDirs.includes(name)) {
					continue;
				}

				// 디렉토리만 확인
				if (type === vscode.FileType.Directory) {
					// build-autolinux 폴더를 찾으면 반환
					if (name === 'build-autolinux') {
						const buildAutolinuxPath = vscode.Uri.joinPath(dir, name);
						axonLog(`✅ build-autolinux 발견 (1-depth 검색): ${buildAutolinuxPath.path}`);
						return buildAutolinuxPath.path;
					}
				}
			}
		} catch (error) {
			// 읽기 권한 없거나 오류 발생 시 무시
			axonLog(`⚠️ 디렉토리 읽기 실패 (무시): ${dir.path}`);
		}
		
		return null;
	}

	/**
	 * build-autolinux 디렉토리 경로 가져오기
	 * 전략:
	 * 1. Multi-root workspace의 정의된 폴더들에서 검색 (빠름)
	 * 2. 못 찾으면 .code-workspace 파일 위치의 1-depth 하위에서 검색 (제한적)
	 * 3. 그래도 못 찾으면 에러
	 */
	private static async getBuildAutolinuxPath(): Promise<string> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		
		// 1단계: 정의된 workspace 폴더에서 검색
		if (workspaceFolders && workspaceFolders.length > 0) {
			for (const folder of workspaceFolders) {
				const buildAutolinuxPath = vscode.Uri.joinPath(folder.uri, 'build-autolinux');
				
				try {
					await vscode.workspace.fs.stat(buildAutolinuxPath);
					axonLog(`✅ build-autolinux 발견 (workspace folder): ${folder.name}`);
					return buildAutolinuxPath.path;
				} catch {
					continue;
				}
			}
			
			axonLog(`⚠️ Workspace 폴더에서 build-autolinux를 찾지 못함: ${workspaceFolders.map(f => f.name).join(', ')}`);
		}

		// 2단계: .code-workspace 파일 위치 기준 1-depth 검색
		const workspaceFile = vscode.workspace.workspaceFile;
		if (workspaceFile && workspaceFile.scheme === 'file') {
			axonLog('🔍 .code-workspace 파일 위치에서 1-depth 검색 시작...');
			const workspaceDir = vscode.Uri.joinPath(workspaceFile, '..');
			
			const result = await this.searchBuildAutolinuxInDirectory(workspaceDir);
			if (result) {
				return result;
			}
			
			axonLog(`⚠️ .code-workspace 위치에서도 build-autolinux를 찾지 못함: ${workspaceDir.path}`);
		}

		// 3단계: 못 찾았으면 에러
		throw new Error(
			'build-autolinux 디렉토리를 찾을 수 없습니다.\n\n' +
			'먼저 "Yocto Project (autolinux) 생성"을 실행하여 프로젝트를 생성하거나,\n' +
			'프로젝트 폴더를 Workspace에 추가하세요.\n\n' +
			(workspaceFolders ? `확인한 폴더: ${workspaceFolders.map(f => f.name).join(', ')}` : 'Workspace 폴더 없음')
		);
	}

	/**
	 * autolinux.config 파일 존재 확인
	 * Multi-root workspace 지원: 모든 폴더에서 autolinux.config를 찾음
	 */
	private static async checkAutolinuxConfig(): Promise<boolean> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return false;
		}

		// 모든 workspace 폴더를 순회하며 autolinux.config 파일 찾기
		for (const folder of workspaceFolders) {
			const configPath = vscode.Uri.joinPath(folder.uri, 'build-autolinux', 'autolinux.config');
			
			try {
				await vscode.workspace.fs.stat(configPath);
				// 찾았으면 true 반환
				return true;
			} catch {
				// 이 폴더에는 없음, 계속 탐색
				continue;
			}
		}

		// 모든 폴더를 확인했지만 찾지 못함
		return false;
	}

	/**
	 * autolinux -c update: 소스 동기화 (JSON 기반)
	 * - autolinux.commands.json의 'update' 그룹 실행
	 */
	static async updateSources(): Promise<void> {
		const { AutolinuxProjectBuilder } = await import('./autolinux-builder');
		await AutolinuxProjectBuilder.runAutolinuxJsonGroup('update');
	}

	/**
	 * autolinux -c clean [option]: 빌드 정리 (JSON 기반)
	 * - clean: 빌드 파일을 recycle 폴더로 이동
	 * - clean old: recycle 폴더 삭제
	 * - autolinux.commands.json의 해당 그룹 실행
	 */
	static async cleanBuild(): Promise<void> {
		try {
			axonLog('🧹 Autolinux Clean 시작...');

			// Clean 옵션 선택
			const option = await vscode.window.showQuickPick(
				[
					{
						label: 'clean',
						description: '빌드 파일을 recycle 폴더(build/delete)로 이동',
						detail: '현재 빌드 파일을 삭제하지 않고 이동합니다.'
					},
					{
						label: 'clean old',
						description: 'Recycle 폴더(build/delete) 삭제',
						detail: '이전에 이동한 빌드 파일들을 영구 삭제합니다.'
					}
				],
				{
					placeHolder: 'Clean 옵션을 선택하세요',
					title: 'Autolinux Clean'
				}
			);

			if (!option) {
				axonLog('❌ 사용자 취소: Clean이 취소되었습니다.');
				return;
			}

			// 선택한 옵션에 해당하는 JSON 그룹 실행
			const { AutolinuxProjectBuilder } = await import('./autolinux-builder');
			await AutolinuxProjectBuilder.runAutolinuxJsonGroup(option.label);

		} catch (error) {
			const errorMsg = `Clean 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * autolinux -c make_fai: FWDN용 FAI 파일 생성 (JSON 기반)
	 * - autolinux.commands.json의 'make_fai' 그룹 실행
	 */
	static async makeFai(): Promise<void> {
		const { AutolinuxProjectBuilder } = await import('./autolinux-builder');
		await AutolinuxProjectBuilder.runAutolinuxJsonGroup('make_fai');
	}

	/**
	 * autolinux -c info: 현재 설정 정보 표시 (JSON 기반)
	 * - autolinux.commands.json의 'info' 그룹 실행
	 */
	static async showInfo(): Promise<void> {
		const { AutolinuxProjectBuilder } = await import('./autolinux-builder');
		await AutolinuxProjectBuilder.runAutolinuxJsonGroup('info');
	}

	/**
	 * autolinux -c make_updatedir [option]: OTA 업데이트 디렉토리 생성
	 * bitbake {image} -f -c make_updatedir 실행
	 * 결과: build/{machine}/tmp/deploy/images/{machine}/update/
	 * 전제조건: meta-update Feature 활성화 필요
	 */
	static async makeUpdateDir(): Promise<void> {
		try {
			axonLog('📦 Autolinux Make Update Directory 시작...');

			// build-autolinux 경로 확인
			const buildAutolinuxPath = await this.getBuildAutolinuxPath();

			// autolinux.config 확인
			const hasConfig = await this.checkAutolinuxConfig();
			if (!hasConfig) {
				vscode.window.showErrorMessage(
					'autolinux.config 파일을 찾을 수 없습니다.\n\n' +
					'먼저 "configure"를 실행하여 프로젝트를 설정하세요.'
				);
				return;
			}

			// 옵션 선택 (main/sub/both)
			const option = await vscode.window.showQuickPick(
				[
					{
						label: 'Both (Main + Sub)',
						description: 'Main과 Sub 모두 생성',
						value: ''
					},
					{
						label: 'Main Only',
						description: 'Main core만 생성',
						value: 'main'
					},
					{
						label: 'Sub Only',
						description: 'Sub core만 생성',
						value: 'sub'
					}
				],
				{
					placeHolder: 'Update Directory 옵션을 선택하세요',
					title: 'Autolinux Make Update Directory'
				}
			);

			if (!option) {
				axonLog('❌ 사용자 취소: Make Update Directory가 취소되었습니다.');
				return;
			}

			// 확인 메시지
			const confirm = await vscode.window.showInformationMessage(
				'OTA 업데이트 디렉토리를 생성하시겠습니까?\n\n' +
				`옵션: ${option.label}\n` +
				'bitbake {image} -f -c make_updatedir 를 실행합니다.\n\n' +
				'⚠️ 주의: meta-update Feature가 활성화되어 있어야 합니다.',
				{ modal: true },
				'생성 시작',
				'취소'
			);

			if (confirm !== '생성 시작') {
				axonLog('❌ 사용자 취소: Make Update Directory가 취소되었습니다.');
				return;
			}

			// 선택한 옵션에 해당하는 JSON 그룹 실행
			const groupName = option.value ? `make_updatedir ${option.value}` : 'make_updatedir';
			const { AutolinuxProjectBuilder } = await import('./autolinux-builder');
			await AutolinuxProjectBuilder.runAutolinuxJsonGroup(groupName);

		} catch (error) {
			const errorMsg = `Update Directory 생성 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}
}

