import * as vscode from 'vscode';
import { axonLog, axonSuccess, axonError } from '../../logger';
import { executeShellTask, cloneGitRepository, createAndPushBranch } from '../common/shell-utils';
import { createVscodeSettings as createVscodeSettingsUtil } from '../common/vscode-utils';

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
		await cloneGitRepository(gitUrl, projectPath, 'MCU');
		axonSuccess(`✅ Git 저장소 '${gitUrl}'을(를) '${projectFullUri.toString()}'에 클론했습니다.`);

		// 새 브랜치 이름이 제공된 경우, 브랜치 생성 및 푸시 작업 실행
		if (branchName) {
			axonLog(`🌿 새 브랜치 '${branchName}' 생성 및 푸시 작업을 시작합니다.`);
			await createAndPushBranch(branchName, projectPath, 'MCU');
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

		// .vscode/settings.json 생성
		axonLog(`⚙️ 프로젝트 설정 파일을 생성합니다: .vscode/settings.json`);
		await createVscodeSettingsUtil(projectFullUri, {
			'axon.projectType': 'mcu_project',
			'axon.buildAxonFolderName': 'mcu-tcn100x'
		});
		axonSuccess(`✅ 프로젝트 설정 파일이 생성되었습니다.`);

		// 생성된 프로젝트 폴더를 VS Code에서 열기
		await vscode.commands.executeCommand('vscode.openFolder', projectFullUri, { forceNewWindow: true });
		axonSuccess(`✅ MCU 프로젝트 생성이 완료되었습니다.`);
	}

	/**
	 * MCU defconfig 실행
	 */
	private static async runMcuDefconfig(projectDir: string): Promise<void> {
		axonLog(`🔄 Running MCU defconfig in: ${projectDir}/mcu-tcn100x`);
		
		await executeShellTask({
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
		
		await executeShellTask({
			command: `cd mcu-tcn100x && make bootfw`,
			cwd: projectDir,
			taskName: 'MCU Bootfw Build',
			taskId: 'mcuBootfw',
			showTerminal: true  // 터미널 표시
		});
	}

}

