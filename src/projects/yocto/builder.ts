import * as vscode from 'vscode';
import { axonLog } from '../../logger';

/**
 * Yocto 프로젝트 빌드 관련 기능
 * 
 * TODO: 향후 구현 예정
 * - Yocto 빌드 프로세스
 * - 이미지 생성
 * - 빌드 결과 검증
 * - 에러 핸들링
 */
export class YoctoProjectBuilder {
	/**
	 * Yocto 빌드 실행
	 * (향후 구현)
	 */
	static async buildYocto(): Promise<void> {
		axonLog('🔨 Yocto 프로젝트 빌드 - 향후 구현 예정');
		throw new Error('Not implemented yet');
	}

	/**
	 * Yocto 이미지 생성
	 * (향후 구현)
	 */
	static async buildImage(): Promise<void> {
		axonLog('📦 Yocto 이미지 생성 - 향후 구현 예정');
		throw new Error('Not implemented yet');
	}

	/**
	 * 클린 빌드 실행
	 * (향후 구현)
	 */
	static async cleanBuild(): Promise<void> {
		axonLog('🧹 Yocto 프로젝트 클린 빌드 - 향후 구현 예정');
		throw new Error('Not implemented yet');
	}
}




