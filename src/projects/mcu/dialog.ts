import * as vscode from 'vscode';
import { McuProjectCreator } from './creator';

/**
 * MCU 프로젝트 생성 다이얼로그 (WebView UI)
 */
export class McuProjectDialog {
	private webview?: vscode.WebviewPanel;

	constructor(private context: vscode.ExtensionContext) {}

	/**
	 * WebView HTML 컨텐츠 생성
	 */
	private getWebviewContent(): string {
		return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCU Standalone Project 생성</title>
    <style>
        :root {
            /* VS Code Light Theme */
            --vscode-bg-primary: #ffffff;
            --vscode-bg-secondary: #f3f3f3;
            --vscode-bg-tertiary: #f8f8f8;
            --vscode-fg-primary: #000000;
            --vscode-fg-secondary: #6c6c6c;
            --vscode-fg-tertiary: #989898;
            --vscode-border-primary: #d4d4d4;
            --vscode-border-secondary: #e5e5e5;
            --vscode-accent-primary: #007acc;
            --vscode-accent-secondary: #005a9e;
            --vscode-focus-border: #007acc;
            --vscode-input-bg: #ffffff;
            --vscode-input-border: #cecece;
            --vscode-input-focus-border: #007acc;
            --vscode-button-bg: #007acc;
            --vscode-button-hover: #005a9e;
            --vscode-button-secondary: #6c757d;
            --vscode-shadow: rgba(0, 0, 0, 0.1);
            --vscode-success: #28a745;
            --vscode-error: #dc3545;
            --vscode-warning: #ffc107;
        }

        /* VS Code Dark Theme */
        .vscode-dark {
            --vscode-bg-primary: #1e1e1e;
            --vscode-bg-secondary: #2d2d30;
            --vscode-bg-tertiary: #252526;
            --vscode-fg-primary: #cccccc;
            --vscode-fg-secondary: #969696;
            --vscode-fg-tertiary: #6a9955;
            --vscode-border-primary: #3e3e42;
            --vscode-border-secondary: #454545;
            --vscode-accent-primary: #007acc;
            --vscode-accent-secondary: #005a9e;
            --vscode-focus-border: #007acc;
            --vscode-input-bg: #3c3c3c;
            --vscode-input-border: #3e3e42;
            --vscode-input-focus-border: #007acc;
            --vscode-button-bg: #0e639c;
            --vscode-button-hover: #1177bb;
            --vscode-button-secondary: #6c757d;
            --vscode-shadow: rgba(0, 0, 0, 0.3);
            --vscode-success: #4ade80;
            --vscode-error: #f87171;
            --vscode-warning: #fbbf24;
        }

        /* High Contrast Theme */
        .vscode-high-contrast {
            --vscode-bg-primary: #000000;
            --vscode-bg-secondary: #000000;
            --vscode-fg-primary: #ffffff;
            --vscode-border-primary: #ffffff;
            --vscode-accent-primary: #ffffff;
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif);
            font-size: var(--vscode-font-size, 13px);
            margin: 0;
            padding: 20px;
            background: var(--vscode-bg-secondary);
            color: var(--vscode-fg-primary);
            line-height: 1.5;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: var(--vscode-bg-primary);
            border-radius: 8px;
            box-shadow: 0 2px 10px var(--vscode-shadow);
            overflow: hidden;
            border: 1px solid var(--vscode-border-primary);
        }
        .header {
            background: var(--vscode-accent-primary);
            color: var(--vscode-fg-primary);
            padding: 20px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 20px;
            font-weight: 600;
        }
        .form-section {
            padding: 20px;
            background: var(--vscode-bg-primary);
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--vscode-fg-primary);
        }
        .form-group input {
            width: 100%;
            padding: 12px;
            border: 2px solid var(--vscode-input-border);
            background: var(--vscode-input-bg);
            color: var(--vscode-fg-primary);
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
        }
        .form-group input:focus {
            outline: none;
            border-color: var(--vscode-input-focus-border);
            box-shadow: 0 0 0 2px var(--vscode-focus-border);
        }
        .form-group input[readonly] {
            background: var(--vscode-bg-tertiary);
            cursor: not-allowed;
            opacity: 0.6;
        }
        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }
        .button-group input {
            flex: 1;
        }
        .button-group button {
            padding: 12px 20px;
            background: var(--vscode-button-bg);
            color: var(--vscode-fg-primary);
            border: 1px solid var(--vscode-border-primary);
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
        }
        .button-group button:hover {
            background: var(--vscode-button-hover);
        }
        .button-group button:disabled {
            background: var(--vscode-bg-tertiary);
            color: var(--vscode-fg-secondary);
            cursor: not-allowed;
            opacity: 0.6;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            margin-top: 15px;
        }
        .checkbox-group input {
            margin-right: 10px;
            transform: scale(1.2);
        }
        .actions {
            padding: 20px;
            background: var(--vscode-bg-tertiary);
            border-top: 1px solid var(--vscode-border-primary);
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        }
        .btn {
            padding: 12px 24px;
            border: 1px solid var(--vscode-border-primary);
            border-radius: 4px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            background: var(--vscode-button-secondary);
            color: var(--vscode-fg-primary);
        }
        .btn-primary {
            background: var(--vscode-button-bg);
            color: var(--vscode-fg-primary);
            border-color: var(--vscode-accent-primary);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hover);
        }
        .btn-primary:disabled {
            background: var(--vscode-bg-tertiary);
            color: var(--vscode-fg-secondary);
            cursor: not-allowed;
            opacity: 0.6;
        }
        .btn-secondary {
            background: var(--vscode-button-secondary);
            color: var(--vscode-fg-primary);
        }
        .btn-secondary:hover {
            background: var(--vscode-accent-secondary);
        }
        .message {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: var(--vscode-fg-primary);
            font-weight: 500;
            z-index: 1000;
            animation: slideIn 0.3s ease-out;
            border: 1px solid var(--vscode-border-primary);
        }
        .message.success {
            background: var(--vscode-success);
            border-color: var(--vscode-success);
        }
        .message.error {
            background: var(--vscode-error);
            border-color: var(--vscode-error);
        }
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>MCU Standalone Project 생성</h1>
        </div>

        <div class="form-section">
            <form id="projectForm">
                <div class="form-group">
                    <label for="projectName">프로젝트 이름 *</label>
                    <input type="text" id="projectName" placeholder="예: my-mcu-project" required />
                </div>

                <div class="form-group">
                    <label for="projectPath">프로젝트 생성 위치 *</label>
                    <div class="button-group">
                        <input type="text" id="projectPath" readonly required />
                        <button type="button" id="browseBtn">Browse</button>
                    </div>
                </div>

                <div class="form-group" id="gitUrlGroup">
                    <label for="gitUrl">Git 저장소 URL *</label>
                    <input type="text" id="gitUrl" value="ssh://git@bitbucket.telechips.com:7999/linux_yp4_0_cgw/mcu-tcn100x.git" required />
                </div>

                <div class="form-group">
                    <label for="branchName">새 브랜치 이름 (선택사항)</label>
                    <input type="text" id="branchName" placeholder="예: feature/new-function" />
                </div>
            </form>
        </div>

        <div class="actions">
            <button class="btn btn-secondary" id="cancelBtn">취소</button>
            <button class="btn btn-primary" id="createBtn" disabled>생성</button>
        </div>
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            let selectedPath = '';

            // VS Code 테마 감지 및 적용
            function updateTheme() {
                const theme = vscode.getState()?.theme || 'light';
                document.body.className = theme === 'dark' ? 'vscode-dark' :
                                         theme === 'high-contrast' ? 'vscode-high-contrast' : '';
            }

            // 초기 테마 설정
            updateTheme();

            // VS Code에서 메시지 받기
            window.addEventListener('message', function(event) {
                const message = event.data;

                switch (message.command) {
                    case 'setTheme':
                        vscode.setState({ theme: message.theme });
                        updateTheme();
                        break;
                }
            });

            // DOM 요소들
            const projectNameInput = document.getElementById('projectName');
            const projectPathInput = document.getElementById('projectPath');
            const gitUrlInput = document.getElementById('gitUrl');
            const branchNameInput = document.getElementById('branchName');
            const createBtn = document.getElementById('createBtn');
            const cancelBtn = document.getElementById('cancelBtn');

            // 폼 유효성 검사
            function validateForm() {
                const projectName = projectNameInput.value.trim();
                const gitUrl = gitUrlInput.value.trim();
                const hasPath = selectedPath.trim().length > 0;
                createBtn.disabled = !projectName || !hasPath || !gitUrl;
            }

            // 이벤트 리스너 등록
            projectNameInput.addEventListener('input', validateForm);
            gitUrlInput.addEventListener('input', validateForm);

            // Browse 버튼 클릭
            document.getElementById('browseBtn').addEventListener('click', function() {
                vscode.postMessage({ command: 'browseFolder' });
            });

            // 취소 버튼 클릭
            cancelBtn.addEventListener('click', function() {
                vscode.postMessage({ command: 'cancel' });
            });

            // 생성 버튼 클릭
            createBtn.addEventListener('click', function() {
                const projectName = projectNameInput.value.trim();
                const projectPath = selectedPath;
                const gitUrl = gitUrlInput.value.trim();
                const branchName = branchNameInput.value.trim();

                if (!projectName || !projectPath || !gitUrl) {
                    showMessage('프로젝트 이름, 생성 위치, Git URL을 모두 입력해주세요.', 'error');
                    return;
                }

                // 로딩 상태 표시
                createBtn.disabled = true;
                createBtn.textContent = '생성 중...';

                vscode.postMessage({
                    command: 'createProject',
                    data: {
                        projectName: projectName,
                        projectPath: projectPath,
                        gitUrl: gitUrl,
                        branchName: branchName
                    }
                });
            });

            // 메시지 표시 함수
            function showMessage(text, type = 'info') {
                const messageDiv = document.createElement('div');
                messageDiv.textContent = text;
                messageDiv.className = 'message ' + type;
                document.body.appendChild(messageDiv);

                setTimeout(() => {
                    messageDiv.remove();
                }, 5000);
            }

            // VS Code에서 메시지 받기
            window.addEventListener('message', function(event) {
                const message = event.data;

                switch (message.command) {
                    case 'setFolderPath':
                        selectedPath = message.path;
                        projectPathInput.value = message.path;
                        validateForm();
                        break;
                    case 'projectCreated':
                        createBtn.disabled = false;
                        createBtn.textContent = '생성';

                        if (message.success) {
                            showMessage('프로젝트가 성공적으로 생성되었습니다!', 'success');
                        } else {
                            showMessage('프로젝트 생성에 실패했습니다: ' + (message.error || '알 수 없는 오류'), 'error');
                        }
                        break;
                }
            });
        })();
    </script>
</body>
</html>`;
	}

	/**
	 * 프로젝트 생성 WebView 표시
	 */
	async showProjectCreationWebView(): Promise<void> {
		// Webview 패널 생성 (에디터 영역에 표시)
		const panel = vscode.window.createWebviewPanel(
			'mcuProjectCreation',
			'Create MCU Standalone Project',
			vscode.ViewColumn.One, // 에디터 영역에 표시
			{
				enableScripts: true,
				localResourceRoots: [this.context.extensionUri]
			}
		);

		// 현재 VS Code 테마 감지 및 웹뷰에 전달
		const currentTheme = vscode.window.activeColorTheme;
		const themeKind = currentTheme.kind === vscode.ColorThemeKind.Dark ? 'dark' :
		                 currentTheme.kind === vscode.ColorThemeKind.HighContrast ? 'high-contrast' : 'light';

		// HTML 내용 설정
		panel.webview.html = this.getWebviewContent();

		// 웹뷰에 현재 테마 정보 전달
		setTimeout(() => {
			panel.webview.postMessage({
				command: 'setTheme',
				theme: themeKind
			});
		}, 100);

		// VS Code 테마 변경 감지
		const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme((theme) => {
			const newThemeKind = theme.kind === vscode.ColorThemeKind.Dark ? 'dark' :
			                    theme.kind === vscode.ColorThemeKind.HighContrast ? 'high-contrast' : 'light';
			panel.webview.postMessage({
				command: 'setTheme',
				theme: newThemeKind
			});
		});

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
				themeChangeDisposable.dispose();
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
			// projectPath가 string이면 URI로 변환 (웹뷰에서 전달된 경로)
			// 웹뷰에서 전달된 URI 문자열을 vscode.Uri 객체로 파싱
			if (typeof data.projectPath === 'string' && data.projectPath.includes('://')) {
				data.projectUri = vscode.Uri.parse(data.projectPath);
				delete data.projectPath;
			}

			// 프로젝트 생성 (creator.ts에 위임)
			await McuProjectCreator.createMcuProject(data);
			
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

