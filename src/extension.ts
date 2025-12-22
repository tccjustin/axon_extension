import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { initializeLogger, axonLog, axonError, axonSuccess } from './logger';
import { executeFwdnCommand, executeFwdnLowFormat, executeFwdnAvailableImage, executeFwdnReadPartition } from './fwdn';
import { 
	getAxonConfig, 
	EXCLUDE_FOLDERS, 
	EXCLUDE_PATTERNS,
	AxonConfig,
	uriUpToFolderName,
	dirToDisplay,
	convertRemotePathToSamba,
	setProjectType
} from './utils';
import { McuProjectDialog } from './projects/mcu/dialog';
import { McuProjectBuilder } from './projects/mcu/builder';
import { YoctoProjectDialog } from './projects/yocto/dialog';
import { YoctoProjectBuilder } from './projects/yocto/builder';
import { AutolinuxProjectDialog } from './projects/yocto/autolinux-dialog';
import { executeShellTask } from './projects/common/shell-utils';
import { AxonSidebarProvider } from './AxonSidebarProvider';


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
			if (globalBuildProvider) {
				globalBuildProvider.addDevtoolRecipe(recipeName);
				vscode.commands.executeCommand('axonBuildView.focus').then(() => {}, () => {});
			}
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

// 전역 SidebarProvider (devtool modify 후 레시피 추가를 위해 필요)
let globalBuildProvider: AxonSidebarProvider | undefined;



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

	// Axon Sidebar Provider 등록 (Webview)
	const axonSidebarProvider = new AxonSidebarProvider(context.extensionUri);
	globalBuildProvider = axonSidebarProvider; // 전역 변수 호환성 유지 (이름은 BuildProvider지만 실제로는 SidebarProvider)
	
    vscode.window.registerWebviewViewProvider(AxonSidebarProvider.viewType, axonSidebarProvider);

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

	// Build Yocto AP 명령
	const buildYoctoApDisposable = vscode.commands.registerCommand(
		'axon.buildYoctoAp',
		async () => {
			await YoctoProjectBuilder.buildAp();
		}
	);

	// Build Yocto MCU 명령
	const buildYoctoMcuDisposable = vscode.commands.registerCommand(
		'axon.buildYoctoMcu',
		async () => {
			await YoctoProjectBuilder.buildMcu();
		}
	);

	// Build Yocto Kernel 명령
	const buildYoctoKernelDisposable = vscode.commands.registerCommand(
		'axon.buildYoctoKernel',
		async () => {
			await YoctoProjectBuilder.buildKernel();
		}
	);

	// DevTool Create & Modify 명령
	const devtoolCreateModifyDisposable = vscode.commands.registerCommand(
		'axon.devtoolCreateModify',
		async (recipeName?: string) => executeDevtoolCreateModify(context.extensionPath, recipeName)
	);

	// Clean Yocto AP 명령
	const cleanYoctoApDisposable = vscode.commands.registerCommand(
		'axon.cleanYoctoAp',
		async () => {
			await YoctoProjectBuilder.cleanApBuild();
		}
	);

	// Clean Yocto MCU 명령
	const cleanYoctoMcuDisposable = vscode.commands.registerCommand(
		'axon.cleanYoctoMcu',
		async () => {
			await YoctoProjectBuilder.cleanMcuBuild();
		}
	);

	// Clean Yocto All 명령
	const cleanYoctoAllDisposable = vscode.commands.registerCommand(
		'axon.cleanYoctoAll',
		async () => {
			await YoctoProjectBuilder.cleanAllBuild();
		}
	);

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
		async (projectType: string) => {
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
			
			const displayMap: { [key: string]: string } = { 
				mcu_project: 'MCU Project', 
				yocto_project: 'Yocto Project',
				yocto_project_autolinux: 'Yocto Project (autolinux)'
			};
			
			console.log(`[Axon] projectType 저장 완료: ${normalizedProjectType}`);
			
			vscode.window.showInformationMessage(
				`프로젝트 타입이 설정되었습니다: ${displayMap[normalizedProjectType] || normalizedProjectType}`
			);
			
			// webview에 상태 동기화
			if (globalBuildProvider) {
				globalBuildProvider.sendProjectType();
			}
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
		createMcuStandaloneProjectDisposable,
		createYoctoProjectDisposable,
		createAutolinuxProjectDisposable,
		// 빌드 명령어들
		buildYoctoApDisposable,
		buildYoctoMcuDisposable,
		buildYoctoKernelDisposable,
		buildAutolinuxDisposable,
		// DevTool 명령어들
		devtoolCreateModifyDisposable,
		devtoolBuildDisposable,
		devtoolFinishDisposable,
		vscodeExcludeFoldersDisposable,
		// 클린 명령어들
		cleanYoctoApDisposable,
		cleanYoctoMcuDisposable,
		cleanYoctoAllDisposable,
		// 설정 편집 명령어들
		editApLocalConfDisposable,
		editMcuLocalConfDisposable,
		editBranchSrcrevDisposable,
		// 프로젝트 타입 설정 명령어
		setProjectTypeDisposable
	);
}

export function deactivate() {}
