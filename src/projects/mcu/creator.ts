import * as vscode from 'vscode';
import { axonLog, axonSuccess, axonError } from '../../logger';
import { PerformanceTracker } from '../../performance-tracker';

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
 * Shell Task 실행 옵션
 */
interface ShellTaskOptions {
	command: string;
	cwd: string;
	taskName: string;
	taskId: string;
	showTerminal?: boolean;  // true: 터미널 표시 및 포커스, false: 숨김 (기본값: false)
}

/**
 * MCU 프로젝트 생성 및 빌드 작업을 처리하는 클래스
 */
export class McuProjectCreator {
	/**
	 * MCU 프로젝트 생성 메인 함수
	 */
	static async createMcuProject(data: McuProjectData, commandStartTime?: number): Promise<void> {
		const { projectName, projectUri, gitUrl, branchName } = data;
		const tracker = new PerformanceTracker(`MCU 프로젝트 생성: ${projectName}`);
		
		if (commandStartTime) {
			const fromCommandElapsed = Date.now() - commandStartTime;
			axonLog(`⏱️ [성능 측정] 커맨드 시작부터 프로젝트 생성 함수까지: ${fromCommandElapsed}ms`);
		}

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
		tracker.checkpointFromLast('프로젝트 폴더 생성');

		// Git Clone을 사용하여 프로젝트 생성
		axonLog(`🔄 Git 저장소에서 프로젝트 생성: ${gitUrl}`);
		const projectPath = projectFullUri.scheme === 'file'
			? projectFullUri.fsPath
			: projectFullUri.path;
		
		// 새로 생성된 폴더 안으로 클론합니다.
		await this.cloneGitRepository(gitUrl, projectPath);
		tracker.checkpointFromLast('Git Clone 완료');
		axonSuccess(`✅ Git 저장소 '${gitUrl}'을(를) '${projectFullUri.toString()}'에 클론했습니다.`);

		// 새 브랜치 이름이 제공된 경우, 브랜치 생성 및 푸시 작업 실행
		if (branchName) {
			axonLog(`🌿 새 브랜치 '${branchName}' 생성 및 푸시 작업을 시작합니다.`);
			await this.createAndPushBranch(branchName, projectPath);
			tracker.checkpointFromLast('브랜치 생성 및 푸시 완료');
			axonSuccess(`✅ 새 브랜치 '${branchName}'를 원격 저장소에 성공적으로 푸시했습니다.`);
		}

		// MCU 프로젝트 빌드 설정 실행
		axonLog(`🔧 MCU 빌드 설정을 시작합니다: make tcn100x_m7-1_defconfig`);
		await this.runMcuDefconfig(projectPath);
		tracker.checkpointFromLast('MCU Defconfig 완료');
		axonSuccess(`✅ MCU defconfig 설정이 완료되었습니다.`);

		// MCU bootfw 빌드 실행
		axonLog(`🔨 MCU bootfw 빌드를 시작합니다: make bootfw`);
		await this.runMcuBootfw(projectPath);
		tracker.checkpointFromLast('MCU Bootfw 빌드 완료');
		axonSuccess(`✅ MCU bootfw 빌드가 완료되었습니다.`);

		// .vscode/settings.json 생성
		axonLog(`⚙️ 프로젝트 설정 파일을 생성합니다: .vscode/settings.json`);
		await this.createVscodeSettings(projectFullUri);
		tracker.checkpointFromLast('VS Code 설정 파일 생성 완료');
		axonSuccess(`✅ 프로젝트 설정 파일이 생성되었습니다.`);

		// 생성된 프로젝트 폴더를 VS Code에서 열기
		await vscode.commands.executeCommand('vscode.openFolder', projectFullUri, { forceNewWindow: true });
		tracker.end('프로젝트 생성 완료');
		
		if (commandStartTime) {
			const totalFromCommand = Date.now() - commandStartTime;
			axonLog(`⏱️ [성능 측정] 커맨드 시작부터 프로젝트 생성 완료까지 총: ${totalFromCommand}ms`);
		}
	}

	/**
	 * Shell Task 실행 공통 함수
	 */
	private static async executeShellTask(options: ShellTaskOptions): Promise<void> {
		const { command, cwd, taskName, taskId, showTerminal = false } = options;
		
		const taskStartTime = Date.now();
		axonLog(`⏱️ [성능 측정] ${taskName} 시작`);

		const task = new vscode.Task(
			{ type: 'shell', task: taskId },
			vscode.TaskScope.Workspace,
			taskName,
			'Axon',
			new vscode.ShellExecution(command, { cwd })
		);

		// 터미널 표시 옵션 설정
		task.presentationOptions = {
			reveal: showTerminal ? vscode.TaskRevealKind.Always : vscode.TaskRevealKind.Silent,
			focus: showTerminal,
			panel: vscode.TaskPanelKind.Shared,
			showReuseMessage: false,
			clear: true
		};

		return new Promise<void>((resolve, reject) => {
			const disposable = vscode.tasks.onDidEndTaskProcess(e => {
				if (e.execution.task.name === taskName) {
					disposable.dispose();
					const taskElapsedTime = Date.now() - taskStartTime;
					if (e.exitCode === 0) {
						axonLog(`⏱️ [성능 측정] ${taskName} 완료: ${taskElapsedTime}ms`);
						resolve();
					} else {
						axonLog(`⏱️ [성능 측정] ${taskName} 실패: ${taskElapsedTime}ms (exit code: ${e.exitCode})`);
						reject(new Error(`${taskName} failed with exit code ${e.exitCode}. Check the terminal for details.`));
					}
				}
			});

			vscode.tasks.executeTask(task).then(undefined, (error) => {
				const taskElapsedTime = Date.now() - taskStartTime;
				axonLog(`⏱️ [성능 측정] ${taskName} 시작 실패: ${taskElapsedTime}ms`);
				reject(new Error(`Failed to start ${taskName} task: ${error}`));
			});
		});
	}

	/**
	 * Git 저장소 클론
	 */
	private static async cloneGitRepository(gitUrl: string, targetDir: string): Promise<void> {
		axonLog(`🔄 Cloning repository using VS Code Tasks API into ${targetDir}...`);
		
		await this.executeShellTask({
			command: `git clone --progress ${gitUrl}`,
			cwd: targetDir,
			taskName: 'Git Clone',
			taskId: 'gitClone',
			showTerminal: true
		});
	}

	/**
	 * 새 브랜치 생성 및 푸시
	 */
	private static async createAndPushBranch(branchName: string, projectDir: string): Promise<void> {
		axonLog(`🔄 Running branch creation task in: ${projectDir}`);
		
		await this.executeShellTask({
			command: `git switch -c ${branchName} && git push -u origin ${branchName}`,
			cwd: projectDir,
			taskName: 'Create and Push Branch',
			taskId: 'createAndPushBranch',
			showTerminal: true
		});
	}

	/**
	 * MCU defconfig 실행
	 */
	private static async runMcuDefconfig(projectDir: string): Promise<void> {
		axonLog(`🔄 Running MCU defconfig in: ${projectDir}/mcu-tcn100x`);
		
		await this.executeShellTask({
			command: `cd mcu-tcn100x && make tcn100x_m7-1_defconfig`,
			cwd: projectDir,
			taskName: 'MCU Defconfig',
			taskId: 'mcuDefconfig',
			showTerminal: true  // 터미널 표시
		});
	}

	/**
	 * MCU bootfw 빌드 실행
	 */
	private static async runMcuBootfw(projectDir: string): Promise<void> {
		axonLog(`🔄 Running MCU bootfw build in: ${projectDir}/mcu-tcn100x`);
		
		await this.executeShellTask({
			command: `cd mcu-tcn100x && make bootfw`,
			cwd: projectDir,
			taskName: 'MCU Bootfw Build',
			taskId: 'mcuBootfw',
			showTerminal: true  // 터미널 표시
		});
	}

	/**
	 * .vscode/settings.json 파일 생성
	 */
	private static async createVscodeSettings(projectFullUri: vscode.Uri): Promise<void> {
		axonLog(`⚙️ .vscode/settings.json 생성 시작`);

		// .vscode 폴더 경로
		const vscodeFolder = vscode.Uri.joinPath(projectFullUri, '.vscode');
		
		// .vscode 폴더 생성
		try {
			await vscode.workspace.fs.createDirectory(vscodeFolder);
			axonLog(`✅ .vscode 폴더 생성 완료: ${vscodeFolder.fsPath}`);
		} catch (error) {
			axonLog(`⚠️ .vscode 폴더가 이미 존재하거나 생성 중 오류: ${error}`);
		}

		// settings.json 파일 경로
		const settingsFile = vscode.Uri.joinPath(vscodeFolder, 'settings.json');

		// 기존 settings.json 읽기 (있으면)
		let existingSettings: any = {};
		try {
			const existingContent = await vscode.workspace.fs.readFile(settingsFile);
			const existingText = Buffer.from(existingContent).toString('utf8');
			existingSettings = JSON.parse(existingText);
			axonLog(`📖 기존 settings.json 파일을 읽었습니다`);
		} catch (error) {
			axonLog(`📝 새로운 settings.json 파일을 생성합니다`);
		}

		// 설정 추가 또는 업데이트
		existingSettings['axon.buildAxonFolderName'] = 'mcu-tcn100x';
		existingSettings['axon.bootFirmwareFolderName'] = 'boot-firmware-tcn100x';

		// JSON 문자열로 변환 (들여쓰기 포함)
		const settingsContent = JSON.stringify(existingSettings, null, 4);

		// 파일 쓰기
		await vscode.workspace.fs.writeFile(settingsFile, Buffer.from(settingsContent, 'utf8'));
		axonLog(`✅ settings.json 파일 저장 완료: ${settingsFile.fsPath}`);
	}
}

