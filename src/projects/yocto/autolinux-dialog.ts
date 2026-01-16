import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AutolinuxProjectCreator } from './autolinux-creator';
import { axonLog, axonError } from '../../logger';
import type { ProjectTypeLeaf } from '../common/project-type-registry';

const fsp = fs.promises; // 비동기 파일 I/O

/**
 * Autolinux 프로젝트 생성 다이얼로그 (WebView UI)
 */
export class AutolinuxProjectDialog {
	private webview?: vscode.WebviewPanel;

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
			axonLog(`⚡ [Pre-loading] Autolinux Webview 에셋 선로딩 완료: ${preloadTime}ms`);
		} catch (error) {
			axonLog(`⚠️ [Pre-loading] Autolinux 에셋 로딩 실패: ${error}`);
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
			fsp.readFile(path.join(webviewPath, 'autolinux-dialog.html'), 'utf8'),
			fsp.readFile(path.join(webviewPath, 'autolinux-dialog.css'), 'utf8'),
			fsp.readFile(path.join(webviewPath, 'autolinux-dialog.js'), 'utf8'),
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
			'autolinuxProjectCreation',
			'Create Yocto Project (autolinux)',
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

		// Settings에서 Git URL 가져오기 및 WebView로 전송
		const config = vscode.workspace.getConfiguration('axon.yocto');
		const presetGitUrl = this.createLeaf?.createPreset?.autolinuxGitUrl;
		const autolinuxGitUrl = presetGitUrl || config.get<string>('autolinuxGitUrl') || 
		                        'ssh://bitbucket.telechips.com:7999/script/build-autolinux';
		
		// WebView 로드 완료 후 초기 데이터 전송
		// 약간의 지연을 두어 WebView가 완전히 로드되도록 함
		setTimeout(() => {
			panel.webview.postMessage({
				command: 'init',
				autolinuxGitUrl: autolinuxGitUrl
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
				axonLog('✅ [Webview] Autolinux 패널 닫힘');
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
			case 'loadAutolinux':
				await this.loadAutolinuxForWebView(message, panel);
				break;
			case 'browseSourceMirror':
				await this.browseSourceMirrorForWebView(panel);
				break;
			case 'browseBuildtool':
				await this.browseBuildtoolForWebView(panel);
				break;
			case 'refreshPlatformsAndSdks':
				await this.refreshPlatformsAndSdksForWebView(message, panel);
				break;
			case 'loadManifestsAndMachines':
				await this.loadManifestsAndMachinesForWebView(message, panel);
				break;
			case 'loadFeatures':
				await this.loadFeaturesForWebView(message, panel);
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
			// 1) 상위 폴더 선택
			const picked = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: '상위 폴더 선택',
				title: 'Autolinux 프로젝트를 생성할 상위 폴더를 선택하세요'
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
	 * Autolinux build script 클론 (Load 버튼)
	 */
	private async loadAutolinuxForWebView(message: any, panel: vscode.WebviewPanel): Promise<void> {
		try {
			const autolinuxGitUrl = message.autolinuxGitUrl;
			const projectPath = message.projectPath;
			const projectName = message.projectName;
			
			// 필수 값 확인
			if (!projectPath) {
				throw new Error('프로젝트 생성 위치를 먼저 선택해주세요.');
			}
			
			if (!projectName) {
				throw new Error('프로젝트 이름을 먼저 입력해주세요.');
			}
			
		// URI로 변환 (projectPath는 이미 전체 경로이므로 그대로 사용)
		// 원격 환경을 위해 현재 workspace의 scheme과 authority 사용
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		const projectUri = workspaceFolder
			? vscode.Uri.from({
				scheme: workspaceFolder.uri.scheme,
				authority: workspaceFolder.uri.authority,
				path: projectPath
			})
			: vscode.Uri.file(projectPath);
		
		axonLog(`🔄 Autolinux build script 클론 시작: ${autolinuxGitUrl}`);
		axonLog(`📂 프로젝트 경로: ${projectUri.path}`);
		axonLog(`📝 프로젝트 이름: ${projectName}`);
			await AutolinuxProjectCreator.cloneAutolinuxScript(autolinuxGitUrl, projectUri);
			
			// User Settings에서 저장된 경로 확인
			const config = vscode.workspace.getConfiguration('axon.yocto');
			const savedSourceMirror = config.inspect<string>('sourceMirror')?.globalValue || '';
			const savedBuildtool = config.inspect<string>('buildtool')?.globalValue || '';
			
			axonLog(`📋 저장된 Source Mirror: ${savedSourceMirror || '없음'}`);
			axonLog(`📋 저장된 Build Tool: ${savedBuildtool || '없음'}`);
			
			panel.webview.postMessage({
				command: 'autolinuxLoaded',
				savedSourceMirror: savedSourceMirror,
				savedBuildtool: savedBuildtool
			});
			
			axonLog(`✅ Autolinux build script 클론 완료`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			axonLog(`❌ Autolinux build script 클론 실패: ${errorMessage}`);
			
			panel.webview.postMessage({
				command: 'autolinuxLoadError',
				error: errorMessage
			});
		}
	}

	/**
	 * WebView에서 프로젝트 생성 요청 처리
	 */
	private async createProjectFromWebView(data: any, panel: vscode.WebviewPanel): Promise<void> {
		try {
		// projectPath를 projectUri로 변환 (웹뷰에서 전달된 경로)
		if (typeof data.projectPath === 'string') {
			// 원격 환경을 위해 현재 workspace의 scheme과 authority 사용
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (workspaceFolder) {
				data.projectUri = vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: data.projectPath
				});
			} else {
				// workspace가 없는 경우 (드물지만) file:// 사용
				data.projectUri = vscode.Uri.file(data.projectPath);
			}
			delete data.projectPath;
		}

			// 프로젝트 생성 (creator.ts에 위임)
			data.axonSettingsPatch = this.createLeaf?.settingsPatch;
			await AutolinuxProjectCreator.createAutolinuxProject(data);
			
			// 성공 메시지
			panel.webview.postMessage({
				command: 'projectCreated',
				success: true
			});
			// 잠시 후 패널 닫기
			setTimeout(() => panel.dispose(), 2000);
		} catch (error) {
			// 오류 메시지
			panel.webview.postMessage({
				command: 'projectCreated',
				success: false,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Platform과 SDK 목록 새로고침 (Refresh 버튼)
	 */
	private async refreshPlatformsAndSdksForWebView(message: any, panel: vscode.WebviewPanel): Promise<void> {
		try {
			const projectPath = message.projectPath;
			const projectName = message.projectName;
			
			// URI로 변환 (원격 환경 지원)
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			const projectUri = workspaceFolder
				? vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: projectPath // projectPath는 이미 전체 경로
				})
				: vscode.Uri.file(projectPath);
			
			axonLog(`🔄 Platform 및 SDK 목록 로드 중...`);
			axonLog(`📂 프로젝트 경로: ${projectUri.path}`);
			const platforms = await AutolinuxProjectCreator.loadPlatformsAndSdks(projectUri);
			
			panel.webview.postMessage({
				command: 'platformsAndSdksLoaded',
				platforms: platforms
			});
			
			axonLog(`✅ Platform 목록 로드 완료: ${Object.keys(platforms).length}개`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			axonLog(`❌ Platform 목록 로드 실패: ${errorMessage}`);
			
			panel.webview.postMessage({
				command: 'platformsAndSdksLoadError',
				error: errorMessage
			});
		}
	}

	/**
	 * Manifest와 Machine 목록 로드
	 */
	private async loadManifestsAndMachinesForWebView(message: any, panel: vscode.WebviewPanel): Promise<void> {
		try {
			const sdkTemplate = message.sdkTemplate;
			const projectPath = message.projectPath;
			const projectName = message.projectName;
			
			// URI로 변환 (원격 환경 지원)
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			const projectUri = workspaceFolder
				? vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: projectPath // projectPath는 이미 전체 경로
				})
				: vscode.Uri.file(projectPath);
			
			axonLog(`🔄 Manifest 및 Machine 목록 로드 중... (SDK: ${sdkTemplate})`);
			const data = await AutolinuxProjectCreator.loadManifestsAndMachines(projectUri, sdkTemplate);
			
			panel.webview.postMessage({
				command: 'manifestsAndMachinesLoaded',
				manifests: data.manifests,
				machines: data.machines
			});
			
			axonLog(`✅ Manifest 및 Machine 목록 로드 완료`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			axonLog(`❌ Manifest/Machine 로드 실패: ${errorMessage}`);
			
			// 에러는 무시하고 기본값 전송
			panel.webview.postMessage({
				command: 'manifestsAndMachinesLoaded',
				manifests: [],
				machines: []
			});
		}
	}

	/**
	 * Feature 목록 로드
	 */
	private async loadFeaturesForWebView(message: any, panel: vscode.WebviewPanel): Promise<void> {
		try {
			const sdkTemplate = message.sdkTemplate;
			const manifest = message.manifest;
			const machine = message.machine;
			const projectPath = message.projectPath;
			const projectName = message.projectName;
			
			// URI로 변환 (원격 환경 지원)
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			const projectUri = workspaceFolder
				? vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: projectPath // projectPath는 이미 전체 경로
				})
				: vscode.Uri.file(projectPath);
			
			axonLog(`🔄 Feature 목록 로드 중... (Machine: ${machine})`);
			const data = await AutolinuxProjectCreator.loadFeatures(projectUri, sdkTemplate, manifest, machine);
			
			panel.webview.postMessage({
				command: 'featuresLoaded',
				mainFeatures: data.mainFeatures,
				subFeatures: data.subFeatures
			});
			
			axonLog(`✅ Feature 목록 로드 완료`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			axonLog(`❌ Feature 로드 실패: ${errorMessage}`);
			
			panel.webview.postMessage({
				command: 'featuresLoadError',
				error: errorMessage
			});
		}
	}

	/**
	 * Source Mirror 폴더 선택
	 */
	private async browseSourceMirrorForWebView(panel: vscode.WebviewPanel): Promise<void> {
		try {
			// 현재 workspace의 URI를 기준으로 홈 디렉토리 설정
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			let defaultUri: vscode.Uri;
			
			if (workspaceFolder) {
				// 원격 환경인 경우 workspace의 scheme 사용
				const homeDir = process.env.HOME || '/home';
				defaultUri = vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: homeDir
				});
				axonLog(`📂 홈 디렉토리 URI: ${defaultUri.toString()}`);
			} else {
				// workspace가 없으면 로컬 홈 디렉토리
				const homeDir = process.env.HOME || process.env.USERPROFILE || '/home';
				defaultUri = vscode.Uri.file(homeDir);
			}
			
			const folders = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				defaultUri: defaultUri,
				openLabel: 'Select Source Mirror Folder',
				title: 'Source Mirror Path 선택'
			});

			if (folders && folders.length > 0) {
				// 원격 환경에서는 path 사용, 로컬에서는 fsPath 사용
				const folderPath = folders[0].scheme === 'file' ? folders[0].fsPath : folders[0].path;
				
				// User Settings에 저장 (원격 서버의 settings.json)
				const config = vscode.workspace.getConfiguration('axon.yocto');
				await config.update('sourceMirror', folderPath, vscode.ConfigurationTarget.Global);
				axonLog(`💾 Source Mirror 경로 저장: ${folderPath}`);
				
				panel.webview.postMessage({
					command: 'setSourceMirrorPath',
					path: folderPath
				});
				axonLog(`✅ Source Mirror 경로 선택: ${folderPath}`);
			}
		} catch (error) {
			axonError(`❌ Source Mirror 폴더 선택 실패: ${error}`);
		}
	}

	/**
	 * Build Tool 폴더 선택
	 */
	private async browseBuildtoolForWebView(panel: vscode.WebviewPanel): Promise<void> {
		try {
			// 현재 workspace의 URI를 기준으로 홈 디렉토리 설정
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			let defaultUri: vscode.Uri;
			
			if (workspaceFolder) {
				// 원격 환경인 경우 workspace의 scheme 사용
				const homeDir = process.env.HOME || '/home';
				defaultUri = vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: homeDir
				});
				axonLog(`📂 홈 디렉토리 URI: ${defaultUri.toString()}`);
			} else {
				// workspace가 없으면 로컬 홈 디렉토리
				const homeDir = process.env.HOME || process.env.USERPROFILE || '/home';
				defaultUri = vscode.Uri.file(homeDir);
			}
			
			const folders = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				defaultUri: defaultUri,
				openLabel: 'Select Build Tools Folder',
				title: 'Build Tools Path 선택'
			});

			if (folders && folders.length > 0) {
				// 원격 환경에서는 path 사용, 로컬에서는 fsPath 사용
				const folderPath = folders[0].scheme === 'file' ? folders[0].fsPath : folders[0].path;
				
				// User Settings에 저장 (원격 서버의 settings.json)
				const config = vscode.workspace.getConfiguration('axon.yocto');
				await config.update('buildtool', folderPath, vscode.ConfigurationTarget.Global);
				axonLog(`💾 Build Tools 경로 저장: ${folderPath}`);
				
				panel.webview.postMessage({
					command: 'setBuildtoolPath',
					path: folderPath
				});
				axonLog(`✅ Build Tools 경로 선택: ${folderPath}`);
			}
		} catch (error) {
			axonError(`❌ Build Tools 폴더 선택 실패: ${error}`);
		}
	}
}

