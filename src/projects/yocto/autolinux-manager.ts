import * as vscode from 'vscode';
import { axonLog, axonSuccess, axonError } from '../../logger';
import { executeShellTask } from '../common/shell-utils';

/**
 * Autolinux 프로젝트 관리 (update, clean, make_fai, info 등)
 * 
 * ⚠️ 중요: 이 모듈은 원격 환경(WSL/SSH)을 기본으로 설계되었습니다.
 * - 모든 경로는 Unix 형식으로 처리됩니다
 * - build-autolinux 디렉토리에서 ./autolinux 스크립트 실행
 */
export class AutolinuxProjectManager {
	/**
	 * build-autolinux 디렉토리 경로 가져오기
	 */
	private static async getBuildAutolinuxPath(): Promise<string> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
		}

		const buildAutolinuxPath = vscode.Uri.joinPath(workspaceFolder.uri, 'build-autolinux');
		
		// build-autolinux 디렉토리 존재 확인
		try {
			await vscode.workspace.fs.stat(buildAutolinuxPath);
		} catch {
			throw new Error(
				'build-autolinux 디렉토리를 찾을 수 없습니다.\n\n' +
				'먼저 "Yocto Project (autolinux) 생성"을 실행하여 프로젝트를 생성하세요.'
			);
		}

		return buildAutolinuxPath.path;
	}

	/**
	 * autolinux.config 파일 존재 확인
	 */
	private static async checkAutolinuxConfig(): Promise<boolean> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return false;
		}

		const configPath = vscode.Uri.joinPath(workspaceFolder.uri, 'build-autolinux', 'autolinux.config');
		
		try {
			await vscode.workspace.fs.stat(configPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * autolinux -c update: 소스 동기화
	 * manifest.xml에 맞춰 모든 레시피를 동기화 (repo sync)
	 * ⚠️ 주의: 로컬 변경사항이 모두 손실됩니다!
	 */
	static async updateSources(): Promise<void> {
		try {
			axonLog('🔄 Autolinux Update 시작...');

			// build-autolinux 경로 확인
			const buildAutolinuxPath = await this.getBuildAutolinuxPath();

			// autolinux.config 확인
			const hasConfig = await this.checkAutolinuxConfig();
			if (!hasConfig) {
				vscode.window.showErrorMessage(
					'autolinux.config 파일을 찾을 수 없습니다.\n\n' +
					'먼저 "configure"를 실행하여 프로젝트를 설정하세요.'
				);
				return;
			}

			// 경고 메시지 표시 (매우 중요!)
			const confirm = await vscode.window.showWarningMessage(
				'⚠️ 경고: 소스 코드 업데이트\n\n' +
				'manifest.xml에 맞춰 모든 레시피를 동기화합니다.\n' +
				'로컬 변경사항이 모두 손실됩니다!\n\n' +
				'실행 명령: repo sync -c -j16\n\n' +
				'계속하시겠습니까?',
				{ modal: true },
				'업데이트 시작',
				'취소'
			);

			if (confirm !== '업데이트 시작') {
				axonLog('❌ 사용자 취소: Update가 취소되었습니다.');
				return;
			}

			// update 실행
			vscode.window.showInformationMessage('소스 업데이트가 시작되었습니다. 터미널을 확인하세요.');

			await executeShellTask({
				command: `./autolinux -c update`,
				cwd: buildAutolinuxPath,
				taskName: 'Autolinux Update Sources',
				taskId: 'autolinuxUpdate',
				showTerminal: true
			});

			axonSuccess('✅ 소스 업데이트가 완료되었습니다!');
			vscode.window.showInformationMessage('소스 업데이트가 완료되었습니다!');

		} catch (error) {
			const errorMsg = `소스 업데이트 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * autolinux -c clean [option]: 빌드 정리
	 * - clean: 빌드 파일을 recycle 폴더로 이동
	 * - clean old: recycle 폴더 삭제
	 * - clean all: 전체 build 디렉토리 삭제
	 */
	static async cleanBuild(): Promise<void> {
		try {
			axonLog('🧹 Autolinux Clean 시작...');

			// build-autolinux 경로 확인
			const buildAutolinuxPath = await this.getBuildAutolinuxPath();

			// autolinux.config 확인
			const hasConfig = await this.checkAutolinuxConfig();
			if (!hasConfig) {
				vscode.window.showErrorMessage(
					'autolinux.config 파일을 찾을 수 없습니다.\n\n' +
					'먼저 "configure"를 실행하여 프로젝트를 설정하세요.'
				);
				return;
			}

			// Clean 옵션 선택
			const option = await vscode.window.showQuickPick(
				[
					{
						label: 'Clean',
						description: '빌드 파일을 recycle 폴더(build/delete)로 이동',
						detail: '현재 빌드 파일을 삭제하지 않고 이동합니다.'
					},
					{
						label: 'Clean Old',
						description: 'Recycle 폴더(build/delete) 삭제',
						detail: '이전에 이동한 빌드 파일들을 영구 삭제합니다.'
					},
					{
						label: 'Clean All',
						description: '전체 build 디렉토리 삭제 ⚠️',
						detail: '모든 빌드 결과물을 영구 삭제합니다. 되돌릴 수 없습니다!'
					}
				],
				{
					placeHolder: 'Clean 옵션을 선택하세요',
					title: 'Autolinux Clean'
				}
			);

			if (!option) {
				axonLog('❌ 사용자 취소: Clean이 취소되었습니다.');
				return;
			}

			// Clean All인 경우 추가 확인
			if (option.label === 'Clean All') {
				const confirmAll = await vscode.window.showWarningMessage(
					'⚠️ 경고: 전체 빌드 디렉토리 삭제\n\n' +
					'모든 빌드 결과물이 영구적으로 삭제됩니다.\n' +
					'이 작업은 되돌릴 수 없습니다!\n\n' +
					'정말로 삭제하시겠습니까?',
					{ modal: true },
					'삭제',
					'취소'
				);

				if (confirmAll !== '삭제') {
					axonLog('❌ 사용자 취소: Clean All이 취소되었습니다.');
					return;
				}
			}

			// 명령어 구성
			const cmd = option.label === 'Clean' ? 'clean' :
						option.label === 'Clean Old' ? 'clean old' : 'clean all';

			vscode.window.showInformationMessage(`${option.label}이 시작되었습니다. 터미널을 확인하세요.`);

			await executeShellTask({
				command: `./autolinux -c ${cmd}`,
				cwd: buildAutolinuxPath,
				taskName: `Autolinux ${option.label}`,
				taskId: 'autolinuxClean',
				showTerminal: true
			});

			axonSuccess(`✅ ${option.label}이 완료되었습니다!`);
			vscode.window.showInformationMessage(`${option.label}이 완료되었습니다!`);

		} catch (error) {
			const errorMsg = `Clean 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * autolinux -c make_fai: FWDN용 FAI 파일 생성
	 * bitbake {image} -f -c make_fai 실행
	 * 결과: build/{machine}/tmp/deploy/fwdn/SD_Data.fai
	 */
	static async makeFai(): Promise<void> {
		try {
			axonLog('📦 Autolinux Make FAI 시작...');

			// build-autolinux 경로 확인
			const buildAutolinuxPath = await this.getBuildAutolinuxPath();

			// autolinux.config 확인
			const hasConfig = await this.checkAutolinuxConfig();
			if (!hasConfig) {
				vscode.window.showErrorMessage(
					'autolinux.config 파일을 찾을 수 없습니다.\n\n' +
					'먼저 "configure"를 실행하여 프로젝트를 설정하세요.'
				);
				return;
			}

			// 확인 메시지
			const confirm = await vscode.window.showInformationMessage(
				'FWDN용 FAI 파일을 생성하시겠습니까?\n\n' +
				'bitbake {image} -f -c make_fai 를 실행합니다.\n' +
				'결과: build/{machine}/tmp/deploy/fwdn/SD_Data.fai',
				{ modal: true },
				'생성 시작',
				'취소'
			);

			if (confirm !== '생성 시작') {
				axonLog('❌ 사용자 취소: Make FAI가 취소되었습니다.');
				return;
			}

			vscode.window.showInformationMessage('FAI 파일 생성이 시작되었습니다. 터미널을 확인하세요.');

			await executeShellTask({
				command: `./autolinux -c make_fai`,
				cwd: buildAutolinuxPath,
				taskName: 'Autolinux Make FAI',
				taskId: 'autolinuxMakeFai',
				showTerminal: true
			});

			axonSuccess('✅ FAI 파일 생성이 완료되었습니다!');
			vscode.window.showInformationMessage(
				'FAI 파일 생성 완료!\n\n' +
				'경로: build/{machine}/tmp/deploy/fwdn/SD_Data.fai'
			);

		} catch (error) {
			const errorMsg = `FAI 파일 생성 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * autolinux -c info: 현재 설정 정보 표시
	 * autolinux.config 파일 내용 표시
	 */
	static async showInfo(): Promise<void> {
		try {
			axonLog('ℹ️ Autolinux Info 시작...');

			// build-autolinux 경로 확인
			const buildAutolinuxPath = await this.getBuildAutolinuxPath();

			// autolinux.config 확인
			const hasConfig = await this.checkAutolinuxConfig();
			if (!hasConfig) {
				vscode.window.showErrorMessage(
					'autolinux.config 파일을 찾을 수 없습니다.\n\n' +
					'먼저 "configure"를 실행하여 프로젝트를 설정하세요.'
				);
				return;
			}

			await executeShellTask({
				command: `./autolinux -c info`,
				cwd: buildAutolinuxPath,
				taskName: 'Autolinux Info',
				taskId: 'autolinuxInfo',
				showTerminal: true
			});

			axonSuccess('✅ 설정 정보 표시 완료!');

		} catch (error) {
			const errorMsg = `설정 정보 표시 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}

	/**
	 * autolinux -c make_updatedir [option]: OTA 업데이트 디렉토리 생성
	 * bitbake {image} -f -c make_updatedir 실행
	 * 결과: build/{machine}/tmp/deploy/images/{machine}/update/
	 * 전제조건: meta-update Feature 활성화 필요
	 */
	static async makeUpdateDir(): Promise<void> {
		try {
			axonLog('📦 Autolinux Make Update Directory 시작...');

			// build-autolinux 경로 확인
			const buildAutolinuxPath = await this.getBuildAutolinuxPath();

			// autolinux.config 확인
			const hasConfig = await this.checkAutolinuxConfig();
			if (!hasConfig) {
				vscode.window.showErrorMessage(
					'autolinux.config 파일을 찾을 수 없습니다.\n\n' +
					'먼저 "configure"를 실행하여 프로젝트를 설정하세요.'
				);
				return;
			}

			// 옵션 선택 (main/sub/both)
			const option = await vscode.window.showQuickPick(
				[
					{
						label: 'Both (Main + Sub)',
						description: 'Main과 Sub 모두 생성',
						value: ''
					},
					{
						label: 'Main Only',
						description: 'Main core만 생성',
						value: 'main'
					},
					{
						label: 'Sub Only',
						description: 'Sub core만 생성',
						value: 'sub'
					}
				],
				{
					placeHolder: 'Update Directory 옵션을 선택하세요',
					title: 'Autolinux Make Update Directory'
				}
			);

			if (!option) {
				axonLog('❌ 사용자 취소: Make Update Directory가 취소되었습니다.');
				return;
			}

			// 확인 메시지
			const confirm = await vscode.window.showInformationMessage(
				'OTA 업데이트 디렉토리를 생성하시겠습니까?\n\n' +
				`옵션: ${option.label}\n` +
				'bitbake {image} -f -c make_updatedir 를 실행합니다.\n\n' +
				'⚠️ 주의: meta-update Feature가 활성화되어 있어야 합니다.',
				{ modal: true },
				'생성 시작',
				'취소'
			);

			if (confirm !== '생성 시작') {
				axonLog('❌ 사용자 취소: Make Update Directory가 취소되었습니다.');
				return;
			}

			// 명령어 구성
			const cmd = option.value ? `make_updatedir ${option.value}` : 'make_updatedir';

			vscode.window.showInformationMessage('Update Directory 생성이 시작되었습니다. 터미널을 확인하세요.');

			await executeShellTask({
				command: `./autolinux -c ${cmd}`,
				cwd: buildAutolinuxPath,
				taskName: 'Autolinux Make Update Directory',
				taskId: 'autolinuxMakeUpdateDir',
				showTerminal: true
			});

			axonSuccess('✅ Update Directory 생성이 완료되었습니다!');
			vscode.window.showInformationMessage(
				'Update Directory 생성 완료!\n\n' +
				'경로: build/{machine}/tmp/deploy/images/{machine}/update/'
			);

		} catch (error) {
			const errorMsg = `Update Directory 생성 중 오류가 발생했습니다: ${error}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			throw error;
		}
	}
}

