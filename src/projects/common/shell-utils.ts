import * as vscode from 'vscode';
import { axonLog, axonError } from '../../logger';
import { ShellTaskOptions } from './types';

/**
 * Shell Task 실행 공통 함수 (Yocto 개선 버전)
 */
export async function executeShellTask(options: ShellTaskOptions): Promise<void> {
	const { command, cwd, taskName, taskId, showTerminal = false, useScriptFile = false, cwdUri: providedCwdUri } = options;
	
	axonLog(`📂 작업 디렉토리: ${cwd}`);
	axonLog(`🔧 실행 명령 길이: ${command.length} bytes`);

	let actualCommand = command;
	let scriptFileUri: vscode.Uri | null = null;

	// 임시 스크립트 파일 생성 (명령어 내용 숨김)
	if (useScriptFile) {
		const scriptFileName = `.axon_temp_${taskId}.sh`;
		
		// cwd를 URI로 변환
		let cwdUri: vscode.Uri;
		
		// providedCwdUri가 제공되면 우선 사용 (프로젝트 생성 중에 유용)
		if (providedCwdUri) {
			cwdUri = providedCwdUri;
			axonLog(`✅ 제공된 cwdUri 사용: ${cwdUri.toString()}`);
		} else {
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
					// cwd가 절대 경로인지 확인
					const normalizedPath = cwd.startsWith('/') ? cwd : `/${cwd}`;
					cwdUri = vscode.Uri.from({
						scheme: wsScheme,
						authority: wsAuthority,
						path: normalizedPath
					});
				}
			} else {
				// 워크스페이스가 없으면 기본 file URI
				cwdUri = vscode.Uri.file(cwd);
			}
		}
		
		scriptFileUri = vscode.Uri.joinPath(cwdUri, scriptFileName);
		
		axonLog(`📝 임시 스크립트 파일 생성 시작: ${scriptFileName}`);
		axonLog(`🔍 cwdUri: ${cwdUri.toString()}`);
		axonLog(`🔍 scriptFileUri: ${scriptFileUri.toString()}`);
		
		try {
			// cwd 폴더가 존재하는지 확인
			try {
				await vscode.workspace.fs.stat(cwdUri);
			} catch (statError) {
				throw new Error(`작업 디렉토리가 존재하지 않습니다: ${cwd}`);
			}
			
			// 스크립트 내용 작성
			const scriptContent = `#!/bin/bash\nset -e\n${command}`;
			await vscode.workspace.fs.writeFile(scriptFileUri, Buffer.from(scriptContent, 'utf8'));
			axonLog(`✅ 파일 쓰기 완료`);
			
			// 파일 생성 확인
			const stat = await vscode.workspace.fs.stat(scriptFileUri);
			axonLog(`✅ 파일 생성 확인: ${stat.size} bytes`);
			
			// 상대 경로로 스크립트 실행 (cwd 기준) + 실행 권한 추가
			actualCommand = `chmod +x "${scriptFileName}" && bash "${scriptFileName}"`;
			axonLog(`✅ 실행 명령: ${actualCommand}`);
		} catch (error) {
			axonError(`❌ 임시 스크립트 파일 생성/확인 실패: ${error}`);
			// 실패시 원본 명령어 그대로 사용
			scriptFileUri = null;
			actualCommand = command;
			axonLog(`⚠️ 원본 명령어로 폴백`);
		}
	}

	// Task API 사용 (안정적인 완료 감지)
	// cwd는 항상 전달 (Unix 경로 또는 Windows 경로)
	// 호출자가 환경에 맞는 경로를 전달할 책임이 있음
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
 * 리눅스 shell 스크립트로 프로젝트 루트 찾기 (공통 함수)
 * 
 * find 명령어를 사용하여 파일/디렉토리를 찾고 상위 디렉토리의 절대 경로를 계산하여 임시 파일에 저장합니다.
 * 이 함수는 Yocto 프로젝트 루트 찾기와 MCU 프로젝트 루트 찾기에서 공통으로 사용됩니다.
 * 
 * @example
 * // Yocto 프로젝트 루트 찾기 (poky 디렉토리 찾기)
 * const yoctoRoot = await findProjectRootByShell({
 *   workspaceFolder,
 *   findPattern: 'poky',
 *   maxDepth: 3,
 *   findType: 'd',
 *   parentLevels: 1,
 *   excludePattern: '*\/.repo\/*',
 *   taskName: 'Find Yocto Project Root',
 *   taskId: 'find-yocto-root',
 *   resultFilePrefix: 'axon_project_root'
 * });
 * 
 * @example
 * // MCU 프로젝트 루트 찾기 (tcn100x_defconfig 파일 찾기)
 * const mcuRoot = await findProjectRootByShell({
 *   workspaceFolder,
 *   findPattern: 'tcn100x_defconfig',
 *   maxDepth: 4,
 *   findType: 'f',
 *   parentLevels: 3,
 *   taskName: 'Find MCU Project Root',
 *   taskId: 'find-mcu-root',
 *   resultFilePrefix: 'axon_mcu_project_root'
 * });
 * 
 * @param options - 찾기 옵션
 * @param options.workspaceFolder - 워크스페이스 폴더
 * @param options.findPattern - 찾을 파일/디렉토리 이름 (예: "poky", "tcn100x_defconfig")
 * @param options.maxDepth - 최대 탐색 깊이 (예: 3, 4)
 * @param options.findType - 'd': directory, 'f': file
 * @param options.parentLevels - 상위 몇 단계로 올라갈지 (예: 1, 3)
 * @param options.excludePattern - 제외할 패턴 (선택적, 예: "*\/.repo\/*")
 * @param options.taskName - 작업 이름 (예: "Find Yocto Project Root")
 * @param options.taskId - 작업 ID (예: "find-yocto-root")
 * @param options.resultFilePrefix - 결과 파일 접두사 (예: "axon_project_root")
 * @returns 프로젝트 루트의 절대 경로 또는 null
 * 
 * @see YoctoProjectBuilder.findYoctoProjectRootByShell - Yocto 프로젝트 루트 찾기 사용 예시
 * @see McuProjectBuilder.findMcuProjectRootByShell - MCU 프로젝트 루트 찾기 사용 예시
 */
export async function findProjectRootByShell(options: {
	workspaceFolder: vscode.WorkspaceFolder;
	findPattern: string;        // 찾을 파일/디렉토리 이름 (예: "poky", "tcn100x_defconfig")
	maxDepth: number;           // 최대 탐색 깊이 (예: 3, 4)
	findType: 'd' | 'f';        // 'd': directory, 'f': file
	parentLevels: number;       // 상위 몇 단계로 올라갈지 (예: 1, 3)
	excludePattern?: string;    // 제외할 패턴 (선택적, 예: "*/.repo/*")
	taskName: string;           // 작업 이름 (예: "Find Yocto Project Root")
	taskId: string;             // 작업 ID (예: "find-yocto-root")
	resultFilePrefix: string;   // 결과 파일 접두사 (예: "axon_project_root")
}): Promise<string | null> {
	const {
		workspaceFolder,
		findPattern,
		maxDepth,
		findType,
		parentLevels,
		excludePattern,
		taskName,
		taskId,
		resultFilePrefix
	} = options;

	const workspacePath = workspaceFolder.uri.path;
	const resultFile = `.${resultFilePrefix}_${Date.now()}.txt`;
	const resultFileUri = vscode.Uri.joinPath(workspaceFolder.uri, resultFile);
	
	try {
		// find 명령어 구성
		let findCommand = `find . -maxdepth ${maxDepth} -name ${findPattern} -type ${findType}`;
		if (excludePattern) {
			findCommand += ` -not -path "${excludePattern}"`;
		}
		findCommand += ` | head -1`;
		
		// 상위 디렉토리로 올라가는 명령어 생성 (dirname 중첩)
		// 예: parentLevels=1이면 dirname "$FOUND_PATH"
		//     parentLevels=3이면 dirname "$(dirname "$(dirname "$FOUND_PATH")")"
		let dirnameCommand = '$FOUND_PATH';
		for (let i = 0; i < parentLevels; i++) {
			if (i === 0) {
				// 첫 번째: dirname "$FOUND_PATH"
				dirnameCommand = `dirname "${dirnameCommand}"`;
			} else {
				// 이후: dirname "$(이전 결과)" - $()로 감싸서 실행 결과를 사용
				dirnameCommand = `dirname "$(${dirnameCommand})"`;
			}
		}
		
		// shell 스크립트: 파일/디렉토리 찾기 + 상위 디렉토리 절대 경로 계산 + 워크스페이스 루트에 임시 파일 저장
		// dirnameCommand는 명령어이므로 $()로 감싸서 실행 결과를 경로로 사용
		const shellScript = `WORKSPACE_ROOT="$(pwd)"; ` +
			`FOUND_PATH=$(${findCommand}); ` +
			`if [ -n "$FOUND_PATH" ]; then ` +
			`  cd "$(${dirnameCommand})" && ` +
			`  PROJECT_ROOT="$(pwd)"; ` +
			`  cd "$WORKSPACE_ROOT" && ` +
			`  echo "$PROJECT_ROOT" > "${resultFile}"; ` +
			`fi`;
		
		const task = new vscode.Task(
			{ type: 'shell', task: taskId },
			vscode.TaskScope.Workspace,
			taskName,
			'Axon',
			new vscode.ShellExecution(shellScript, { cwd: workspacePath })
		);
		
		task.presentationOptions = {
			reveal: vscode.TaskRevealKind.Silent,
			focus: false,
			panel: vscode.TaskPanelKind.Shared,
			showReuseMessage: false,
			clear: false
		};
		
		// 작업 실행 및 완료 대기
		await new Promise<void>((resolve, reject) => {
			const disposable = vscode.tasks.onDidEndTaskProcess(e => {
				if (e.execution.task.name === taskName) {
					disposable.dispose();
					if (e.exitCode === 0) {
						resolve();
					} else {
						// exitCode가 0이 아니어도 파일이 생성되었을 수 있으므로 resolve
						axonLog(`⚠️ shell 스크립트 exitCode: ${e.exitCode}, 하지만 계속 진행합니다.`);
						resolve();
					}
				}
			});
			vscode.tasks.executeTask(task).then(undefined, reject);
		});
		
		// 임시 파일 존재 확인 및 읽기
		let projectRoot: string | null = null;
		try {
			const stat = await vscode.workspace.fs.stat(resultFileUri);
			if (stat.type === vscode.FileType.File) {
				const resultContent = await vscode.workspace.fs.readFile(resultFileUri);
				projectRoot = Buffer.from(resultContent).toString('utf8').trim();
				
				if (projectRoot) {
					axonLog(`📄 임시 파일에서 프로젝트 루트 읽기 성공: ${projectRoot}`);
				} else {
					axonLog(`⚠️ 임시 파일이 비어있습니다.`);
				}
			} else {
				axonLog(`⚠️ 임시 파일이 디렉토리입니다.`);
			}
		} catch (fileError) {
			axonLog(`⚠️ 임시 파일 읽기 실패: ${fileError}`);
			// 파일이 없을 수도 있으므로 계속 진행
		}
		
		// 임시 파일 삭제 (읽기 성공 여부와 관계없이)
		try {
			await vscode.workspace.fs.delete(resultFileUri);
			axonLog(`🗑️ 임시 파일 삭제 완료: ${resultFile}`);
		} catch (deleteError) {
			axonLog(`⚠️ 임시 파일 삭제 실패 (무시): ${deleteError}`);
		}
		
		return projectRoot;
	} catch (error) {
		axonLog(`⚠️ shell 스크립트 실행 중 오류 발생: ${error}`);
		if (error instanceof Error) {
			axonLog(`   오류 상세: ${error.message}`);
			axonLog(`   스택: ${error.stack}`);
		}
		
		// 에러 발생 시에도 임시 파일 삭제 시도
		try {
			await vscode.workspace.fs.delete(resultFileUri);
			axonLog(`🗑️ 임시 파일 삭제 완료 (에러 후): ${resultFile}`);
		} catch {
			// 무시
		}
		
		return null;
	}
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


