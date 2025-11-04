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
	private commandStartTime?: number; // 커맨드 시작 시간
	
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
	 * 프로젝트 생성 WebView 표시 (최적화: 비동기 로딩 + CSP + 패널 재사용)
	 */
	async showProjectCreationWebView(commandStartTime?: number): Promise<void> {
		this.commandStartTime = commandStartTime;
		
		if (this.commandStartTime) {
			const webviewStartElapsed = Date.now() - this.commandStartTime;
			axonLog(`⏱️ [성능 측정] Webview 생성 시작: ${webviewStartElapsed}ms (커맨드부터)`);
		}
		
		// 이미 열린 패널이 있으면 재사용
		if (this.webview) {
			this.webview.reveal(vscode.ViewColumn.One);
			if (this.commandStartTime) {
				const webviewReuseElapsed = Date.now() - this.commandStartTime;
				axonLog(`⚡ [성능 측정] Webview 패널 재사용: ${webviewReuseElapsed}ms (커맨드부터)`);
			}
			return;
		}

		// Webview 패널 생성
		const panelCreateStart = Date.now();
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
		
		const panelCreateTime = Date.now() - panelCreateStart;
		axonLog(`⏱️ [성능 측정] Webview 패널 생성 완료: ${panelCreateTime}ms`);

		this.webview = panel;

		// HTML 내용 설정 (비동기, 블로킹 없음)
		const htmlLoadStart = Date.now();
		panel.webview.html = await this.buildWebviewHtml(panel.webview);
		const htmlLoadTime = Date.now() - htmlLoadStart;
		axonLog(`⏱️ [성능 측정] Webview HTML 빌드 완료: ${htmlLoadTime}ms`);
		
		if (this.commandStartTime) {
			const totalWebviewElapsed = Date.now() - this.commandStartTime;
			axonLog(`⏱️ [성능 측정] Webview 표시 완료: ${totalWebviewElapsed}ms (커맨드부터)`);
		}

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
			case 'performanceMetric':
				this.handlePerformanceMetric(message.metric, message.time);
				break;
			case 'browseFolder':
				await this.browseFolderForWebView(panel);
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
	 * Webview 성능 측정 메트릭 처리
	 */
	private handlePerformanceMetric(metric: string, time: number): void {
		if (this.commandStartTime) {
			const fromCommand = Date.now() - this.commandStartTime;
			axonLog(`⏱️ [성능 측정] Webview ${metric}: ${time.toFixed(2)}ms (Webview 내부) / ${fromCommand}ms (커맨드부터)`);
		} else {
			axonLog(`⏱️ [성능 측정] Webview ${metric}: ${time.toFixed(2)}ms (Webview 내부)`);
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
			const folderUriString = folders[0].toString(); // fsPath 대신 toString() 사용
			panel.webview.postMessage({
				command: 'setFolderPath',
				path: folderUriString // URI 문자열을 웹뷰로 전달
			});
		}
	}

	/**
	 * WebView에서 프로젝트 생성 요청 처리
	 */
	private async createProjectFromWebView(data: any, panel: vscode.WebviewPanel): Promise<void> {
		try {
			if (this.commandStartTime) {
				const userInputElapsed = Date.now() - this.commandStartTime;
				axonLog(`⏱️ [성능 측정] 사용자 입력 완료 및 프로젝트 생성 시작: ${userInputElapsed}ms (커맨드부터)`);
			}
			
			// projectPath가 string이면 URI로 변환 (웹뷰에서 전달된 경로)
			// 웹뷰에서 전달된 URI 문자열을 vscode.Uri 객체로 파싱
			if (typeof data.projectPath === 'string' && data.projectPath.includes('://')) {
				data.projectUri = vscode.Uri.parse(data.projectPath);
				delete data.projectPath;
			}

			// 프로젝트 생성 (creator.ts에 위임)
			const creationStartTime = Date.now();
			await McuProjectCreator.createMcuProject(data, this.commandStartTime);
			const creationTotalTime = Date.now() - creationStartTime;
			axonLog(`⏱️ [성능 측정] 프로젝트 생성 전체 완료: ${creationTotalTime}ms`);
			
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

