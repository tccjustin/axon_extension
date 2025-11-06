import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { initializeLogger, axonLog, axonError, axonSuccess } from './logger';
import { executeFwdnCommand, updateConfiguration } from './fwdn';
import { 
	getAxonConfig, 
	findBootFirmwareFolder, 
	EXCLUDE_FOLDERS, 
	EXCLUDE_PATTERNS,
	AxonConfig,
	uriUpToFolderName,
	dirToDisplay,
	convertRemotePathToSamba,
	searchBootFirmwareInDirectory
} from './utils';
import { McuProjectDialog } from './projects/mcu/dialog';
import { YoctoProjectDialog } from './projects/yocto/dialog';

// Axon Tree Item
class AxonTreeItem extends vscode.TreeItem {
	constructor(
		public readonly id: string,
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command,
		public readonly iconName?: string,
		public readonly tooltipText?: string
	) {
		super(label, collapsibleState);

		if (command) {
			this.command = command;
		}

		if (iconName) {
			this.iconPath = new vscode.ThemeIcon(iconName);
		}

		if (tooltipText) {
			this.tooltip = tooltipText;
		}
	}
}

// Create Projects View Provider
class CreateProjectsProvider implements vscode.TreeDataProvider<AxonTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<AxonTreeItem | undefined | null | void> = new vscode.EventEmitter<AxonTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<AxonTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: AxonTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: AxonTreeItem): Thenable<AxonTreeItem[]> {
		if (!element) {
			return Promise.resolve([
				new AxonTreeItem(
					'createMcuStandaloneProject',
					'MCU Standalone Project',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.createMcuStandaloneProject',
						title: 'Create MCU Standalone Project'
					},
					'circuit-board',
					'Create a new MCU standalone project'
				),
				new AxonTreeItem(
					'createYoctoProject',
					'Yocto Project',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.createYoctoProject',
						title: 'Create Yocto Project'
					},
					'package',
					'Create a new Yocto project'
				)
			]);
		}
		return Promise.resolve([]);
	}
}

// Configurations View Provider
class ConfigurationsProvider implements vscode.TreeDataProvider<AxonTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<AxonTreeItem | undefined | null | void> = new vscode.EventEmitter<AxonTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<AxonTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: AxonTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: AxonTreeItem): Thenable<AxonTreeItem[]> {
		if (!element) {
			return Promise.resolve([
				// 향후 설정 항목들을 여기에 추가
			]);
		}
		return Promise.resolve([]);
	}
}

// Build View Provider
class BuildProvider implements vscode.TreeDataProvider<AxonTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<AxonTreeItem | undefined | null | void> = new vscode.EventEmitter<AxonTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<AxonTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: AxonTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: AxonTreeItem): Thenable<AxonTreeItem[]> {
		if (!element) {
			return Promise.resolve([
				// 향후 빌드 항목들을 여기에 추가
			]);
		}
		return Promise.resolve([]);
	}
}

// MCU Project Creation Dialog - 이제 projects/mcu/dialog.ts에 있음

// 현재 감지된 Boot Firmware 경로 (캐싱) - 사용하지 않음

// 워크스페이스 폴더 가져오기
function getWorkspaceFolder(): vscode.WorkspaceFolder | null {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			const errorMsg = '워크스페이스 폴더를 찾을 수 없습니다.';
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
		return null;
	}
	return workspaceFolder;
}


// 설정 메뉴를 보여주는 새로운 상위 명령어
async function showConfigurationMenu() {
	axonLog('🔍 showConfigurationMenu 함수 시작');
	
	// QuickPick에 표시할 항목들 정의
	const items: (vscode.QuickPickItem & { command: string })[] = [
		{
			label: '🔧 FWDN 실행 파일 경로 설정',
			description: 'fwdn.exe 파일의 위치를 설정합니다.',
			command: 'axon.configureFwdnExe' // 실행할 명령어 ID
		},
		{
			label: '📁 Build 폴더명 설정',
			description: '프로젝트의 빌드 폴더 이름(예: build-axon)을 설정합니다.',
			command: 'axon.configureProjectFolder'
		},
		{
			label: '📂 Boot Firmware 폴더명 설정',
			description: 'Boot Firmware 폴더 이름(예: boot-firmware_tcn1000)을 설정합니다.',
			command: 'axon.configureBootFirmwareFolder'
		}
	];

	axonLog('📋 QuickPick 메뉴 표시 중...');
	
	// QuickPick 메뉴 표시
	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: '변경할 설정 항목을 선택하세요',
		ignoreFocusOut: true  // 포커스를 잃어도 닫히지 않도록 설정
	});

	// 사용자가 항목을 선택한 경우 해당 명령 실행
	if (selected) {
		axonLog(`✅ 선택된 항목: ${selected.label}`);
		axonLog(`🎯 실행할 명령: ${selected.command}`);
		await vscode.commands.executeCommand(selected.command);
		axonLog(`✅ 명령 실행 완료: ${selected.command}`);
	} else {
		axonLog('❌ 사용자가 선택을 취소했습니다.');
	}
}



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

	// Axon Tree Data Providers 등록
	const createProjectsProvider = new CreateProjectsProvider();
	const configurationsProvider = new ConfigurationsProvider();
	const buildProvider = new BuildProvider();
	
	vscode.window.registerTreeDataProvider('axonCreateProjectsView', createProjectsProvider);
	vscode.window.registerTreeDataProvider('axonConfigurationsView', configurationsProvider);
	vscode.window.registerTreeDataProvider('axonBuildView', buildProvider);

	// MCU Project Dialog Provider 등록
	const mcuProjectDialog = new McuProjectDialog(context);
	
	// Yocto Project Dialog Provider 등록
	const yoctoProjectDialog = new YoctoProjectDialog(context);

	// 설정 메뉴를 보여주는 새로운 상위 명령어
	const configureSettingsDisposable = vscode.commands.registerCommand(
		'axon.configureSettings',
		showConfigurationMenu
	);

	// FWDN ALL 실행 명령
	const runFwdnAllDisposable = vscode.commands.registerCommand(
		'axon.FWDN_ALL',
		async () => executeFwdnCommand(context.extensionPath)
	);

	// FWDN 실행 파일 경로 설정 명령
	const configureFwdnExeDisposable = vscode.commands.registerCommand(
		'axon.configureFwdnExe',
		async () => {
			axonLog('🔧 [configureFwdnExe] 명령 시작');
			const config = vscode.workspace.getConfiguration('axon');

			axonLog('📂 [configureFwdnExe] 파일 선택 다이얼로그 표시 중...');
			const selectedFiles = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				openLabel: 'FWDN 실행 파일 선택',
				title: 'FWDN 실행 파일을 선택하세요',
				filters: {
					'Executable': ['exe'],
					'All Files': ['*']
				},
				defaultUri: vscode.Uri.file(config.get<string>('fwdn.exePath', 'C:\\Users\\jhlee17\\work\\FWDN\\fwdn.exe'))
			});

			if (selectedFiles && selectedFiles.length > 0) {
				axonLog(`✅ [configureFwdnExe] 파일 선택됨: ${selectedFiles[0].fsPath}`);
				await updateConfiguration('fwdn.exePath', selectedFiles[0].fsPath, 'FWDN 실행 파일');
			} else {
				axonLog('❌ [configureFwdnExe] 파일 선택 취소됨');
			}
			axonLog('🏁 [configureFwdnExe] 명령 종료');
		}
	);

	// Build 폴더명 설정 명령
	const configureProjectFolderDisposable = vscode.commands.registerCommand(
		'axon.configureProjectFolder',
		async () => {
			axonLog('📁 [configureProjectFolder] 명령 시작');
			const config = vscode.workspace.getConfiguration('axon');
			const currentValue = config.get<string>('buildAxonFolderName', 'build-axon');
			axonLog(`📁 [configureProjectFolder] 현재 값: ${currentValue}`);

			axonLog('⌨️ [configureProjectFolder] 입력 박스 표시 중...');
			const newValue = await vscode.window.showInputBox({
				prompt: 'Build 폴더명을 입력하세요',
				value: currentValue,
				placeHolder: '예: build-axon',
				ignoreFocusOut: true,  // 포커스를 잃어도 닫히지 않도록 설정
				validateInput: (value) => {
					if (!value || value.trim().length === 0) {
						return '폴더명을 입력해주세요.';
					}
					return null;
				}
			});

			if (newValue && newValue !== currentValue) {
				axonLog(`✅ [configureProjectFolder] 새 값 입력됨: ${newValue}`);
				await updateConfiguration('buildAxonFolderName', newValue.trim(), 'Build 폴더명');
			} else if (newValue === currentValue) {
				axonLog('ℹ️ [configureProjectFolder] 값이 변경되지 않음');
			} else {
				axonLog('❌ [configureProjectFolder] 입력 취소됨');
			}
			axonLog('🏁 [configureProjectFolder] 명령 종료');
		}
	);

	// Boot Firmware 폴더명 설정 명령
	const configureBootFirmwareFolderDisposable = vscode.commands.registerCommand(
		'axon.configureBootFirmwareFolder',
		async () => {
			axonLog('📂 [configureBootFirmwareFolder] 명령 시작');
			const config = vscode.workspace.getConfiguration('axon');
			const currentValue = config.get<string>('bootFirmwareFolderName', 'boot-firmware_tcn1000');
			axonLog(`📂 [configureBootFirmwareFolder] 현재 값: ${currentValue}`);

			axonLog('⌨️ [configureBootFirmwareFolder] 입력 박스 표시 중...');
			const newValue = await vscode.window.showInputBox({
				prompt: 'Boot Firmware 폴더명을 입력하세요',
				value: currentValue,
				placeHolder: '예: boot-firmware_tcn1000',
				ignoreFocusOut: true,  // 포커스를 잃어도 닫히지 않도록 설정
				validateInput: (value) => {
					if (!value || value.trim().length === 0) {
						return '폴더명을 입력해주세요.';
					}
					return null;
				}
			});

			if (newValue && newValue !== currentValue) {
				axonLog(`✅ [configureBootFirmwareFolder] 새 값 입력됨: ${newValue}`);
				await updateConfiguration('bootFirmwareFolderName', newValue.trim(), 'Boot Firmware 폴더명');
			} else if (newValue === currentValue) {
				axonLog('ℹ️ [configureBootFirmwareFolder] 값이 변경되지 않음');
			} else {
				axonLog('❌ [configureBootFirmwareFolder] 입력 취소됨');
			}
			axonLog('🏁 [configureBootFirmwareFolder] 명령 종료');
		}
	);

	// MCU Build Make 실행 명령
	const mcuBuildMakeDisposable = vscode.commands.registerCommand(
		'axon.mcuBuildMake',
		async () => executeMcuBuildMake(context.extensionPath)
	);

	// Build and Copy Scripts 실행 명령
	const buildAndCopyScriptsDisposable = vscode.commands.registerCommand(
		'axon.buildAndCopyScripts',
		async () => executeBuildAndCopyScripts(context.extensionPath)
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

        context.subscriptions.push(
		configureSettingsDisposable, // 상위 설정 메뉴 명령어
		runFwdnAllDisposable,
		mcuBuildMakeDisposable,
		buildAndCopyScriptsDisposable,
		// 하위 명령어들도 프로그램에서 호출할 수 있도록 등록은 유지합니다.
		configureFwdnExeDisposable,
		configureProjectFolderDisposable,
		configureBootFirmwareFolderDisposable,
		// 새로운 프로젝트 생성 명령어들
		createMcuStandaloneProjectDisposable,
		createYoctoProjectDisposable
	);
}

// build-axon 폴더를 찾는 재귀 검색 함수 (searchBootFirmwareInDirectory와 유사한 구조)
async function searchBuildAxonInDirectory(baseUri: vscode.Uri, currentDepth: number = 0, maxDepth: number = 4): Promise<string | null> {
	const config = getAxonConfig();
	const buildAxonFolderName = config.buildAxonFolderName;

	try {
		// baseUri가 이미 build-axon 폴더인지 확인 (폴더명이 build-axon으로 끝나는지)
		const basePath = baseUri.path;
		if (basePath.endsWith('/' + buildAxonFolderName) || basePath.endsWith('\\' + buildAxonFolderName)) {
			const finalPath = baseUri.scheme === 'file' ? baseUri.fsPath : baseUri.path;
			axonLog(`✅ depth ${currentDepth}에서 baseUri가 이미 ${buildAxonFolderName} 폴더입니다: ${finalPath}`);
			return finalPath;
		}

		// 현재 디렉토리에서 build-axon 폴더 확인
		const targetPath = baseUri.with({ path: `${baseUri.path.replace(/\/$/, '')}/${buildAxonFolderName}` });

		try {
			const stat = await vscode.workspace.fs.stat(targetPath);
			if (stat.type === vscode.FileType.Directory) {
				let finalPath: string;
				if (targetPath.scheme === 'file') {
					finalPath = targetPath.fsPath;
				} else {
					// 원격 경로일 경우, 전체 URI를 문자열로 반환하여 스킴과 authority 정보를 보존합니다.
					finalPath = targetPath.toString();
				}

				axonLog(`✅ depth ${currentDepth}에서 ${buildAxonFolderName} 폴더를 찾았습니다: ${finalPath}`);
				return finalPath;
			}
		} catch {
			// 폴더가 없으면 계속 진행
		}

		// 최대 depth에 도달하지 않았으면 하위 폴더 탐색
		if (currentDepth < maxDepth) {
			try {
				const entries = await vscode.workspace.fs.readDirectory(baseUri);

				// 디렉토리만 필터링 (제외할 폴더 제외)
				const allDirectories = entries.filter(([name, type]) => type === vscode.FileType.Directory);
				const directories = allDirectories.filter(([dirName, dirType]) => !EXCLUDE_FOLDERS.includes(dirName));
				const excludedCount = allDirectories.length - directories.length;

				axonLog(`🔍 depth ${currentDepth}에서 ${directories.length}개 폴더를 탐색합니다... (${excludedCount}개 폴더 제외)`);

				// 각 하위 디렉토리에서 재귀 검색
				for (const [dirName, dirType] of directories) {
					const subDirUri = baseUri.with({ path: baseUri.path + '/' + dirName });
					axonLog(`📁 depth ${currentDepth} - ${dirName} 폴더 탐색 중...`);

					const result = await searchBuildAxonInDirectory(subDirUri, currentDepth + 1, maxDepth);
					if (result) {
						return result; // 찾았으면 즉시 반환
					}
				}
			} catch (error) {
				axonLog(`⚠️ depth ${currentDepth} 폴더 읽기 실패: ${error}`);
			}
		}

		return null;
	} catch (error) {
		axonLog(`⚠️ depth ${currentDepth} 검색 중 오류: ${error}`);
		return null;
	}
}

// 설정 가능한 build-axon 폴더를 찾는 함수 (findBootFirmwareFolder와 유사한 구조)
async function findBuildAxonFolder(): Promise<string | null> {
	const config = getAxonConfig();
	const buildAxonFolderName = config.buildAxonFolderName;

	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		axonLog('❌ 워크스페이스 폴더를 찾을 수 없습니다.');
		axonLog(`⏱️ 워크스페이스 없음 - 소요시간: 0ms`);
		return null;
	}

	// 수행 시간 측정 시작
	const searchStartTime = Date.now();
	axonLog(`🔍 빠른 방식으로 ${buildAxonFolderName} 검색 시작 (depth 4까지): ${workspaceFolders[0].uri.path}`);

	try {
		let result: string | null = null;
		const workspacePath = workspaceFolders[0].uri.path;

		// 워크스페이스 경로에 build-axon 폴더명이 포함되어 있다면 해당 폴더부터 검색
		if (workspacePath.includes(buildAxonFolderName)) {
			axonLog(`✅ 워크스페이스 폴더에 ${buildAxonFolderName}이 포함되어 있습니다: ${workspacePath}`);

			// 워크스페이스 URI에서 설정된 폴더명까지의 경로 추출
			const folderIndex = workspaceFolders[0].uri.path.indexOf(buildAxonFolderName);
			if (folderIndex !== -1) {
				const folderPath = workspaceFolders[0].uri.path.substring(0, folderIndex + buildAxonFolderName.length);
				const folderUri = workspaceFolders[0].uri.with({ path: folderPath });

				axonLog(`🔍 워크스페이스 내 ${buildAxonFolderName} 폴더부터 depth 4까지 검색: ${dirToDisplay(folderUri)}`);

				// 찾은 build-axon 폴더부터 depth 4까지 재귀 검색
				result = await searchBuildAxonInDirectory(folderUri, 0, 4);

				if (result) {
					const searchEndTime = Date.now();
					const searchDuration = searchEndTime - searchStartTime;
					axonLog(`✅ 워크스페이스 내 ${buildAxonFolderName} 폴더를 찾았습니다: ${result}`);
					axonLog(`⏱️ ${buildAxonFolderName} 검색 완료 - 소요시간: ${searchDuration}ms`);
					return result;
				}
			}
		}

		// 일반적인 경우: 워크스페이스 폴더부터 depth 4까지 build-axon 폴더 검색
		axonLog(`🔍 워크스페이스 폴더부터 depth 4까지 ${buildAxonFolderName} 검색: ${dirToDisplay(workspaceFolders[0].uri)}`);

		result = await searchBuildAxonInDirectory(workspaceFolders[0].uri, 0, 4);

		if (result) {
			const searchEndTime = Date.now();
			const searchDuration = searchEndTime - searchStartTime;
			axonLog(`✅ 워크스페이스에서 ${buildAxonFolderName} 폴더를 찾았습니다: ${result}`);
			axonLog(`⏱️ 전체 검색 완료 - 소요시간: ${searchDuration}ms`);
			return result;
		}

		axonLog(`❌ depth 4까지 검색했지만 ${buildAxonFolderName} 폴더를 찾을 수 없습니다.`);

		const searchEndTime = Date.now();
		const searchDuration = searchEndTime - searchStartTime;
		axonLog(`⏱️ 전체 검색 완료 (실패) - 소요시간: ${searchDuration}ms`);
		return null;

	} catch (error) {
		const searchEndTime = Date.now();
		const searchDuration = searchEndTime - searchStartTime;
		axonError(`빠른 방식으로 build-axon 폴더 검색 중 오류 발생: ${error}`);
		axonLog(`⏱️ 검색 중단 (오류) - 소요시간: ${searchDuration}ms`);
		return null;
	}
}

// MCU 빌드 make 실행 함수
async function executeMcuBuildMake(extensionPath: string): Promise<void> {
	axonLog(`🚀 MCU Build Make 실행 명령 시작`);

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	try {
		// build-axon 폴더 찾기
		axonLog(`🔍 build-axon 폴더 자동 검색 시작...`);
		const buildAxonPath = await findBuildAxonFolder();

		if (!buildAxonPath) {
			axonLog(`❌ build-axon 폴더를 찾을 수 없습니다.`);
			vscode.window.showErrorMessage('build-axon 폴더를 찾을 수 없습니다. "Axon: MCU Build Make" 명령을 다시 실행하거나 수동으로 이동해주세요.');
			return;
		}

		axonLog(`✅ build-axon 폴더를 찾았습니다: ${buildAxonPath}`);

		// MCU 빌드 경로 구성 (findBootFirmwareFolder 구조와 유사하게 build-axon 경로에 붙임)
		// path.join 사용하지 말고 직접 경로 구성 (convertRemotePathToSamba 사용 안 함)
		const mcuRelativePath = '/linux_yp4.0_cgw_1.x.x_dev/build/tcn1000-mcu/tmp/work/cortexm7-telechips-linux-musleabi/m7-1/1.0.0-r0/git';
		const mcuBuildPath = buildAxonPath.endsWith('/') ? buildAxonPath + mcuRelativePath.substring(1) : buildAxonPath + mcuRelativePath;
		axonLog(`📁 MCU 빌드 경로: ${mcuBuildPath}`);

		// 환경 감지 및 터미널 생성
		const isRemote = vscode.env.remoteName !== undefined;
		let terminal: vscode.Terminal;

		if (isRemote) {
			// 원격 환경: bash를 사용하는 원격 터미널 생성 (기존 bash 터미널 재사용)
			axonLog(`🔧 원격 환경 감지 - bash 터미널 생성 또는 재사용`);

			// 열려있는 bash 터미널 찾기
			let bashTerminal = vscode.window.terminals.find(term => {
				const terminalName = term.name || '';
				return terminalName.toLowerCase().includes('bash') ||
					   terminalName.toLowerCase().includes('terminal') ||
					   terminalName === '';
			});

			if (bashTerminal) {
				// 기존 bash 터미널이 있으면 재사용
				terminal = bashTerminal;
				axonLog(`✅ 기존 bash 터미널을 재사용합니다: ${bashTerminal.name}`);
			} else {
				// bash 터미널이 없으면 새로 생성
				try {
					await vscode.commands.executeCommand('workbench.action.terminal.new');
					const remoteTerminal = vscode.window.activeTerminal;
					if (remoteTerminal) {
						terminal = remoteTerminal;
						axonLog(`✅ 새 bash 터미널을 생성했습니다`);
					} else {
						throw new Error('원격 bash 터미널 생성에 실패했습니다.');
					}
				} catch {
					// 폴백: 직접 bash 터미널 생성
					terminal = vscode.window.createTerminal({
						name: `MCU Build Make (Bash)`,
						shellPath: 'bash',
						shellArgs: ['--login'],
						isTransient: true
					});
					axonLog(`✅ 폴백으로 bash 터미널을 직접 생성했습니다`);
				}
			}
		} else {
			// 로컬 환경: bash 터미널 생성 또는 재사용
			axonLog(`🔧 로컬 환경 - bash 터미널 생성 또는 재사용`);

			// 열려있는 bash 터미널 찾기
			let bashTerminal = vscode.window.terminals.find(term => {
				const terminalName = term.name || '';
				return terminalName.toLowerCase().includes('bash') ||
					   terminalName.toLowerCase().includes('terminal') ||
					   terminalName === '';
			});

			if (bashTerminal) {
				// 기존 bash 터미널이 있으면 재사용
				terminal = bashTerminal;
				axonLog(`✅ 기존 bash 터미널을 재사용합니다: ${bashTerminal.name}`);
			} else {
				// bash 터미널이 없으면 새로 생성 시도
				try {
					await vscode.commands.executeCommand('workbench.action.terminal.new');
					const basicTerminal = vscode.window.activeTerminal;
					if (basicTerminal) {
						// 새로 생성된 터미널을 사용 (VS Code에서 기본적으로 적절한 shell을 선택)
						terminal = basicTerminal;
						axonLog(`✅ 새 터미널을 생성했습니다: ${basicTerminal.name}`);
					} else {
						throw new Error('기본 터미널 생성에 실패했습니다.');
					}
				} catch {
					// 폴백: 직접 bash 터미널 생성
					terminal = vscode.window.createTerminal({
						name: `MCU Build Make (Bash)`,
						shellPath: 'bash',
						shellArgs: ['--login'],
						isTransient: true
					});
					axonLog(`✅ 폴백으로 bash 터미널을 직접 생성했습니다`);
				}
			}
		}

		// MCU 빌드 디렉토리로 이동 후 make 실행
		terminal.sendText(`cd "${mcuBuildPath}" && make`, true);

		const successMsg = `MCU Build Make이 실행되었습니다! 경로: ${mcuBuildPath}`;
		axonSuccess(successMsg);
		vscode.window.showInformationMessage(successMsg);

		axonLog(`✅ MCU Build Make 실행 완료`);

	} catch (error) {
		const errorMsg = `MCU Build Make 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

// Build and Copy Scripts 실행 함수
async function executeBuildAndCopyScripts(extensionPath: string): Promise<void> {
	try {
		axonLog('🚀 Build and Copy Scripts 시작...');

		// 스크립트 폴더 이름을 'scripts_for_vscode'로 고정
		const scriptsFolderName = 'scripts_for_vscode';
		// buildAxonFolderName 설정을 사용하는 폴더를 지능적으로 찾기
		axonLog('🔍 build-axon 폴더 지능적 검색 시작...');
		const buildAxonPath = await findBuildAxonFolder();

		if (!buildAxonPath) {
			axonError(`❌ build-axon 폴더를 찾을 수 없습니다.`);
			vscode.window.showErrorMessage('build-axon 폴더를 찾을 수 없습니다. "Axon: Configure Project Folder Name" 명령으로 설정하거나, build-axon 폴더를 생성해주세요.');
			return;
		}

		axonLog(`✅ build-axon 폴더를 찾았습니다: ${buildAxonPath}`);

		// 환경 정보 로깅 (vscode.env.remoteName 기반)
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			axonError('❌ 워크스페이스 폴더를 찾을 수 없습니다.');
			vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
			return;
		}

		const isRemoteWorkspace = !!vscode.env.remoteName;
		const remoteName = vscode.env.remoteName || 'local';

		axonLog(`🔍 리모트 이름: ${remoteName}`);
		axonLog(`🔍 extensionPath: ${extensionPath}`);
		axonLog(`🔍 원격 워크스페이스: ${isRemoteWorkspace}`);

		// 원격 워크스페이스인 경우 로그 추가
		if (isRemoteWorkspace) {
			axonLog(`🌐 원격 SSH 환경 감지됨 - 원격 서버로 스크립트 복사`);
		} else {
			axonLog(`💻 로컬 환경 - 로컬에 스크립트 복사`);
		}

		// URI 기반 경로 생성 (vscode.workspace.fs 사용을 위해)
		let buildAxonUri: vscode.Uri;
		if (buildAxonPath.startsWith('vscode-remote://')) {
			// findBuildAxonFolder가 반환한 전체 URI 문자열을 파싱합니다.
			buildAxonUri = vscode.Uri.parse(buildAxonPath, true);
		} else {
			// 로컬 경로일 경우 기존 방식대로 처리합니다.
			buildAxonUri = vscode.Uri.file(buildAxonPath);
		}
		const scriptsTargetUri = vscode.Uri.joinPath(buildAxonUri, scriptsFolderName);
		const sourceScriptsUri = vscode.Uri.joinPath(vscode.Uri.file(extensionPath), 'scripts');

		axonLog(`🔍 buildAxonUri: ${buildAxonUri}`);
		axonLog(`🔍 scriptsTargetUri: ${scriptsTargetUri}`);
		axonLog(`🔍 sourceScriptsUri: ${sourceScriptsUri}`);

		// 소스 스크립트 폴더 확인 (vscode.workspace.fs 사용)
		let sourceFolderExists = false;
		try {
			const sourceStat = await vscode.workspace.fs.stat(sourceScriptsUri);
			sourceFolderExists = (sourceStat.type & vscode.FileType.Directory) === vscode.FileType.Directory;
		} catch (error) {
			sourceFolderExists = false;
		}

		if (!sourceFolderExists) {
			axonError(`❌ 소스 스크립트 폴더를 찾을 수 없습니다: ${sourceScriptsUri}`);
			vscode.window.showErrorMessage('소스 스크립트 폴더를 찾을 수 없습니다.');
			return;
		}

		// 소스 폴더의 파일들 확인
		try {
			const entries = await vscode.workspace.fs.readDirectory(sourceScriptsUri);
			const files = entries.map(([name, type]) => name);
			if (files.length === 0) {
				axonError(`❌ 소스 스크립트 폴더가 비어있습니다: ${sourceScriptsUri}`);
				vscode.window.showErrorMessage('소스 스크립트 폴더가 비어있습니다.');
				return;
			}
			axonLog(`📋 소스 폴더의 파일들: ${files.join(', ')}`);
		} catch (error) {
			axonError(`❌ 소스 스크립트 폴더를 읽을 수 없습니다: ${error}`);
			vscode.window.showErrorMessage('소스 스크립트 폴더를 읽을 수 없습니다.');
			return;
		}

		// 대상 폴더가 이미 존재하면 확인 (vscode.workspace.fs 사용)
		let targetFolderExists = false;
		try {
			const targetStat = await vscode.workspace.fs.stat(scriptsTargetUri);
			targetFolderExists = (targetStat.type & vscode.FileType.Directory) === vscode.FileType.Directory;
			axonLog(`🔍 scriptsTargetUri 폴더 존재 확인: ${targetFolderExists}`);
		} catch (error) {
			axonLog(`❌ scriptsTargetUri 폴더가 존재하지 않습니다: ${error}`);
			targetFolderExists = false;
		}

		if (targetFolderExists) {
			axonLog(`✅ 스크립트 폴더(${scriptsFolderName})가 이미 존재합니다. 파일 내용을 비교합니다.`);

			const sourcePyUri = vscode.Uri.joinPath(sourceScriptsUri, 'mcu_build_and_copy.py');
			const targetPyUri = vscode.Uri.joinPath(scriptsTargetUri, 'mcu_build_and_copy.py');

			const areFilesSame = await areFilesIdentical(sourcePyUri, targetPyUri);

			if (areFilesSame) {
				axonSuccess('✅ 스크립트가 최신 버전입니다. 복사를 건너뜁니다.');
			} else {
				axonLog('⚠️ 로컬 스크립트와 내용이 다릅니다. 덮어쓰기가 필요합니다.');
				const overwrite = await vscode.window.showWarningMessage(
					`'${scriptsFolderName}' 폴더의 스크립트가 최신 버전이 아닙니다. 덮어쓰시겠습니까?`,
					{ modal: true },
					'덮어쓰기'
				);

				if (overwrite !== '덮어쓰기') {
					axonLog('❌ 사용자 취소: 스크립트 복사 중단');
					// 복사는 중단하지만, 기존 스크립트를 실행할지 물어볼 수 있도록 계속 진행
				} else {
					// 덮어쓰기 진행
					axonLog(`📁 기존 스크립트 폴더 삭제: ${scriptsTargetUri}`);
					try {
						await vscode.workspace.fs.delete(scriptsTargetUri, { recursive: true, useTrash: false });
						axonLog(`✅ 기존 스크립트 폴더 삭제 완료`);
						// 복사 로직으로 넘어감
						targetFolderExists = false; // 폴더가 삭제되었으므로 복사 로직을 타도록 설정
					} catch (error) {
						axonError(`❌ 기존 스크립트 폴더 삭제 실패: ${error}`);
						vscode.window.showErrorMessage(`기존 스크립트 폴더 삭제에 실패했습니다.`);
						return;
					}
				}
			}
		}

		// 폴더가 없거나, 덮어쓰기로 결정된 경우 복사 진행
		if (!targetFolderExists) {
			axonLog('📋 스크립트 파일 복사 중...');
			await copyFolderRecursive(sourceScriptsUri, scriptsTargetUri);
			axonSuccess('✅ 스크립트 파일 복사 완료');
		} else {
			axonLog(`✅ 스크립트 폴더가 존재하지 않습니다. 새로 생성합니다.`);
		}

		// 스크립트 파일들 복사 (vscode.workspace.fs 사용)
		axonLog('📋 스크립트 파일 복사 중...');
		try {
			// 대상 디렉토리를 먼저 생성
			await vscode.workspace.fs.createDirectory(scriptsTargetUri);
			axonLog(`✅ 대상 디렉토리 생성 완료: ${scriptsTargetUri}`);

			// workspace.fs 기반으로 복사 함수 호출
			await copyFolderRecursive(sourceScriptsUri, scriptsTargetUri);
			axonLog('✅ 스크립트 파일 복사 완료');
		} catch (error) {
			axonError(`❌ 스크립트 파일 복사 중 오류 발생: ${error}`);
			vscode.window.showErrorMessage(`스크립트 파일 복사 중 오류가 발생했습니다: ${error}`);
			return;
		}

		// 복사된 파일들 확인
		try {
			const entries = await vscode.workspace.fs.readDirectory(scriptsTargetUri);
			const copiedFiles = entries.map(([name, type]) => name);
			axonLog(`✅ 복사된 파일들: ${copiedFiles.join(', ')}`);
		} catch (error) {
			axonError(`❌ 복사된 파일들을 확인할 수 없습니다: ${error}`);
			vscode.window.showErrorMessage('복사된 파일들을 확인할 수 없습니다.');
			return;
		}

		// 특정 파이썬 파일 실행 (mcu_build_and_copy.py)
		const pythonScriptUri = vscode.Uri.joinPath(scriptsTargetUri, 'mcu_build_and_copy.py');
		axonLog(`🔍 pythonScriptUri: ${pythonScriptUri}`);

		// 파일 존재 확인 (vscode.workspace.fs 사용)
		let pythonScriptExists = false;
		try {
			const pythonStat = await vscode.workspace.fs.stat(pythonScriptUri);
			pythonScriptExists = (pythonStat.type & vscode.FileType.File) === vscode.FileType.File;
			axonLog(`✅ 파이썬 스크립트 존재 확인 성공: ${pythonScriptUri}`);
		} catch (error) {
			axonLog(`❌ 파이썬 스크립트 존재 확인 실패: ${error}`);
			pythonScriptExists = false;
		}

		if (pythonScriptExists) {
			axonLog(`🐍 파이썬 스크립트 실행: ${pythonScriptUri}`);

			// 터미널의 CWD(현재 작업 디렉토리)와 실행할 스크립트 경로를 환경에 맞게 설정
			// 원격 환경에서는 fsPath 대신 path를 사용해야 셸이 올바르게 인식합니다.
			const isRemote = !!vscode.env.remoteName;
			const cwdPath = isRemote ? scriptsTargetUri.path : scriptsTargetUri.fsPath;
			const scriptPath = isRemote ? pythonScriptUri.path : pythonScriptUri.fsPath;

			const terminalName = 'Axon MCU Build and Copy';
			let terminal = vscode.window.terminals.find(t => t.name === terminalName);

			if (terminal) {
				axonLog(`🐍 기존 "${terminalName}" 터미널을 재사용합니다.`);
				// 터미널의 작업 디렉토리를 변경해야 할 경우, cd 명령어를 사용합니다.
				terminal.sendText(`cd "${cwdPath}"`);
			} else {
				axonLog(`🐍 새 "${terminalName}" 터미널 생성 - cwd: ${cwdPath}`);
				terminal = vscode.window.createTerminal({
					name: terminalName,
					cwd: cwdPath
				});
			}

			terminal.show();

			// 원격 환경에서는 python3 사용
			const pythonCommand = isRemoteWorkspace ? 'python3' : 'python';
			const command = `${pythonCommand} "${scriptPath}"`;

			axonLog(`🐍 터미널 명령어: ${command}`);
			terminal.sendText(command);

			axonSuccess('🐍 MCU Build and Copy 스크립트 실행을 시작했습니다.');
		}

		const successMsg = `Build and Copy Scripts 완료! 폴더: ${scriptsFolderName}`;
		axonSuccess(successMsg);
		vscode.window.showInformationMessage(successMsg);

	} catch (error) {
		const errorMsg = `Build and Copy Scripts 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

/**
 * 두 파일의 내용이 동일한지 비교하는 함수
 */
async function areFilesIdentical(sourceUri: vscode.Uri, targetUri: vscode.Uri): Promise<boolean> {
	try {
		const [sourceContent, targetContent] = await Promise.all([
			vscode.workspace.fs.readFile(sourceUri),
			vscode.workspace.fs.readFile(targetUri)
		]);

		// Uint8Array를 Node.js의 Buffer로 변환하여 내용을 비교합니다.
		const sourceBuffer = Buffer.from(sourceContent);
		const targetBuffer = Buffer.from(targetContent);

		const areEqual = sourceBuffer.equals(targetBuffer);
		axonLog(`⚖️ 파일 비교 결과 (${sourceUri.path.split('/').pop()}): ${areEqual ? '동일함' : '다름'}`);
		return areEqual;

	} catch (error) {
		// 대상 파일이 없거나 읽기 오류가 발생하면 '다름'으로 간주
		axonLog(`⚠️ 파일 비교 중 오류 발생 (파일이 존재하지 않을 수 있음): ${error}`);
		return false;
	}
}


// 폴더 재귀 복사 함수 (vscode.workspace.fs 기반)
async function copyFolderRecursive(sourceUri: vscode.Uri, targetUri: vscode.Uri): Promise<void> {
	// 대상 디렉토리가 존재하는지 확인하고 생성
	try {
		await vscode.workspace.fs.createDirectory(targetUri);
		axonLog(`📁 대상 디렉토리 생성: ${targetUri}`);
	} catch (error) {
		// 이미 존재하면 무시
	}

	// 소스 디렉토리의 항목들 읽기
	const entries = await vscode.workspace.fs.readDirectory(sourceUri);
	axonLog(`📁 복사할 항목들: ${entries.map(([name, type]) => name).join(', ')}`);

	for (const [fileName, fileType] of entries) {
		const sourcePath = vscode.Uri.joinPath(sourceUri, fileName);
		const targetPath = vscode.Uri.joinPath(targetUri, fileName);

		if (fileType === vscode.FileType.Directory) {
			axonLog(`📂 디렉토리 복사: ${fileName}`);
			await copyFolderRecursive(sourcePath, targetPath);
		} else if (fileType === vscode.FileType.File) {
			axonLog(`📄 파일 복사: ${fileName}`);
			try {
				// 파일 내용 읽기
				const fileContent = await vscode.workspace.fs.readFile(sourcePath);
				// 대상에 파일 쓰기
				await vscode.workspace.fs.writeFile(targetPath, fileContent);
				axonLog(`✅ 파일 복사 완료: ${fileName}`);
			} catch (error) {
				axonError(`❌ 파일 복사 실패: ${fileName}, 오류: ${error}`);
				throw error; // 복사 실패 시 상위로 전파
			}
		}
	}
}

export function deactivate() {}
