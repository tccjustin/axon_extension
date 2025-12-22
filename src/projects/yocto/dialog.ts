import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { YoctoProjectCreator } from './creator';
import { axonLog } from '../../logger';

const fsp = fs.promises; // 비동기 파일 I/O

/**
 * Yocto 프로젝트 생성 다이얼로그 (WebView UI)
 */
export class YoctoProjectDialog {
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
			axonLog(`⚡ [Pre-loading] Yocto Webview 에셋 선로딩 완료: ${preloadTime}ms`);
		} catch (error) {
			axonLog(`⚠️ [Pre-loading] Yocto 에셋 로딩 실패: ${error}`);
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
			fsp.readFile(path.join(webviewPath, 'yocto-dialog.html'), 'utf8'),
			fsp.readFile(path.join(webviewPath, 'yocto-dialog.css'), 'utf8'),
			fsp.readFile(path.join(webviewPath, 'yocto-dialog.js'), 'utf8'),
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
			'yoctoProjectCreation',
			'Create Yocto Project',
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

		// Settings에서 설정값 가져오기 및 WebView로 전송
		const config = vscode.workspace.getConfiguration('axon.yocto');
		const manifestGitUrl = config.get<string>('manifestGitUrl') || 
		                       'ssh://git@bitbucket.telechips.com:7999/manifest/manifest-cgw.git';
		const sourceMirrorPath = config.get<string>('sourceMirror', '');
		const buildtoolPath = config.get<string>('buildtool', '');
		
		// WebView 로드 완료 후 초기 데이터 전송
		setTimeout(() => {
			panel.webview.postMessage({
				command: 'init',
				manifestGitUrl: manifestGitUrl,
				sourceMirrorPath: sourceMirrorPath,
				buildtoolPath: buildtoolPath
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
				axonLog('✅ [Webview] Yocto 패널 닫힘');
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
			case 'browseSourceMirror':
				await this.browseSourceMirrorForWebView(panel);
				break;
			case 'browseBuildtool':
				await this.browseBuildtoolForWebView(panel);
				break;
			case 'loadManifests':
				await this.loadManifestsForWebView(message, panel);
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
			title: 'Yocto 프로젝트를 생성할 폴더를 선택하세요'
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
	 * Source Mirror 폴더 선택 다이얼로그
	 */
	private async browseSourceMirrorForWebView(panel: vscode.WebviewPanel): Promise<void> {
		const folders = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Source Mirror 경로 선택',
			title: 'Source Mirror 폴더를 선택하세요'
		});

		if (folders && folders.length > 0) {
			const folderPath = folders[0].path; // Unix 경로 형식
			
			// settings.json에 저장 (machine scope)
			const config = vscode.workspace.getConfiguration('axon.yocto');
			await config.update('sourceMirror', folderPath, vscode.ConfigurationTarget.Global);
			
			panel.webview.postMessage({
				command: 'setSourceMirrorPath',
				path: folderPath
			});
			
			axonLog(`✅ Source Mirror 경로 저장: ${folderPath}`);
		}
	}

	/**
	 * Buildtool 폴더 선택 다이얼로그
	 */
	private async browseBuildtoolForWebView(panel: vscode.WebviewPanel): Promise<void> {
		const folders = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Buildtool 경로 선택',
			title: 'Buildtool 폴더를 선택하세요'
		});

		if (folders && folders.length > 0) {
			const folderPath = folders[0].path; // Unix 경로 형식
			
			// settings.json에 저장 (machine scope)
			const config = vscode.workspace.getConfiguration('axon.yocto');
			await config.update('buildtool', folderPath, vscode.ConfigurationTarget.Global);
			
			panel.webview.postMessage({
				command: 'setBuildtoolPath',
				path: folderPath
			});
			
			axonLog(`✅ Buildtool 경로 저장: ${folderPath}`);
		}
	}

	/**
	 * Manifest 목록 로드
	 */
	private async loadManifestsForWebView(message: any, panel: vscode.WebviewPanel): Promise<void> {
		try {
			const manifestGitUrl = message.manifestGitUrl;
			const projectPath = message.projectPath;
			const projectName = message.projectName;
			
			// 필수 값 확인
			if (!projectPath) {
				throw new Error('프로젝트 생성 위치를 먼저 선택해주세요.');
			}
			
			if (!projectName) {
				throw new Error('프로젝트 이름을 먼저 입력해주세요.');
			}
			
			// 원격 환경을 고려한 URI 생성
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			let targetUri: vscode.Uri;
			
			if (workspaceFolder) {
				// 워크스페이스가 있으면 그 scheme과 authority 사용
				targetUri = vscode.Uri.from({
					scheme: workspaceFolder.uri.scheme,
					authority: workspaceFolder.uri.authority,
					path: projectPath
				});
			} else {
				// 워크스페이스가 없으면 기본 처리
				targetUri = projectPath.includes('://') 
					? vscode.Uri.parse(projectPath)
					: vscode.Uri.file(projectPath);
			}
			
			// 프로젝트 폴더 URI 생성
			const projectUri = vscode.Uri.joinPath(targetUri, projectName);
			
			axonLog(`📋 Manifest 목록 로드 시작: ${manifestGitUrl}`);
			axonLog(`📂 프로젝트 경로: ${projectUri.path}`);
			const manifests = await YoctoProjectCreator.fetchManifestList(manifestGitUrl, projectUri);
			
			panel.webview.postMessage({
				command: 'manifestListLoaded',
				manifests: manifests
			});
			
			axonLog(`✅ Manifest 목록 로드 완료: ${manifests.length}개`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			axonLog(`❌ Manifest 목록 로드 실패: ${errorMessage}`);
			
			panel.webview.postMessage({
				command: 'manifestLoadError',
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
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				
				// 원격 환경을 고려한 URI 생성
				if (workspaceFolder) {
					data.projectUri = vscode.Uri.from({
						scheme: workspaceFolder.uri.scheme,
						authority: workspaceFolder.uri.authority,
						path: data.projectPath
					});
				} else {
					// Workspace가 없으면 기본 처리
					if (data.projectPath.includes('://')) {
						data.projectUri = vscode.Uri.parse(data.projectPath);
					} else {
						data.projectUri = vscode.Uri.file(data.projectPath);
					}
				}
				delete data.projectPath;
			}

			// 프로젝트 생성 (creator.ts에 위임)
			await YoctoProjectCreator.createYoctoProject(data);
			
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
}




