import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { initializeLogger, axonLog, axonError, axonSuccess } from './logger';
import { executeFwdnCommand, executeFwdnLowFormat, executeFwdnAvailableImage, executeFwdnReadPartition } from './fwdn';
import { 
	convertRemotePathToSamba,
	setProjectType
} from './utils';
import { McuProjectDialog } from './projects/mcu/dialog';
import { McuProjectBuilder } from './projects/mcu/builder';
import { YoctoProjectDialog } from './projects/yocto/dialog';
import { YoctoProjectBuilder } from './projects/yocto/builder';
import { AutolinuxProjectDialog } from './projects/yocto/autolinux-dialog';
import { executeShellTask } from './projects/common/shell-utils';


// MCU Project Creation Dialog - 이제 projects/mcu/dialog.ts에 있음

// 현재 감지된 Boot Firmware 경로 (캐싱) - 사용하지 않음

// 워크스페이스 폴더 가져오기
function getWorkspaceFolder(): vscode.WorkspaceFolder | null {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		const errorMsg = '워크스페이스 폴더를 찾을 수 없습니다.\n\n' +
			'해결 방법:\n' +
			'1. VS Code에서 "파일 > 폴더 열기"를 선택하세요.\n' +
			'2. 프로젝트가 있는 폴더를 선택하세요.\n' +
			'3. 폴더가 열린 후 다시 시도하세요.';
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
		return null;
	}
	return workspaceFolder;
}


// VS Code exclude 설정 적용
async function configureVscodeExcludeFolders(): Promise<void> {
	try {
		const workspaceFolder = getWorkspaceFolder();
		if (!workspaceFolder) {
			return;
		}

		const config = vscode.workspace.getConfiguration();

		// files.exclude
		const filesExcludePatterns: string[] = [
			// ===== tcn1000 =====
			"**/build/tcn1000/buildhistory/**",
			"**/build/tcn1000/cache/**",
			"**/build/tcn1000/downloads/**",
			"**/build/tcn1000/sstate-cache/**",
			"**/build/tcn1000/tmp/**",
			"**/build/tcn1000/workspace/**",
			// ===== tcn1000-mcu =====
			"**/build/tcn1000-mcu/buildhistory/**",
			"**/build/tcn1000-mcu/cache/**",
			"**/build/tcn1000-mcu/downloads/**",
			"**/build/tcn1000-mcu/hashserve.sock",
			"**/build/tcn1000-mcu/sstate-cache/**",
			"**/build/tcn1000-mcu/tmp/**",
			"**/source-mirror/**",
			"**/.repo/**",
			"**/boot-firmware_tcn1000/**",
			"**/buildtools/**",
			"**/fwdn-v8/**",
			"**/mktcimg/**"
		];

		// search.exclude
		const searchExcludePatterns: string[] = [
			// ===== tcn1000 =====
			"**/build/tcn1000/buildhistory/**",
			"**/build/tcn1000/cache/**",
			"**/build/tcn1000/downloads/**",
			"**/build/tcn1000/sstate-cache/**",
			"**/build/tcn1000/tmp/**",
			"**/build/tcn1000/workspace/**",
			// ===== tcn1000-mcu =====
			"**/build/tcn1000-mcu/bitbake-cookerdaemon.log",
			"**/build/tcn1000-mcu/bitbake.lock",
			"**/build/tcn1000-mcu/bitbake.sock",
			"**/build/tcn1000-mcu/buildhistory/**",
			"**/build/tcn1000-mcu/cache/**",
			"**/build/tcn1000-mcu/downloads/**",
			"**/build/tcn1000-mcu/hashserve.sock",
			"**/build/tcn1000-mcu/sstate-cache/**",
			"**/build/tcn1000-mcu/tmp/**",
			"**/source-mirror/**",
			"**/.repo/**",
			"**/boot-firmware_tcn1000/**",
			"**/buildtools/**",
			"**/fwdn-v8/**",
			"**/mktcimg/**"
		];

		// files.watcherExclude
		const watcherExcludePatterns: string[] = [
			// ===== tcn1000 =====
			"**/build/tcn1000/bitbake-cookerdaemon.log",
			"**/build/tcn1000/buildhistory/**",
			"**/build/tcn1000/cache/**",
			"**/build/tcn1000/downloads/**",
			"**/build/tcn1000/sstate-cache/**",
			"**/build/tcn1000/tmp/**",
			"**/build/tcn1000/workspace/**",
			// ===== tcn1000-mcu =====
			"**/build/tcn1000-mcu/bitbake-cookerdaemon.log",
			"**/build/tcn1000-mcu/bitbake.lock",
			"**/build/tcn1000-mcu/bitbake.sock",
			"**/build/tcn1000-mcu/buildhistory/**",
			"**/build/tcn1000-mcu/cache/**",
			"**/build/tcn1000-mcu/downloads/**",
			"**/build/tcn1000-mcu/hashserve.sock",
			"**/build/tcn1000-mcu/sstate-cache/**",
			"**/build/tcn1000-mcu/tmp/**",
			"**/source-mirror/**",
			"**/.repo/**",
			"**/boot-firmware_tcn1000/**",
			"**/buildtools/**",
			"**/fwdn-v8/**",
			"**/mktcimg/**"
		];

		let updated = false;

		// files.exclude 업데이트
		const currentFilesExclude = config.get<Record<string, boolean>>('files.exclude') ?? {};
		const newFilesExclude = { ...currentFilesExclude };
		for (const pattern of filesExcludePatterns) {
			if (!(pattern in newFilesExclude)) {
				newFilesExclude[pattern] = true;
				updated = true;
			}
		}
		if (updated) {
			await config.update('files.exclude', newFilesExclude, vscode.ConfigurationTarget.Workspace);
			axonLog('✅ files.exclude 설정에 Yocto 관련 폴더를 추가했습니다.');
		}

		// search.exclude 업데이트
		let searchUpdated = false;
		const currentSearchExclude = config.get<Record<string, boolean>>('search.exclude') ?? {};
		const newSearchExclude = { ...currentSearchExclude };
		for (const pattern of searchExcludePatterns) {
			if (!(pattern in newSearchExclude)) {
				newSearchExclude[pattern] = true;
				searchUpdated = true;
			}
		}
		if (searchUpdated) {
			await config.update('search.exclude', newSearchExclude, vscode.ConfigurationTarget.Workspace);
			axonLog('✅ search.exclude 설정에 Yocto 관련 폴더를 추가했습니다.');
			updated = true;
		}

		// files.watcherExclude 업데이트
		let watcherUpdated = false;
		const currentWatcherExclude = config.get<Record<string, boolean>>('files.watcherExclude') ?? {};
		const newWatcherExclude = { ...currentWatcherExclude };
		for (const pattern of watcherExcludePatterns) {
			if (!(pattern in newWatcherExclude)) {
				newWatcherExclude[pattern] = true;
				watcherUpdated = true;
			}
		}
		if (watcherUpdated) {
			await config.update('files.watcherExclude', newWatcherExclude, vscode.ConfigurationTarget.Workspace);
			axonLog('✅ files.watcherExclude 설정에 Yocto 관련 폴더를 추가했습니다.');
			updated = true;
		}

		if (!updated) {
			const msg = '이미 VS Code exclude 설정이 모두 적용되어 있습니다.';
			axonLog(`ℹ️ ${msg}`);
			vscode.window.showInformationMessage(msg);
		} else {
			const msg = 'VS Code exclude 설정을 업데이트했습니다. (files.exclude, search.exclude, files.watcherExclude)';
			axonSuccess(`🎯 ${msg}`);
			vscode.window.showInformationMessage(msg);
		}
	} catch (error) {
		const errorMsg = `VS Code exclude 설정 적용 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

/**
 * DevTool Create & Modify 실행 (devtool.ts로 이동됨)
 * 
 * @param recipeName - 선택적 레시피 이름 (webview에서 선택한 경우)
 */
async function executeDevtoolCreateModify(extensionPath: string, recipeName?: string): Promise<void> {
	if (recipeName) {
		axonLog(`📋 webview에서 전달된 레시피: ${recipeName}`);
	} else {
		axonLog(`📋 레시피가 전달되지 않았습니다. 선택 다이얼로그를 표시합니다.`);
	}
	const { DevToolManager } = await import('./projects/yocto/devtool');
	await DevToolManager.createAndModify(
		extensionPath,
		(recipeName: string) => {
			// TreeView는 자동으로 업데이트되므로 별도 처리 불필요
		},
		recipeName
	);
}

/**
 * DevTool Build 실행 (devtool.ts로 이동됨)
 * 
 * @param recipeName - 빌드할 레시피 이름
 */
async function executeDevtoolBuild(recipeName: string): Promise<void> {
	const { DevToolManager } = await import('./projects/yocto/devtool');
	await DevToolManager.build(recipeName);
}

/**
 * DevTool Finish 실행 (devtool.ts로 이동됨)
 * 
 * @param recipeName - finish할 레시피 이름
 * @param layerPath - 레이어 경로 (선택적)
 */
async function executeDevtoolFinish(recipeName: string, layerPath?: string): Promise<void> {
	const { DevToolManager } = await import('./projects/yocto/devtool');
	await DevToolManager.finish(recipeName, layerPath);
}

// TreeView로 완전 전환 완료 - WebView 사이드바 제거됨



export async function activate(context: vscode.ExtensionContext) {
	// Axon 전용 Output 채널 생성 및 로거 초기화
	const axonOutputChannel = vscode.window.createOutputChannel('Axon');
	initializeLogger(axonOutputChannel);
	
	// 버전 정보 표시
	const extension = vscode.extensions.getExtension('justin-lee.axon');
	const version = extension?.packageJSON.version || 'not defined';
	
	axonLog('===========================================');
	axonLog('Axon extension is now active!');
	axonLog(`Version: ${version}`);
	axonLog('===========================================');
	axonOutputChannel.show();

	// Axon TreeView Providers 등록 (네이티브 - 3개 패널로 분리)
	const { AxonProjectCreationProvider } = await import('./AxonProjectCreationProvider');
	const { AxonBuildProvider } = await import('./AxonBuildProvider');
	const { AxonFwdnProvider } = await import('./AxonFwdnProvider');
	
	const projectCreationProvider = new AxonProjectCreationProvider();
	const buildProvider = new AxonBuildProvider();
	const fwdnProvider = new AxonFwdnProvider();
	
	const projectCreationView = vscode.window.createTreeView('axonProjectCreationView', {
		treeDataProvider: projectCreationProvider,
		showCollapseAll: false
	});
	
	const buildView = vscode.window.createTreeView('axonBuildView', {
		treeDataProvider: buildProvider,
		showCollapseAll: true
	});
	
	const fwdnView = vscode.window.createTreeView('axonFwdnView', {
		treeDataProvider: fwdnProvider,
		showCollapseAll: false
	});
	
	context.subscriptions.push(projectCreationView, buildView, fwdnView);

	// 프로젝트 타입 변경 시 TreeView 새로고침
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('axon.projectType')) {
				buildProvider.refresh();
				fwdnProvider.refresh();
			}
		})
	);

	// yocto.commands.json 변경 시 Build View 새로고침
	const workspaceFolders = vscode.workspace.workspaceFolders || [];
	for (const folder of workspaceFolders) {
		const patterns = [
			new vscode.RelativePattern(folder, 'vsebuildscript/yocto.commands.json'),
			new vscode.RelativePattern(folder, 'buildscript/yocto.commands.json')
		];
		for (const pattern of patterns) {
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			watcher.onDidChange(() => buildProvider.refresh());
			watcher.onDidCreate(() => buildProvider.refresh());
			watcher.onDidDelete(() => buildProvider.refresh());
			context.subscriptions.push(watcher);
		}
	}

	// MCU Project Dialog Provider 등록
	const mcuProjectDialog = new McuProjectDialog(context);
	
	// Yocto Project Dialog Provider 등록
	const yoctoProjectDialog = new YoctoProjectDialog(context);
	
	// Autolinux Project Dialog Provider 등록
	const autolinuxProjectDialog = new AutolinuxProjectDialog(context);

	// FWDN ALL 실행 명령
	const runFwdnAllDisposable = vscode.commands.registerCommand(
		'axon.FWDN_ALL',
		async () => executeFwdnCommand(context.extensionPath)
	);

	// FWDN Low Level Format 실행 명령
	const runFwdnLowFormatDisposable = vscode.commands.registerCommand(
		'axon.FWDN_LOW_FORMAT',
		async () => executeFwdnLowFormat(context.extensionPath)
	);

	// FWDN Specific Image File 실행 명령
	const runFwdnAvailableImageDisposable = vscode.commands.registerCommand(
		'axon.FWDN_AVAILABLE_IMAGE',
		async () => executeFwdnAvailableImage(context.extensionPath)
	);

	// FWDN Read Partition 실행 명령
	const runFwdnReadPartitionDisposable = vscode.commands.registerCommand(
		'axon.FWDN_READ_PARTITION',
		async () => executeFwdnReadPartition(context.extensionPath)
	);

	// MCU Build Make 실행 명령
	const mcuBuildMakeDisposable = vscode.commands.registerCommand(
		'axon.mcuBuildMake',
		async (core?: string) => {
			if (core) {
				await McuProjectBuilder.buildMake(core);
			} else {
				vscode.window.showErrorMessage('빌드할 코어를 선택해주세요.');
			}
		}
	);

	// MCU Build All 실행 명령
	const mcuBuildAllDisposable = vscode.commands.registerCommand(
		'axon.mcuBuildAll',
		async () => await McuProjectBuilder.buildAll()
	);


	// MCU Clean 실행 명령
	const mcuCleanDisposable = vscode.commands.registerCommand(
		'axon.mcuClean',
		async () => await McuProjectBuilder.cleanBuild()
	);

	// Build Option Extraction 실행 명령
	const buildOptionExtractionDisposable = vscode.commands.registerCommand(
		'axon.buildOptionExtraction',
		async () => await McuProjectBuilder.buildOptionExtraction()
	);

	// Create Project (QuickPick) 명령
	const createProjectDisposable = vscode.commands.registerCommand(
		'axon.createProject',
		async () => {
			const selected = await vscode.window.showQuickPick([
				{ 
					label: '$(file-code) MCU Standalone Project', 
					value: 'mcu',
					description: 'Create a new MCU standalone project'
				},
				{ 
					label: '$(package) Yocto Project', 
					value: 'yocto',
					description: 'Create a new Yocto project'
				},
				{ 
					label: '$(package) Yocto Project (autolinux)', 
					value: 'autolinux',
					description: 'Create a new Yocto project with autolinux'
				}
			], {
				placeHolder: 'Select project type to create',
				title: 'Create New Project'
			});

			if (!selected) {
				return;
			}

			switch (selected.value) {
				case 'mcu':
					await mcuProjectDialog.showProjectCreationWebView();
					break;
				case 'yocto':
					await yoctoProjectDialog.showProjectCreationWebView();
					break;
				case 'autolinux':
					await autolinuxProjectDialog.showProjectCreationWebView();
					break;
			}
		}
	);

	// Create MCU Standalone Project 명령
	const createMcuStandaloneProjectDisposable = vscode.commands.registerCommand(
		'axon.createMcuStandaloneProject',
		async () => {
			await mcuProjectDialog.showProjectCreationWebView();
		}
	);

	// Create Yocto Project 명령
	const createYoctoProjectDisposable = vscode.commands.registerCommand(
		'axon.createYoctoProject',
		async () => {
			await yoctoProjectDialog.showProjectCreationWebView();
		}
	);

	// Create Autolinux Project 명령
	const createAutolinuxProjectDisposable = vscode.commands.registerCommand(
		'axon.createAutolinuxProject',
		async () => {
			await autolinuxProjectDialog.showProjectCreationWebView();
		}
	);

	// Build Autolinux 명령
	const buildAutolinuxDisposable = vscode.commands.registerCommand(
		'axon.buildAutolinux',
		async () => {
			const { AutolinuxProjectBuilder } = await import('./projects/yocto/autolinux-builder');
			await AutolinuxProjectBuilder.buildAutolinux();
		}
	);

	// Autolinux Update 명령
	const autolinuxUpdateDisposable = vscode.commands.registerCommand(
		'axon.autolinuxUpdate',
		async () => {
			const { AutolinuxProjectManager } = await import('./projects/yocto/autolinux-manager');
			await AutolinuxProjectManager.updateSources();
		}
	);

	// Autolinux Clean 명령
	const autolinuxCleanDisposable = vscode.commands.registerCommand(
		'axon.autolinuxClean',
		async () => {
			const { AutolinuxProjectManager } = await import('./projects/yocto/autolinux-manager');
			await AutolinuxProjectManager.cleanBuild();
		}
	);

	// Autolinux Make FAI 명령
	const autolinuxMakeFaiDisposable = vscode.commands.registerCommand(
		'axon.autolinuxMakeFai',
		async () => {
			const { AutolinuxProjectManager } = await import('./projects/yocto/autolinux-manager');
			await AutolinuxProjectManager.makeFai();
		}
	);

	// Autolinux Info 명령
	const autolinuxInfoDisposable = vscode.commands.registerCommand(
		'axon.autolinuxInfo',
		async () => {
			const { AutolinuxProjectManager } = await import('./projects/yocto/autolinux-manager');
			await AutolinuxProjectManager.showInfo();
		}
	);

	// Autolinux Make Update Directory 명령
	const autolinuxMakeUpdateDirDisposable = vscode.commands.registerCommand(
		'axon.autolinuxMakeUpdateDir',
		async () => {
			const { AutolinuxProjectManager } = await import('./projects/yocto/autolinux-manager');
			await AutolinuxProjectManager.makeUpdateDir();
		}
	);

	// Yocto 빌드 명령은 JSON 기반 시스템 (runYoctoJsonGroup)으로 통합됨

	// Build Yocto (JSON group runner) 명령
	const runYoctoJsonGroupDisposable = vscode.commands.registerCommand(
		'axon.runYoctoJsonGroup',
		async (groupName?: string) => {
			if (!groupName) {
				vscode.window.showErrorMessage('Yocto commands groupName이 필요합니다.');
				return;
			}
			await YoctoProjectBuilder.runYoctoJsonGroup(groupName);
		}
	);

	const runAutolinuxJsonGroupDisposable = vscode.commands.registerCommand(
		'axon.runAutolinuxJsonGroup',
		async (groupName?: string) => {
			if (!groupName) {
				vscode.window.showErrorMessage('Autolinux commands groupName이 필요합니다.');
				return;
			}
			const { AutolinuxProjectBuilder } = await import('./projects/yocto/autolinux-builder');
			await AutolinuxProjectBuilder.runAutolinuxJsonGroup(groupName);
		}
	);

	const runMcuJsonGroupDisposable = vscode.commands.registerCommand(
		'axon.runMcuJsonGroup',
		async (groupName?: string) => {
			if (!groupName) {
				vscode.window.showErrorMessage('MCU commands groupName이 필요합니다.');
				return;
			}
			const { McuProjectBuilder } = await import('./projects/mcu/builder');
			await McuProjectBuilder.runMcuJsonGroup(groupName);
		}
	);

	// Yocto commands.json 생성/열기 명령 (워크스페이스 루트에 생성)
	const createYoctoCommandsJsonDisposable = vscode.commands.registerCommand(
		'axon.createYoctoCommandsJson',
		async () => {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
				return;
			}

			const dirUri = vscode.Uri.joinPath(workspaceFolder.uri, 'vsebuildscript');
			const fileUri = vscode.Uri.joinPath(dirUri, 'yocto.commands.json');

			// 폴더 생성
			await vscode.workspace.fs.createDirectory(dirUri);

			// 파일 존재 확인
			let exists = true;
			try {
				await vscode.workspace.fs.stat(fileUri);
			} catch {
				exists = false;
			}

			if (!exists) {
				const template = `{
  "version": 1,
  "name": "Yocto Build Commands",
  "description": "Build > Yocto 메뉴를 JSON으로 정의 (env/source + 실행 커맨드 그룹). machine/version은 projectRoot의 config.json에서 로드된다는 전제를 둠.",
  "env": {
    "projectRoot": "\${config:axon.yocto.projectRoot}",
    "setup": "buildtools/environment-setup-x86_64-pokysdk-linux",
    "apBuildScript": "\${config:axon.yocto.apBuildScript}",
    "apMachine": "\${configJson:machine}",
    "apVersion": "\${configJson:version}",
    "mcuMachine": "\${configJson:mcu_machine}",
    "mcuVersion": "\${configJson:mcu_version}",
    "mcuBuildScript": "poky/meta-telechips/meta-dev/meta-mcu-dev/mcu-build.sh"
  },
  "groups": {
    "build AP": [
      "cd \\"\${env:projectRoot}\\"",
      "source \\"\${env:projectRoot}/\${env:setup}\\"",
      "source \\"\${env:projectRoot}/\${env:apBuildScript}\\" \${env:apMachine} \${env:apVersion}",
      "bitbake \${config:axon.yocto.apImageName}",
      "bitbake -f -c make_fai \${config:axon.yocto.apImageName}"
    ],
    "build MCU": [
      "cd \\"\${env:projectRoot}\\"",
      "source \\"\${env:projectRoot}/\${env:setup}\\"",
      "source \\"\${env:projectRoot}/\${env:mcuBuildScript}\\" \${env:mcuMachine} \${env:mcuVersion}",
      "bitbake m7-0 m7-1 m7-2 m7-np -f -c compile"
    ],
    "build Kernel": [
      "cd \\"\${env:projectRoot}\\"",
      "source \\"\${env:projectRoot}/\${env:setup}\\"",
      "source \\"\${env:projectRoot}/\${env:apBuildScript}\\" \${env:apMachine} \${env:apVersion}",
      "bitbake linux-telechips -f -c compile",
      "bitbake linux-telechips -c deploy"
    ],
    "clean AP": [
      "cd \\"\${env:projectRoot}/build/tcn1000\\"",
      "echo \\"Cleaning Yocto AP build directory (except conf/downloads/sstate-cache)...\\"",
      "find . -mindepth 1 -maxdepth 1 -not -name 'conf' -a -not -name 'downloads' -a -not -name 'sstate-cache' -exec rm -rf {} +"
    ],
    "clean MCU": [
      "cd \\"\${env:projectRoot}/build/tcn1000-mcu\\"",
      "echo \\"Cleaning Yocto MCU build directory (except conf/downloads/sstate-cache)...\\"",
      "find . -mindepth 1 -maxdepth 1 -not -name 'conf' -a -not -name 'downloads' -a -not -name 'sstate-cache' -exec rm -rf {} +"
    ],
    "clean All": [
      "for d in \\"\${env:projectRoot}/build/tcn1000\\" \\"\${env:projectRoot}/build/tcn1000-mcu\\"; do cd \\"$d\\" && echo \\"Cleaning Yocto build directory (except conf/downloads/sstate-cache)...\\" && find . -mindepth 1 -maxdepth 1 -not -name 'conf' -a -not -name 'downloads' -a -not -name 'sstate-cache' -exec rm -rf {} + ; done"
    ]
  }
}`;

				await vscode.workspace.fs.writeFile(fileUri, Buffer.from(template, 'utf8'));
				vscode.window.showInformationMessage('vsebuildscript/yocto.commands.json을 생성했습니다.');
			}

			// 열기
			const doc = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(doc);

			// UI 갱신
			buildProvider.refresh();
		}
	);

	// Autolinux commands.json 생성 명령
	const createAutolinuxCommandsJsonDisposable = vscode.commands.registerCommand(
		'axon.createAutolinuxCommandsJson',
		async () => {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
				return;
			}

			const dirUri = vscode.Uri.joinPath(workspaceFolder.uri, 'vsebuildscript');
			const fileUri = vscode.Uri.joinPath(dirUri, 'autolinux.commands.json');

			// 폴더 생성
			await vscode.workspace.fs.createDirectory(dirUri);

			// 파일 존재 확인
			let exists = true;
			try {
				await vscode.workspace.fs.stat(fileUri);
			} catch {
				exists = false;
			}

			if (!exists) {
				// buildscript/autolinux.commands.json을 템플릿으로 읽기
				const extensionPath = context.extensionPath;
				const templateUri = vscode.Uri.file(`${extensionPath}/buildscript/autolinux.commands.json`);
				try {
					const templateContent = await vscode.workspace.fs.readFile(templateUri);
					await vscode.workspace.fs.writeFile(fileUri, templateContent);
					vscode.window.showInformationMessage('vsebuildscript/autolinux.commands.json을 생성했습니다.');
				} catch (error) {
					vscode.window.showErrorMessage(`템플릿 파일 복사 실패: ${error}`);
					return;
				}
			}

			// 열기
			const doc = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(doc);

			// UI 갱신
			buildProvider.refresh();
		}
	);

	// MCU commands.json 생성 명령
	const createMcuCommandsJsonDisposable = vscode.commands.registerCommand(
		'axon.createMcuCommandsJson',
		async () => {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
				return;
			}

			const dirUri = vscode.Uri.joinPath(workspaceFolder.uri, 'vsebuildscript');
			const fileUri = vscode.Uri.joinPath(dirUri, 'mcu.commands.json');

			// 폴더 생성
			await vscode.workspace.fs.createDirectory(dirUri);

			// 파일 존재 확인
			let exists = true;
			try {
				await vscode.workspace.fs.stat(fileUri);
			} catch {
				exists = false;
			}

			if (!exists) {
				// buildscript/mcu.commands.json을 템플릿으로 읽기
				const extensionPath = context.extensionPath;
				const templateUri = vscode.Uri.file(`${extensionPath}/buildscript/mcu.commands.json`);
				try {
					const templateContent = await vscode.workspace.fs.readFile(templateUri);
					await vscode.workspace.fs.writeFile(fileUri, templateContent);
					vscode.window.showInformationMessage('vsebuildscript/mcu.commands.json을 생성했습니다.');
				} catch (error) {
					vscode.window.showErrorMessage(`템플릿 파일 복사 실패: ${error}`);
					return;
				}
			}

			// 열기
			const doc = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(doc);

			// UI 갱신
			buildProvider.refresh();
		}
	);

	// DevTool Create & Modify 명령
	const devtoolCreateModifyDisposable = vscode.commands.registerCommand(
		'axon.devtoolCreateModify',
		async (recipeName?: string) => executeDevtoolCreateModify(context.extensionPath, recipeName)
	);

	// Yocto 클린 명령은 JSON 기반 시스템 (runYoctoJsonGroup)으로 통합됨

	// Edit AP local.conf 명령
	const editApLocalConfDisposable = vscode.commands.registerCommand(
		'axon.editApLocalConf',
		async () => {
			await YoctoProjectBuilder.editApLocalConf();
		}
	);

	// Edit MCU local.conf 명령
	const editMcuLocalConfDisposable = vscode.commands.registerCommand(
		'axon.editMcuLocalConf',
		async () => {
			await YoctoProjectBuilder.editMcuLocalConf();
		}
	);

	// Edit Branch/Srcrev 명령
	const editBranchSrcrevDisposable = vscode.commands.registerCommand(
		'axon.editBranchSrcrev',
		async () => {
			await YoctoProjectBuilder.editBranchSrcrev();
		}
	);

	// DevTool Build 명령
	const devtoolBuildDisposable = vscode.commands.registerCommand(
		'axon.devtoolBuild',
		async (recipeName: string) => executeDevtoolBuild(recipeName)
	);

	// DevTool Finish 명령
	const devtoolFinishDisposable = vscode.commands.registerCommand(
		'axon.devtoolFinish',
		async (recipeName: string, layerPath?: string) => executeDevtoolFinish(recipeName, layerPath)
	);

	// VSCode exclude folders 설정 명령
	const vscodeExcludeFoldersDisposable = vscode.commands.registerCommand(
		'axon.vscodeExcludeFolders',
		async () => {
			await configureVscodeExcludeFolders();
		}
	);

	// Set Project Type 명령
	const setProjectTypeDisposable = vscode.commands.registerCommand(
		'axon.setProjectType',
		async (projectType?: string) => {
			// projectType이 없으면 QuickPick으로 선택
			if (!projectType) {
				const selected = await vscode.window.showQuickPick([
					{ label: 'MCU Project', value: 'mcu_project', description: 'MCU Standalone Project' },
					{ label: 'Yocto Project', value: 'yocto_project', description: 'Yocto Project' },
					{ label: 'Yocto Project (autolinux)', value: 'yocto_project_autolinux', description: 'Yocto Project with autolinux' }
				], {
					placeHolder: 'Select project type',
					title: 'Set Project Type'
				});
				
				if (!selected) {
					return;
				}
				
				projectType = selected.value;
			}
			
			if (projectType !== 'mcu_project' && 
			    projectType !== 'yocto_project' && 
			    projectType !== 'yocto_autolinux' &&
			    projectType !== 'yocto_project_autolinux') {
				vscode.window.showErrorMessage(`잘못된 프로젝트 타입입니다: ${projectType}`);
				return;
			}
			
			console.log(`[Axon] setProjectType 호출됨: ${projectType}`);
			
			// yocto_autolinux 또는 yocto_project_autolinux를 yocto_project_autolinux로 통일
			let normalizedProjectType = projectType;
			if (projectType === 'yocto_autolinux') {
				normalizedProjectType = 'yocto_project_autolinux';
			}
			
			// projectType을 직접 저장
			const config = vscode.workspace.getConfiguration('axon');
			await config.update('projectType', normalizedProjectType, vscode.ConfigurationTarget.Workspace);
			
		// Yocto 프로젝트 타입인 경우 apBuildScript, apImageName 기본값 저장
		if (normalizedProjectType === 'yocto_project' || normalizedProjectType === 'yocto_project_autolinux') {
			const yoctoConfig = vscode.workspace.getConfiguration('axon.yocto');
			await yoctoConfig.update(
				'apBuildScript', 
				'poky/meta-telechips/meta-dev/meta-cgw-dev/cgw-build.sh',
				vscode.ConfigurationTarget.Workspace
			);
			await yoctoConfig.update(
				'apImageName',
				'telechips-cgw-image',
				vscode.ConfigurationTarget.Workspace
			);
			console.log(`[Axon] apBuildScript, apImageName 기본값 저장 완료`);
		}
			
			const displayMap: { [key: string]: string } = { 
				mcu_project: 'MCU Project', 
				yocto_project: 'Yocto Project',
				yocto_project_autolinux: 'Yocto Project (autolinux)'
			};
			
			console.log(`[Axon] projectType 저장 완료: ${normalizedProjectType}`);
			
			vscode.window.showInformationMessage(
				`프로젝트 타입이 설정되었습니다: ${displayMap[normalizedProjectType] || normalizedProjectType}`
			);
			
			// TreeView 새로고침 (프로젝트 타입 변경 시)
			buildProvider.refresh();
			fwdnProvider.refresh();
		}
	);

	context.subscriptions.push(
		runFwdnAllDisposable,
		runFwdnLowFormatDisposable,
		runFwdnAvailableImageDisposable,
		runFwdnReadPartitionDisposable,
		mcuBuildMakeDisposable,
		mcuBuildAllDisposable,
		mcuCleanDisposable,
		buildOptionExtractionDisposable,
		// 새로운 프로젝트 생성 명령어들
		createProjectDisposable,
		createMcuStandaloneProjectDisposable,
		createYoctoProjectDisposable,
		createAutolinuxProjectDisposable,
		// 빌드 명령어들
		runYoctoJsonGroupDisposable,
		runAutolinuxJsonGroupDisposable,
		runMcuJsonGroupDisposable,
		createYoctoCommandsJsonDisposable,
		createAutolinuxCommandsJsonDisposable,
		createMcuCommandsJsonDisposable,
		buildAutolinuxDisposable,
		// Autolinux 관리 명령어들
		autolinuxUpdateDisposable,
		autolinuxCleanDisposable,
		autolinuxMakeFaiDisposable,
		autolinuxInfoDisposable,
		autolinuxMakeUpdateDirDisposable,
		// DevTool 명령어들
		devtoolCreateModifyDisposable,
		devtoolBuildDisposable,
		devtoolFinishDisposable,
		vscodeExcludeFoldersDisposable,
		// 클린 명령어들은 JSON 기반 시스템으로 통합됨
		// 설정 편집 명령어들
		editApLocalConfDisposable,
		editMcuLocalConfDisposable,
		editBranchSrcrevDisposable,
		// 프로젝트 타입 설정 명령어
		setProjectTypeDisposable
	);
}

export function deactivate() {}
