import * as vscode from 'vscode';
import { axonLog } from '../../logger';

/**
 * MCU 프로젝트 빌드 관련 기능
 * 
 * TODO: 향후 구현 예정
 * - 전체 빌드 프로세스
 * - 증분 빌드
 * - 빌드 결과 검증
 * - 에러 핸들링
 */
export class McuProjectBuilder {
	/**
	 * 전체 빌드 실행
	 * (향후 구현)
	 */
	static async buildAll(): Promise<void> {
		axonLog('🔨 MCU 프로젝트 전체 빌드 - 향후 구현 예정');
		throw new Error('Not implemented yet');
	}

	/**
	 * 증분 빌드 실행
	 * (향후 구현)
	 */
	static async buildIncremental(): Promise<void> {
		axonLog('🔨 MCU 프로젝트 증분 빌드 - 향후 구현 예정');
		throw new Error('Not implemented yet');
	}

	/**
	 * 클린 빌드 실행
	 * (향후 구현)
	 */
	static async cleanBuild(): Promise<void> {
		axonLog('🧹 MCU 프로젝트 클린 빌드 - 향후 구현 예정');
		throw new Error('Not implemented yet');
	}
}

