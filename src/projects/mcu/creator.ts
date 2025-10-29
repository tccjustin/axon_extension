import * as vscode from 'vscode';
import { axonLog, axonSuccess, axonError } from '../../logger';

/**
 * MCU 프로젝트 생성 데이터
 */
export interface McuProjectData {
	projectName: string;
	projectUri: vscode.Uri;
	gitUrl: string;
	branchName?: string;
}

/**
 * MCU 프로젝트 생성 및 빌드 작업을 처리하는 클래스
 */
export class McuProjectCreator {
	/**
	 * MCU 프로젝트 생성 메인 함수
	 */
	static async createMcuProject(data: McuProjectData): Promise<void> {
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

		// 프로젝트 폴더를 먼저 생성합니다.
		axonLog(`📂 새 프로젝트 폴더 생성: ${projectFullUri.toString()}`);
		await vscode.workspace.fs.createDirectory(projectFullUri);

		// Git Clone을 사용하여 프로젝트 생성
		axonLog(`🔄 Git 저장소에서 프로젝트 생성: ${gitUrl}`);
		const projectPath = projectFullUri.scheme === 'file'
			? projectFullUri.fsPath
			: projectFullUri.path;
		
		// 새로 생성된 폴더 안으로 클론합니다.
		await this.cloneGitRepository(gitUrl, projectPath);
		axonSuccess(`✅ Git 저장소 '${gitUrl}'을(를) '${projectFullUri.toString()}'에 클론했습니다.`);

		// 새 브랜치 이름이 제공된 경우, 브랜치 생성 및 푸시 작업 실행
		if (branchName) {
			axonLog(`🌿 새 브랜치 '${branchName}' 생성 및 푸시 작업을 시작합니다.`);
			await this.createAndPushBranch(branchName, projectPath);
			axonSuccess(`✅ 새 브랜치 '${branchName}'를 원격 저장소에 성공적으로 푸시했습니다.`);
		}

		// MCU 프로젝트 빌드 설정 실행
		axonLog(`🔧 MCU 빌드 설정을 시작합니다: make tcn100x_m7-1_defconfig`);
		await this.runMcuDefconfig(projectPath);
		axonSuccess(`✅ MCU defconfig 설정이 완료되었습니다.`);

		// MCU bootfw 빌드 실행
		axonLog(`🔨 MCU bootfw 빌드를 시작합니다: make bootfw`);
		await this.runMcuBootfw(projectPath);
		axonSuccess(`✅ MCU bootfw 빌드가 완료되었습니다.`);

		// 생성된 프로젝트 폴더를 VS Code에서 열기
		await vscode.commands.executeCommand('vscode.openFolder', projectFullUri, { forceNewWindow: true });
	}

	/**
	 * Git 저장소 클론
	 */
	private static async cloneGitRepository(gitUrl: string, targetDir: string): Promise<void> {
		axonLog(`🔄 Cloning repository using VS Code Tasks API into ${targetDir}...`);
		const command = `git clone --progress "${gitUrl}"`;

		const task = new vscode.Task(
			{ type: 'shell', task: 'gitClone' },
			vscode.TaskScope.Workspace,
			'Git Clone',
			'Axon',
			new vscode.ShellExecution(command, { cwd: targetDir })
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

	/**
	 * 새 브랜치 생성 및 푸시
	 */
	private static async createAndPushBranch(branchName: string, projectDir: string): Promise<void> {
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

	/**
	 * MCU defconfig 실행
	 */
	private static async runMcuDefconfig(projectDir: string): Promise<void> {
		axonLog(`🔄 Running MCU defconfig in: ${projectDir}/mcu-tcn100x`);
		const command = `cd mcu-tcn100x && make tcn100x_m7-1_defconfig`;

		const task = new vscode.Task(
			{ type: 'shell', task: 'mcuDefconfig' },
			vscode.TaskScope.Workspace,
			'MCU Defconfig',
			'Axon',
			new vscode.ShellExecution(command, { cwd: projectDir })
		);

		task.presentationOptions = {
			reveal: vscode.TaskRevealKind.Always,
			focus: true,
			panel: vscode.TaskPanelKind.Shared,
			showReuseMessage: false,
			clear: true
		};

		return new Promise<void>((resolve, reject) => {
			const disposable = vscode.tasks.onDidEndTaskProcess(e => {
				if (e.execution.task.name === 'MCU Defconfig') {
					disposable.dispose();
					if (e.exitCode === 0) {
						resolve();
					} else {
						reject(new Error(`MCU defconfig failed with exit code ${e.exitCode}. Check the terminal for details.`));
					}
				}
			});

			vscode.tasks.executeTask(task).then(undefined, (error) => {
				reject(new Error(`Failed to start MCU defconfig task: ${error}`));
			});
		});
	}

	/**
	 * MCU bootfw 빌드 실행
	 */
	private static async runMcuBootfw(projectDir: string): Promise<void> {
		axonLog(`🔄 Running MCU bootfw build in: ${projectDir}/mcu-tcn100x`);
		const command = `cd mcu-tcn100x && make bootfw`;

		const task = new vscode.Task(
			{ type: 'shell', task: 'mcuBootfw' },
			vscode.TaskScope.Workspace,
			'MCU Bootfw Build',
			'Axon',
			new vscode.ShellExecution(command, { cwd: projectDir })
		);

		task.presentationOptions = {
			reveal: vscode.TaskRevealKind.Always,
			focus: true,
			panel: vscode.TaskPanelKind.Shared,
			showReuseMessage: false,
			clear: true
		};

		return new Promise<void>((resolve, reject) => {
			const disposable = vscode.tasks.onDidEndTaskProcess(e => {
				if (e.execution.task.name === 'MCU Bootfw Build') {
					disposable.dispose();
					if (e.exitCode === 0) {
						resolve();
					} else {
						reject(new Error(`MCU bootfw build failed with exit code ${e.exitCode}. Check the terminal for details.`));
					}
				}
			});

			vscode.tasks.executeTask(task).then(undefined, (error) => {
				reject(new Error(`Failed to start MCU bootfw build task: ${error}`));
			});
		});
	}
}

