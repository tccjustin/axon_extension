import * as vscode from 'vscode';
import { axonLog, axonSuccess, axonError } from '../../logger';
import { AutolinuxProjectCreator } from './autolinux-creator';
import { executeShellTask } from '../common/shell-utils';

/**
 * Autolinux 프로젝트 빌드 관리
 */
export class AutolinuxProjectBuilder {
	/**
	 * 디렉토리에서 autolinux.config 검색 (1-depth만, 재귀 없음)
	 * @param dir 검색할 디렉토리
	 * @returns { projectPath, configUri } 또는 null
	 */
	private static async searchAutolinuxConfigInDirectory(
		dir: vscode.Uri
	): Promise<{ projectPath: vscode.Uri; configUri: vscode.Uri } | null> {
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
					// build-autolinux/autolinux.config 확인
					const buildAutolinuxPath = vscode.Uri.joinPath(dir, name, 'build-autolinux');
					const configPath = vscode.Uri.joinPath(buildAutolinuxPath, 'autolinux.config');
					
					try {
						await vscode.workspace.fs.stat(configPath);
						axonLog(`✅ autolinux.config 발견 (1-depth 검색): ${configPath.path}`);
						return {
							projectPath: vscode.Uri.joinPath(dir, name),
							configUri: configPath
						};
					} catch {
						// 없으면 계속
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
	 * autolinux 빌드 실행 (QuickPick으로 이미지 선택)
	 */
	static async buildAutolinux(): Promise<void> {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			
			let projectPath: vscode.Uri | undefined;
			let configUri: vscode.Uri | undefined;

			// 1단계: 정의된 workspace 폴더에서 검색
			if (workspaceFolders && workspaceFolders.length > 0) {
				for (const folder of workspaceFolders) {
					const configPath = vscode.Uri.joinPath(folder.uri, 'build-autolinux', 'autolinux.config');
					
					try {
						await vscode.workspace.fs.stat(configPath);
						projectPath = folder.uri;
						configUri = configPath;
						axonLog(`✅ autolinux.config 발견 (workspace folder): ${folder.name}`);
						break;
					} catch {
						continue;
					}
				}
				
				if (!projectPath || !configUri) {
					axonLog(`⚠️ Workspace 폴더에서 autolinux.config를 찾지 못함: ${workspaceFolders.map(f => f.name).join(', ')}`);
				}
			}

			// 2단계: .code-workspace 파일 위치 기준 1-depth 검색
			if ((!projectPath || !configUri)) {
				const workspaceFile = vscode.workspace.workspaceFile;
				if (workspaceFile && workspaceFile.scheme === 'file') {
					axonLog('🔍 .code-workspace 파일 위치에서 1-depth 검색 시작...');
					const workspaceDir = vscode.Uri.joinPath(workspaceFile, '..');
					
					const result = await this.searchAutolinuxConfigInDirectory(workspaceDir);
					if (result) {
						projectPath = result.projectPath;
						configUri = result.configUri;
					} else {
						axonLog(`⚠️ .code-workspace 위치에서도 autolinux.config를 찾지 못함: ${workspaceDir.path}`);
					}
				}
			}
			
			// 3단계: 못 찾았으면 에러
			if (!projectPath || !configUri) {
				vscode.window.showErrorMessage(
					'autolinux.config 파일을 찾을 수 없습니다.\n\n' +
					'먼저 "Yocto Project (autolinux) 생성"을 실행하여 프로젝트를 생성하거나,\n' +
					'프로젝트 폴더를 Workspace에 추가하세요.\n\n' +
					(workspaceFolders ? `확인한 폴더: ${workspaceFolders.map(f => f.name).join(', ')}` : 'Workspace 폴더 없음')
				);
				return;
			}

			// autolinux.config 읽기
			const configContent = await vscode.workspace.fs.readFile(configUri);
			const configText = Buffer.from(configContent).toString('utf-8');
			
			// SDK와 Machine 추출
			const sdkMatch = configText.match(/^SDK=(.+)$/m);
			const machineMatch = configText.match(/^MACHINE=(.+)$/m);
			
			if (!sdkMatch || !machineMatch) {
				vscode.window.showErrorMessage('autolinux.config에서 SDK 또는 MACHINE을 찾을 수 없습니다.');
				return;
			}

			const sdk = sdkMatch[1].trim();
			const machine = machineMatch[1].trim();

			axonLog(`📋 SDK: ${sdk}, Machine: ${machine}`);

			// SDK 템플릿에서 이미지 목록 로드
			const { mainImages, subImages } = await AutolinuxProjectCreator.loadImages(projectPath, sdk, machine);

			// Machine이 sub인지 확인
			const isSub = machine.includes('-sub');
			const images = isSub ? subImages : mainImages;

			if (images.length === 0) {
				vscode.window.showErrorMessage('빌드 가능한 이미지가 없습니다.');
				return;
			}

			// QuickPick으로 이미지 선택
			const selectedImage = await vscode.window.showQuickPick(
				images.map(img => ({
					label: img.name,
					description: img.date,
					detail: isSub ? 'Sub Core Image' : 'Main Core Image'
				})),
				{
					placeHolder: 'Select an image to build',
					title: 'Autolinux Build'
				}
			);

			if (!selectedImage) {
				axonLog('빌드 취소됨');
				return;
			}

			axonLog(`🚀 빌드 시작: ${selectedImage.label}`);

			// 빌드 실행
			const buildPath = vscode.Uri.joinPath(projectPath, 'build-autolinux');
			const buildPathStr = buildPath.scheme === 'file' ? buildPath.fsPath : buildPath.path;

			await executeShellTask({
				command: `./autolinux -c build ${selectedImage.label}`,
				cwd: buildPathStr,
				taskName: `Autolinux Build: ${selectedImage.label}`,
				taskId: 'autolinuxBuild',
				showTerminal: true
			});

			axonSuccess(`✅ 빌드 명령어 실행 완료: ${selectedImage.label}`);

		} catch (error) {
			axonError(`❌ Autolinux 빌드 실패: ${error}`);
			vscode.window.showErrorMessage(`Autolinux 빌드 실패: ${error}`);
		}
	}

	/**
	 * commands.json 파일 1-depth 검색 (제외 폴더 스킵)
	 */
	private static async searchCommandsJsonInDirectory(
		dir: vscode.Uri, 
		fileName: string
	): Promise<vscode.Uri | null> {
		const excludeDirs = [
			'node_modules', '.git', 'build', 'tmp', 'downloads', 'sstate-cache',
			'.vscode', 'dist', 'out', '.next', 'target', 'bin', 'obj'
		];

		try {
			const entries = await vscode.workspace.fs.readDirectory(dir);
			
			for (const [name, type] of entries) {
				if (excludeDirs.includes(name)) {
					continue;
				}

				if (type === vscode.FileType.Directory) {
					if (name === 'vsebuildscript' || name === 'buildscript') {
						const jsonPath = vscode.Uri.joinPath(dir, name, fileName);
						try {
							await vscode.workspace.fs.stat(jsonPath);
							axonLog(`✅ ${fileName} 발견 (1-depth 검색): ${jsonPath.path}`);
							return jsonPath;
						} catch {
							// 파일 없으면 계속
						}
					}
				}
			}
		} catch (error) {
			axonLog(`⚠️ 디렉토리 읽기 실패 (무시): ${dir.path}`);
		}
		
		return null;
	}

	/**
	 * commands.json 파일 찾기 (통합 유틸리티)
	 */
	private static async findCommandsJsonFile(fileName: string): Promise<vscode.Uri | null> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		
		// 1단계: 정의된 workspace 폴더에서 검색
		if (workspaceFolders && workspaceFolders.length > 0) {
			for (const folder of workspaceFolders) {
				// vsebuildscript/xxx.commands.json 확인
				const vsebuildscriptPath = vscode.Uri.joinPath(folder.uri, 'vsebuildscript', fileName);
				try {
					await vscode.workspace.fs.stat(vsebuildscriptPath);
					axonLog(`✅ ${fileName} 발견 (workspace folder/vsebuildscript): ${folder.name}`);
					return vsebuildscriptPath;
				} catch {
					// 없으면 buildscript 확인
				}

				// buildscript/xxx.commands.json 확인
				const buildscriptPath = vscode.Uri.joinPath(folder.uri, 'buildscript', fileName);
				try {
					await vscode.workspace.fs.stat(buildscriptPath);
					axonLog(`✅ ${fileName} 발견 (workspace folder/buildscript): ${folder.name}`);
					return buildscriptPath;
				} catch {
					continue;
				}
			}
			
			axonLog(`⚠️ Workspace 폴더에서 ${fileName}을 찾지 못함: ${workspaceFolders.map(f => f.name).join(', ')}`);
		}

		// 2단계: .code-workspace 파일 위치 기준 1-depth 검색
		const workspaceFile = vscode.workspace.workspaceFile;
		if (workspaceFile && workspaceFile.scheme === 'file') {
			axonLog(`🔍 .code-workspace 파일 위치에서 ${fileName} 1-depth 검색 시작...`);
			const workspaceDir = vscode.Uri.joinPath(workspaceFile, '..');
			
			const result = await this.searchCommandsJsonInDirectory(workspaceDir, fileName);
			if (result) {
				return result;
			}
			
			axonLog(`⚠️ .code-workspace 위치에서도 ${fileName}을 찾지 못함: ${workspaceDir.path}`);
		}

		// 3단계: 못 찾았으면 null 반환
		return null;
	}

	/**
	 * buildscript/autolinux.commands.json의 group을 실행
	 * - Yocto와 동일한 패턴으로 JSON 기반 빌드 명령 실행
	 */
	static async runAutolinuxJsonGroup(groupName: string): Promise<void> {
		try {
			axonLog(`🎯 [Autolinux JSON] runAutolinuxJsonGroup 호출됨 - groupName: "${groupName}"`);

			// Autolinux 프로젝트 설정 찾기 (buildAutolinux와 동일한 로직)
			const workspaceFolders = vscode.workspace.workspaceFolders;
			let projectPath: vscode.Uri | undefined;
			let configUri: vscode.Uri | undefined;

			// 1단계: 정의된 workspace 폴더에서 검색
			if (workspaceFolders && workspaceFolders.length > 0) {
				for (const folder of workspaceFolders) {
					const configPath = vscode.Uri.joinPath(folder.uri, 'build-autolinux', 'autolinux.config');
					
					try {
						await vscode.workspace.fs.stat(configPath);
						projectPath = folder.uri;
						configUri = configPath;
						axonLog(`✅ autolinux.config 발견 (workspace folder): ${folder.name}`);
						break;
					} catch {
						continue;
					}
				}
			}

			// 2단계: .code-workspace 파일 위치 기준 1-depth 검색
			if (!projectPath || !configUri) {
				const workspaceFile = vscode.workspace.workspaceFile;
				if (workspaceFile && workspaceFile.scheme === 'file') {
					axonLog('🔍 .code-workspace 파일 위치에서 1-depth 검색 시작...');
					const workspaceDir = vscode.Uri.joinPath(workspaceFile, '..');
					
					const result = await this.searchAutolinuxConfigInDirectory(workspaceDir);
					if (result) {
						projectPath = result.projectPath;
						configUri = result.configUri;
					}
				}
			}

			// 3단계: 못 찾았으면 에러
			if (!projectPath || !configUri) {
				throw new Error('autolinux.config 파일을 찾을 수 없습니다. 먼저 프로젝트를 생성하세요.');
			}

			const projectPathStr = projectPath.scheme === 'file' ? projectPath.fsPath : projectPath.path;

			// JSON 파일 로드 (통합 검색 로직 사용)
			const jsonUri = await this.findCommandsJsonFile('autolinux.commands.json');
			
			if (!jsonUri) {
				throw new Error('autolinux.commands.json을 찾을 수 없습니다. vsebuildscript/ 또는 buildscript/ 폴더에 파일을 생성하세요.');
			}

			const jsonBytes = await vscode.workspace.fs.readFile(jsonUri);
			const spec = JSON.parse(Buffer.from(jsonBytes).toString('utf8'));
			const loadedFrom = jsonUri;

			const groups: Record<string, string[]> | undefined = spec?.groups;
			if (!groups || typeof groups !== 'object') {
				throw new Error('autolinux.commands.json에 groups가 없습니다.');
			}

			const commands = groups[groupName];
			if (!commands || !Array.isArray(commands)) {
				throw new Error(`autolinux.commands.json에 group이 없습니다: ${groupName}`);
			}

			// env 구성 (settings.json에서 autolinux 설정 읽기)
			const rawEnv: Record<string, any> = (spec?.env && typeof spec.env === 'object') ? spec.env : {};
			const env = await this.resolveEnv(rawEnv, projectPathStr);

			// commands 치환
			const resolvedCommands: string[] = commands.map(line => {
				if (typeof line !== 'string') return '';
				return this.interpolate(line, env);
			}).filter(Boolean);

			if (resolvedCommands.length === 0) {
				throw new Error(`실행할 commands가 비어있습니다: ${groupName}`);
			}

			const script = resolvedCommands.join('\n');

			axonLog(`🚀 [Autolinux JSON] 실행: ${groupName} (from ${loadedFrom.toString()})`);
			axonLog(`📋 [Autolinux JSON] 원본 commands (${commands.length}개):`);
			commands.forEach((cmd, i) => axonLog(`  [${i}] ${cmd}`));
			axonLog(`📋 [Autolinux JSON] 치환된 commands (${resolvedCommands.length}개):`);
			resolvedCommands.forEach((cmd, i) => axonLog(`  [${i}] ${cmd}`));
			
			// 사용자 확인 팝업
			const previewCommands = resolvedCommands.slice(0, 3).map(cmd => {
				return cmd.length > 80 ? cmd.substring(0, 77) + '...' : cmd;
			});
			const moreCount = resolvedCommands.length > 3 ? `\n... 외 ${resolvedCommands.length - 3}개 명령` : '';
			
			const confirmMsg = 
				`${groupName} 작업을 시작하시겠습니까?\n\n` +
				`실행할 명령: ${resolvedCommands.length}개\n` +
				`━━━━━━━━━━━━━━━━━━━━━━\n` +
				`${previewCommands.join('\n')}${moreCount}\n` +
				`━━━━━━━━━━━━━━━━━━━━━━\n\n` +
				`⚠️ 이 작업은 시간이 걸릴 수 있습니다.`;
			
			const confirm = await vscode.window.showWarningMessage(
				confirmMsg,
				{ modal: true },
				'시작',
				'취소'
			);
			
			if (confirm !== '시작') {
				axonLog('❌ 사용자 취소: 작업이 취소되었습니다.');
				vscode.window.showInformationMessage('작업이 취소되었습니다.');
				return;
			}
			
			// 명령 실행 시작 메시지
			const taskDisplayName = `Autolinux (JSON): ${groupName}`;
			vscode.window.showInformationMessage(`${taskDisplayName}가 시작되었습니다. 터미널을 확인하세요.`);
			
			await executeShellTask({
				command: script,
				cwd: projectPathStr,
				taskName: taskDisplayName,
				taskId: `autolinuxJson:${groupName}`,
				showTerminal: true,
				useScriptFile: true
			});
			
			axonLog('✅ executeShellTask 완료됨!');

			// Build View에 포커스 복원
			setTimeout(async () => {
				await vscode.commands.executeCommand('axonBuildView.focus');
				axonLog(`🔄 Build View에 포커스를 복원했습니다`);
			}, 100);
			
			// 완료 메시지 출력
			axonLog('📢 빌드 완료 메시지 출력 시작...');
			const successMsg = `✅ ${taskDisplayName}가 완료되었습니다!`;
			axonSuccess(successMsg);
			vscode.window.showInformationMessage(`${taskDisplayName}가 완료되었습니다!`);
			
			axonLog('🔔 터미널 닫기 팝업 표시 시작...');
			await this.askToCloseTerminal(taskDisplayName);
			axonLog('✅ 터미널 닫기 팝업 완료');
			
		} catch (error) {
			const errorMsg = `Autolinux JSON group 실행 중 오류: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * 작업 완료 후 터미널 닫기 확인 팝업
	 */
	private static async askToCloseTerminal(taskName: string): Promise<void> {
		const result = await vscode.window.showInformationMessage(
			`${taskName}가 완료되었습니다.\n터미널을 닫겠습니까?`,
			{ modal: true },
			'Yes',
			'No'
		);
		
		if (result === 'Yes') {
			const activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal) {
				axonLog(`✅ 사용자가 터미널 닫기를 선택했습니다. 터미널을 닫습니다.`);
				activeTerminal.dispose();
			} else {
				axonLog(`⚠️ 활성 터미널이 없습니다.`);
			}
		} else {
			axonLog(`ℹ️ 사용자가 터미널을 열어둡니다.`);
		}
	}

	private static async resolveEnv(
		rawEnv: Record<string, any>,
		projectRoot: string
	): Promise<Record<string, string>> {
		// string만 유지
		const env: Record<string, string> = {};
		Object.keys(rawEnv || {}).forEach(k => {
			const v = rawEnv[k];
			env[k] = typeof v === 'string' ? v : String(v ?? '');
		});

		// projectRoot 주입
		env.projectRoot = projectRoot;

		// 최대 N회 반복 치환 (env끼리 참조 가능)
		for (let i = 0; i < 6; i++) {
			let changed = false;
			for (const key of Object.keys(env)) {
				const before = env[key];
				const after = this.interpolate(before, env);
				if (after !== before) {
					env[key] = after;
					changed = true;
				}
			}
			if (!changed) break;
		}

		return env;
	}

	private static interpolate(
		input: string,
		env: Record<string, string>
	): string {
		return input.replace(/\$\{([^}]+)\}/g, (_m, exprRaw) => {
			const expr = String(exprRaw || '').trim();
			if (expr.startsWith('env:')) {
				const key = expr.slice('env:'.length).trim();
				return env[key] ?? '';
			}
			if (expr.startsWith('config:')) {
				const key = expr.slice('config:'.length).trim();
				const v = vscode.workspace.getConfiguration().get<any>(key);
				return v === undefined || v === null ? '' : String(v);
			}
			return '';
		});
	}
}

