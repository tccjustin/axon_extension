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
import { YoctoProjectBuilder } from './projects/yocto/builder';
import { executeShellTask } from './projects/common/shell-utils';

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
			// 최상위 레벨: Yocto 폴더
			return Promise.resolve([
				new AxonTreeItem(
					'configYocto',
					'Yocto',
					vscode.TreeItemCollapsibleState.Collapsed,
					undefined,
					'package',
					'Yocto 설정 항목'
				)
			]);
		} else if (element.id === 'configYocto') {
			// Yocto 하위 설정 항목들
			return Promise.resolve([
				new AxonTreeItem(
					'editApLocalConf',
					'AP : conf/local.conf',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.editApLocalConf',
						title: 'Edit AP local.conf'
					},
					'edit',
					'AP의 build/tcn1000/conf/local.conf 파일 편집'
				),
				new AxonTreeItem(
					'editMcuLocalConf',
					'MCU : conf/local.conf',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.editMcuLocalConf',
						title: 'Edit MCU local.conf'
					},
					'edit',
					'MCU의 build/tcn1000-mcu/conf/local.conf 파일 편집'
				),
				new AxonTreeItem(
					'editBranchSrcrev',
					'Modify : branch/srcrev',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.editBranchSrcrev',
						title: 'Edit Branch/Srcrev'
					},
					'git-branch',
					'poky/meta-telechips/meta-dev/telechips-cgw-rev.inc 파일 편집'
				),
				new AxonTreeItem(
					'vscodeExcludeFolders',
					'vscode - exclude folders',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.vscodeExcludeFolders',
						title: 'VSCode - Exclude Folders'
					},
					'eye-closed',
					'Yocto 빌드 관련 폴더를 VS Code files/search/watcher exclude에 추가'
				)
			]);
		}
		return Promise.resolve([]);
	}
}

// Build View Provider
class BuildProvider implements vscode.TreeDataProvider<AxonTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<AxonTreeItem | undefined | null | void> = new vscode.EventEmitter<AxonTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<AxonTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
	
	// 마지막으로 선택한 MCU 코어 저장
	private lastSelectedCore: string = '';
	
	// DevTool 레시피 목록 저장
	private devtoolRecipes: string[] = [];

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	setLastSelectedCore(coreName: string): void {
		this.lastSelectedCore = coreName;
		this.refresh();
	}

	getLastSelectedCore(): string {
		return this.lastSelectedCore;
	}
	
	// DevTool 레시피 추가
	addDevtoolRecipe(recipeName: string): void {
		if (!this.devtoolRecipes.includes(recipeName)) {
			this.devtoolRecipes.push(recipeName);
			this.saveDevtoolRecipes();
			this.refresh();
		}
	}
	
	// DevTool 레시피 목록 저장 (workspace settings)
	private saveDevtoolRecipes(): void {
		const config = vscode.workspace.getConfiguration('axon');
		config.update('devtool.recipes', this.devtoolRecipes, vscode.ConfigurationTarget.Workspace);
	}
	
	// DevTool 레시피 목록 로드
	loadDevtoolRecipes(): void {
		const config = vscode.workspace.getConfiguration('axon');
		const recipes = config.get<string[]>('devtool.recipes', []);
		this.devtoolRecipes = recipes;
	}

	getTreeItem(element: AxonTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: AxonTreeItem): Thenable<AxonTreeItem[]> {
		if (!element) {
			// 최상위 레벨: MCU, Yocto, DevTool 폴더
			return Promise.resolve([
				new AxonTreeItem(
					'buildMcu',
					'MCU',
					vscode.TreeItemCollapsibleState.Collapsed,
					undefined,
					'circuit-board',
					'MCU 빌드 항목'
				),
				new AxonTreeItem(
					'buildYocto',
					'Yocto',
					vscode.TreeItemCollapsibleState.Collapsed,
					undefined,
					'package',
					'Yocto 빌드 항목'
				),
				new AxonTreeItem(
					'buildDevTool',
					'DevTool (External Src)',
					vscode.TreeItemCollapsibleState.Collapsed,
					undefined,
					'beaker',
					'DevTool 항목'
				)
			]);
		} else if (element.id === 'buildMcu') {
			// MCU 하위 항목들
			const lastCore = this.lastSelectedCore;
			const selectCoreLabel = lastCore ? `Select Core (현재: ${lastCore})` : 'Select Core';
			
			return Promise.resolve([
				new AxonTreeItem(
					'mcuSelectCore',
					selectCoreLabel,
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.mcuSelectCore',
						title: 'MCU Select Core'
					},
					'chip',
					lastCore ? `현재 선택: ${lastCore} - 클릭하여 변경` : '코어 선택 (m7-np, m7-0, m7-1, m7-2)'
				),
				new AxonTreeItem(
					'mcuBuildAll',
					'Build All',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.mcuBuildAll',
						title: 'MCU Build All'
					},
					'tools',
					'MCU 전체 빌드 (m7-np, m7-0, m7-2, m7-1)'
				),
				new AxonTreeItem(
					'mcuBuildMake',
					'Build Make',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.mcuBuildMake',
						title: 'MCU Build Make'
					},
					'wrench',
					'MCU Make 빌드 실행'
				),
				new AxonTreeItem(
					'mcuClean',
					'Clean',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.mcuClean',
						title: 'MCU Clean'
					},
					'trash',
					'MCU 빌드 정리 (make clean)'
				),
				new AxonTreeItem(
					'mcuFwdn',
					'FWDN',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.FWDN_ALL',
						title: 'MCU FWDN'
					},
					'plug',
					'MCU 펌웨어 다운로드 실행 (fwdn.exe)'
				)
			]);
		} else if (element.id === 'buildYocto') {
			// Yocto 하위 항목들
			return Promise.resolve([
				new AxonTreeItem(
					'buildYoctoAp',
					'Build AP',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.buildYoctoAp',
						title: 'Build Yocto AP'
					},
					'tools',
					'Yocto AP 이미지 빌드'
				),
			new AxonTreeItem(
				'buildYoctoMcu',
				'Build MCU',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'axon.buildYoctoMcu',
					title: 'Build Yocto MCU'
				},
				'chip',
				'Yocto MCU 빌드'
			),
			new AxonTreeItem(
				'buildYoctoKernel',
				'Build Kernel',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'axon.buildYoctoKernel',
					title: 'Build Yocto Kernel'
				},
				'file-binary',
				'Yocto Kernel 빌드 (linux-telechips + make SD_fai.rom)'
			),
			new AxonTreeItem(
				'yoctoFwdn',
				'FWDN',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'axon.FWDN_ALL',
					title: 'Yocto FWDN'
				},
				'plug',
				'Yocto 펌웨어 다운로드 실행 (fwdn.exe)'
			),
			new AxonTreeItem(
				'cleanYoctoAp',
				'Clean AP',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.cleanYoctoAp',
						title: 'Clean Yocto AP'
					},
					'trash',
					'Yocto AP 빌드 폴더 정리'
				),
				new AxonTreeItem(
					'cleanYoctoMcu',
					'Clean MCU',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.cleanYoctoMcu',
						title: 'Clean Yocto MCU'
					},
					'trash',
					'Yocto MCU 빌드 폴더 정리'
				),
			new AxonTreeItem(
				'cleanYoctoAll',
				'Clean All',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'axon.cleanYoctoAll',
					title: 'Clean Yocto All'
				},
				'trash',
				'Yocto AP + MCU 빌드 폴더 정리'
			)
		]);
		} else if (element.id === 'buildDevTool') {
			// DevTool 하위 항목들
			const items: AxonTreeItem[] = [
				new AxonTreeItem(
					'devtoolCreateModify',
					'Setup External Source (modify)',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.devtoolCreateModify',
						title: 'DevTool Create & Modify'
					},
					'file-code',
					'devtool modify 워크스페이스 생성 및 레시피 수정'
				)
			];
			
			// 저장된 레시피 목록 추가
			for (const recipe of this.devtoolRecipes) {
				items.push(new AxonTreeItem(
					`devtoolBuild_${recipe}`,
					`${recipe} build`,
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'axon.devtoolBuild',
						title: `DevTool Build ${recipe}`,
						arguments: [recipe]
					},
					'package',
					`devtool build ${recipe} 실행`
				));
			}
			
			// FWDN 항목 추가
			items.push(new AxonTreeItem(
				'devtoolFwdn',
				'FWDN',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'axon.FWDN_ALL',
					title: 'DevTool FWDN'
				},
				'plug',
				'DevTool 펌웨어 다운로드 실행 (fwdn.exe)'
			));
			
			return Promise.resolve(items);
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
 * DevTool Create & Modify 실행
 * 
 * AP 레시피에 대해서만 devtool modify를 지원합니다.
 * MCU 레시피(m7-0, m7-1, m7-2, m7-np)는 지원하지 않습니다.
 * 
 * 실행 단계:
 * 1. 드롭박스에서 레시피 선택 (또는 직접 입력)
 * 2. MCU 레시피인 경우 에러 메시지 표시 및 종료
 * 3. AP 빌드 설정 및 빌드 디렉토리 생성 (build/tcn1000)
 * 4. Yocto 환경 초기화 (source poky/oe-init-build-env)
 * 5. devtool create-workspace 실행 (workspace가 없을 때만)
 * 6. devtool modify 실행
 * 7. bbappend 파일 수정 스크립트 실행
 */
async function executeDevtoolCreateModify(extensionPath: string): Promise<void> {
	axonLog('🔧 [DevTool Create & Modify] 시작');

	try {
		// Yocto 프로젝트 루트 경로 확인 (build AP와 동일한 방식 사용)
		const { YoctoProjectBuilder } = await import('./projects/yocto/builder');
		
		// bootFirmwareFolderName 설정 확인 (build AP와 동일)
		const bootFirmwareFolderName = await YoctoProjectBuilder['ensureBootFirmwareFolderName']();
		if (!bootFirmwareFolderName) {
			vscode.window.showInformationMessage('빌드가 취소되었습니다.');
			return;
		}
		
		// Yocto 프로젝트 루트 자동 탐지 (build AP와 동일)
		const yoctoRoot = await YoctoProjectBuilder.getYoctoProjectRoot();
		axonLog(`📁 Yocto 프로젝트 루트: ${yoctoRoot}`);
		
		// 1. 레시피 선택 (AP 레시피만 지원, MCU 레시피는 devtool modify를 사용하지 않음)
		const recipes = [
			{ label: 'linux-telechips', description: 'Kernel 레시피' }
		];

		const manualInputItem = { label: '직접 입력...', description: '레시피명을 직접 입력' };
		const quickPickItems = [...recipes, manualInputItem];

		const selected = await vscode.window.showQuickPick(quickPickItems, {
			placeHolder: 'devtool modify할 레시피를 선택하거나 "직접 입력..."을 선택하세요',
			ignoreFocusOut: true
		});

		if (!selected) {
			axonLog('❌ 사용자가 레시피 선택을 취소했습니다.');
			return;
		}

		let recipeName: string;
		let isManualInput = false;
		if (selected.label === manualInputItem.label) {
			const input = await vscode.window.showInputBox({
				title: '레시피명 직접 입력',
				placeHolder: '예: telechips-cgw-app',
				prompt: 'Yocto devtool modify에 사용할 레시피명을 입력하세요',
				ignoreFocusOut: true,
				validateInput: (value: string) => {
					const trimmed = value.trim();
					if (!trimmed) return '레시피명을 입력하세요';
					// 간단 검증: 공백 금지
					if (/\s/.test(trimmed)) return '공백 없이 입력하세요';
					return null;
				}
			});

			if (!input) {
				axonLog('❌ 사용자가 레시피 입력을 취소했습니다.');
				return;
			}

			recipeName = input.trim();
			isManualInput = true;
		} else {
			recipeName = selected.label;
		}

		axonLog(`✅ 선택된 레시피: ${recipeName}`);
		
		// MCU 레시피는 지원하지 않음
		const mcuRecipes = ['m7-0', 'm7-1', 'm7-2', 'm7-np'];
		if (mcuRecipes.includes(recipeName)) {
			const errorMsg = `MCU 레시피(${recipeName})는 devtool modify를 지원하지 않습니다.\n\nMCU 레시피는 별도의 빌드 방식을 사용합니다.`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 모든 AP 레시피는 build/tcn1000 사용
		const buildDir = 'build/tcn1000';
		const workspaceName = 'tcn1000';
		
		// workspaceFolder 가져오기
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
		}
		
		// 2. AP 빌드 설정 및 빌드 디렉토리 생성 (builder.ts 174-260 참고)
		const projectRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: yoctoRoot
		});
		
		const configUri = vscode.Uri.joinPath(projectRootUri, 'config.json');
		let apMachine: string | undefined;
		let cgwVersion: string | undefined;
		
		// config.json 읽기 시도
		try {
			const configContent = await vscode.workspace.fs.readFile(configUri);
			const config = JSON.parse(Buffer.from(configContent).toString('utf8'));
			apMachine = config.machine;
			cgwVersion = config.version;
			
			if (apMachine && cgwVersion) {
				axonLog(`✅ 설정 로드: MACHINE=${apMachine}, CGW_SDK_VERSION=${cgwVersion}`);
			}
		} catch (error) {
			axonLog(`⚠️ config.json 읽기 실패 또는 없음`);
		}
		
		// machine 또는 version이 없으면 사용자에게 선택받기
		if (!apMachine || !cgwVersion) {
			axonLog('📋 빌드 설정을 선택해주세요...');
			
			// machine 선택
			if (!apMachine) {
				const supportedMachines = ['tcn1000'];
				apMachine = await vscode.window.showQuickPick(supportedMachines, {
					placeHolder: 'AP MACHINE을 선택하세요',
					title: 'Yocto AP Build Configuration'
				});
				
				if (!apMachine) {
					axonLog('❌ 사용자 취소: MACHINE 선택이 취소되었습니다.');
					vscode.window.showInformationMessage('빌드가 취소되었습니다.');
					return;
				}
			}
			
			// version 선택
			if (!cgwVersion) {
				const supportedVersions = ['dev', 'qa', 'release'];
				cgwVersion = await vscode.window.showQuickPick(supportedVersions, {
					placeHolder: 'CGW SDK VERSION을 선택하세요',
					title: 'Yocto AP Build Configuration'
				});
				
				if (!cgwVersion) {
					axonLog('❌ 사용자 취소: VERSION 선택이 취소되었습니다.');
					vscode.window.showInformationMessage('빌드가 취소되었습니다.');
					return;
				}
			}
			
			// 선택한 설정을 config.json에 저장
			try {
				let existingConfig: any = {};
				try {
					const configContent = await vscode.workspace.fs.readFile(configUri);
					existingConfig = JSON.parse(Buffer.from(configContent).toString('utf8'));
				} catch {
					// config.json이 없으면 빈 객체 사용
				}
				
				existingConfig.machine = apMachine;
				existingConfig.version = cgwVersion;
				
				const configJson = JSON.stringify(existingConfig, null, 2);
				await vscode.workspace.fs.writeFile(configUri, Buffer.from(configJson, 'utf8'));
				axonLog(`💾 빌드 설정을 config.json에 저장했습니다: MACHINE=${apMachine}, VERSION=${cgwVersion}`);
			} catch (error) {
				axonLog(`⚠️ config.json 저장 실패 (계속 진행): ${error}`);
			}
		}
		
		const machine = apMachine!;
		const version = cgwVersion!;
		const buildScript = `${yoctoRoot}/poky/meta-telechips/meta-dev/meta-cgw-dev/cgw-build.sh`;
		
		axonLog(`📂 빌드 디렉토리: ${buildDir}`);
		axonLog(`📋 빌드 설정: MACHINE=${machine}, VERSION=${version}`);
		
		// 3. buildtools 환경 확인 (builder.ts 498-514 또는 276-292 참고)
		const envPath = `${yoctoRoot}/buildtools/environment-setup-x86_64-pokysdk-linux`;
		const envUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: envPath
		});
		
		try {
			await vscode.workspace.fs.stat(envUri);
			axonLog(`✅ Buildtools 환경 확인: ${envPath}`);
		} catch {
			const errorMsg = 'Buildtools 환경이 설정되지 않았습니다. 먼저 "build toolchain"을 실행해야 합니다.';
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 4. 빌드 스크립트 확인 (builder.ts 516-534 또는 294-312 참고)
		const buildScriptUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: buildScript
		});
		
		try {
			await vscode.workspace.fs.stat(buildScriptUri);
			axonLog(`✅ 빌드 스크립트 확인: ${buildScript}`);
		} catch {
			const errorMsg = `빌드 스크립트를 찾을 수 없습니다: ${buildScript}`;
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 5. 빌드 스크립트 실행하여 빌드 디렉토리 생성 (builder.ts 539-543 또는 317-321 참고)
		// 빌드 디렉토리와 local.conf 파일을 생성하기 위해 빌드 스크립트만 실행
		axonLog(`🔨 빌드 디렉토리 생성 중...`);
		const { executeShellTask } = await import('./projects/common/shell-utils');
		
		const yoctoRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: yoctoRoot
		});
		
		const setupBuildDirCommand = `cd "${yoctoRoot}"
source "${envPath}"
source "${buildScript}" ${machine} ${version}`;
		
		await executeShellTask({
			command: setupBuildDirCommand,
			cwd: yoctoRoot,
			taskName: `Setup Build Directory: ${buildDir}`,
			taskId: `setupBuildDir_${buildDir.replace(/\//g, '_')}`,
			showTerminal: true,
			useScriptFile: true,
			cwdUri: yoctoRootUri
		});
		
		axonLog(`✅ 빌드 디렉토리 생성 완료: ${buildDir}`);
		
		// 실행 확인 다이얼로그
		const confirmMessage = `'${recipeName}' 레시피에 대해 DevTool Create & Modify를 실행하시겠습니까?\n\n` +
			`빌드 환경: ${buildDir}\n` +
			`MACHINE: ${machine}, VERSION: ${version}\n` +
			`DevTool workspace: external-workspace/${workspaceName}\n\n` +
			`실행 단계:\n` +
			`1. devtool create-workspace (workspace가 없을 때만)\n` +
			`2. devtool modify\n` +
			`3. bbappend 파일 수정`;
		
		const confirm = await vscode.window.showInformationMessage(
			confirmMessage,
			{ modal: true },
			'확인',
			'취소'
		);
		
		if (confirm !== '확인') {
			axonLog('❌ 사용자가 실행을 취소했습니다.');
			return;
		}
		
		// 6. DevTool workspace 경로 결정 (빌드 디렉토리 기반)
		// workspaceName은 이미 위에서 결정됨
		const workspacePath = `${yoctoRoot}/external-workspace/${workspaceName}`;
		const workspaceSourcePath = `${workspacePath}/sources`;
		axonLog(`📁 DevTool workspace: ${workspacePath}`);
		
		// 6-1. workspace 존재 여부 확인
		const workspaceUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: workspacePath
		});
		
		let workspaceExists = false;
		try {
			const stat = await vscode.workspace.fs.stat(workspaceUri);
			workspaceExists = (stat.type & vscode.FileType.Directory) === vscode.FileType.Directory;
		} catch {
			workspaceExists = false;
		}
		
		if (workspaceExists) {
			axonLog(`✅ DevTool workspace가 이미 존재합니다: ${workspacePath}`);
		} else {
			axonLog(`📝 새 DevTool workspace를 생성합니다: ${workspacePath}`);
		}
		
		// 3. bbappend 파일 수정을 위한 인라인 bash 스크립트
		axonLog(`📋 bbappend 수정 스크립트 준비 중...`);
		
		const fixBbappendScript = `
RECIPE_PN="${recipeName}"
# DevTool workspace에서 bbappend 파일 찾기
# devtool modify 후 생성되는 bbappend 파일은 기본적으로 BUILDDIR/workspace/appends/ 에 있습니다.
BBAPPEND_FILE=""

# 탐색할 디렉토리 목록 (우선순위 순서)
# 1. external-workspace의 appends 폴더 (커스텀 workspace 사용 시)
# 2. external-workspace/recipes/ (커스텀 workspace의 레시피별 폴더)
search_dirs=(
  "${yoctoRoot}/external-workspace/${workspaceName}/appends"
  "${yoctoRoot}/external-workspace/${workspaceName}/recipes/\${RECIPE_PN}"
)

# 각 디렉토리에서 bbappend 파일 찾기
for dir in "\${search_dirs[@]}"; do
    [ -d "$dir" ] || continue
    candidate=$(find "$dir" -maxdepth 1 -name "\${RECIPE_PN}*.bbappend" 2>/dev/null | head -n 1)
    if [[ -n "$candidate" ]]; then
        BBAPPEND_FILE="$candidate"
        break
    fi
done

# 파일을 찾지 못한 경우 에러 출력
if [[ -z "$BBAPPEND_FILE" ]]; then
    echo "❌ ERROR: bbappend 파일을 찾을 수 없습니다."
    echo "확인한 경로:"
    printf '  - %s\n' "\${search_dirs[@]}"
    echo "현재 디렉토리: $(pwd)"
    exit 1
fi

echo "✅ bbappend 파일: \${BBAPPEND_FILE}"

# 백업 생성
BACKUP_FILE="\${BBAPPEND_FILE}.backup.\$(date +%Y%m%d_%H%M%S)"
cp "\${BBAPPEND_FILE}" "\${BACKUP_FILE}"
echo "📋 Backup created: \${BACKUP_FILE}"

# 임시 파일 생성
TEMP_FILE=\$(mktemp)

# 1단계: 헤더 부분 복사
while IFS= read -r line; do
    if [[ "\$line" =~ ^FILESEXTRAPATHS ]] || [[ "\$line" =~ ^FILESPATH ]] || [[ "\$line" =~ ^#.*srctreebase ]]; then
        echo "\$line" >> "\${TEMP_FILE}"
    elif [[ "\$line" =~ ^inherit.*externalsrc ]]; then
        break
    elif [[ -z "\$line" ]]; then
        echo "\$line" >> "\${TEMP_FILE}"
    fi
done < "\${BBAPPEND_FILE}"

# 2단계: Python 필터 추가
cat >> "\${TEMP_FILE}" <<'PYEOF'

# externalsrc 사용 시 원격 git 항목은 Fetch 해석에서 제외
python () {
    src_uri = (d.getVar('SRC_URI') or '').split()
    filtered = []
    for u in src_uri:
        if u.startswith('git://') or u.startswith('ssh://') or u.startswith('http://') or u.startswith('https://'):
            continue
        if ('.git' in u) and (not u.startswith('file://')):
            continue
        filtered.append(u)
    d.setVar('SRC_URI', ' '.join(filtered))
}

PYEOF

# 3단계: 나머지 부분 (inherit externalsrc 이후) 추가
COPY_REST=false
while IFS= read -r line; do
    if [[ "\$line" =~ ^inherit.*externalsrc ]]; then
        COPY_REST=true
    fi
    if [[ "\${COPY_REST}" == true ]]; then
        echo "\$line" >> "\${TEMP_FILE}"
    fi
done < "\${BBAPPEND_FILE}"

# 파일 교체
mv "\${TEMP_FILE}" "\${BBAPPEND_FILE}"

echo ""
echo "✓ bbappend 파일이 성공적으로 수정되었습니다!"
echo "  수정된 파일: \${BBAPPEND_FILE}"
echo "  백업 파일: \${BACKUP_FILE}"
echo ""
`;
		
		// 7. executeShellTask를 사용하여 명령 실행
		const { executeShellTask: devtoolExecuteShellTask } = await import('./projects/common/shell-utils');
		
		const devtoolYoctoRootUri = vscode.Uri.from({
			scheme: workspaceFolder.uri.scheme,
			authority: workspaceFolder.uri.authority,
			path: yoctoRoot
		});
		
		// workspace가 없을 때만 create-workspace 실행
		const createWorkspaceCommand = workspaceExists 
			? `echo "ℹ️  DevTool workspace가 이미 존재하므로 create-workspace를 건너뜁니다: ${workspacePath}"`
			: `devtool create-workspace ${workspacePath}`;
		
		// devtool modify는 항상 external-workspace의 sources 디렉토리를 사용하도록 지정
		const devtoolModifyCommand = `devtool modify ${recipeName} "${workspaceSourcePath}"`;
		
		const fullCommand = `cd "${yoctoRoot}"
source poky/oe-init-build-env ${buildDir}
${createWorkspaceCommand}
${devtoolModifyCommand}
${fixBbappendScript}
echo ""
echo "=========================================="
echo "✅ DevTool Setup이 성공적으로 완료되었습니다!"
echo "   레시피: ${recipeName}"
echo "   빌드 환경: ${buildDir}"
echo "   DevTool workspace: ${workspacePath}"
echo "=========================================="
echo ""`;
		
		axonLog(`🔨 실행할 명령 준비 완료`);
		
		await devtoolExecuteShellTask({
			command: fullCommand,
			cwd: yoctoRoot,
			taskName: `DevTool: ${recipeName}`,
			taskId: `devtoolCreateModify_${recipeName}`,
			showTerminal: true,
			useScriptFile: true,  // 긴 명령어를 스크립트 파일로 실행
			cwdUri: devtoolYoctoRootUri
		});
		
		// 작업 성공적으로 종료됨 (exit code 0) → 메뉴에 동적으로 추가
		if (globalBuildProvider) {
			globalBuildProvider.addDevtoolRecipe(recipeName);
			try {
				await vscode.commands.executeCommand('axonBuildView.focus');
			} catch {}
		}

		axonSuccess(`✅ DevTool Create & Modify가 완료되었습니다!\n레시피: ${recipeName}\n빌드 디렉토리: ${buildDir}`);
		
	} catch (error) {
		const errorMsg = `DevTool Create & Modify 실행 중 오류 발생: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

/**
 * DevTool Build 실행
 * 
 * @param recipeName - 빌드할 레시피 이름
 */
async function executeDevtoolBuild(recipeName: string): Promise<void> {
	axonLog(`🔨 [DevTool Build] 시작: ${recipeName}`);

	try {
		// 실행 확인 다이얼로그
		let confirmMessage = `'${recipeName}' 레시피를 빌드하시겠습니까?\n\n실행 명령:\n- devtool build ${recipeName}`;
		
		// linux-telechips인 경우 추가 정보 표시
		if (recipeName === 'linux-telechips') {
			confirmMessage += `\n- bitbake -f -c make_fai telechips-cgw-image`;
		}
		
		const confirm = await vscode.window.showInformationMessage(
			confirmMessage,
			{ modal: true },
			'확인',
			'취소'
		);
		
		if (confirm !== '확인') {
			axonLog('❌ 사용자가 빌드를 취소했습니다.');
			return;
		}
		
		// Yocto 프로젝트 루트 경로 확인
		const config = vscode.workspace.getConfiguration('axon');
		const yoctoRoot = config.get<string>('yocto.projectRoot', '');
		
		if (!yoctoRoot || yoctoRoot.trim() === '') {
			const errorMsg = 'Yocto 프로젝트 루트가 설정되지 않았습니다.';
			axonError(errorMsg);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}
		
		// 빌드 환경 결정
		// MCU 레시피 (m7-0, m7-1, m7-2, m7-np)만 build/tcn1000-mcu 사용
		// 나머지 모든 레시피는 build/tcn1000 사용
		const mcuRecipes = ['m7-0', 'm7-1', 'm7-2', 'm7-np'];
		const buildDir = mcuRecipes.includes(recipeName)
			? 'build/tcn1000-mcu'
			: 'build/tcn1000';
		axonLog(`📂 빌드 디렉토리: ${buildDir}`);
		
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('워크스페이스 폴더를 찾을 수 없습니다.');
		}
		
		// YoctoProjectBuilder의 공통 함수 사용
		const { YoctoProjectBuilder } = await import('./projects/yocto/builder');
		
		// buildtools 환경 확인
		const envPath = await YoctoProjectBuilder.ensureBuildtoolsEnvironment(yoctoRoot, workspaceFolder);
		if (!envPath) {
			return;
		}
		
		// 빌드 디렉토리 설정 (oe-init-build-env 실행)
		const setupSuccess = await YoctoProjectBuilder.setupBuildDirectoryWithOeInit(
			yoctoRoot,
			envPath,
			buildDir,
			workspaceFolder
		);
		if (!setupSuccess) {
			return;
		}
		
		// local.conf 파일 수정 (캐시 경로 설정)
		const fullBuildDir = `${yoctoRoot}/${buildDir}`;
		axonLog('📝 local.conf 파일 수정 중...');
		await YoctoProjectBuilder.updateLocalConfCachePaths(fullBuildDir, workspaceFolder);
		
		// 빌드 명령 구성
		const buildCommands: string[] = [
			`devtool build ${recipeName}`
		];
		
		// linux-telechips인 경우 추가 bitbake 명령어 실행
		if (recipeName === 'linux-telechips') {
			buildCommands.push(`bitbake -f -c make_fai telechips-cgw-image`);
			axonLog(`📦 linux-telechips 감지: bitbake make_fai 명령어 추가`);
		}
		
		// 성공 메시지 추가
		buildCommands.push(
			`echo ""`,
			`echo "=========================================="`,
			`echo "✅ DevTool Build가 성공적으로 완료되었습니다!"`,
			`echo "   레시피: ${recipeName}"`,
			`echo "   빌드 환경: ${buildDir}"`,
			`echo "=========================================="`,
			`echo ""`
		);
		
		// 빌드 명령 실행
		await YoctoProjectBuilder.executeBuildCommand(
			yoctoRoot,
			envPath,
			buildDir,
			buildCommands,
			`DevTool Build: ${recipeName}`,
			`devtoolBuild_${recipeName}`,
			workspaceFolder
		);
		
		axonSuccess(`✅ DevTool Build가 시작되었습니다!\n레시피: ${recipeName}`);
		
	} catch (error) {
		const errorMsg = `DevTool Build 실행 중 오류 발생: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

// 전역 BuildProvider (executeMcuSelectCore에서 접근하기 위함)
let globalBuildProvider: BuildProvider | undefined;



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
	globalBuildProvider = buildProvider; // 전역 변수에 저장
	
	// DevTool 레시피 목록 로드
	buildProvider.loadDevtoolRecipes();
	
	vscode.window.registerTreeDataProvider('axonCreateProjectsView', createProjectsProvider);
	vscode.window.registerTreeDataProvider('axonConfigurationsView', configurationsProvider);
	vscode.window.registerTreeDataProvider('axonBuildView', buildProvider);

	// MCU Project Dialog Provider 등록
	const mcuProjectDialog = new McuProjectDialog(context);
	
	// Yocto Project Dialog Provider 등록
	const yoctoProjectDialog = new YoctoProjectDialog(context);

	// FWDN ALL 실행 명령
	const runFwdnAllDisposable = vscode.commands.registerCommand(
		'axon.FWDN_ALL',
		async () => executeFwdnCommand(context.extensionPath)
	);

	// MCU Build Make 실행 명령
	const mcuBuildMakeDisposable = vscode.commands.registerCommand(
		'axon.mcuBuildMake',
		async () => executeMcuBuildMake(context.extensionPath)
	);

	// MCU Build All 실행 명령
	const mcuBuildAllDisposable = vscode.commands.registerCommand(
		'axon.mcuBuildAll',
		async () => executeMcuBuildAll(context.extensionPath)
	);

	// MCU Select Core 실행 명령
	const mcuSelectCoreDisposable = vscode.commands.registerCommand(
		'axon.mcuSelectCore',
		async () => executeMcuSelectCore(context.extensionPath)
	);

	// MCU Clean 실행 명령
	const mcuCleanDisposable = vscode.commands.registerCommand(
		'axon.mcuClean',
		async () => executeMcuClean(context.extensionPath)
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
		async () => executeDevtoolCreateModify(context.extensionPath)
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

	// VSCode exclude folders 설정 명령
	const vscodeExcludeFoldersDisposable = vscode.commands.registerCommand(
		'axon.vscodeExcludeFolders',
		async () => {
			await configureVscodeExcludeFolders();
		}
	);

	context.subscriptions.push(
		runFwdnAllDisposable,
		mcuBuildMakeDisposable,
		mcuBuildAllDisposable,
		mcuSelectCoreDisposable,
		mcuCleanDisposable,
		buildAndCopyScriptsDisposable,
		// 새로운 프로젝트 생성 명령어들
		createMcuStandaloneProjectDisposable,
		createYoctoProjectDisposable,
		// 빌드 명령어들
		buildYoctoApDisposable,
		buildYoctoMcuDisposable,
		buildYoctoKernelDisposable,
		// DevTool 명령어들
		devtoolCreateModifyDisposable,
		devtoolBuildDisposable,
		vscodeExcludeFoldersDisposable,
		// 클린 명령어들
		cleanYoctoApDisposable,
		cleanYoctoMcuDisposable,
		cleanYoctoAllDisposable,
		// 설정 편집 명령어들
		editApLocalConfDisposable,
		editMcuLocalConfDisposable,
		editBranchSrcrevDisposable
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

// 설정된 빌드 폴더를 찾는 재귀 검색 함수
async function searchMcuTcn100xInDirectory(baseUri: vscode.Uri, currentDepth: number = 0, maxDepth: number = 4): Promise<string | null> {
	const config = getAxonConfig();
	const mcuFolderName = config.buildAxonFolderName || 'mcu-tcn100x';

	try {
		// baseUri가 이미 mcu-tcn100x 폴더인지 확인
		const basePath = baseUri.path;
		if (basePath.endsWith('/' + mcuFolderName) || basePath.endsWith('\\' + mcuFolderName)) {
			// 로컬은 fsPath, 원격은 Unix 경로 사용 (터미널 명령용)
			const finalPath = baseUri.scheme === 'file' ? baseUri.fsPath : baseUri.path;
			axonLog(`✅ depth ${currentDepth}에서 baseUri가 이미 ${mcuFolderName} 폴더입니다: ${finalPath}`);
			return finalPath;
		}

		// 현재 디렉토리에서 mcu-tcn100x 폴더 확인
		const targetPath = baseUri.with({ path: `${baseUri.path.replace(/\/$/, '')}/${mcuFolderName}` });

		try {
			const stat = await vscode.workspace.fs.stat(targetPath);
			if (stat.type === vscode.FileType.Directory) {
				let finalPath: string;
				if (targetPath.scheme === 'file') {
					finalPath = targetPath.fsPath;
				} else {
					// 원격 경로일 경우, Unix 경로만 반환 (터미널 명령용)
					finalPath = targetPath.path;
				}

				axonLog(`✅ depth ${currentDepth}에서 ${mcuFolderName} 폴더를 찾았습니다: ${finalPath}`);
				return finalPath;
			}
		} catch {
			// 폴더가 없으면 계속 진행
		}

		// 최대 depth에 도달하지 않았으면 하위 폴더 탐색
		if (currentDepth < maxDepth) {
			try {
				const entries = await vscode.workspace.fs.readDirectory(baseUri);

				// 디렉토리만 필터링
				const allDirectories = entries.filter(([name, type]) => type === vscode.FileType.Directory);
				const directories = allDirectories.filter(([name]) => !name.startsWith('.'));

				for (const [dirName] of directories) {
					const subDirUri = baseUri.with({ path: baseUri.path + '/' + dirName });
					axonLog(`📁 depth ${currentDepth} - ${dirName} 폴더 탐색 중...`);

					const result = await searchMcuTcn100xInDirectory(subDirUri, currentDepth + 1, maxDepth);
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

// 설정된 빌드 폴더를 찾는 함수 (MCU Standalone 또는 Yocto 프로젝트용)
async function findMcuTcn100xFolder(): Promise<string | null> {
	const config = getAxonConfig();
	const mcuFolderName = config.buildAxonFolderName || 'mcu-tcn100x';
	
	const workspaceFolders = vscode.workspace.workspaceFolders;
	
	if (!workspaceFolders || workspaceFolders.length === 0) {
		axonLog('❌ 워크스페이스 폴더를 찾을 수 없습니다.');
		return null;
	}
	
	const searchStartTime = Date.now();
	axonLog(`🔍 ${mcuFolderName} 폴더 검색 시작 (depth 4까지): ${workspaceFolders[0].uri.path}`);
	
	try {
		let result: string | null = null;
		const workspacePath = workspaceFolders[0].uri.path;
		
		// 워크스페이스 경로에 mcu-tcn100x 폴더명이 포함되어 있다면 해당 폴더부터 검색
		if (workspacePath.includes(mcuFolderName)) {
			axonLog(`✅ 워크스페이스에 ${mcuFolderName}이 포함되어 있습니다: ${workspacePath}`);
			
			const folderIndex = workspacePath.indexOf(mcuFolderName);
			if (folderIndex !== -1) {
				const folderPath = workspacePath.substring(0, folderIndex + mcuFolderName.length);
				const folderUri = workspaceFolders[0].uri.with({ path: folderPath });
				
				axonLog(`🔍 워크스페이스 내 ${mcuFolderName} 폴더부터 depth 4까지 검색: ${dirToDisplay(folderUri)}`);
				
				result = await searchMcuTcn100xInDirectory(folderUri, 0, 4);
				
				if (result) {
					const searchDuration = Date.now() - searchStartTime;
					axonLog(`✅ 워크스페이스 내 ${mcuFolderName} 폴더를 찾았습니다: ${result}`);
					axonLog(`⏱️ ${mcuFolderName} 검색 완료 - 소요시간: ${searchDuration}ms`);
					return result;
				}
			}
		}
		
		// 일반적인 경우: 워크스페이스 폴더부터 depth 4까지 검색
		axonLog(`🔍 워크스페이스 폴더부터 depth 4까지 ${mcuFolderName} 검색: ${dirToDisplay(workspaceFolders[0].uri)}`);
		
		result = await searchMcuTcn100xInDirectory(workspaceFolders[0].uri, 0, 4);
		
		if (result) {
			const searchDuration = Date.now() - searchStartTime;
			axonLog(`✅ 워크스페이스에서 ${mcuFolderName} 폴더를 찾았습니다: ${result}`);
			axonLog(`⏱️ 전체 검색 완료 - 소요시간: ${searchDuration}ms`);
			return result;
		}
		
		axonLog(`❌ depth 4까지 검색했지만 ${mcuFolderName} 폴더를 찾을 수 없습니다.`);
		
		const searchDuration = Date.now() - searchStartTime;
		axonLog(`⏱️ 전체 검색 완료 (실패) - 소요시간: ${searchDuration}ms`);
		return null;
	} catch (error) {
		const searchDuration = Date.now() - searchStartTime;
		axonError(`${mcuFolderName} 폴더 검색 중 오류 발생: ${error}`);
		axonLog(`⏱️ 검색 중단 (오류) - 소요시간: ${searchDuration}ms`);
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

// buildAxonFolderName 설정 확인 및 선택 공통 함수
// (프로젝트 타입 기반으로 자동 설정)
async function ensureBuildAxonFolderName(): Promise<string | null> {
	const { ensureProjectType } = await import('./utils');
	
	// 프로젝트 타입 선택 (자동으로 buildAxonFolderName도 설정됨)
	const projectType = await ensureProjectType();
	
	if (!projectType) {
		axonLog('❌ 프로젝트 타입 선택이 취소되었습니다.');
		return null;
	}
	
	// 설정된 buildAxonFolderName 반환
	const config = getAxonConfig();
	axonLog(`✅ buildAxonFolderName: ${config.buildAxonFolderName}`);
	
	return config.buildAxonFolderName;
}

// MCU 빌드 make 실행 함수 (MCU Standalone 프로젝트용)
async function executeMcuBuildMake(extensionPath: string): Promise<void> {
	axonLog(`🚀 MCU Build Make 실행 명령 시작 (MCU Standalone 프로젝트)`);

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	try {
		// buildAxonFolderName 설정 확인 및 선택
		const buildAxonFolderName = await ensureBuildAxonFolderName();
		if (!buildAxonFolderName) {
			vscode.window.showInformationMessage('빌드가 취소되었습니다.');
			return;
		}
		
		// 빌드 폴더 찾기
		axonLog(`🔍 ${buildAxonFolderName} 폴더 자동 검색 시작...`);
		const mcuBuildPath = await findMcuTcn100xFolder();

		if (!mcuBuildPath) {
			axonLog(`❌ ${buildAxonFolderName} 폴더를 찾을 수 없습니다.`);
			vscode.window.showErrorMessage(`${buildAxonFolderName} 폴더를 찾을 수 없습니다. 워크스페이스를 확인해주세요.`);
			return;
		}

		axonLog(`✅ ${buildAxonFolderName} 폴더를 찾았습니다: ${mcuBuildPath}`);

		// 빌드 설정 확인 표시
		const configInfo = [
			'',
			'==================================================',
			'         MCU Build Make Configuration',
			'==================================================',
			`  빌드 경로: ${mcuBuildPath}`,
			`  명령: make`,
			'==================================================',
			''
		].join('\n');
		
		axonLog(configInfo);
		
		// 사용자 확인
		const confirm = await vscode.window.showWarningMessage(
			`MCU Build Make를 시작하시겠습니까?\n\n경로: ${mcuBuildPath}\n명령: make\n\n이 작업은 시간이 걸릴 수 있습니다.`,
			{ modal: true },
			'빌드 시작',
			'취소'
		);
		
		if (confirm !== '빌드 시작') {
			axonLog('❌ 사용자 취소: 빌드가 취소되었습니다.');
			vscode.window.showInformationMessage('빌드가 취소되었습니다.');
			return;
		}

	// 선택한 코어 가져오기
	const selectedCore = globalBuildProvider?.getLastSelectedCore();
	
	if (!selectedCore) {
		axonLog('❌ 선택된 코어가 없습니다.');
		vscode.window.showErrorMessage('먼저 "Select Core" 메뉴에서 빌드할 코어를 선택해주세요.');
		return;
	}
	
	axonLog(`🎯 선택된 코어: ${selectedCore}`);
	
	// 빌드 명령 생성
	const buildCommand = `cd "${mcuBuildPath}" && make clean_${selectedCore} && make ${selectedCore}`;
	
	axonLog(`🔨 실행할 명령 준비 완료`);
	
	await executeShellTask({
		command: buildCommand,
		cwd: mcuBuildPath,
		taskName: `MCU Build Make: ${selectedCore}`,
		taskId: `mcuBuildMake_${selectedCore}`,
		showTerminal: true,
		useScriptFile: true
	});
	
	// Build View에 포커스 복원
	setTimeout(async () => {
		await vscode.commands.executeCommand('axonBuildView.focus');
		axonLog(`🔄 Build View에 포커스를 복원했습니다`);
	}, 100);
	
	axonLog(`✅ MCU Build Make 실행 완료`);

	} catch (error) {
		const errorMsg = `MCU Build Make 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

// MCU Build All 실행 함수 (MCU Standalone 프로젝트용)
async function executeMcuBuildAll(extensionPath: string): Promise<void> {
	axonLog(`🚀 MCU Build All 실행 명령 시작 (MCU Standalone 프로젝트)`);

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	try {
		// buildAxonFolderName 설정 확인 및 선택
		const buildAxonFolderName = await ensureBuildAxonFolderName();
		if (!buildAxonFolderName) {
			vscode.window.showInformationMessage('빌드가 취소되었습니다.');
			return;
		}
		
		// 빌드 폴더 찾기
		axonLog(`🔍 ${buildAxonFolderName} 폴더 자동 검색 시작...`);
		const mcuBuildPath = await findMcuTcn100xFolder();

		if (!mcuBuildPath) {
			axonLog(`❌ ${buildAxonFolderName} 폴더를 찾을 수 없습니다.`);
			vscode.window.showErrorMessage(`${buildAxonFolderName} 폴더를 찾을 수 없습니다. 워크스페이스를 확인해주세요.`);
			return;
		}

		axonLog(`✅ ${buildAxonFolderName} 폴더를 찾았습니다: ${mcuBuildPath}`);

		// defconfig 목록 (실행 순서대로)
		const defconfigs = [
			'tcn100x_m7-np_defconfig',
			'tcn100x_m7-0_defconfig',
			'tcn100x_m7-2_defconfig',
			'tcn100x_m7-1_defconfig'
		];

		// 빌드 설정 확인 표시
		const configInfo = [
			'',
			'==================================================',
			'        MCU Build All Configuration',
			'==================================================',
			`  빌드 경로: ${mcuBuildPath}`,
			`  타겟: ${defconfigs.join(', ')}`,
			'==================================================',
			''
		].join('\n');
		
		axonLog(configInfo);
		
		// 사용자 확인
		const confirm = await vscode.window.showWarningMessage(
			`MCU Build All을 시작하시겠습니까?\n\n경로: ${mcuBuildPath}\n타겟: m7-np, m7-0, m7-2, m7-1\n\n이 작업은 시간이 오래 걸릴 수 있습니다.`,
			{ modal: true },
			'빌드 시작',
			'취소'
		);
		
		if (confirm !== '빌드 시작') {
			axonLog('❌ 사용자 취소: 빌드가 취소되었습니다.');
			vscode.window.showInformationMessage('빌드가 취소되었습니다.');
			return;
		}

	// 빌드 명령 생성
	const buildCommand = `cd "${mcuBuildPath}" && make clean && make all`;
	
	axonLog(`🔨 실행할 명령 준비 완료`);
	
	await executeShellTask({
		command: buildCommand,
		cwd: mcuBuildPath,
		taskName: 'MCU Build All',
		taskId: 'mcuBuildAll',
		showTerminal: true,
		useScriptFile: true
	});
		
		// TreeView 업데이트 - 마지막으로 빌드된 코어 표시 (m7-1)
		if (globalBuildProvider) {
			globalBuildProvider.setLastSelectedCore('m7-1');
			axonLog(`🔄 TreeView 업데이트: 마지막 빌드 코어 = m7-1`);
		}
		
		// Build View에 포커스 복원 (딜레이 후 실행하여 확실하게 포커스 이동)
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);

		axonLog(`✅ MCU Build All 명령 전송 완료`);

	} catch (error) {
		const errorMsg = `MCU Build All 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

// MCU Select Core 실행 함수 (MCU Standalone 프로젝트용)
async function executeMcuSelectCore(extensionPath: string): Promise<void> {
	axonLog(`🚀 MCU Select Core 실행 명령 시작`);

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	try {
		// buildAxonFolderName 설정 확인 및 선택
		const buildAxonFolderName = await ensureBuildAxonFolderName();
		if (!buildAxonFolderName) {
			vscode.window.showInformationMessage('작업이 취소되었습니다.');
			return;
		}
		
		// 코어 목록 정의
		const coreOptions = [
			{ label: 'm7-np', defconfig: 'tcn100x_m7-np_defconfig', description: 'M7 Non-Processor' },
			{ label: 'm7-0', defconfig: 'tcn100x_m7-0_defconfig', description: 'M7 Core 0' },
			{ label: 'm7-1', defconfig: 'tcn100x_m7-1_defconfig', description: 'M7 Core 1' },
			{ label: 'm7-2', defconfig: 'tcn100x_m7-2_defconfig', description: 'M7 Core 2' }
		];

		// QuickPick으로 코어 선택
		const selectedCore = await vscode.window.showQuickPick(coreOptions, {
			placeHolder: '빌드할 코어를 선택하세요',
			title: 'MCU Select Core'
		});

		if (!selectedCore) {
			axonLog(`ℹ️ 사용자가 코어 선택을 취소했습니다.`);
			return;
		}

		axonLog(`✅ 선택된 코어: ${selectedCore.label} (${selectedCore.defconfig})`);

		// 빌드 폴더 찾기
		axonLog(`🔍 빌드 폴더 자동 검색 시작...`);
		const mcuBuildPath = await findMcuTcn100xFolder();

		if (!mcuBuildPath) {
			const config = getAxonConfig();
			const folderName = config.buildAxonFolderName || 'mcu-tcn100x';
			axonLog(`❌ ${folderName} 폴더를 찾을 수 없습니다.`);
			vscode.window.showErrorMessage(`${folderName} 폴더를 찾을 수 없습니다. 워크스페이스를 확인해주세요.`);
			return;
		}

		axonLog(`✅ 빌드 폴더를 찾았습니다: ${mcuBuildPath}`);

		// 환경 감지 및 터미널 생성
		const isRemote = vscode.env.remoteName !== undefined;
		let terminal: vscode.Terminal;

		if (isRemote) {
			// 원격 환경: bash를 사용하는 원격 터미널 생성
			axonLog(`🔧 원격 환경 감지 - bash 터미널 생성 또는 재사용`);

			// 열려있는 bash 터미널 찾기
			let bashTerminal = vscode.window.terminals.find(term => {
				const terminalName = term.name || '';
				return terminalName.toLowerCase().includes('bash') ||
					   terminalName.toLowerCase().includes('terminal') ||
					   terminalName === '';
			});

			if (bashTerminal) {
				terminal = bashTerminal;
				axonLog(`✅ 기존 bash 터미널을 재사용합니다: ${bashTerminal.name}`);
			} else {
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
					terminal = vscode.window.createTerminal({
						name: `MCU Select Core (Bash)`,
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

			let bashTerminal = vscode.window.terminals.find(term => {
				const terminalName = term.name || '';
				return terminalName.toLowerCase().includes('bash') ||
					   terminalName.toLowerCase().includes('terminal') ||
					   terminalName === '';
			});

			if (bashTerminal) {
				terminal = bashTerminal;
				axonLog(`✅ 기존 bash 터미널을 재사용합니다: ${bashTerminal.name}`);
			} else {
				try {
					await vscode.commands.executeCommand('workbench.action.terminal.new');
					const basicTerminal = vscode.window.activeTerminal;
					if (basicTerminal) {
						terminal = basicTerminal;
						axonLog(`✅ 새 터미널을 생성했습니다: ${basicTerminal.name}`);
					} else {
						throw new Error('기본 터미널 생성에 실패했습니다.');
					}
				} catch {
					terminal = vscode.window.createTerminal({
						name: `MCU Select Core (Bash)`,
						shellPath: 'bash',
						shellArgs: ['--login'],
						isTransient: true
					});
					axonLog(`✅ 폴백으로 bash 터미널을 직접 생성했습니다`);
				}
			}
		}

		// 터미널 표시 (포커스는 주지 않음)
		terminal.show(false);
		axonLog(`📺 터미널을 백그라운드로 표시합니다`);

		// MCU 빌드 디렉토리로 이동하고 선택한 defconfig 실행
		terminal.sendText(`cd "${mcuBuildPath}"`, true);
		terminal.sendText(`make ${selectedCore.defconfig}`, true);
		
		// 완료 메시지
		terminal.sendText(`echo ""`, true);
		terminal.sendText(`echo "✅ ${selectedCore.label} defconfig 완료!"`, true);
		terminal.sendText(`echo ""`, true);

		const successMsg = `${selectedCore.label} defconfig가 실행되었습니다!\n경로: ${mcuBuildPath}\n명령: make ${selectedCore.defconfig}`;
		axonSuccess(successMsg);

		// TreeView 업데이트 - 마지막 선택한 코어 표시
		if (globalBuildProvider) {
			globalBuildProvider.setLastSelectedCore(selectedCore.label);
			axonLog(`🔄 TreeView 업데이트: 마지막 선택 코어 = ${selectedCore.label}`);
		}

		// Build View에 포커스 복원 (딜레이 후 실행하여 확실하게 포커스 이동)
		setTimeout(async () => {
			await vscode.commands.executeCommand('axonBuildView.focus');
			axonLog(`🔄 Build View에 포커스를 복원했습니다`);
		}, 100);

		axonLog(`✅ MCU Select Core (${selectedCore.label}) 명령 전송 완료`);

	} catch (error) {
		const errorMsg = `MCU Select Core 실행 중 오류가 발생했습니다: ${error}`;
		axonError(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

// MCU Clean 실행 함수 (MCU Standalone 프로젝트용)
async function executeMcuClean(extensionPath: string): Promise<void> {
	axonLog(`🚀 MCU Clean 실행 명령 시작 (MCU Standalone 프로젝트)`);

	// 환경 정보 로깅 (디버깅용)
	axonLog(`🌐 환경 정보 - Remote-SSH: ${vscode.env.remoteName !== undefined}, Platform: ${process.platform}`);

	try {
		// buildAxonFolderName 설정 확인 및 선택
		const buildAxonFolderName = await ensureBuildAxonFolderName();
		if (!buildAxonFolderName) {
			vscode.window.showInformationMessage('작업이 취소되었습니다.');
			return;
		}
		
		// 빌드 폴더 찾기
		axonLog(`🔍 ${buildAxonFolderName} 폴더 자동 검색 시작...`);
		const mcuBuildPath = await findMcuTcn100xFolder();

		if (!mcuBuildPath) {
			axonLog(`❌ ${buildAxonFolderName} 폴더를 찾을 수 없습니다.`);
			vscode.window.showErrorMessage(`${buildAxonFolderName} 폴더를 찾을 수 없습니다. 워크스페이스를 확인해주세요.`);
			return;
		}

		axonLog(`✅ ${buildAxonFolderName} 폴더를 찾았습니다: ${mcuBuildPath}`);

		// 빌드 설정 확인 표시
		const configInfo = [
			'',
			'==================================================',
			'         MCU Clean Configuration',
			'==================================================',
			`  빌드 경로: ${mcuBuildPath}`,
			`  명령: make clean`,
			'==================================================',
			''
		].join('\n');
		
		axonLog(configInfo);
		
		// 사용자 확인
		const confirm = await vscode.window.showWarningMessage(
			`MCU Clean을 시작하시겠습니까?\n\n경로: ${mcuBuildPath}\n명령: make clean\n\n빌드된 파일들이 삭제됩니다.`,
			{ modal: true },
			'Clean 시작',
			'취소'
		);
		
		if (confirm !== 'Clean 시작') {
			axonLog('❌ 사용자 취소: Clean이 취소되었습니다.');
			vscode.window.showInformationMessage('Clean이 취소되었습니다.');
			return;
		}

	// Clean 명령 생성
	const cleanCommand = `cd "${mcuBuildPath}" && make clean`;
	
	axonLog(`🔨 실행할 명령 준비 완료`);
	
	await executeShellTask({
		command: cleanCommand,
		cwd: mcuBuildPath,
		taskName: 'MCU Clean',
		taskId: 'mcuClean',
		showTerminal: true,
		useScriptFile: true
	});
	
	// Build View에 포커스 복원
	setTimeout(async () => {
		await vscode.commands.executeCommand('axonBuildView.focus');
		axonLog(`🔄 Build View에 포커스를 복원했습니다`);
	}, 100);
	
	axonLog(`✅ MCU Clean 실행 완료`);

	} catch (error) {
		const errorMsg = `MCU Clean 실행 중 오류가 발생했습니다: ${error}`;
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
