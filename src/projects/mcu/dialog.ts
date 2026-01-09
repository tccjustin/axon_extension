import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { McuProjectCreator } from './creator';
import { axonLog } from '../../logger';

const fsp = fs.promises; // 비동기 파일 I/O

/**
 * MCU 프로젝트 생성 다이얼로그 (WebView UI)
 */
export class McuProjectDialog {
	private webview?: vscode.WebviewPanel;
	
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
	async showProjectCreationWebView(): Promise<void> {
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
		
		const gitUrl = config.get<string>('gitUrl') || 
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
			case 'browseFolder':
				await this.browseFolderForWebView(panel);
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
	 * 폴더 선택 다이얼로그
	 */
	private async browseFolderForWebView(panel: vscode.WebviewPanel): Promise<void> {
		const folders = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: '프로젝트 생성 위치 선택',
			title: '프로젝트를 생성할 폴더를 선택하세요'
		});

		if (folders && folders.length > 0) {
			const folderPath = folders[0].path; // Unix 경로 사용 (원격 환경 호환)
			panel.webview.postMessage({
				command: 'setFolderPath',
				path: folderPath // Unix 경로를 웹뷰로 전달
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
			
			// projectPath를 projectUri로 변환
			let projectUri: vscode.Uri;
			if (typeof data.projectPath === 'string') {
				if (data.projectPath.includes('://')) {
					projectUri = vscode.Uri.parse(data.projectPath);
				} else {
					projectUri = vscode.Uri.file(data.projectPath);
				}
			} else {
				projectUri = data.projectPath;
			}

			// Git clone 실행
			const gitUrl = data.gitUrl || 'ssh://git@bitbucket.telechips.com:7999/linux_yp4_0_cgw/mcu-tcn100x.git';
			const projectPath = projectUri.path;
			const parentPath = projectUri.path.substring(0, projectUri.path.lastIndexOf('/'));
			const cloneCommand = `git clone ${gitUrl} "${projectPath}"`;
			
			axonLog(`📦 Git Clone 실행: ${cloneCommand}`);
			axonLog(`📂 작업 디렉토리: ${parentPath}`);
			
			const { executeShellTask } = await import('../common/shell-utils');
			await executeShellTask({
				command: cloneCommand,
				cwd: parentPath,
				taskName: 'Clone MCU Project',
				taskId: 'cloneMcuProject',
				showTerminal: true
			});

			// Build Tools Path가 설정되어 있으면 심볼릭 링크 생성
			if (data.buildtool && data.buildtool.trim() !== '') {
				const buildtoolPath = data.buildtool.trim();
				const toolsPath = `${projectPath}/tools`;
				
				// buildtoolPath에서 폴더 이름 추출
				const buildtoolName = buildtoolPath.split('/').filter((p: string) => p).pop() || 'buildtools';
				const symlinkTarget = `${toolsPath}/${buildtoolName}`;
				
				axonLog(`🔗 Build Tools 심볼릭 링크 생성 중...`);
				axonLog(`📂 Build Tools 소스 경로: ${buildtoolPath}`);
				axonLog(`📂 대상 경로: ${symlinkTarget}`);
				axonLog(`📂 작업 디렉토리: ${projectPath}`);
				
				// tools 폴더를 만들고 그 안에 buildtool 폴더 자체를 심볼릭 링크로 생성
				const symlinkCommand = `mkdir -p "${toolsPath}" && ln -sf "${buildtoolPath}" "${symlinkTarget}"`;
				
				axonLog(`🔧 실행 명령: ${symlinkCommand}`);
				
				try {
					await executeShellTask({
						command: symlinkCommand,
						cwd: projectPath,
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
			axonLog(`📂 작업 디렉토리: ${projectPath}`);
			
			const buildSetupCommand = `make tcn100x_defconfig && make bootfw`;
			axonLog(`🔧 실행 명령: ${buildSetupCommand}`);
			
			try {
				await executeShellTask({
					command: buildSetupCommand,
					cwd: projectPath,
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

		axonLog(`✅ MCU 프로젝트 생성 완료`);
		
		// 성공 메시지
		panel.webview.postMessage({
			command: 'projectCreated',
			success: true
		});
		
		// 성공 알림
		vscode.window.showInformationMessage(`MCU 프로젝트가 생성되었습니다: ${data.projectName}`);
		
		// 생성된 프로젝트 폴더를 VS Code에서 열기
		await vscode.commands.executeCommand('vscode.openFolder', projectUri, { forceNewWindow: true });
		
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

