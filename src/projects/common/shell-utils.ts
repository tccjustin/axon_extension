import * as vscode from 'vscode';
import { axonLog, axonError } from '../../logger';
import { ShellTaskOptions } from './types';

/**
 * Shell Task 실행 공통 함수 (Yocto 개선 버전)
 */
export async function executeShellTask(options: ShellTaskOptions): Promise<void> {
	const { command, cwd, taskName, taskId, showTerminal = false, useScriptFile = false } = options;
	
	axonLog(`📂 작업 디렉토리: ${cwd}`);
	axonLog(`🔧 실행 명령 길이: ${command.length} bytes`);

	let actualCommand = command;
	let scriptFileUri: vscode.Uri | null = null;

	// 임시 스크립트 파일 생성 (명령어 내용 숨김)
	if (useScriptFile) {
		const scriptFileName = `.axon_temp_${taskId}.sh`;
		
		// cwd를 URI로 변환 (워크스페이스 기준)
		let cwdUri: vscode.Uri;
		
		// 워크스페이스 폴더 가져오기 (원격 환경 자동 감지)
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (workspaceFolder) {
			// 워크스페이스의 scheme을 사용 (file:// 또는 vscode-remote://)
			const wsScheme = workspaceFolder.uri.scheme;
			const wsAuthority = workspaceFolder.uri.authority;
			
			if (wsScheme === 'file') {
				// 로컬 환경
				cwdUri = vscode.Uri.file(cwd);
			} else {
				// 원격 환경 (vscode-remote://)
				cwdUri = vscode.Uri.from({
					scheme: wsScheme,
					authority: wsAuthority,
					path: cwd
				});
			}
		} else {
			// 워크스페이스가 없으면 기본 file URI
			cwdUri = vscode.Uri.file(cwd);
		}
		
		scriptFileUri = vscode.Uri.joinPath(cwdUri, scriptFileName);
		
		axonLog(`📝 임시 스크립트 파일 생성 시작: ${scriptFileName}`);
		axonLog(`🔍 cwdUri: ${cwdUri.toString()}`);
		axonLog(`🔍 scriptFileUri: ${scriptFileUri.toString()}`);
		
		try {
			// 스크립트 내용 작성
			const scriptContent = `#!/bin/bash\nset -e\n${command}`;
			await vscode.workspace.fs.writeFile(scriptFileUri, Buffer.from(scriptContent, 'utf8'));
			axonLog(`✅ 파일 쓰기 완료`);
			
			// 파일 생성 확인
			const stat = await vscode.workspace.fs.stat(scriptFileUri);
			axonLog(`✅ 파일 생성 확인: ${stat.size} bytes`);
			
			// 상대 경로로 스크립트 실행 (cwd 기준)
			actualCommand = `bash "${scriptFileName}"`;
			axonLog(`✅ 실행 명령: ${actualCommand}`);
		} catch (error) {
			axonError(`❌ 임시 스크립트 파일 생성/확인 실패: ${error}`);
			// 실패시 원본 명령어 그대로 사용
			scriptFileUri = null;
			axonLog(`⚠️ 원본 명령어로 폴백`);
		}
	}

	// Task API 사용 (안정적인 완료 감지)
	const task = new vscode.Task(
		{ type: 'shell', task: taskId },
		vscode.TaskScope.Workspace,
		taskName,
		'Axon',
		new vscode.ShellExecution(actualCommand, { cwd })
	);

	// 터미널 표시 옵션 설정
	task.presentationOptions = {
		reveal: showTerminal ? vscode.TaskRevealKind.Always : vscode.TaskRevealKind.Silent,
		focus: showTerminal,
		panel: vscode.TaskPanelKind.Shared,
		showReuseMessage: false,
		clear: false  // 터미널 내용을 지우지 않고 누적
	};

	return new Promise<void>((resolve, reject) => {
		const disposable = vscode.tasks.onDidEndTaskProcess(async e => {
			if (e.execution.task.name === taskName) {
				disposable.dispose();
				
				// 임시 스크립트 파일 삭제
				if (scriptFileUri) {
					try {
						await vscode.workspace.fs.delete(scriptFileUri);
						axonLog(`🗑️ 임시 스크립트 파일 삭제 완료`);
					} catch (error) {
						axonLog(`⚠️ 임시 스크립트 파일 삭제 실패 (무시): ${error}`);
					}
				}
				
				if (e.exitCode === 0) {
					resolve();
				} else {
					reject(new Error(`${taskName} failed with exit code ${e.exitCode}. Check the terminal for details.`));
				}
			}
		});

		vscode.tasks.executeTask(task).then(undefined, (error) => {
			reject(new Error(`Failed to start ${taskName} task: ${error}`));
		});
	});
}

/**
 * Git 저장소 클론
 */
export async function cloneGitRepository(gitUrl: string, targetDir: string, taskPrefix: string = ''): Promise<void> {
	axonLog(`🔄 Cloning repository using VS Code Tasks API into ${targetDir}...`);
	
	await executeShellTask({
		command: `git clone --progress ${gitUrl}`,
		cwd: targetDir,
		taskName: taskPrefix ? `Git Clone (${taskPrefix})` : 'Git Clone',
		taskId: taskPrefix ? `${taskPrefix}GitClone` : 'gitClone',
		showTerminal: true
	});
}

/**
 * 새 브랜치 생성 및 푸시
 */
export async function createAndPushBranch(branchName: string, projectDir: string, taskPrefix: string = ''): Promise<void> {
	axonLog(`🔄 Running branch creation task in: ${projectDir}`);
	
	await executeShellTask({
		command: `git switch -c ${branchName} && git push -u origin ${branchName}`,
		cwd: projectDir,
		taskName: taskPrefix ? `Create and Push Branch (${taskPrefix})` : 'Create and Push Branch',
		taskId: taskPrefix ? `${taskPrefix}CreateAndPushBranch` : 'createAndPushBranch',
		showTerminal: true
	});
}

