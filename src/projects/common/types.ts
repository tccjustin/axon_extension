import * as vscode from 'vscode';

/**
 * 공통 타입 정의
 */

/**
 * Shell Task 실행 옵션
 */
export interface ShellTaskOptions {
	command: string;
	cwd: string;
	taskName: string;
	taskId: string;
	showTerminal?: boolean;  // true: 터미널 표시 및 포커스, false: 숨김 (기본값: false)
	useScriptFile?: boolean;  // true: 명령어를 heredoc으로 감싸서 실행 (터미널에 명령어 내용 숨김, 기본값: false)
	cwdUri?: vscode.Uri;  // cwd를 URI로 직접 전달 (원격 환경 지원)
}

/**
 * Python Script 실행 옵션
 */
export interface PythonScriptOptions {
	pythonCode: string;  // 실행할 Python 코드
	cwd: string;  // 작업 디렉토리
	taskName: string;  // 작업 이름
	taskId: string;  // 작업 ID (고유해야 함)
	showTerminal?: boolean;  // true: 터미널 표시 및 포커스, false: 숨김 (기본값: false)
	pythonCommand?: string;  // Python 실행 명령어 (기본값: 'python3', 없으면 'python')
	cwdUri?: vscode.Uri;  // cwd를 URI로 직접 전달 (원격 환경 지원)
}

