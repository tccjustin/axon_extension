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
}

