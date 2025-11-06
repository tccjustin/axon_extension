import * as vscode from 'vscode';
import { axonLog } from '../../logger';

/**
 * .vscode/settings.json 파일 생성 (MCU 버전)
 */
export async function createVscodeSettings(projectFullUri: vscode.Uri, settings: Record<string, any>): Promise<void> {
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
	Object.assign(existingSettings, settings);

	// JSON 문자열로 변환 (들여쓰기 포함)
	const settingsContent = JSON.stringify(existingSettings, null, 4);

	// 파일 쓰기
	await vscode.workspace.fs.writeFile(settingsFile, Buffer.from(settingsContent, 'utf8'));
	axonLog(`✅ settings.json 파일 저장 완료: ${settingsFile.fsPath}`);
}


