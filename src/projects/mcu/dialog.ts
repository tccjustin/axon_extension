import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { McuProjectCreator } from './creator';
import { axonLog } from '../../logger';
import type { ProjectTypeLeaf } from '../common/project-type-registry';

const fsp = fs.promises; // 비동기 파일 I/O

/**
 * MCU 프로젝트 생성 다이얼로그 (WebView UI)
 */
export class McuProjectDialog {
	private webview?: vscode.WebviewPanel;

	// Create Project에서 선택된 leaf (projectType/gitUrl 프리셋 등)
	private createLeaf?: ProjectTypeLeaf;
	private createBreadcrumb?: string;
	
	// 캐싱: 원본 파일 (템플릿) 및 최종 HTML
	private rawHtml?: string;
	private rawCss?: string;
	private rawJs?: string;

	constructor(private context: vscode.ExtensionContext) {
		// 비동기 선로딩: Extension 활성화 시 파일을 미리 메모리에 로드
		this.preloadAssets();
	}

	/**
	 * nonce 생성 (CSP용)
	 */
	private createNonce(): string {
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let text = '';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}

	/**
	 * 비동기 선로딩: Extension 활성화 시 백그라운드에서 파일 로드
	 */
	private async preloadAssets(): Promise<void> {
		try {
			const preloadStart = Date.now();
			await this.loadRawAssets();
			const preloadTime = Date.now() - preloadStart;
			axonLog(`⚡ [Pre-loading] Webview 에셋 선로딩 완료: ${preloadTime}ms`);
		} catch (error) {
			axonLog(`⚠️ [Pre-loading] 에셋 로딩 실패: ${error}`);
		}
	}

	/**
	 * 비동기 파일 로딩 + 캐싱 (블로킹 없음)
	 */
	private async loadRawAssets(): Promise<void> {
		// 이미 로드되었으면 스킵
		if (this.rawHtml && this.rawCss && this.rawJs) {
			return;
		}

		const webviewPath = path.join(this.context.extensionPath, 'out', 'webview');
		
		// 병렬 로딩 (빠름!)
		const [html, css, js] = await Promise.all([
			fsp.readFile(path.join(webviewPath, 'mcu-dialog.html'), 'utf8'),
			fsp.readFile(path.join(webviewPath, 'mcu-dialog.css'), 'utf8'),
			fsp.readFile(path.join(webviewPath, 'mcu-dialog.js'), 'utf8'),
		]);

		this.rawHtml = html;
		this.rawCss = css;
		this.rawJs = js;
	}


	/**
	 * CSP + nonce + 템플릿 플레이스홀더로 최종 HTML 생성 (비동기)
	 */
	private async buildWebviewHtml(webview: vscode.Webview): Promise<string> {
		// 에셋 로딩 대기 (선로딩이 안 끝났을 경우)
		await this.loadRawAssets();

		const nonce = this.createNonce();
		
		// 보안 CSP 정책
		const csp = [
			`default-src 'none';`,
			`img-src ${webview.cspSource} https: data:;`,
			`style-src ${webview.cspSource} 'nonce-${nonce}';`,
			`script-src ${webview.cspSource} 'nonce-${nonce}';`,
			`font-src ${webview.cspSource} https: data:;`,
		].join(' ');

		// 템플릿 플레이스홀더 치환 (안전한 방식)
		let html = this.rawHtml!;
		html = html.replace('<!--CSP-->',
			`<meta http-equiv="Content-Security-Policy" content="${csp}">`
		);
		html = html.replace('<!--CSS_INLINE-->',
			`<style nonce="${nonce}">${this.rawCss}</style>`
		);
		html = html.replace('<!--JS_INLINE-->',
			`<script nonce="${nonce}">${this.rawJs}</script>`
		);

		return html;
	}

	/**
	 * 프로젝트 생성 WebView 표시
	 */
	async showProjectCreationWebView(leaf?: ProjectTypeLeaf, breadcrumb?: string): Promise<void> {
		this.createLeaf = leaf;
		this.createBreadcrumb = breadcrumb;

		// 이미 열린 패널이 있으면 재사용
		if (this.webview) {
			this.webview.reveal(vscode.ViewColumn.One);
			return;
		}

		// Webview 패널 생성
		const panel = vscode.window.createWebviewPanel(
			'mcuProjectCreation',
			'Create MCU Standalone Project',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				// 로컬 리소스 루트 (필요 시 외부 파일 참조 가능)
				localResourceRoots: [
					vscode.Uri.file(path.join(this.context.extensionPath, 'out', 'webview'))
				]
			}
		);

		this.webview = panel;

		// HTML 내용 설정
		panel.webview.html = await this.buildWebviewHtml(panel.webview);

		// Settings에서 MCU Git URL 및 Build Tools Path 가져오기
		const config = vscode.workspace.getConfiguration('axon.mcu');
		
		axonLog(`🔍 [MCU Settings Debug] Reading configuration...`);
		axonLog(`🔍 [MCU Settings Debug] Configuration object: ${JSON.stringify(config)}`);
		
		const presetGitUrl = this.createLeaf?.createPreset?.mcuGitUrl;
		const gitUrl = presetGitUrl || config.get<string>('gitUrl') || 
		               'ssh://git@bitbucket.telechips.com:7999/linux_yp4_0_cgw/mcu-tcn100x.git';
		const buildtool = config.get<string>('buildtool') || '';
		
		axonLog(`📡 [MCU Settings] Git URL from settings: ${gitUrl}`);
		axonLog(`📡 [MCU Settings] Build Tools from settings: "${buildtool}" (length: ${buildtool.length})`);
		axonLog(`📡 [MCU Settings] Build Tools is empty: ${buildtool === ''}`);
		axonLog(`📡 [MCU Settings] Build Tools type: ${typeof buildtool}`);
		
		// 모든 설정 키 확인
		const allSettings = config.inspect('buildtool');
		axonLog(`🔍 [MCU Settings Debug] buildtool inspect: ${JSON.stringify(allSettings, null, 2)}`);
		
		// WebView 로드 완료 후 초기 데이터 전송
		setTimeout(() => {
			axonLog(`📤 [MCU WebView] Sending init message...`);
			axonLog(`📤 [MCU WebView] - gitUrl: ${gitUrl}`);
			axonLog(`📤 [MCU WebView] - buildtoolPath: "${buildtool}"`);
			
			panel.webview.postMessage({
				command: 'init',
				gitUrl: gitUrl,
				buildtoolPath: buildtool
			});
		}, 100);

		// 메시지 리스너 설정
		const disposable = panel.webview.onDidReceiveMessage(
			async (message) => {
				await this.handleWebViewMessage(message, panel);
			},
			undefined,
			this.context.subscriptions
		);

		// 패널이 닫힐 때 정리
		panel.onDidDispose(
			() => {
				disposable.dispose();
				this.webview = undefined;
				axonLog('✅ [Webview] 패널 닫힘');
			},
			undefined,
			this.context.subscriptions
		);
	}

	/**
	 * WebView 메시지 핸들러
	 */
	private async handleWebViewMessage(message: any, panel: vscode.WebviewPanel): Promise<void> {
		switch (message.command) {
			case 'createFolder':
				await this.createFolderForWebView(panel);
				break;
			case 'browseBuildtool':
				await this.browseBuildtoolForWebView(panel);
				break;
			case 'createProject':
				await this.createProjectFromWebView(message.data, panel);
				break;
			case 'cancel':
				panel.dispose();
				break;
		}
	}

	/**
	 * 프로젝트 폴더 생성 (WebView에서 입력한 경로 기준)
	 */
	private async createFolderForWebView(panel: vscode.WebviewPanel): Promise<void> {
		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			// 1) 상위 폴더 선택
			const picked = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: '상위 폴더 선택',
				title: '프로젝트를 생성할 상위 폴더를 선택하세요'
			});
			if (!picked || picked.length === 0) {
				panel.webview.postMessage({ command: 'folderCreated', success: false, cancelled: true });
				return;
			}

			const parentUri = picked[0];

			// 2) 새 폴더명 입력
			const folderName = await vscode.window.showInputBox({
				title: '프로젝트 폴더 이름',
				prompt: '생성할 프로젝트 폴더 이름을 입력하세요',
				ignoreFocusOut: true,
				validateInput: (v) => {
					const name = (v || '').trim();
					if (!name) return '폴더 이름을 입력하세요.';
					if (name.includes('/') || name.includes('\\')) return '폴더 이름에는 / 또는 \\ 를 사용할 수 없습니다.';
					return null;
				}
			});
			if (!folderName) {
				panel.webview.postMessage({ command: 'folderCreated', success: false, cancelled: true });
				return;
			}

			const folderUri = vscode.Uri.joinPath(parentUri, folderName.trim());

			await vscode.workspace.fs.createDirectory(folderUri);

			panel.webview.postMessage({
				command: 'folderCreated',
				success: true,
				path: folderUri.path
			});
		} catch (error) {
			panel.webview.postMessage({
				command: 'folderCreated',
				success: false,
				cancelled: false,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Build Tools 폴더 선택 다이얼로그
	 */
	private async browseBuildtoolForWebView(panel: vscode.WebviewPanel): Promise<void> {
		try {
			const folders = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: 'Build Tools 경로 선택',
				title: 'Build Tools 폴더를 선택하세요'
			});

			if (folders && folders.length > 0) {
				const folderPath = folders[0].path; // Unix 경로 사용
				
				// 원격 환경의 User Settings에 저장
				const config = vscode.workspace.getConfiguration('axon.mcu');
				
				// 원격 환경인지 확인
				const isRemote = vscode.env.remoteName !== undefined;
				axonLog(`🔍 [MCU Settings] 환경: ${isRemote ? '원격 (' + vscode.env.remoteName + ')' : '로컬'}`);
				
				// 원격 환경이면 Global, 로컬이면 Workspace에 저장
				const target = isRemote ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
				await config.update('buildtool', folderPath, target);
				axonLog(`💾 [MCU Settings] Build Tools 경로 저장 (${isRemote ? 'Remote User' : 'Workspace'}): ${folderPath}`);
				
				panel.webview.postMessage({
					command: 'setBuildtoolPath',
					path: folderPath
				});
				axonLog(`✅ Build Tools 경로 선택: ${folderPath}`);
			}
		} catch (error) {
			axonLog(`❌ Build Tools 폴더 선택 실패: ${error}`);
		}
	}

	/**
	 * WebView에서 프로젝트 생성 요청 처리 (Git clone 수행)
	 */
	private async createProjectFromWebView(data: any, panel: vscode.WebviewPanel): Promise<void> {
		try {
			axonLog(`🔄 MCU 프로젝트 생성 시작: ${data.projectName}`);
			
		// projectPath를 projectUri로 변환 (원격 환경 지원)
		let projectUri: vscode.Uri;
		if (typeof data.projectPath === 'string') {
			if (data.projectPath.includes('://')) {
				// 이미 URI 형식
				projectUri = vscode.Uri.parse(data.projectPath);
			} else {
				// 일반 경로 → 현재 워크스페이스의 scheme/authority 사용
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (workspaceFolder) {
					projectUri = vscode.Uri.from({
						scheme: workspaceFolder.uri.scheme,
						authority: workspaceFolder.uri.authority,
						path: data.projectPath
					});
					axonLog(`🌐 원격 환경 감지: scheme=${workspaceFolder.uri.scheme}, authority=${workspaceFolder.uri.authority}`);
				} else {
					// 워크스페이스가 없으면 로컬로 fallback
					projectUri = vscode.Uri.file(data.projectPath);
				}
			}
		} else {
			projectUri = data.projectPath;
		}

		// 1. 사용자가 입력한 프로젝트 폴더 생성
		axonLog(`📂 프로젝트 폴더 생성: ${projectUri.toString()}`);
		try {
			// 이미 존재하면 허용 (사용자가 Create Folder 버튼으로 미리 생성했을 수 있음)
			try {
				const stat = await vscode.workspace.fs.stat(projectUri);
				if (stat.type !== vscode.FileType.Directory) {
					throw new Error(`프로젝트 경로가 디렉토리가 아닙니다: ${projectUri.toString()}`);
				}
				axonLog(`✅ 프로젝트 폴더가 이미 존재합니다. 그대로 진행합니다.`);
			} catch {
				await vscode.workspace.fs.createDirectory(projectUri);
				axonLog(`✅ 프로젝트 폴더 생성 완료`);
			}
		} catch (error) {
			throw new Error(`프로젝트 폴더 생성 실패: ${error}`);
		}

		// 2. Git clone 실행 (생성된 폴더 안에서)
		const config = vscode.workspace.getConfiguration('axon.mcu');
		const presetGitUrl = this.createLeaf?.createPreset?.mcuGitUrl;
		const presetGitBranch = this.createLeaf?.createPreset?.mcuGitBranch;

		const effectiveGitUrl =
			(data.gitUrl && String(data.gitUrl).trim() !== '' ? String(data.gitUrl).trim() : '') ||
			presetGitUrl ||
			config.get<string>('gitUrl') ||
			'ssh://git@bitbucket.telechips.com:7999/linux_yp4_0_cgw/mcu-tcn100x.git';

		// WebView는 기본으로 gitUrl을 항상 보내므로, "사용자가 수정했는지"를 판단하려면 preset과 비교해야 함
		const dataGitUrlTrimmed = (data.gitUrl && String(data.gitUrl).trim() !== '') ? String(data.gitUrl).trim() : '';
		const shouldUsePresetBranch = !!presetGitBranch && (!dataGitUrlTrimmed || (presetGitUrl && dataGitUrlTrimmed === presetGitUrl));

		const projectPath = projectUri.path;
		const cloneCommand = shouldUsePresetBranch
			? `git clone -b "${presetGitBranch}" "${effectiveGitUrl}"`
			: `git clone "${effectiveGitUrl}"`;
		
		// git clone으로 생성될 실제 폴더 이름 (repository 이름)
		const urlToken = effectiveGitUrl.trim().split(/\s+/)[0]; // 혹시 사용자가 공백/옵션을 넣어도 repoName 파싱은 보호
		const repoName = urlToken.split('/').filter((p: string) => p).pop()?.replace('.git', '') || 'mcu-tcn100x';
		const actualProjectPath = `${projectPath}/${repoName}`;
		
		axonLog(`📦 Git Clone 실행: ${cloneCommand}`);
		axonLog(`📂 작업 디렉토리: ${projectPath}`);
		axonLog(`📁 생성될 repository 폴더: ${repoName}`);
			
		const { executeShellTask } = await import('../common/shell-utils');
		await executeShellTask({
			command: cloneCommand,
			cwd: projectPath,
			taskName: 'Clone MCU Project',
			taskId: 'cloneMcuProject',
			showTerminal: true
		});

		// 2-1. (Release 전용) boot-firmware 저장소 추가 clone
		// 요구사항: MCU git clone 직후, 생성된 git 디렉토리(=actualProjectPath)로 이동한 후
		// `git clone -b mcuGitBranch bootfirmwareGitUrl "boot-firmware-tcn100x"` 수행
		const bootfirmwareGitUrl = this.createLeaf?.createPreset?.bootfirmwareGitUrl;
		if (bootfirmwareGitUrl && bootfirmwareGitUrl.trim() !== '') {
			if (!presetGitBranch || presetGitBranch.trim() === '') {
				throw new Error(
					'boot-firmware clone을 위해 preset mcuGitBranch가 필요하지만 설정되어 있지 않습니다.\n\n' +
					`projectType: ${(this.createLeaf?.settingsPatch?.['axon.projectType'] as string) || '(unknown)'}`
				);
			}

			const bootfwFolderName = 'boot-firmware-tcn100x';
			const bootfwCloneCommand =
				`test -d "${bootfwFolderName}" ` +
				`&& echo "[SKIP] ${bootfwFolderName} already exists" ` +
				`|| git clone -b "${presetGitBranch}" "${bootfirmwareGitUrl.trim()}" "${bootfwFolderName}"`;

			axonLog(`📦 Boot Firmware Git Clone 실행: ${bootfwCloneCommand}`);
			axonLog(`📂 작업 디렉토리(생성된 git directory): ${actualProjectPath}`);

			await executeShellTask({
				command: bootfwCloneCommand,
				cwd: actualProjectPath,
				taskName: 'Clone Boot Firmware (boot-firmware-tcn100x)',
				taskId: 'cloneBootFirmware',
				showTerminal: true
			});
		}

		// Build Tools Path가 설정되어 있으면 심볼릭 링크 생성
		if (data.buildtool && data.buildtool.trim() !== '') {
			const buildtoolPath = data.buildtool.trim();
			const toolsPath = `${actualProjectPath}/tools`;
			
			// buildtoolPath에서 폴더 이름 추출
			const buildtoolName = buildtoolPath.split('/').filter((p: string) => p).pop() || 'buildtools';
			const symlinkTarget = `${toolsPath}/${buildtoolName}`;
			
			axonLog(`🔗 Build Tools 심볼릭 링크 생성 중...`);
			axonLog(`📂 Build Tools 소스 경로: ${buildtoolPath}`);
			axonLog(`📂 대상 경로: ${symlinkTarget}`);
			axonLog(`📂 작업 디렉토리: ${actualProjectPath}`);
			
			// tools 폴더를 만들고 그 안에 buildtool 폴더 자체를 심볼릭 링크로 생성
			const symlinkCommand = `mkdir -p "${toolsPath}" && ln -sf "${buildtoolPath}" "${symlinkTarget}"`;
			
			axonLog(`🔧 실행 명령: ${symlinkCommand}`);
			
			try {
				await executeShellTask({
					command: symlinkCommand,
					cwd: actualProjectPath,
					taskName: 'Create Build Tools Symlink',
					taskId: 'createBuildToolsSymlink',
					showTerminal: true
				});
				axonLog(`✅ Build Tools 심볼릭 링크 생성 완료`);
			} catch (linkError) {
				axonLog(`⚠️ Build Tools 심볼릭 링크 생성 실패: ${linkError}`);
				vscode.window.showWarningMessage(`Build Tools 심볼릭 링크 생성 실패: ${linkError}`);
				// 심볼릭 링크 실패는 치명적이지 않으므로 계속 진행
			}
		} else {
			axonLog(`ℹ️ Build Tools Path가 설정되지 않아 심볼릭 링크를 생성하지 않습니다.`);
		}

		// MCU 빌드 설정 실행 (make tcn100x_defconfig && make bootfw)
		axonLog(`🔧 MCU 빌드 설정 시작...`);
		axonLog(`📂 작업 디렉토리: ${actualProjectPath}`);
		
		const buildSetupCommand = `make tcn100x_defconfig && make bootfw`;
		axonLog(`🔧 실행 명령: ${buildSetupCommand}`);
		
		try {
			await executeShellTask({
				command: buildSetupCommand,
				cwd: actualProjectPath,
				taskName: 'MCU Build Setup',
				taskId: 'mcuBuildSetup',
				showTerminal: true
			});
			axonLog(`✅ MCU 빌드 설정 완료`);
		} catch (buildError) {
			axonLog(`⚠️ MCU 빌드 설정 실패: ${buildError}`);
			vscode.window.showWarningMessage(`MCU 빌드 설정 실패: ${buildError}`);
			// 빌드 설정 실패는 치명적이지 않으므로 계속 진행
		}

			// 실제 생성된 프로젝트 폴더의 URI 생성
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			const actualProjectUri = workspaceFolder ? vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: actualProjectPath
			}) : vscode.Uri.file(actualProjectPath);
			
			axonLog(`📁 사용자 입력 폴더: ${projectPath}`);
			axonLog(`📁 실제 프로젝트 경로: ${actualProjectPath}`);

			// .vscode/settings.json 생성
			axonLog(`⚙️ 프로젝트 설정 파일을 생성합니다: .vscode/settings.json`);
			const { createVscodeSettings } = await import('../common/vscode-utils');
			await createVscodeSettings(actualProjectUri, {
				'axon.projectType': (this.createLeaf?.settingsPatch?.['axon.projectType'] as string) || 'mcu_project-dev',
				'axon.mcu.projectRoot': actualProjectPath
			});
			axonLog(`✅ 프로젝트 설정 파일이 생성되었습니다.`);

		axonLog(`✅ MCU 프로젝트 생성 완료`);
		
		// 성공 메시지
		panel.webview.postMessage({
			command: 'projectCreated',
			success: true
		});
		
		// 성공 알림
		vscode.window.showInformationMessage(`MCU 프로젝트가 생성되었습니다: ${data.projectName}`);
		
		// 생성된 프로젝트 폴더를 VS Code에서 열기
		await vscode.commands.executeCommand('vscode.openFolder', actualProjectUri, { forceNewWindow: true });
		
		// 잠시 후 패널 닫기
		setTimeout(() => panel.dispose(), 1000);
		} catch (error) {
			axonLog(`❌ MCU 프로젝트 생성 실패: ${error}`);
			
			// 오류 메시지
			panel.webview.postMessage({
				command: 'projectCreated',
				success: false,
				error: error instanceof Error ? error.message : String(error)
			});
			
			vscode.window.showErrorMessage(`MCU 프로젝트 생성 실패: ${error}`);
		}
	}
}

