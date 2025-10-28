import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

// Axon Project Tree Item
class AxonProjectItem extends vscode.TreeItem {
	constructor(
		public readonly id: string,
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(label, collapsibleState);

		if (command) {
			this.command = command;
		}

		// 아이콘 설정
		if (id === 'createMcuStandaloneProject') {
			this.iconPath = new vscode.ThemeIcon('circuit-board');
			this.tooltip = 'Create a new MCU standalone project';
		} else if (id === 'createYoctoProject') {
			this.iconPath = new vscode.ThemeIcon('package');
			this.tooltip = 'Create a new Yocto project';
		}
	}
}

// Axon Project Tree Data Provider
class AxonProjectProvider implements vscode.TreeDataProvider<AxonProjectItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<AxonProjectItem | undefined | null | void> = new vscode.EventEmitter<AxonProjectItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<AxonProjectItem | undefined | null | void> = this._onDidChangeTreeData.event;

	constructor() {}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: AxonProjectItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: AxonProjectItem): Thenable<AxonProjectItem[]> {
		if (element) {
			return Promise.resolve([]);
		} else {
			// Root level items
			return Promise.resolve([
				new AxonProjectItem(
					'createMcuStandaloneProject',
					'Create MCU Standalone Project',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.createMcuStandaloneProject',
						title: 'Create MCU Standalone Project'
					}
				),
				new AxonProjectItem(
					'createYoctoProject',
					'Create Yocto Project',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.createYoctoProject',
						title: 'Create Yocto Project'
					}
				)
			]);
		}
	}
}

// MCU Project Creation Dialog using VS Code API
class McuProjectDialog {
	private webview?: vscode.WebviewPanel;

	constructor(private context: vscode.ExtensionContext) {}

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

	private async createProjectFromWebView(data: any, panel: vscode.WebviewPanel): Promise<void> {
		try {
			// projectPath가 string이면 URI로 변환 (웹뷰에서 전달된 경로)
			// 웹뷰에서 전달된 URI 문자열을 vscode.Uri 객체로 파싱
			if (typeof data.projectPath === 'string' && data.projectPath.includes('://')) {
				data.projectUri = vscode.Uri.parse(data.projectPath);
				delete data.projectPath;
			}

			// 프로젝트 생성
			await this.createMcuProject(data);
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

	private async createMcuProject(data: {
		projectName: string;
		projectUri: vscode.Uri;
		gitUrl: string;
		branchName?: string;
	}): Promise<void> {
		const { projectName, projectUri, gitUrl, branchName } = data;
		axonLog(`🚀 프로젝트 생성 시작: ${projectName}`);

		const projectFullUri = vscode.Uri.joinPath(projectUri, projectName);

		try {
			await vscode.workspace.fs.stat(projectFullUri);
			// 폴더가 이미 존재하면 오류 발생
			throw new Error(`프로젝트 폴더 '${projectName}'이(가) 이미 '${projectUri.toString()}' 위치에 존재합니다.`);
		} catch (error) {
			if (error instanceof Error && error.message.includes('존재합니다')) {
				throw error; // 폴더 존재 오류는 그대로 전달
			}
			// 'FileNotFound' 오류는 정상적인 경우이므로 무시하고 계속 진행
		}

		// 항상 Git Clone을 사용하여 프로젝트 생성
		axonLog(`🔄 Git 저장소에서 프로젝트 생성: ${gitUrl}`);
		// git clone은 부모 디렉토리에서 실행해야 하므로 projectUri의 경로를 사용합니다.
		// clone 명령어는 자동으로 `projectName` 폴더를 생성합니다.
		// 원격 환경에서는 fsPath 대신 path를 사용해야 올바른 경로가 전달됩니다.
		const parentPath = projectUri.scheme === 'file'
			? projectUri.fsPath
			: projectUri.path;
		await this.cloneGitRepository(gitUrl, projectName, parentPath);
		axonSuccess(`✅ Git 저장소 '${gitUrl}'을(를) '${projectFullUri.toString()}'에 클론했습니다.`);

		// 새 브랜치 이름이 제공된 경우, 브랜치 생성 및 푸시 작업 실행
		if (branchName) {
			axonLog(`🌿 새 브랜치 '${branchName}' 생성 및 푸시 작업을 시작합니다.`);
			const projectPath = projectFullUri.scheme === 'file'
				? projectFullUri.fsPath
				: projectFullUri.path;
			await this.createAndPushBranch(branchName, projectPath);
			axonSuccess(`✅ 새 브랜치 '${branchName}'를 원격 저장소에 성공적으로 푸시했습니다.`);
		}

		// 생성된 프로젝트 폴더를 VS Code에서 열기
		await vscode.commands.executeCommand('vscode.openFolder', projectFullUri, { forceNewWindow: true });
	}

	private async cloneGitRepository(gitUrl: string, projectName: string, parentDir: string): Promise<void> {
		axonLog(`🔄 Cloning repository using VS Code Tasks API...`);
		const command = `git clone --progress "${gitUrl}" "${projectName}"`;

		const task = new vscode.Task(
			{ type: 'shell', task: 'gitClone' },
			vscode.TaskScope.Workspace,
			'Git Clone',
			'Axon',
			new vscode.ShellExecution(command, { cwd: parentDir })
		);

		// 터미널이 포커스를 뺏지 않도록 설정
		task.presentationOptions = {
			reveal: vscode.TaskRevealKind.Silent,
			focus: false,
			panel: vscode.TaskPanelKind.Shared,
			showReuseMessage: false,
			clear: true
		};

		return new Promise<void>((resolve, reject) => {
			const disposable = vscode.tasks.onDidEndTaskProcess(e => {
				if (e.execution.task.name === 'Git Clone') {
					disposable.dispose();
					if (e.exitCode === 0) {
						resolve();
					} else {
						reject(new Error(`Git clone failed with exit code ${e.exitCode}. Check the terminal for details.`));
					}
				}
			});

			vscode.tasks.executeTask(task).then(undefined, (error) => {
				reject(new Error(`Failed to start Git clone task: ${error}`));
			});
		});
	}

	private async createAndPushBranch(branchName: string, projectDir: string): Promise<void> {
		axonLog(`🔄 Running branch creation task in: ${projectDir}`);
		// 1. 새 브랜치 생성 및 전환 -> 2. 원격에 푸시하고 업스트림 설정
		const command = `git switch -c "${branchName}" && git push -u origin "${branchName}"`;

		const task = new vscode.Task(
			{ type: 'shell', task: 'createAndPushBranch' },
			vscode.TaskScope.Workspace,
			'Create and Push Branch',
			'Axon',
			new vscode.ShellExecution(command, { cwd: projectDir })
		);

		task.presentationOptions = {
			reveal: vscode.TaskRevealKind.Silent,
			focus: false,
			panel: vscode.TaskPanelKind.Shared,
			showReuseMessage: false,
			clear: true
		};

		return new Promise<void>((resolve, reject) => {
			const disposable = vscode.tasks.onDidEndTaskProcess(e => {
				if (e.execution.task.name === 'Create and Push Branch') {
					disposable.dispose();
					if (e.exitCode === 0) {
						resolve();
					} else {
						reject(new Error(`Branch creation/push failed with exit code ${e.exitCode}. Check the terminal for details.`));
					}
				}
			});

			vscode.tasks.executeTask(task).then(undefined, (error) => {
				reject(new Error(`Failed to start branch creation task: ${error}`));
			});
		});
	}
}

// Axon 전용 Output 채널
let axonOutputChannel: vscode.OutputChannel;

// 현재 감지된 Boot Firmware 경로 (캐싱) - 사용하지 않음
let currentBootFirmwarePath: string | null = null;

// 제외할 폴더 패턴 (검색에서 제외할 폴더들)
const EXCLUDE_PATTERNS = '**/{node_modules,.git,.cache,build,dist,out,tmp,buildtools,fwdn-v8,mktcimg,poky,source-mirror,tools}/**';

// 제외할 폴더명들 (EXCLUDE_PATTERNS에서 추출)
const EXCLUDE_FOLDERS = [
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

// 로그 함수들
function logWithTimestamp(message: string, prefix: string = ''): string {
	const timestamp = new Date().toLocaleTimeString();
	return `${prefix}[${timestamp}] ${message}`;
}
	
function axonLog(message: string) {
	const logMessage = logWithTimestamp(message);
	if (axonOutputChannel) {
		axonOutputChannel.appendLine(logMessage);
	}
	console.log(`[Axon] ${logMessage}`);
}

function axonError(message: string) {
	const logMessage = logWithTimestamp(message, '❌ ');
	if (axonOutputChannel) {
		axonOutputChannel.appendLine(logMessage);
	}
	console.error(`[Axon] ${logMessage}`);
}

function axonSuccess(message: string) {
	const logMessage = logWithTimestamp(message, '✅ ');
	if (axonOutputChannel) {
		axonOutputChannel.appendLine(logMessage);
	}
	console.log(`[Axon] ${logMessage}`);
}

// 설정 가져오기 헬퍼 함수
interface FwdnConfig {
	fwdnExePath: string;
	bootFirmwarePath: string;
}

interface AxonConfig {
	fwdnExePath: string;
	buildAxonFolderName: string;
	bootFirmwareFolderName: string;
}

// 전체 Axon 설정 가져오기 함수
function getAxonConfig(): AxonConfig {
	const config = vscode.workspace.getConfiguration('axon');

	return {
		fwdnExePath: config.get<string>('fwdn.exePath', 'C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe'),
		buildAxonFolderName: config.get<string>('buildAxonFolderName', 'build-axon'),
		bootFirmwareFolderName: config.get<string>('bootFirmwareFolderName', 'boot-firmware_tcn1000')
	};
}

async function getFwdnConfig(): Promise<FwdnConfig> {
	const config = vscode.workspace.getConfiguration('axon');

	// Boot Firmware 경로는 매번 새로 검색 (캐시 사용하지 않음) - 빠른 방식 사용
	axonLog(`🔍 Boot Firmware 경로 자동 검색 시작 (빠른 방식)...`);
	const bootFirmwarePath = await findBootFirmwareFolder();

	if (!bootFirmwarePath) {
		axonLog(`❌ Boot Firmware 경로를 찾을 수 없습니다.`);
		throw new Error('Boot Firmware 경로를 찾을 수 없습니다. "Axon: Auto-detect Boot Firmware Path" 명령을 먼저 실행하거나 수동으로 설정해주세요.');
	}

	axonLog(`✅ Boot Firmware 경로를 찾았습니다: ${bootFirmwarePath}`);

	return {
		fwdnExePath: config.get<string>('fwdn.exePath', 'C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe'),
		bootFirmwarePath: bootFirmwarePath
	};
}

// 설정 검증 함수
function validateConfig(config: FwdnConfig): string | null {
	if (!config.fwdnExePath) {
		return 'FWDN 실행 파일 경로가 설정되지 않았습니다. 설정을 먼저 구성해주세요.';
	}
	if (!config.bootFirmwarePath) {
		return 'Boot Firmware 경로가 설정되지 않았습니다. 설정을 먼저 구성해주세요.';
	}
	return null;
}

// 워크스페이스 폴더 가져오기
function getWorkspaceFolder(): vscode.WorkspaceFolder | null {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			const errorMsg = '워크스페이스 폴더를 찾을 수 없습니다.';
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
		return null;
	}
	return workspaceFolder;
}

// FWDN 실행 완료 후 자동 창 닫기 함수 (신호 파일 기반)
async function executeFwdnWithAutoClose(terminal: vscode.Terminal): Promise<void> {
	return new Promise((resolve) => {
		let isCompleted = false;

		try {
			axonLog('🔍 FWDN 완료 신호 파일 대기 중...');

			// 완료 신호 파일 경로 (배치 파일과 동일한 위치)
			const signalFile = path.join(os.tmpdir(), 'axon_fwdn_completed.txt');

			// 주기적으로 신호 파일 확인
			const checkSignalFile = () => {
				try {
					if (fs.existsSync(signalFile)) {
						// 신호 파일 내용 확인
						const content = fs.readFileSync(signalFile, 'utf8').trim();
						if (content === 'FWDN_COMPLETED' && !isCompleted) {
							isCompleted = true;
							clearInterval(checkInterval!);

							// 신호 파일 삭제
							try {
								fs.unlinkSync(signalFile);
							} catch (deleteError) {
								axonLog(`⚠️ 신호 파일 삭제 실패: ${deleteError}`);
							}

							const successMsg = '✅ FWDN 실행 완료! 창을 자동으로 닫습니다.';
							axonSuccess(successMsg);
							vscode.window.showInformationMessage(successMsg);

							setTimeout(() => {
								try {
									terminal.dispose();
								} catch (disposeError) {
									axonLog(`⚠️ 터미널 종료 중 오류: ${disposeError}`);
								}
								resolve();
							}, 1000);
						}
					}
				} catch (error) {
					axonLog(`⚠️ 신호 파일 확인 중 오류: ${error}`);
				}
			};

			// 0.5초마다 신호 파일 확인
			const checkInterval = setInterval(checkSignalFile, 500);

			// 초기 확인 (즉시 실행)
			setTimeout(checkSignalFile, 200);

			// 안전장치: 10분 후 강제 종료
			setTimeout(() => {
				if (!isCompleted) {
					axonLog('⏰ FWDN 실행 시간 초과로 정리합니다.');
					if (checkInterval) clearInterval(checkInterval);

					// 남은 신호 파일 정리
					try {
						if (fs.existsSync(signalFile)) {
							fs.unlinkSync(signalFile);
						}
					} catch (deleteError) {
						axonLog(`⚠️ 신호 파일 정리 실패: ${deleteError}`);
					}

					try {
						terminal.dispose();
					} catch (disposeError) {
						axonLog(`⚠️ 타임아웃 후 터미널 종료 중 오류: ${disposeError}`);
					}
					resolve();
				}
			}, 600000); // 10분 타임아웃

		} catch (error) {
			axonError(`FWDN 완료 처리 중 오류: ${error}`);
			try {
				terminal.dispose();
			} catch (disposeError) {
				axonLog(`⚠️ 에러 후 터미널 종료 중 오류: ${disposeError}`);
			}
			resolve();
		}
	});
}


// FWDN 실행 함수 (ALL 모드만)
async function executeFwdnCommand(extensionPath: string): Promise<void> {
	axonLog(`🚀 FWDN ALL (Step 1-4) 실행 명령 시작`);

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	// 설정 가져오기
	let config: FwdnConfig;
	try {
		config = await getFwdnConfig();
		axonLog(`📋 설정 - FWDN 경로: ${config.fwdnExePath}, Boot Firmware 경로: ${config.bootFirmwarePath}`);
	} catch (error) {
		// Boot Firmware 경로가 설정되지 않은 경우
		axonError(`설정 오류: ${error}`);
		vscode.window.showErrorMessage(`Boot Firmware 경로가 설정되지 않았습니다. "Axon: Auto-detect Boot Firmware Path" 명령을 먼저 실행해주세요.`);
		return;
	}

	// 설정 검증
	const validationError = validateConfig(config);
	if (validationError) {
		axonError(validationError);
		vscode.window.showErrorMessage(validationError);
			return;
		}

	try {
		axonLog(`🔧 로컬 PowerShell에서 직접 실행`);

		// 배치 파일 경로 생성 (익스텐션 설치 경로 기준)
		const batchFilePath = path.join(extensionPath, 'fwdn_all.bat');
		axonLog(`📝 배치 파일 경로: ${batchFilePath}`);

		// UNC 경로 처리 (Remote-SSH 환경에서 로컬 파일 접근용)
		const isUncPath = config.fwdnExePath.startsWith('\\\\tsclient\\');
		const processedFwdnExePath = isUncPath ? config.fwdnExePath : `"${config.fwdnExePath}"`;

		// CMD를 통해 배치 파일 실행 (ALL 모드로 고정)
		const psCommand = `cmd /c "${batchFilePath}" all "${config.bootFirmwarePath}" "${config.fwdnExePath}"`;

		axonLog(`📋 실행 명령: ${psCommand}`);

		// PowerShell 실행 파일 경로 결정 (PowerShell 7 우선)
		const ps7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
		const ps5 = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

		const psExe = fs.existsSync(ps7) ? ps7 : (fs.existsSync(ps5) ? ps5 : null);
		if (!psExe) {
			throw new Error('로컬 PC에서 PowerShell 실행 파일을 찾지 못했습니다.');
		}

		// 환경 감지 및 터미널 생성
		const isRemote = vscode.env.remoteName !== undefined;
		let terminal: vscode.Terminal;

		if (isRemote) {
			// 원격 환경: 로컬 터미널 생성 명령 사용
			await vscode.commands.executeCommand('workbench.action.terminal.newLocal');
			const term = vscode.window.activeTerminal;
			if (!term) {
				throw new Error('로컬 터미널 생성에 실패했습니다.');
			}
			terminal = term;
		} else {
			// 로컬 환경: 기본 터미널 생성 시도
			try {
				await vscode.commands.executeCommand('workbench.action.terminal.new');
				const basicTerminal = vscode.window.activeTerminal;
				if (basicTerminal) {
					terminal = basicTerminal;
				} else {
					throw new Error('기본 터미널 생성에 실패했습니다.');
				}
			} catch {
				// 폴백: 직접 터미널 생성
				terminal = vscode.window.createTerminal({
					name: `FWDN ALL (Step 1-4)`,
					isTransient: true
				});
			}
		}

		terminal.sendText(psCommand, true);  // PS 문법 그대로 실행

		// 배치 파일 완료 신호 대기 및 자동 창 닫기
		await executeFwdnWithAutoClose(terminal);

		axonLog(`✅ FWDN ALL (Step 1-4) 실행 완료`);

	} catch (error) {
		const errorMsg = `FWDN ALL (Step 1-4) 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}



// 설정 업데이트 공통 함수
async function updateConfiguration(
	key: string,
	value: string,
	label: string
): Promise<void> {
	// 설정 파일에 저장
	const config = vscode.workspace.getConfiguration('axon');
	await config.update(key, value, vscode.ConfigurationTarget.Workspace);

	axonLog(`✅ ${label} 경로가 설정되었습니다: ${value}`);
	vscode.window.showInformationMessage(`${label} 경로가 설정되었습니다: ${value}`);
}

// 워크스페이스에서 설정 가능한 boot firmware 폴더 검색 함수 (원래 버전 - findFiles 사용)
async function findBootFirmwareFolderOriginal(): Promise<string | null> {
	const config = getAxonConfig();
	const bootFirmwareFolderName = config.bootFirmwareFolderName;

	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		axonLog('❌ 워크스페이스 폴더를 찾을 수 없습니다.');
		return null;
	}

	axonLog(`🔍 워크스페이스 폴더에서 ${bootFirmwareFolderName} 검색 시작: ${workspaceFolders[0].uri.fsPath}`);
	axonLog(`📁 워크스페이스 URI: ${workspaceFolders[0].uri.toString()}`);

	// 디버깅: VS Code API 정보 확인
	axonLog(`🐛 디버깅 정보:`);
	axonLog(`  - VS Code 버전: ${vscode.version}`);
	axonLog(`  - 워크스페이스 개수: ${workspaceFolders.length}`);
	axonLog(`  - 첫 번째 워크스페이스: ${workspaceFolders[0].uri.fsPath}`);
	axonLog(`  - URI 스킴: ${workspaceFolders[0].uri.scheme}`);

	try {
		// 찾고자 하는 폴더 이름들
		const targetFolders = [bootFirmwareFolderName];

		// 워크스페이스 폴더 자체가 관련 경로인지 확인
		const workspaceUri = workspaceFolders[0].uri;
		const workspacePath = workspaceUri.scheme === 'file' ? workspaceUri.fsPath : workspaceUri.path; // 검색용으로는 원래 URI path 사용

		// 워크스페이스 경로에 설정된 build 폴더명이 포함되어 있다면 해당 폴더를 기준으로 검색
		if (workspacePath.includes(config.buildAxonFolderName)) {
			axonLog(`✅ 워크스페이스 폴더에 ${config.buildAxonFolderName}이 포함되어 있습니다: ${workspacePath}`);

			// 워크스페이스 URI에서 설정된 폴더명까지의 경로 추출
			const folderIndex = workspaceUri.path.indexOf(config.buildAxonFolderName);
			if (folderIndex !== -1) {
				const folderPath = workspaceUri.path.substring(0, folderIndex + config.buildAxonFolderName.length);
				const folderUri = workspaceUri.with({ path: folderPath });

				axonLog(`🔍 ${config.buildAxonFolderName} 폴더 기준으로 ${bootFirmwareFolderName} 검색: ${dirToDisplay(folderUri)}`);

				// 설정된 build 폴더 내에서 boot firmware 폴더 검색 (5초 타임아웃 + 시간 측정)
				const searchStartTime = Date.now();

				// 제외할 폴더 패턴 설정
				const bootFirmwarePattern = new vscode.RelativePattern(folderUri, `**/${bootFirmwareFolderName}/**`);
				const exclude = new vscode.RelativePattern(folderUri, EXCLUDE_PATTERNS);

				// 취소 토큰과 타이머 설정
				const cts = new vscode.CancellationTokenSource();
				const timer = setTimeout(() => cts.cancel(), 5000); // 5초 타임아웃

				try {
					const bootFirmwareFiles = await vscode.workspace.findFiles(bootFirmwarePattern, exclude, 1, cts.token);
					const searchEndTime = Date.now();
					const searchDuration = searchEndTime - searchStartTime;
					axonLog(`⏱️ ${config.buildAxonFolderName} 폴더 boot-firmware 검색 시간: ${searchDuration}ms`);

					if (bootFirmwareFiles.length > 0) {
						const foundUri = bootFirmwareFiles[0];
						const bootFirmwareDir = uriUpToFolderName(foundUri, bootFirmwareFolderName);
						axonLog(`🎯 ${config.buildAxonFolderName} 폴더 내에서 ${bootFirmwareFolderName}을 찾았습니다: ${dirToDisplay(bootFirmwareDir)}`);
						const finalPath = bootFirmwareDir.scheme === 'file' ? bootFirmwareDir.fsPath : convertRemotePathToSamba(bootFirmwareDir.path);
						axonLog(`📝 최종 설정 경로: ${finalPath}`);
						return finalPath;
					} else {
						axonLog(`❌ ${config.buildAxonFolderName} 폴더 내에서 ${bootFirmwareFolderName}를 찾을 수 없습니다.`);
					}
				} catch (e) {
					axonLog(`⏱️ ${config.buildAxonFolderName} findFiles 취소/실패: ${String(e)}`);
				} finally {
					clearTimeout(timer);
					cts.dispose();
				}
			}
		} else if (workspacePath.includes('linux_yp') || workspacePath.includes('cgw')) {
			// linux_yp나 cgw가 포함된 경우는 workspace 자체를 반환
			axonLog(`✅ 워크스페이스 폴더가 linux_yp/cgw 관련 경로에 있습니다: ${workspacePath}`);
			const finalPath = workspaceUri.scheme === 'file' ? workspaceUri.fsPath : convertRemotePathToSamba(workspaceUri.path);
			axonLog(`📝 최종 설정 경로: ${finalPath}`);
			return finalPath;
		}

		for (const workspaceFolder of workspaceFolders) {
			axonLog(`🔍 워크스페이스 "${workspaceFolder.uri.fsPath}"에서 검색 시작`);

			for (const folderName of targetFolders) {
				axonLog(`📋 "${folderName}" 폴더 검색 중...`);

				// ✅ 폴더 내부를 가리키도록 패턴 변경 (폴더 자체는 매칭 불가, 5초 타임아웃 + 시간 측정)
				const searchStartTime = Date.now();

				// 제외할 폴더 패턴 설정
				const include = new vscode.RelativePattern(workspaceFolder, `**/${folderName}/**`);
				const exclude = new vscode.RelativePattern(workspaceFolder, EXCLUDE_PATTERNS);

				// 취소 토큰과 타이머 설정
				const cts = new vscode.CancellationTokenSource();
				const timer = setTimeout(() => cts.cancel(), 5000); // 5초 타임아웃

				try {
					const hits = await vscode.workspace.findFiles(include, exclude, 1, cts.token);
					const searchEndTime = Date.now();
					const searchDuration = searchEndTime - searchStartTime;
					axonLog(`⏱️ ${folderName} 검색 시간: ${searchDuration}ms`);

					axonLog(`📊 "${folderName}" 패턴 결과: ${hits.length}개 (base=${workspaceFolder.uri.toString()})`);

					if (hits.length > 0) {
						const hit = hits[0]; // 폴더 안의 임의의 파일/항목 URI
						const dirUri = uriUpToFolderName(hit, folderName); // 폴더 경로만 추출

						axonLog(`🎯 "${folderName}" 폴더 URI: ${dirUri.toString()}`);

						try {
							const stat = await vscode.workspace.fs.stat(dirUri);
							if (stat.type === vscode.FileType.Directory) {
								axonLog(`✅ ${folderName} 폴더를 찾았습니다: ${dirToDisplay(dirUri)}`);
								// file 스킴이 아니면 fsPath 사용이 위험하니, 필요 용도에 맞게 반환값 선택
								const finalPath = dirUri.scheme === 'file' ? dirUri.fsPath : convertRemotePathToSamba(dirUri.path);
								axonLog(`📝 최종 설정 경로: ${finalPath}`);
								return finalPath;
							} else {
								axonLog(`⚠️ ${folderName}이 폴더가 아닙니다: ${dirToDisplay(dirUri)}`);
							}
						} catch (statError) {
							axonLog(`⚠️ stat 실패: ${statError instanceof Error ? statError.message : String(statError)}`);
						}
					} else {
						axonLog(`❌ "${folderName}" 패턴으로 아무것도 찾을 수 없습니다.`);
					}
				} catch (e) {
					axonLog(`⏱️ findFiles 취소/실패: ${String(e)}`);
				} finally {
					clearTimeout(timer);
					cts.dispose();
				}
			}
		}


		axonLog(`❌ ${bootFirmwareFolderName} 폴더를 찾을 수 없습니다.`);
		return null;

	} catch (error) {
		axonError(`Boot firmware 폴더 검색 중 오류 발생: ${error}`);
		return null;
	}
}

/**
 * 지정된 디렉토리에서 설정 가능한 boot firmware 폴더를 재귀적으로 검색 (최대 depth 4)
 */
async function searchBootFirmwareInDirectory(baseUri: vscode.Uri, currentDepth: number = 0, maxDepth: number = 4): Promise<string | null> {
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
async function findBootFirmwareFolder(): Promise<string | null> {
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

// --- Helper Functions ---

/**
 * URI에서 특정 폴더명까지의 상위 폴더 URI를 반환 (스킴 보존)
 */
function uriUpToFolderName(uri: vscode.Uri, folderName: string): vscode.Uri {
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
function dirToDisplay(uri: vscode.Uri): string {
	// 로깅용: 로컬이면 fsPath, 아니면 POSIX path
	return uri.scheme === 'file' ? uri.fsPath : `${uri.scheme}:${uri.path}`;
}

/**
 * 원격 경로를 Samba 네트워크 드라이브 경로로 변환
 * SSH/WSL 환경에서 로컬 Samba 매핑으로 변환
 */
function convertRemotePathToSamba(remotePath: string): string {
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

// 설정 메뉴를 보여주는 새로운 상위 명령어
async function showConfigurationMenu() {
	// QuickPick에 표시할 항목들 정의
	const items: (vscode.QuickPickItem & { command: string })[] = [
		{
			label: '🔧 FWDN 실행 파일 경로 설정',
			description: 'fwdn.exe 파일의 위치를 설정합니다.',
			command: 'axon.configureFwdnExe' // 실행할 명령어 ID
		},
		{
			label: '📁 Build 폴더명 설정',
			description: '프로젝트의 빌드 폴더 이름(예: build-axon)을 설정합니다.',
			command: 'axon.configureProjectFolder'
		},
		{
			label: '📂 Boot Firmware 폴더명 설정',
			description: 'Boot Firmware 폴더 이름(예: boot-firmware_tcn1000)을 설정합니다.',
			command: 'axon.configureBootFirmwareFolder'
		}
	];

	// QuickPick 메뉴 표시
	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: '변경할 설정 항목을 선택하세요'
	});
}


// Yocto Project 생성 함수
async function createYoctoProject(): Promise<void> {
	axonLog('🚀 Yocto Project 생성 시작');
	vscode.window.showInformationMessage('Yocto Project 생성 명령이 실행되었습니다.');
}

export async function activate(context: vscode.ExtensionContext) {
	// Axon 전용 Output 채널 생성
	axonOutputChannel = vscode.window.createOutputChannel('Axon');
	
	// 버전 정보 표시
	const extension = vscode.extensions.getExtension('justin-lee.axon');
	const version = extension?.packageJSON.version || '0.3.7';
	
	axonLog('===========================================');
	axonLog('Axon extension is now active!');
	axonLog(`Version: ${version}`);
	axonLog('===========================================');
	axonOutputChannel.show();

	// Axon Project Tree Data Provider 등록
	const axonProjectProvider = new AxonProjectProvider();
	vscode.window.registerTreeDataProvider('axonProjectView', axonProjectProvider);

	// MCU Project Dialog Provider 등록
	const mcuProjectDialog = new McuProjectDialog(context);

	// 설정 메뉴를 보여주는 새로운 상위 명령어
	const configureSettingsDisposable = vscode.commands.registerCommand(
		'axon.configureSettings',
		showConfigurationMenu
	);

	// FWDN ALL 실행 명령
	const runFwdnAllDisposable = vscode.commands.registerCommand(
		'axon.FWDN_ALL',
		async () => executeFwdnCommand(context.extensionPath)
	);

	// FWDN 실행 파일 경로 설정 명령
	const configureFwdnExeDisposable = vscode.commands.registerCommand(
		'axon.configureFwdnExe',
		async () => {
			const config = vscode.workspace.getConfiguration('axon');

			const selectedFiles = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				openLabel: 'FWDN 실행 파일 선택',
				title: 'FWDN 실행 파일을 선택하세요',
				filters: {
					'Executable': ['exe'],
					'All Files': ['*']
				},
				defaultUri: vscode.Uri.file(config.get<string>('fwdn.exePath', 'C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe'))
			});

			if (selectedFiles && selectedFiles.length > 0) {
				await updateConfiguration('fwdn.exePath', selectedFiles[0].fsPath, 'FWDN 실행 파일');
			}
		}
	);

	// Build 폴더명 설정 명령
	const configureProjectFolderDisposable = vscode.commands.registerCommand(
		'axon.configureProjectFolder',
		async () => {
			const config = vscode.workspace.getConfiguration('axon');
			const currentValue = config.get<string>('buildAxonFolderName', 'build-axon');

			const newValue = await vscode.window.showInputBox({
				prompt: 'Build 폴더명을 입력하세요',
				value: currentValue,
				placeHolder: '예: build-axon',
				validateInput: (value) => {
					if (!value || value.trim().length === 0) {
						return '폴더명을 입력해주세요.';
					}
					return null;
				}
			});

			if (newValue && newValue !== currentValue) {
				await updateConfiguration('buildAxonFolderName', newValue.trim(), 'Build 폴더명');
			}
		}
	);

	// Boot Firmware 폴더명 설정 명령
	const configureBootFirmwareFolderDisposable = vscode.commands.registerCommand(
		'axon.configureBootFirmwareFolder',
		async () => {
			const config = vscode.workspace.getConfiguration('axon');
			const currentValue = config.get<string>('bootFirmwareFolderName', 'boot-firmware_tcn1000');

			const newValue = await vscode.window.showInputBox({
				prompt: 'Boot Firmware 폴더명을 입력하세요',
				value: currentValue,
				placeHolder: '예: boot-firmware_tcn1000',
				validateInput: (value) => {
					if (!value || value.trim().length === 0) {
						return '폴더명을 입력해주세요.';
					}
					return null;
				}
			});

			if (newValue && newValue !== currentValue) {
				await updateConfiguration('bootFirmwareFolderName', newValue.trim(), 'Boot Firmware 폴더명');
			}
		}
	);

	// MCU Build Make 실행 명령
	const mcuBuildMakeDisposable = vscode.commands.registerCommand(
		'axon.mcuBuildMake',
		async () => executeMcuBuildMake(context.extensionPath)
	);

	// Build and Copy Scripts 실행 명령
	const buildAndCopyScriptsDisposable = vscode.commands.registerCommand(
		'axon.buildAndCopyScripts',
		async () => executeBuildAndCopyScripts(context.extensionPath)
	);

	// Create MCU Standalone Project 명령
	const createMcuStandaloneProjectDisposable = vscode.commands.registerCommand(
		'axon.createMcuStandaloneProject',
		async () => {
			await mcuProjectDialog.showProjectCreationWebView();
		}
	);

	// Create Yocto Project 명령
	const createYoctoProjectDisposable = vscode.commands.registerCommand(
		'axon.createYoctoProject',
		async () => createYoctoProject()
	);

        context.subscriptions.push(
		configureSettingsDisposable, // 상위 설정 메뉴 명령어
		runFwdnAllDisposable,
		mcuBuildMakeDisposable,
		buildAndCopyScriptsDisposable,
		// 하위 명령어들도 프로그램에서 호출할 수 있도록 등록은 유지합니다.
		configureFwdnExeDisposable,
		configureProjectFolderDisposable,
		configureBootFirmwareFolderDisposable,
		// 새로운 프로젝트 생성 명령어들
		createMcuStandaloneProjectDisposable,
		createYoctoProjectDisposable
	);
}

// build-axon 폴더를 찾는 재귀 검색 함수 (searchBootFirmwareInDirectory와 유사한 구조)
async function searchBuildAxonInDirectory(baseUri: vscode.Uri, currentDepth: number = 0, maxDepth: number = 4): Promise<string | null> {
	const config = getAxonConfig();
	const buildAxonFolderName = config.buildAxonFolderName;

	try {
		// baseUri가 이미 build-axon 폴더인지 확인 (폴더명이 build-axon으로 끝나는지)
		const basePath = baseUri.path;
		if (basePath.endsWith('/' + buildAxonFolderName) || basePath.endsWith('\\' + buildAxonFolderName)) {
			const finalPath = baseUri.scheme === 'file' ? baseUri.fsPath : baseUri.path;
			axonLog(`✅ depth ${currentDepth}에서 baseUri가 이미 ${buildAxonFolderName} 폴더입니다: ${finalPath}`);
			return finalPath;
		}

		// 현재 디렉토리에서 build-axon 폴더 확인
		const targetPath = baseUri.with({ path: `${baseUri.path.replace(/\/$/, '')}/${buildAxonFolderName}` });

		try {
			const stat = await vscode.workspace.fs.stat(targetPath);
			if (stat.type === vscode.FileType.Directory) {
				let finalPath: string;
				if (targetPath.scheme === 'file') {
					finalPath = targetPath.fsPath;
				} else {
					// 원격 경로일 경우, 전체 URI를 문자열로 반환하여 스킴과 authority 정보를 보존합니다.
					finalPath = targetPath.toString();
				}

				axonLog(`✅ depth ${currentDepth}에서 ${buildAxonFolderName} 폴더를 찾았습니다: ${finalPath}`);
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

				// 각 하위 디렉토리에서 재귀 검색
				for (const [dirName, dirType] of directories) {
					const subDirUri = baseUri.with({ path: baseUri.path + '/' + dirName });
					axonLog(`📁 depth ${currentDepth} - ${dirName} 폴더 탐색 중...`);

					const result = await searchBuildAxonInDirectory(subDirUri, currentDepth + 1, maxDepth);
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

// 설정 가능한 build-axon 폴더를 찾는 함수 (findBootFirmwareFolder와 유사한 구조)
async function findBuildAxonFolder(): Promise<string | null> {
	const config = getAxonConfig();
	const buildAxonFolderName = config.buildAxonFolderName;

	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		axonLog('❌ 워크스페이스 폴더를 찾을 수 없습니다.');
		axonLog(`⏱️ 워크스페이스 없음 - 소요시간: 0ms`);
		return null;
	}

	// 수행 시간 측정 시작
	const searchStartTime = Date.now();
	axonLog(`🔍 빠른 방식으로 ${buildAxonFolderName} 검색 시작 (depth 4까지): ${workspaceFolders[0].uri.path}`);

	try {
		let result: string | null = null;
		const workspacePath = workspaceFolders[0].uri.path;

		// 워크스페이스 경로에 build-axon 폴더명이 포함되어 있다면 해당 폴더부터 검색
		if (workspacePath.includes(buildAxonFolderName)) {
			axonLog(`✅ 워크스페이스 폴더에 ${buildAxonFolderName}이 포함되어 있습니다: ${workspacePath}`);

			// 워크스페이스 URI에서 설정된 폴더명까지의 경로 추출
			const folderIndex = workspaceFolders[0].uri.path.indexOf(buildAxonFolderName);
			if (folderIndex !== -1) {
				const folderPath = workspaceFolders[0].uri.path.substring(0, folderIndex + buildAxonFolderName.length);
				const folderUri = workspaceFolders[0].uri.with({ path: folderPath });

				axonLog(`🔍 워크스페이스 내 ${buildAxonFolderName} 폴더부터 depth 4까지 검색: ${dirToDisplay(folderUri)}`);

				// 찾은 build-axon 폴더부터 depth 4까지 재귀 검색
				result = await searchBuildAxonInDirectory(folderUri, 0, 4);

				if (result) {
					const searchEndTime = Date.now();
					const searchDuration = searchEndTime - searchStartTime;
					axonLog(`✅ 워크스페이스 내 ${buildAxonFolderName} 폴더를 찾았습니다: ${result}`);
					axonLog(`⏱️ ${buildAxonFolderName} 검색 완료 - 소요시간: ${searchDuration}ms`);
					return result;
				}
			}
		}

		// 일반적인 경우: 워크스페이스 폴더부터 depth 4까지 build-axon 폴더 검색
		axonLog(`🔍 워크스페이스 폴더부터 depth 4까지 ${buildAxonFolderName} 검색: ${dirToDisplay(workspaceFolders[0].uri)}`);

		result = await searchBuildAxonInDirectory(workspaceFolders[0].uri, 0, 4);

		if (result) {
			const searchEndTime = Date.now();
			const searchDuration = searchEndTime - searchStartTime;
			axonLog(`✅ 워크스페이스에서 ${buildAxonFolderName} 폴더를 찾았습니다: ${result}`);
			axonLog(`⏱️ 전체 검색 완료 - 소요시간: ${searchDuration}ms`);
			return result;
		}

		axonLog(`❌ depth 4까지 검색했지만 ${buildAxonFolderName} 폴더를 찾을 수 없습니다.`);

		const searchEndTime = Date.now();
		const searchDuration = searchEndTime - searchStartTime;
		axonLog(`⏱️ 전체 검색 완료 (실패) - 소요시간: ${searchDuration}ms`);
		return null;

	} catch (error) {
		const searchEndTime = Date.now();
		const searchDuration = searchEndTime - searchStartTime;
		axonError(`빠른 방식으로 build-axon 폴더 검색 중 오류 발생: ${error}`);
		axonLog(`⏱️ 검색 중단 (오류) - 소요시간: ${searchDuration}ms`);
		return null;
	}
}

// MCU 빌드 make 실행 함수
async function executeMcuBuildMake(extensionPath: string): Promise<void> {
	axonLog(`🚀 MCU Build Make 실행 명령 시작`);

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	try {
		// build-axon 폴더 찾기
		axonLog(`🔍 build-axon 폴더 자동 검색 시작...`);
		const buildAxonPath = await findBuildAxonFolder();

		if (!buildAxonPath) {
			axonLog(`❌ build-axon 폴더를 찾을 수 없습니다.`);
			vscode.window.showErrorMessage('build-axon 폴더를 찾을 수 없습니다. "Axon: MCU Build Make" 명령을 다시 실행하거나 수동으로 이동해주세요.');
			return;
		}

		axonLog(`✅ build-axon 폴더를 찾았습니다: ${buildAxonPath}`);

		// MCU 빌드 경로 구성 (findBootFirmwareFolder 구조와 유사하게 build-axon 경로에 붙임)
		// path.join 사용하지 말고 직접 경로 구성 (convertRemotePathToSamba 사용 안 함)
		const mcuRelativePath = '/linux_yp4.0_cgw_1.x.x_dev/build/tcn1000-mcu/tmp/work/cortexm7-telechips-linux-musleabi/m7-1/1.0.0-r0/git';
		const mcuBuildPath = buildAxonPath.endsWith('/') ? buildAxonPath + mcuRelativePath.substring(1) : buildAxonPath + mcuRelativePath;
		axonLog(`📁 MCU 빌드 경로: ${mcuBuildPath}`);

		// 환경 감지 및 터미널 생성
		const isRemote = vscode.env.remoteName !== undefined;
		let terminal: vscode.Terminal;

		if (isRemote) {
			// 원격 환경: bash를 사용하는 원격 터미널 생성 (기존 bash 터미널 재사용)
			axonLog(`🔧 원격 환경 감지 - bash 터미널 생성 또는 재사용`);

			// 열려있는 bash 터미널 찾기
			let bashTerminal = vscode.window.terminals.find(term => {
				const terminalName = term.name || '';
				return terminalName.toLowerCase().includes('bash') ||
					   terminalName.toLowerCase().includes('terminal') ||
					   terminalName === '';
			});

			if (bashTerminal) {
				// 기존 bash 터미널이 있으면 재사용
				terminal = bashTerminal;
				axonLog(`✅ 기존 bash 터미널을 재사용합니다: ${bashTerminal.name}`);
			} else {
				// bash 터미널이 없으면 새로 생성
				try {
					await vscode.commands.executeCommand('workbench.action.terminal.new');
					const remoteTerminal = vscode.window.activeTerminal;
					if (remoteTerminal) {
						terminal = remoteTerminal;
						axonLog(`✅ 새 bash 터미널을 생성했습니다`);
					} else {
						throw new Error('원격 bash 터미널 생성에 실패했습니다.');
					}
				} catch {
					// 폴백: 직접 bash 터미널 생성
					terminal = vscode.window.createTerminal({
						name: `MCU Build Make (Bash)`,
						shellPath: 'bash',
						shellArgs: ['--login'],
						isTransient: true
					});
					axonLog(`✅ 폴백으로 bash 터미널을 직접 생성했습니다`);
				}
			}
		} else {
			// 로컬 환경: bash 터미널 생성 또는 재사용
			axonLog(`🔧 로컬 환경 - bash 터미널 생성 또는 재사용`);

			// 열려있는 bash 터미널 찾기
			let bashTerminal = vscode.window.terminals.find(term => {
				const terminalName = term.name || '';
				return terminalName.toLowerCase().includes('bash') ||
					   terminalName.toLowerCase().includes('terminal') ||
					   terminalName === '';
			});

			if (bashTerminal) {
				// 기존 bash 터미널이 있으면 재사용
				terminal = bashTerminal;
				axonLog(`✅ 기존 bash 터미널을 재사용합니다: ${bashTerminal.name}`);
			} else {
				// bash 터미널이 없으면 새로 생성 시도
				try {
					await vscode.commands.executeCommand('workbench.action.terminal.new');
					const basicTerminal = vscode.window.activeTerminal;
					if (basicTerminal) {
						// 새로 생성된 터미널을 사용 (VS Code에서 기본적으로 적절한 shell을 선택)
						terminal = basicTerminal;
						axonLog(`✅ 새 터미널을 생성했습니다: ${basicTerminal.name}`);
					} else {
						throw new Error('기본 터미널 생성에 실패했습니다.');
					}
				} catch {
					// 폴백: 직접 bash 터미널 생성
					terminal = vscode.window.createTerminal({
						name: `MCU Build Make (Bash)`,
						shellPath: 'bash',
						shellArgs: ['--login'],
						isTransient: true
					});
					axonLog(`✅ 폴백으로 bash 터미널을 직접 생성했습니다`);
				}
			}
		}

		// MCU 빌드 디렉토리로 이동 후 make 실행
		terminal.sendText(`cd "${mcuBuildPath}" && make`, true);

		const successMsg = `MCU Build Make이 실행되었습니다! 경로: ${mcuBuildPath}`;
		axonSuccess(successMsg);
		vscode.window.showInformationMessage(successMsg);

		axonLog(`✅ MCU Build Make 실행 완료`);

	} catch (error) {
		const errorMsg = `MCU Build Make 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

// Build and Copy Scripts 실행 함수
async function executeBuildAndCopyScripts(extensionPath: string): Promise<void> {
	try {
		axonLog('🚀 Build and Copy Scripts 시작...');

		// 스크립트 폴더 이름을 'scripts_for_vscode'로 고정
		const scriptsFolderName = 'scripts_for_vscode';
		// buildAxonFolderName 설정을 사용하는 폴더를 지능적으로 찾기
		axonLog('🔍 build-axon 폴더 지능적 검색 시작...');
		const buildAxonPath = await findBuildAxonFolder();

		if (!buildAxonPath) {
			axonError(`❌ build-axon 폴더를 찾을 수 없습니다.`);
			vscode.window.showErrorMessage('build-axon 폴더를 찾을 수 없습니다. "Axon: Configure Project Folder Name" 명령으로 설정하거나, build-axon 폴더를 생성해주세요.');
			return;
		}

		axonLog(`✅ build-axon 폴더를 찾았습니다: ${buildAxonPath}`);

		// 환경 정보 로깅 (vscode.env.remoteName 기반)
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			axonError('❌ 워크스페이스 폴더를 찾을 수 없습니다.');
			vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
			return;
		}

		const isRemoteWorkspace = !!vscode.env.remoteName;
		const remoteName = vscode.env.remoteName || 'local';

		axonLog(`🔍 리모트 이름: ${remoteName}`);
		axonLog(`🔍 extensionPath: ${extensionPath}`);
		axonLog(`🔍 원격 워크스페이스: ${isRemoteWorkspace}`);

		// 원격 워크스페이스인 경우 로그 추가
		if (isRemoteWorkspace) {
			axonLog(`🌐 원격 SSH 환경 감지됨 - 원격 서버로 스크립트 복사`);
		} else {
			axonLog(`💻 로컬 환경 - 로컬에 스크립트 복사`);
		}

		// URI 기반 경로 생성 (vscode.workspace.fs 사용을 위해)
		let buildAxonUri: vscode.Uri;
		if (buildAxonPath.startsWith('vscode-remote://')) {
			// findBuildAxonFolder가 반환한 전체 URI 문자열을 파싱합니다.
			buildAxonUri = vscode.Uri.parse(buildAxonPath, true);
		} else {
			// 로컬 경로일 경우 기존 방식대로 처리합니다.
			buildAxonUri = vscode.Uri.file(buildAxonPath);
		}
		const scriptsTargetUri = vscode.Uri.joinPath(buildAxonUri, scriptsFolderName);
		const sourceScriptsUri = vscode.Uri.joinPath(vscode.Uri.file(extensionPath), 'scripts');

		axonLog(`🔍 buildAxonUri: ${buildAxonUri}`);
		axonLog(`🔍 scriptsTargetUri: ${scriptsTargetUri}`);
		axonLog(`🔍 sourceScriptsUri: ${sourceScriptsUri}`);

		// 소스 스크립트 폴더 확인 (vscode.workspace.fs 사용)
		let sourceFolderExists = false;
		try {
			const sourceStat = await vscode.workspace.fs.stat(sourceScriptsUri);
			sourceFolderExists = (sourceStat.type & vscode.FileType.Directory) === vscode.FileType.Directory;
		} catch (error) {
			sourceFolderExists = false;
		}

		if (!sourceFolderExists) {
			axonError(`❌ 소스 스크립트 폴더를 찾을 수 없습니다: ${sourceScriptsUri}`);
			vscode.window.showErrorMessage('소스 스크립트 폴더를 찾을 수 없습니다.');
			return;
		}

		// 소스 폴더의 파일들 확인
		try {
			const entries = await vscode.workspace.fs.readDirectory(sourceScriptsUri);
			const files = entries.map(([name, type]) => name);
			if (files.length === 0) {
				axonError(`❌ 소스 스크립트 폴더가 비어있습니다: ${sourceScriptsUri}`);
				vscode.window.showErrorMessage('소스 스크립트 폴더가 비어있습니다.');
				return;
			}
			axonLog(`📋 소스 폴더의 파일들: ${files.join(', ')}`);
		} catch (error) {
			axonError(`❌ 소스 스크립트 폴더를 읽을 수 없습니다: ${error}`);
			vscode.window.showErrorMessage('소스 스크립트 폴더를 읽을 수 없습니다.');
			return;
		}

		// 대상 폴더가 이미 존재하면 확인 (vscode.workspace.fs 사용)
		let targetFolderExists = false;
		try {
			const targetStat = await vscode.workspace.fs.stat(scriptsTargetUri);
			targetFolderExists = (targetStat.type & vscode.FileType.Directory) === vscode.FileType.Directory;
			axonLog(`🔍 scriptsTargetUri 폴더 존재 확인: ${targetFolderExists}`);
		} catch (error) {
			axonLog(`❌ scriptsTargetUri 폴더가 존재하지 않습니다: ${error}`);
			targetFolderExists = false;
		}

		if (targetFolderExists) {
			axonLog(`✅ 스크립트 폴더(${scriptsFolderName})가 이미 존재합니다. 파일 내용을 비교합니다.`);

			const sourcePyUri = vscode.Uri.joinPath(sourceScriptsUri, 'mcu_build_and_copy.py');
			const targetPyUri = vscode.Uri.joinPath(scriptsTargetUri, 'mcu_build_and_copy.py');

			const areFilesSame = await areFilesIdentical(sourcePyUri, targetPyUri);

			if (areFilesSame) {
				axonSuccess('✅ 스크립트가 최신 버전입니다. 복사를 건너뜁니다.');
			} else {
				axonLog('⚠️ 로컬 스크립트와 내용이 다릅니다. 덮어쓰기가 필요합니다.');
				const overwrite = await vscode.window.showWarningMessage(
					`'${scriptsFolderName}' 폴더의 스크립트가 최신 버전이 아닙니다. 덮어쓰시겠습니까?`,
					{ modal: true },
					'덮어쓰기'
				);

				if (overwrite !== '덮어쓰기') {
					axonLog('❌ 사용자 취소: 스크립트 복사 중단');
					// 복사는 중단하지만, 기존 스크립트를 실행할지 물어볼 수 있도록 계속 진행
				} else {
					// 덮어쓰기 진행
					axonLog(`📁 기존 스크립트 폴더 삭제: ${scriptsTargetUri}`);
					try {
						await vscode.workspace.fs.delete(scriptsTargetUri, { recursive: true, useTrash: false });
						axonLog(`✅ 기존 스크립트 폴더 삭제 완료`);
						// 복사 로직으로 넘어감
						targetFolderExists = false; // 폴더가 삭제되었으므로 복사 로직을 타도록 설정
					} catch (error) {
						axonError(`❌ 기존 스크립트 폴더 삭제 실패: ${error}`);
						vscode.window.showErrorMessage(`기존 스크립트 폴더 삭제에 실패했습니다.`);
						return;
					}
				}
			}
		}

		// 폴더가 없거나, 덮어쓰기로 결정된 경우 복사 진행
		if (!targetFolderExists) {
			axonLog('📋 스크립트 파일 복사 중...');
			await copyFolderRecursive(sourceScriptsUri, scriptsTargetUri);
			axonSuccess('✅ 스크립트 파일 복사 완료');
		} else {
			axonLog(`✅ 스크립트 폴더가 존재하지 않습니다. 새로 생성합니다.`);
		}

		// 스크립트 파일들 복사 (vscode.workspace.fs 사용)
		axonLog('📋 스크립트 파일 복사 중...');
		try {
			// 대상 디렉토리를 먼저 생성
			await vscode.workspace.fs.createDirectory(scriptsTargetUri);
			axonLog(`✅ 대상 디렉토리 생성 완료: ${scriptsTargetUri}`);

			// workspace.fs 기반으로 복사 함수 호출
			await copyFolderRecursive(sourceScriptsUri, scriptsTargetUri);
			axonLog('✅ 스크립트 파일 복사 완료');
		} catch (error) {
			axonError(`❌ 스크립트 파일 복사 중 오류 발생: ${error}`);
			vscode.window.showErrorMessage(`스크립트 파일 복사 중 오류가 발생했습니다: ${error}`);
			return;
		}

		// 복사된 파일들 확인
		try {
			const entries = await vscode.workspace.fs.readDirectory(scriptsTargetUri);
			const copiedFiles = entries.map(([name, type]) => name);
			axonLog(`✅ 복사된 파일들: ${copiedFiles.join(', ')}`);
		} catch (error) {
			axonError(`❌ 복사된 파일들을 확인할 수 없습니다: ${error}`);
			vscode.window.showErrorMessage('복사된 파일들을 확인할 수 없습니다.');
			return;
		}

		// 특정 파이썬 파일 실행 (mcu_build_and_copy.py)
		const pythonScriptUri = vscode.Uri.joinPath(scriptsTargetUri, 'mcu_build_and_copy.py');
		axonLog(`🔍 pythonScriptUri: ${pythonScriptUri}`);

		// 파일 존재 확인 (vscode.workspace.fs 사용)
		let pythonScriptExists = false;
		try {
			const pythonStat = await vscode.workspace.fs.stat(pythonScriptUri);
			pythonScriptExists = (pythonStat.type & vscode.FileType.File) === vscode.FileType.File;
			axonLog(`✅ 파이썬 스크립트 존재 확인 성공: ${pythonScriptUri}`);
		} catch (error) {
			axonLog(`❌ 파이썬 스크립트 존재 확인 실패: ${error}`);
			pythonScriptExists = false;
		}

		if (pythonScriptExists) {
			axonLog(`🐍 파이썬 스크립트 실행: ${pythonScriptUri}`);

			// 터미널의 CWD(현재 작업 디렉토리)와 실행할 스크립트 경로를 환경에 맞게 설정
			// 원격 환경에서는 fsPath 대신 path를 사용해야 셸이 올바르게 인식합니다.
			const isRemote = !!vscode.env.remoteName;
			const cwdPath = isRemote ? scriptsTargetUri.path : scriptsTargetUri.fsPath;
			const scriptPath = isRemote ? pythonScriptUri.path : pythonScriptUri.fsPath;

			const terminalName = 'Axon MCU Build and Copy';
			let terminal = vscode.window.terminals.find(t => t.name === terminalName);

			if (terminal) {
				axonLog(`🐍 기존 "${terminalName}" 터미널을 재사용합니다.`);
				// 터미널의 작업 디렉토리를 변경해야 할 경우, cd 명령어를 사용합니다.
				terminal.sendText(`cd "${cwdPath}"`);
			} else {
				axonLog(`🐍 새 "${terminalName}" 터미널 생성 - cwd: ${cwdPath}`);
				terminal = vscode.window.createTerminal({
					name: terminalName,
					cwd: cwdPath
				});
			}

			terminal.show();

			// 원격 환경에서는 python3 사용
			const pythonCommand = isRemoteWorkspace ? 'python3' : 'python';
			const command = `${pythonCommand} "${scriptPath}"`;

			axonLog(`🐍 터미널 명령어: ${command}`);
			terminal.sendText(command);

			axonSuccess('🐍 MCU Build and Copy 스크립트 실행을 시작했습니다.');
		}

		const successMsg = `Build and Copy Scripts 완료! 폴더: ${scriptsFolderName}`;
		axonSuccess(successMsg);
		vscode.window.showInformationMessage(successMsg);

	} catch (error) {
		const errorMsg = `Build and Copy Scripts 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

/**
 * 두 파일의 내용이 동일한지 비교하는 함수
 */
async function areFilesIdentical(sourceUri: vscode.Uri, targetUri: vscode.Uri): Promise<boolean> {
	try {
		const [sourceContent, targetContent] = await Promise.all([
			vscode.workspace.fs.readFile(sourceUri),
			vscode.workspace.fs.readFile(targetUri)
		]);

		// Uint8Array를 Node.js의 Buffer로 변환하여 내용을 비교합니다.
		const sourceBuffer = Buffer.from(sourceContent);
		const targetBuffer = Buffer.from(targetContent);

		const areEqual = sourceBuffer.equals(targetBuffer);
		axonLog(`⚖️ 파일 비교 결과 (${sourceUri.path.split('/').pop()}): ${areEqual ? '동일함' : '다름'}`);
		return areEqual;

	} catch (error) {
		// 대상 파일이 없거나 읽기 오류가 발생하면 '다름'으로 간주
		axonLog(`⚠️ 파일 비교 중 오류 발생 (파일이 존재하지 않을 수 있음): ${error}`);
		return false;
	}
}


// 폴더 재귀 복사 함수 (vscode.workspace.fs 기반)
async function copyFolderRecursive(sourceUri: vscode.Uri, targetUri: vscode.Uri): Promise<void> {
	// 대상 디렉토리가 존재하는지 확인하고 생성
	try {
		await vscode.workspace.fs.createDirectory(targetUri);
		axonLog(`📁 대상 디렉토리 생성: ${targetUri}`);
	} catch (error) {
		// 이미 존재하면 무시
	}

	// 소스 디렉토리의 항목들 읽기
	const entries = await vscode.workspace.fs.readDirectory(sourceUri);
	axonLog(`📁 복사할 항목들: ${entries.map(([name, type]) => name).join(', ')}`);

	for (const [fileName, fileType] of entries) {
		const sourcePath = vscode.Uri.joinPath(sourceUri, fileName);
		const targetPath = vscode.Uri.joinPath(targetUri, fileName);

		if (fileType === vscode.FileType.Directory) {
			axonLog(`📂 디렉토리 복사: ${fileName}`);
			await copyFolderRecursive(sourcePath, targetPath);
		} else if (fileType === vscode.FileType.File) {
			axonLog(`📄 파일 복사: ${fileName}`);
			try {
				// 파일 내용 읽기
				const fileContent = await vscode.workspace.fs.readFile(sourcePath);
				// 대상에 파일 쓰기
				await vscode.workspace.fs.writeFile(targetPath, fileContent);
				axonLog(`✅ 파일 복사 완료: ${fileName}`);
			} catch (error) {
				axonError(`❌ 파일 복사 실패: ${fileName}, 오류: ${error}`);
				throw error; // 복사 실패 시 상위로 전파
			}
		}
	}
}

export function deactivate() {}
