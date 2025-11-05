import * as vscode from 'vscode';
import { axonLog, axonSuccess, axonError } from '../../logger';

/**
 * Yocto 프로젝트 생성 데이터
 */
export interface YoctoProjectData {
	projectName: string;
	projectUri: vscode.Uri;
	gitUrl?: string;
	branchName?: string;
	manifestGitUrl?: string;
	selectedManifest?: string;
}

/**
 * Shell Task 실행 옵션
 */
interface ShellTaskOptions {
	command: string;
	cwd: string;
	taskName: string;
	taskId: string;
	showTerminal?: boolean;  // true: 터미널 표시 및 포커스, false: 숨김 (기본값: false)
}

/**
 * Yocto 프로젝트 생성 및 빌드 작업을 처리하는 클래스
 */
export class YoctoProjectCreator {
	/**
	 * Yocto 프로젝트 생성 메인 함수
	 */
	static async createYoctoProject(data: YoctoProjectData): Promise<void> {
		const { projectName, projectUri, gitUrl, branchName, manifestGitUrl, selectedManifest } = data;

		const projectFullUri = vscode.Uri.joinPath(projectUri, projectName);

		// 프로젝트 폴더 존재 여부 확인 및 생성
		let folderAlreadyExists = false;
		try {
			const stat = await vscode.workspace.fs.stat(projectFullUri);
			folderAlreadyExists = true;
			
			// Manifest 기반 생성인 경우, Load 단계에서 생성된 폴더일 수 있으므로 허용
			if (manifestGitUrl && selectedManifest) {
				axonLog(`📁 프로젝트 폴더가 이미 존재합니다 (Manifest Load 단계에서 생성됨): ${projectFullUri.toString()}`);
			} else {
				// Git Clone 방식인 경우는 폴더가 비어있어야 함
				throw new Error(`프로젝트 폴더 '${projectName}'이(가) 이미 '${projectUri.toString()}' 위치에 존재합니다.`);
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('존재합니다')) {
				throw error; // 폴더 존재 오류는 그대로 전달
			}
			// 'FileNotFound' 오류는 정상적인 경우이므로 무시하고 계속 진행
			folderAlreadyExists = false;
		}

		// 프로젝트 폴더 생성 (아직 없는 경우만)
		if (!folderAlreadyExists) {
			axonLog(`📂 새 Yocto 프로젝트 폴더 생성: ${projectFullUri.toString()}`);
			await vscode.workspace.fs.createDirectory(projectFullUri);
		} else {
			axonLog(`📂 기존 Yocto 프로젝트 폴더 사용: ${projectFullUri.toString()}`);
		}

		const projectPath = projectFullUri.scheme === 'file'
			? projectFullUri.fsPath
			: projectFullUri.path;

		// Manifest 기반 프로젝트 생성 (repo init/sync 방식)
		if (manifestGitUrl && selectedManifest) {
			axonLog(`🔄 Manifest 기반 Yocto 프로젝트 생성: ${selectedManifest}`);
			axonLog(`ℹ️ Buildscript는 이미 Load 단계에서 클론되었습니다.`);
			
			// 원격 환경 감지 (vscode-remote, ssh 등)
			const isRemote = projectUri.scheme !== 'file';
			axonLog(`🌐 실행 환경: ${isRemote ? '원격 (Remote SSH/WSL)' : '로컬'} (scheme: ${projectUri.scheme})`);
			
			// SDK 이름 추출 (manifest 파일명에서)
			const sdkName = selectedManifest.replace('.xml', '');
			
			// 1. SDK 폴더 생성 (build-axon 안에)
			// 최종 구조: project_root/build-axon/linux_yp4.0_cgw_1.x.x_dev/
			const buildAxonPath = vscode.Uri.joinPath(projectFullUri, 'build-axon');
			const sdkPath = vscode.Uri.joinPath(buildAxonPath, sdkName);
			axonLog(`📂 SDK 폴더 생성: ${sdkPath.toString()}`);
			await vscode.workspace.fs.createDirectory(sdkPath);
			
			const sdkFsPath = sdkPath.scheme === 'file' ? sdkPath.fsPath : sdkPath.path;
			
			// 최종 구조: 
			// project_root/
			//   └── build-axon/
			//       └── linux_yp4.0_cgw_1.x.x_dev/  (SDK 폴더 - 이 안에서 repo init/sync)
			
			// 2. repo init (SDK 폴더 안에서)
			axonLog(`🔄 repo init 실행: ${selectedManifest} (위치: ${sdkFsPath})`);
			await this.repoInit(manifestGitUrl, selectedManifest, sdkFsPath);
			axonSuccess(`✅ repo init이 완료되었습니다.`);
			
			// 3. repo sync (SDK 폴더 안에서)
			axonLog(`🔄 repo sync 실행...`);
			await this.repoSync(sdkFsPath, isRemote);
			axonSuccess(`✅ repo sync가 완료되었습니다.`);
			
			// 4. build script 심볼릭 링크 생성 (SDK 폴더 안에)
			const buildScriptSourcePath = `${projectPath}/build-axon/buildscripts/build-axon.py`;
			axonLog(`🔗 Build script 심볼릭 링크 생성...`);
			await this.createBuildScriptSymlink(buildScriptSourcePath, sdkFsPath, sdkName, isRemote);
			axonSuccess(`✅ Build script 심볼릭 링크가 생성되었습니다.`);
			
			// 5. auto-setup 실행 (SDK 폴더에서)
			axonLog(`⚙️ Auto-setup 실행...`);
			await this.runAutoSetup(sdkFsPath, sdkName, isRemote);
			axonSuccess(`✅ Auto-setup이 완료되었습니다.`);
		}
		// Git Clone 방식 (기존 방식)
		else if (gitUrl) {
			axonLog(`🔄 Git 저장소에서 Yocto 프로젝트 생성: ${gitUrl}`);
			
			// 새로 생성된 폴더 안으로 클론합니다.
			await this.cloneGitRepository(gitUrl, projectPath);
			axonSuccess(`✅ Git 저장소 '${gitUrl}'을(를) '${projectFullUri.toString()}'에 클론했습니다.`);

			// 새 브랜치 이름이 제공된 경우, 브랜치 생성 및 푸시 작업 실행
			if (branchName) {
				axonLog(`🌿 새 브랜치 '${branchName}' 생성 및 푸시 작업을 시작합니다.`);
				await this.createAndPushBranch(branchName, projectPath);
				axonSuccess(`✅ 새 브랜치 '${branchName}'를 원격 저장소에 성공적으로 푸시했습니다.`);
			}
		}

		// .vscode/settings.json 생성
		axonLog(`⚙️ Yocto 프로젝트 설정 파일을 생성합니다: .vscode/settings.json`);
		await this.createVscodeSettings(projectFullUri);
		axonSuccess(`✅ 프로젝트 설정 파일이 생성되었습니다.`);

		// 생성된 프로젝트 폴더를 VS Code에서 열기
		await vscode.commands.executeCommand('vscode.openFolder', projectFullUri, { forceNewWindow: true });
		axonSuccess(`✅ Yocto 프로젝트 생성이 완료되었습니다.`);
	}

	/**
	 * Shell Task 실행 공통 함수
	 */
	private static async executeShellTask(options: ShellTaskOptions): Promise<void> {
		const { command, cwd, taskName, taskId, showTerminal = false } = options;
		
		axonLog(`📂 작업 디렉토리: ${cwd}`);
		axonLog(`🔧 실행 명령: ${command}`);

		const task = new vscode.Task(
			{ type: 'shell', task: taskId },
			vscode.TaskScope.Workspace,
			taskName,
			'Axon',
			new vscode.ShellExecution(command, { cwd })
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
			const disposable = vscode.tasks.onDidEndTaskProcess(e => {
				if (e.execution.task.name === taskName) {
					disposable.dispose();
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
	 * Buildscript 클론
	 */
	private static async cloneBuildscript(projectPath: string): Promise<void> {
		axonLog(`🔄 Cloning buildscript repository...`);
		
		await this.executeShellTask({
			command: `git clone ssh://git@bitbucket.telechips.com:7999/axon/build-axon.git -b dev`,
			cwd: projectPath,
			taskName: 'Clone Buildscript (Yocto)',
			taskId: 'yoctoCloneBuildscript',
			showTerminal: true
		});
	}

	/**
	 * Git 저장소 클론
	 */
	private static async cloneGitRepository(gitUrl: string, targetDir: string): Promise<void> {
		axonLog(`🔄 Cloning Yocto repository using VS Code Tasks API into ${targetDir}...`);
		
		await this.executeShellTask({
			command: `git clone --progress ${gitUrl}`,
			cwd: targetDir,
			taskName: 'Git Clone (Yocto)',
			taskId: 'yoctoGitClone',
			showTerminal: true
		});
	}

	/**
	 * 새 브랜치 생성 및 푸시
	 */
	private static async createAndPushBranch(branchName: string, projectDir: string): Promise<void> {
		axonLog(`🔄 Running Yocto branch creation task in: ${projectDir}`);
		
		await this.executeShellTask({
			command: `git switch -c ${branchName} && git push -u origin ${branchName}`,
			cwd: projectDir,
			taskName: 'Create and Push Branch (Yocto)',
			taskId: 'yoctoCreateAndPushBranch',
			showTerminal: true
		});
	}

	/**
	 * .vscode/settings.json 파일 생성
	 */
	private static async createVscodeSettings(projectFullUri: vscode.Uri): Promise<void> {
		axonLog(`⚙️ .vscode/settings.json 생성 시작 (Yocto)`);

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

		// 설정 추가 또는 업데이트 (Yocto 전용 설정)
		existingSettings['axon.projectType'] = 'yocto';

		// JSON 문자열로 변환 (들여쓰기 포함)
		const settingsContent = JSON.stringify(existingSettings, null, 4);

		// 파일 쓰기
		await vscode.workspace.fs.writeFile(settingsFile, Buffer.from(settingsContent, 'utf8'));
		axonLog(`✅ settings.json 파일 저장 완료: ${settingsFile.fsPath}`);
	}

	/**
	 * repo init 실행
	 */
	private static async repoInit(manifestGitUrl: string, manifestFile: string, targetDir: string): Promise<void> {
		axonLog(`🔄 Running repo init in: ${targetDir}`);
		
		await this.executeShellTask({
			command: `repo init -u ${manifestGitUrl} -m ${manifestFile}`,
			cwd: targetDir,
			taskName: 'Repo Init (Yocto)',
			taskId: 'yoctoRepoInit',
			showTerminal: true
		});
	}

	/**
	 * repo sync 실행
	 */
	private static async repoSync(targetDir: string, isRemote: boolean = false): Promise<void> {
		axonLog(`🔄 Running repo sync in: ${targetDir}`);
		
		// 원격 환경(SSH, WSL 등) 또는 로컬 리눅스에서는 nproc 사용
		// 로컬 Windows에서만 NUMBER_OF_PROCESSORS 사용
		const syncCommand = (!isRemote && process.platform === 'win32')
			? 'repo sync -j%NUMBER_OF_PROCESSORS%'
			: 'repo sync -j$(nproc)';
		
		axonLog(`🔧 Sync 명령: ${syncCommand} (원격: ${isRemote}, 플랫폼: ${process.platform})`);
		
		await this.executeShellTask({
			command: syncCommand,
			cwd: targetDir,
			taskName: 'Repo Sync (Yocto)',
			taskId: 'yoctoRepoSync',
			showTerminal: true
		});
	}

	/**
	 * Build script 심볼릭 링크 생성
	 * 
	 * 원격 환경: shell 명령으로 심볼릭 링크 생성
	 * 로컬 리눅스: Node.js fs로 심볼릭 링크 생성
	 * 로컬 Windows: 파일 복사 (심볼릭 링크는 관리자 권한 필요)
	 */
	private static async createBuildScriptSymlink(sourcePath: string, sdkPath: string, sdkName: string, isRemote: boolean = false): Promise<void> {
		axonLog(`🔗 Creating build script link (원격: ${isRemote}, platform: ${process.platform})`);
		
		const path = require('path');
		const linkName = `build-${sdkName}`;
		const linkPath = path.join(sdkPath, linkName);
		
		// 원격 환경: shell 명령 사용 (VS Code Remote가 알아서 처리)
		if (isRemote) {
			axonLog(`🌐 원격 환경에서 심볼릭 링크 생성: ${linkPath}`);
			
			// 상대 경로로 심볼릭 링크 생성
			// SDK 위치: build-axon/linux_yp4.0_cgw_1.x.x_dev/
			// 타겟: build-axon/buildscripts/build-axon.py
			// 따라서: ../buildscripts/build-axon.py
			const relativeSource = `../buildscripts/build-axon.py`;
			
			axonLog(`🔗 심볼릭 링크: ${linkName} -> ${relativeSource}`);
			
			await this.executeShellTask({
				command: `ln -sf "${relativeSource}" "${linkName}" && chmod +x "${linkName}"`,
				cwd: sdkPath,
				taskName: 'Create Build Script Link (Yocto)',
				taskId: 'yoctoCreateBuildLink',
				showTerminal: false
			});
			
			axonLog(`✅ 원격 환경에서 Build script 심볼릭 링크를 생성했습니다: ${linkPath}`);
		} 
		// 로컬 환경: Node.js fs 모듈 사용
		else {
			const fs = require('fs');
			
			try {
				if (fs.existsSync(linkPath)) {
					axonLog(`⚠️ 링크가 이미 존재합니다: ${linkPath}`);
					return;
				}
				
				// 로컬 Windows: 파일 복사 (심볼릭 링크는 관리자 권한 필요)
				if (process.platform === 'win32') {
					fs.copyFileSync(sourcePath, linkPath);
					axonLog(`✅ 로컬 Windows에서 Build script를 복사했습니다: ${linkPath}`);
				} else {
					// 로컬 리눅스: 심볼릭 링크 생성
					fs.symlinkSync(sourcePath, linkPath);
					fs.chmodSync(linkPath, 0o755);
					axonLog(`✅ 로컬 리눅스에서 Build script 심볼릭 링크를 생성했습니다: ${linkPath}`);
				}
			} catch (error) {
				axonError(`❌ Build script 링크 생성 실패: ${error}`);
				throw error;
			}
		}
	}

	/**
	 * Auto-setup 실행
	 * build-axon.py의 --auto-setup 옵션 로직과 download.sh의 내용을 구현
	 */
	private static async runAutoSetup(sdkPath: string, sdkName: string, isRemote: boolean = false): Promise<void> {
		axonLog(`⚙️ Running auto-setup in: ${sdkPath}`);
		axonLog(`🌐 실행 환경: ${isRemote ? '원격 (Remote SSH/WSL)' : '로컬'}`);
		
		// 1. buildtools/environment-setup 파일 존재 여부 확인 (shell 명령 사용 - 원격 지원)
		const envSetupRelativePath = 'buildtools/environment-setup-x86_64-pokysdk-linux';
		axonLog(`🔍 Buildtools 설치 확인: ${envSetupRelativePath}`);
		
		try {
			// shell 명령으로 파일 존재 확인 (원격 환경 지원)
			// 항상 성공하는 명령으로 변경 (exit code 0)
			await this.executeShellTask({
				command: `if [ -f ${envSetupRelativePath} ]; then echo "EXISTS"; exit 0; else echo "NOT_EXISTS"; exit 1; fi`,
				cwd: sdkPath,
				taskName: 'Check Buildtools (Yocto)',
				taskId: 'yoctoCheckBuildtools',
				showTerminal: false
			});
			
			// 파일이 존재하면 여기까지 도달
			axonLog(`✅ Buildtools가 이미 설치되어 있습니다: ${envSetupRelativePath}`);
			return;
		} catch (error) {
			// 파일이 존재하지 않으면 catch로 들어옴
			axonLog(`⚙️ Buildtools가 설치되지 않았습니다. 설치를 시작합니다...`);
		}
		// 압축 해제 후 10초 대기 (파일 시스템 동기화 대기)
		axonLog(`⏳ 파일 시스템 동기화를 위해 10초 대기 중...`);
		await new Promise(resolve => setTimeout(resolve, 10000));
		axonLog(`✅ 대기 완료`);
		
		// 2. download.sh의 내용을 shell 명령으로 구현 (원격 환경 지원)
		// poky 디렉토리는 상대 경로로 접근
		const pokyRelativePath = 'poky';
		
		// FTP 설정 (download.sh에서 가져옴)
		const FTP_ADDR = "rf.telechips.com";
		const FTP_USER = "customer";
		const FTP_PASS = "telecustomer12!";
		const DL_SOURCE_MIRROR_DIR = "source-mirror";
		const TOOLS_FILE = "tools-kirkstone.tar.gz";
		
		axonLog(`📥 Tools 다운로드 시작...`);
		axonLog(`ℹ️ This may take a long time depending on your network environment.`);
		
		// 2-1. tools-kirkstone.tar.gz 다운로드
		axonLog(`🔽 Downloading ${TOOLS_FILE} from FTP server...`);
		
		const downloadToolsCommand = `ncftp -u ${FTP_USER} -p ${FTP_PASS} ${FTP_ADDR} &> /dev/null << 'End-Of-Session'
bin
get /share/${TOOLS_FILE}
bye
End-Of-Session`;
		
		await this.executeShellTask({
			command: downloadToolsCommand,
			cwd: `${sdkPath}`,
			taskName: 'Download Tools (Yocto)',
			taskId: 'yoctoDownloadTools',
			showTerminal: true
		});
		
		axonSuccess(`✅ Tools 다운로드 완료`);

				// 압축 해제 후 10초 대기 (파일 시스템 동기화 대기)
		axonLog(`⏳ 파일 시스템 동기화를 위해 10초 대기 중...`);
		await new Promise(resolve => setTimeout(resolve, 10000));
		axonLog(`✅ 대기 완료`);

		// 2-2. tar 압축 해제 및 파일 삭제 (한 번에 처리)
		axonLog(`📦 Extracting ${TOOLS_FILE}...`);
		
		const extractAndCleanCommand = `tar xzf ${TOOLS_FILE} &> /dev/null && rm ${TOOLS_FILE}`;
		
		await this.executeShellTask({
			command: extractAndCleanCommand,
			cwd: `${sdkPath}`,
			taskName: 'Extract Tools (Yocto)',
			taskId: 'yoctoExtractTools',
			showTerminal: true
		});
		
		axonSuccess(`✅ Tools 압축 해제 및 정리 완료`);
		
		// 압축 해제 후 10초 대기 (파일 시스템 동기화 대기)
		axonLog(`⏳ 파일 시스템 동기화를 위해 10초 대기 중...`);
		await new Promise(resolve => setTimeout(resolve, 10000));
		axonLog(`✅ 대기 완료`);
		
		// 2-3. source-mirror 디렉토리 생성 및 다운로드
		axonLog(`📂 Creating ${DL_SOURCE_MIRROR_DIR} directory and downloading source mirror...`);
		
		const downloadMirrorCommand = `mkdir -p ${DL_SOURCE_MIRROR_DIR} && cd ${DL_SOURCE_MIRROR_DIR} && ncftp -u ${FTP_USER} -p ${FTP_PASS} ${FTP_ADDR} &> /dev/null << 'End-Of-Session'
bin
cd /share/tcn100x
get -R -T *
bye
End-Of-Session`;
		
		await this.executeShellTask({
			command: downloadMirrorCommand,
			cwd: `${sdkPath}`,
			taskName: 'Download Source Mirror (Yocto)',
			taskId: 'yoctoDownloadSourceMirror',
			showTerminal: false
		});
		
		axonSuccess(`✅ Source mirror 다운로드 완료`);
		
		// 3. gcc 버전 확인 및 buildtools 스크립트 선택
		axonLog(`🔍 GCC 버전 확인 및 buildtools 선택...`);
		
		// GCC 버전에 따라 스크립트 선택하는 shell 스크립트
		const selectAndInstallCommand = `
# GCC 버전 확인
GCC_VERSION=$(gcc -dumpversion)
echo "GCC Version: $GCC_VERSION"

# 버전 파싱 (major.minor)
MAJOR_MINOR=$(echo $GCC_VERSION | cut -d. -f1,2)
echo "Major.Minor: $MAJOR_MINOR"

# 버전 비교 및 스크립트 선택
if awk -v ver="$MAJOR_MINOR" 'BEGIN {exit !(ver >= 7.5)}'; then
    BUILDTOOLS_SCRIPT="x86_64-buildtools-nativesdk-standalone-4.0.sh"
    echo "GCC >= 7.5: Using $BUILDTOOLS_SCRIPT"
else
    BUILDTOOLS_SCRIPT="x86_64-buildtools-extended-nativesdk-standalone-4.0.sh"
    echo "GCC < 7.5: Using $BUILDTOOLS_SCRIPT"
fi

# 스크립트 존재 확인
if [ ! -f "tools/$BUILDTOOLS_SCRIPT" ]; then
    echo "Error: Buildtools installer not found at tools/$BUILDTOOLS_SCRIPT"
    exit 1
fi

# buildtools 설치
echo "Installing buildtools..."
echo buildtools | tools/$BUILDTOOLS_SCRIPT
`;
		
		axonLog(`🔨 Buildtools 설치 중... (이 작업은 시간이 걸릴 수 있습니다)`);
		
		await this.executeShellTask({
			command: selectAndInstallCommand,
			cwd: `${sdkPath}`,
			taskName: 'Install Buildtools (Yocto)',
			taskId: 'yoctoInstallBuildtools',
			showTerminal: false
		});
		
		axonSuccess(`✅ Buildtools 설치가 완료되었습니다.`);
		axonLog(`📝 Toolchain installation completed. You can now run build actions manually.`);
	}

	/**
	 * manifest-cgw 저장소에서 manifest 목록 가져오기
	 * projectPath: 프로젝트 폴더 경로 (프로젝트 이름 포함)
	 */
	static async fetchManifestList(manifestGitUrl: string, projectPath: vscode.Uri): Promise<string[]> {
		axonLog(`📋 Fetching manifest list from: ${manifestGitUrl} (원격 환경)`);
		axonLog(`📂 프로젝트 폴더: ${projectPath.fsPath}`);
		
		// Git clone으로 자동 생성될 폴더명 추출 (예: manifest-cgw.git → manifest-cgw)
		const repoName = manifestGitUrl.split('/').pop()?.replace('.git', '') || 'manifest-cgw';
		const clonedDir = vscode.Uri.joinPath(projectPath, repoName);
		
		let projectFolderCreated = false;
		
		try {
			// 프로젝트 폴더 생성
			try {
				await vscode.workspace.fs.createDirectory(projectPath);
				projectFolderCreated = true;
				axonLog(`✅ 프로젝트 폴더 생성: ${projectPath.fsPath}`);
			} catch (error) {
				// 폴더가 이미 존재하면 무시
				axonLog(`📁 프로젝트 폴더가 이미 존재하거나 생성 중 오류 (계속 진행): ${error}`);
			}
			
			// Buildscript 클론 (가장 먼저!)
			const projectPathStr = projectPath.scheme === 'file' ? projectPath.fsPath : projectPath.path;
			axonLog(`🔄 Buildscript 클론 시작...`);
			try {
				await this.cloneBuildscript(projectPathStr);
				axonLog(`✅ Buildscript 클론 완료`);
			} catch (buildscriptError) {
				axonLog(`⚠️ Buildscript 클론 실패: ${buildscriptError}`);
				axonLog(`ℹ️ Buildscript 없이 계속 진행합니다`);
			}
			
			// manifest 저장소 클론 (Git이 자동으로 폴더 생성)
			axonLog(`🔄 Cloning manifest repository (원격 환경)...`);
			
			try {
				await this.executeShellTask({
					command: `git clone ${manifestGitUrl}`,
					cwd: projectPath.scheme === 'file' ? projectPath.fsPath : projectPath.path,
					taskName: 'Load Manifests (Yocto)',
					taskId: 'yoctoLoadManifests',
					showTerminal: true  // 에러 발생 시 터미널 표시
				});
			} catch (cloneError) {
				// Git clone 실패 시 상세한 에러 메시지 제공
				const errorMsg = 
					`Manifest 저장소 클론 실패:\n\n` +
					`원인:\n` +
					`1. SSH 키가 원격 서버에 설정되지 않았을 수 있습니다.\n` +
					`2. 네트워크/방화벽이 포트 7999를 차단할 수 있습니다.\n` +
					`3. 저장소에 대한 접근 권한이 없을 수 있습니다.\n\n` +
					`해결 방법:\n` +
					`- 원격 서버에서 'ssh -T git@bitbucket.telechips.com -p 7999' 명령으로 연결 테스트\n` +
					`- SSH 키 설정: 'ssh-keygen' 및 Bitbucket에 공개키 등록\n` +
					`- 터미널에서 자세한 에러 메시지를 확인하세요.`;
				
				axonError(errorMsg);
				throw new Error(errorMsg);
			}
			
			// XML 파일 목록 읽기 (VS Code FS API - 원격 지원)
			const entries = await vscode.workspace.fs.readDirectory(clonedDir);
			const manifests = entries
				.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.xml'))
				.map(([name]) => name)
				.sort();
			
			axonLog(`✅ Found ${manifests.length} manifest files`);
			
			// 클론된 manifest 디렉토리만 삭제 (프로젝트 폴더는 유지)
			await vscode.workspace.fs.delete(clonedDir, { recursive: true, useTrash: false });
			axonLog(`🗑️ Manifest 디렉토리 삭제 완료: ${repoName}`);
			
			return manifests;
		} catch (error) {
			// 에러 발생 시 정리
			try {
				// 클론된 디렉토리 삭제
				await vscode.workspace.fs.delete(clonedDir, { recursive: true, useTrash: false });
			} catch (cleanupError) {
				axonLog(`⚠️ Manifest 디렉토리 정리 실패: ${cleanupError}`);
			}
			
			// 프로젝트 폴더를 이번에 생성했다면 삭제
			if (projectFolderCreated) {
				try {
					await vscode.workspace.fs.delete(projectPath, { recursive: true, useTrash: false });
					axonLog(`🗑️ 생성된 프로젝트 폴더 삭제: ${projectPath.fsPath}`);
				} catch (cleanupError) {
					axonLog(`⚠️ 프로젝트 폴더 정리 실패: ${cleanupError}`);
				}
			}
			
			axonError(`❌ Manifest 목록 가져오기 실패: ${error}`);
			throw error;
		}
	}
}




