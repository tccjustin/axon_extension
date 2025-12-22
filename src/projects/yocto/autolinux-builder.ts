import * as vscode from 'vscode';
import { axonLog, axonSuccess, axonError } from '../../logger';
import { AutolinuxProjectCreator } from './autolinux-creator';
import { executeShellTask } from '../common/shell-utils';

/**
 * Autolinux 프로젝트 빌드 관리
 */
export class AutolinuxProjectBuilder {
	/**
	 * autolinux 빌드 실행 (QuickPick으로 이미지 선택)
	 */
	static async buildAutolinux(): Promise<void> {
		try {
			// 현재 워크스페이스 확인
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				vscode.window.showErrorMessage('워크스페이스가 열려있지 않습니다.');
				return;
			}

			const projectPath = workspaceFolders[0].uri;
			
			// autolinux.config 파일 확인
			const configUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', 'autolinux.config');
			
			try {
				await vscode.workspace.fs.stat(configUri);
			} catch {
				vscode.window.showErrorMessage('autolinux.config 파일을 찾을 수 없습니다. 먼저 프로젝트를 생성하세요.');
				return;
			}

			// autolinux.config 읽기
			const configContent = await vscode.workspace.fs.readFile(configUri);
			const configText = Buffer.from(configContent).toString('utf-8');
			
			// SDK와 Machine 추출
			const sdkMatch = configText.match(/^SDK=(.+)$/m);
			const machineMatch = configText.match(/^MACHINE=(.+)$/m);
			
			if (!sdkMatch || !machineMatch) {
				vscode.window.showErrorMessage('autolinux.config에서 SDK 또는 MACHINE을 찾을 수 없습니다.');
				return;
			}

			const sdk = sdkMatch[1].trim();
			const machine = machineMatch[1].trim();

			axonLog(`📋 SDK: ${sdk}, Machine: ${machine}`);

			// SDK 템플릿에서 이미지 목록 로드
			const { mainImages, subImages } = await AutolinuxProjectCreator.loadImages(projectPath, sdk, machine);

			// Machine이 sub인지 확인
			const isSub = machine.includes('-sub');
			const images = isSub ? subImages : mainImages;

			if (images.length === 0) {
				vscode.window.showErrorMessage('빌드 가능한 이미지가 없습니다.');
				return;
			}

			// QuickPick으로 이미지 선택
			const selectedImage = await vscode.window.showQuickPick(
				images.map(img => ({
					label: img.name,
					description: img.date,
					detail: isSub ? 'Sub Core Image' : 'Main Core Image'
				})),
				{
					placeHolder: 'Select an image to build',
					title: 'Autolinux Build'
				}
			);

			if (!selectedImage) {
				axonLog('빌드 취소됨');
				return;
			}

			axonLog(`🚀 빌드 시작: ${selectedImage.label}`);

			// 빌드 실행
			const buildPath = vscode.Uri.joinPath(projectPath, 'build-autolinux');
			const buildPathStr = buildPath.scheme === 'file' ? buildPath.fsPath : buildPath.path;

			await executeShellTask({
				command: `./autolinux -c build ${selectedImage.label}`,
				cwd: buildPathStr,
				taskName: `Autolinux Build: ${selectedImage.label}`,
				taskId: 'autolinuxBuild',
				showTerminal: true
			});

			axonSuccess(`✅ 빌드 명령어 실행 완료: ${selectedImage.label}`);

		} catch (error) {
			axonError(`❌ Autolinux 빌드 실패: ${error}`);
			vscode.window.showErrorMessage(`Autolinux 빌드 실패: ${error}`);
		}
	}
}

