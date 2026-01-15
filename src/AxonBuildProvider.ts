import * as vscode from 'vscode';
import { axonLog } from './logger';

/**
 * Axon Build TreeView Provider
 */
export class AxonBuildProvider implements vscode.TreeDataProvider<AxonTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<AxonTreeItem | undefined | null | void> = new vscode.EventEmitter<AxonTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<AxonTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private projectType: string | undefined;

	constructor() {
		this.loadProjectType();
	}

	private async loadProjectType(): Promise<void> {
		const config = vscode.workspace.getConfiguration('axon');
		this.projectType = config.get<string>('projectType');
	}

	refresh(): void {
		this.loadProjectType();
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: AxonTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: AxonTreeItem): Promise<AxonTreeItem[]> {
		if (!element) {
			return await this.getRootItems();
		}
		return await this.getChildItems(element);
	}

	private async getRootItems(): Promise<AxonTreeItem[]> {
		if (!this.projectType) {
			return [
				new AxonTreeItem(
					'No project configured',
					'info',
					vscode.TreeItemCollapsibleState.None,
					'info',
					{
						command: 'axon.setProjectType',
						title: 'Set Project Type'
					}
				)
			];
		}

	switch (this.projectType) {
		case 'yocto_project':
			return await this.getBuildYoctoItems();
		case 'yocto_project_autolinux':
			return await this.getBuildYoctoAutolinuxItems();
		case 'mcu_project':
			return await this.getBuildMcuItems();
		default:
			return [];
	}
	}

	private async getChildItems(element: AxonTreeItem): Promise<AxonTreeItem[]> {
		switch (element.contextValue) {
			case 'configuration':
				return this.getConfigurationItems();
			case 'build':
				return this.getBuildItems();
			case 'buildYocto':
				return await this.getBuildYoctoItems();
		case 'buildYoctoAutolinux':
			return await this.getBuildYoctoAutolinuxItems();
		case 'buildMcu':
			return await this.getBuildMcuItems();
		case 'devtool':
				return this.getDevtoolItems();
			case 'yoctoConfig':
				return this.getYoctoConfigItems();
			default:
				return [];
		}
	}

	private getConfigurationItems(): AxonTreeItem[] {
		const items: AxonTreeItem[] = [];

		const currentType = this.projectType === 'yocto_project' ? 'Yocto' :
							this.projectType === 'yocto_project_autolinux' ? 'Autolinux' :
							this.projectType === 'mcu_project' ? 'MCU' : 'None';
		
		items.push(new AxonTreeItem(
			`Project Type: ${currentType}`,
			'symbol-enum',
			vscode.TreeItemCollapsibleState.None,
			'projectType',
			{
				command: 'axon.setProjectType',
				title: 'Set Project Type'
			}
		));

		if (this.projectType === 'yocto_project') {
			items.push(new AxonTreeItem(
				'Yocto Configuration',
				'settings-gear',
				vscode.TreeItemCollapsibleState.Collapsed,
				'yoctoConfig'
			));
		}

		if (this.projectType === 'mcu_project') {
			items.push(new AxonTreeItem(
				'Build Option Extraction',
				'search',
				vscode.TreeItemCollapsibleState.None,
				'buildOption',
				{
					command: 'axon.buildOptionExtraction',
					title: 'Build Option Extraction'
				}
			));
		}

		return items;
	}

	private getYoctoConfigItems(): AxonTreeItem[] {
		return [
			new AxonTreeItem(
				'Edit AP local.conf',
				'file',
				vscode.TreeItemCollapsibleState.None,
				'yoctoConfigItem',
				{
					command: 'axon.editApLocalConf',
					title: 'Edit AP local.conf'
				}
			),
			new AxonTreeItem(
				'Edit MCU local.conf',
				'file',
				vscode.TreeItemCollapsibleState.None,
				'yoctoConfigItem',
				{
					command: 'axon.editMcuLocalConf',
					title: 'Edit MCU local.conf'
				}
			),
			new AxonTreeItem(
				'Edit Branch/Srcrev',
				'file',
				vscode.TreeItemCollapsibleState.None,
				'yoctoConfigItem',
				{
					command: 'axon.editBranchSrcrev',
					title: 'Edit Branch/Srcrev'
				}
			)
		];
	}

	private getBuildItems(): AxonTreeItem[] {
		const items: AxonTreeItem[] = [];

		if (this.projectType === 'yocto_project') {
			items.push(new AxonTreeItem(
				'Yocto',
				'package',
				vscode.TreeItemCollapsibleState.Collapsed,
				'buildYocto'
			));

			items.push(new AxonTreeItem(
				'DevTool',
				'beaker',
				vscode.TreeItemCollapsibleState.Collapsed,
				'devtool'
			));
		}

		if (this.projectType === 'yocto_project_autolinux') {
			items.push(new AxonTreeItem(
				'Yocto (autolinux)',
				'package',
				vscode.TreeItemCollapsibleState.Collapsed,
				'buildYoctoAutolinux'
			));
		}

		return items;
	}

	private async getBuildYoctoItems(): Promise<AxonTreeItem[]> {
		const groups = await this.tryLoadYoctoCommandsGroups();

		// JSON 파일이 없거나 읽기 실패하면 기존 하드코딩 메뉴 유지
		if (!groups || groups.length === 0) {
			return [
				// JSON 생성 안내 버튼
				new AxonTreeItem(
					'⚠️ yocto.commands.json 없음 (생성)',
					'new-file',
					vscode.TreeItemCollapsibleState.None,
					'yoctoCommandsMissing',
					{
						command: 'axon.createYoctoCommandsJson',
						title: 'Create yocto.commands.json'
					}
				),
				// 빌드 버튼
				new AxonTreeItem(
					'▶ Build AP',
					'rocket',
					vscode.TreeItemCollapsibleState.None,
					'yoctoBuildButton',
					{
						command: 'axon.buildYoctoAp',
						title: 'Build AP'
					}
				),
				new AxonTreeItem(
					'▶ Build MCU',
					'circuit-board',
					vscode.TreeItemCollapsibleState.None,
					'yoctoBuildButton',
					{
						command: 'axon.buildYoctoMcu',
						title: 'Build MCU'
					}
				),
				new AxonTreeItem(
					'▶ Build Kernel',
					'server-process',
					vscode.TreeItemCollapsibleState.None,
					'yoctoBuildButton',
					{
						command: 'axon.buildYoctoKernel',
						title: 'Build Kernel'
					}
				),
				new AxonTreeItem(
					'🗑️ Clean AP',
					'trash',
					vscode.TreeItemCollapsibleState.None,
					'yoctoClean',
					{
						command: 'axon.cleanYoctoAp',
						title: 'Clean AP'
					}
				),
				new AxonTreeItem(
					'🗑️ Clean MCU',
					'trash',
					vscode.TreeItemCollapsibleState.None,
					'yoctoClean',
					{
						command: 'axon.cleanYoctoMcu',
						title: 'Clean MCU'
					}
				),
				new AxonTreeItem(
					'🗑️ Clean All',
					'trash',
					vscode.TreeItemCollapsibleState.None,
					'yoctoClean',
					{
						command: 'axon.cleanYoctoAll',
						title: 'Clean All'
					}
				)
			];
		}

		// JSON 기반 동적 메뉴 (groups 키 목록)
		return groups.map(groupName => {
			const lower = groupName.toLowerCase();
			const isClean = lower.includes('clean');

			let icon = isClean ? 'trash' : 'rocket';
			let labelPrefix = isClean ? '🗑️ ' : '▶ ';
			let context = isClean ? 'yoctoClean' : 'yoctoBuildButton';

			if (!isClean) {
				if (lower.includes('build ap')) icon = 'rocket';
				else if (lower.includes('build mcu')) icon = 'circuit-board';
				else if (lower.includes('build kernel')) icon = 'server-process';
			}

			const title = groupName;
			const label = `${labelPrefix}${title}`;

			return new AxonTreeItem(
				label,
				icon,
				vscode.TreeItemCollapsibleState.None,
				context,
				{
					command: 'axon.runYoctoJsonGroup',
					title: title,
					arguments: [groupName]
				}
			);
		});
	}

	/**
	 * commands.json 파일 1-depth 검색 (제외 폴더 스킵)
	 * autolinux-manager의 searchBuildAutolinuxInDirectory와 동일한 로직
	 */
	private async searchCommandsJsonInDirectory(
		dir: vscode.Uri, 
		fileName: string
	): Promise<vscode.Uri | null> {
		// 제외할 폴더 목록 (성능 최적화)
		const excludeDirs = [
			'node_modules', '.git', 'build', 'tmp', 'downloads', 'sstate-cache',
			'.vscode', 'dist', 'out', '.next', 'target', 'bin', 'obj'
		];

		try {
			const entries = await vscode.workspace.fs.readDirectory(dir);
			
			for (const [name, type] of entries) {
				// 제외 폴더는 스킵
				if (excludeDirs.includes(name)) {
					continue;
				}

				// 디렉토리만 확인
				if (type === vscode.FileType.Directory) {
					// vsebuildscript 또는 buildscript 폴더 확인
					if (name === 'vsebuildscript' || name === 'buildscript') {
						const jsonPath = vscode.Uri.joinPath(dir, name, fileName);
						try {
							await vscode.workspace.fs.stat(jsonPath);
							axonLog(`✅ ${fileName} 발견 (1-depth 검색): ${jsonPath.path}`);
							return jsonPath;
						} catch {
							// 파일 없으면 계속
						}
					}
				}
			}
		} catch (error) {
			// 읽기 권한 없거나 오류 발생 시 무시
			axonLog(`⚠️ 디렉토리 읽기 실패 (무시): ${dir.path}`);
		}
		
		return null;
	}

	/**
	 * commands.json 파일 찾기 (통합 유틸리티)
	 * autolinux-manager의 getBuildAutolinuxPath와 동일한 로직
	 * 전략:
	 * 1. Multi-root workspace의 정의된 폴더들에서 검색 (빠름)
	 * 2. 못 찾으면 .code-workspace 파일 위치의 1-depth 하위에서 검색 (제한적)
	 * 3. 그래도 못 찾으면 null 반환
	 */
	private async findCommandsJsonFile(fileName: string): Promise<vscode.Uri | null> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		
		// 1단계: 정의된 workspace 폴더에서 검색
		if (workspaceFolders && workspaceFolders.length > 0) {
			for (const folder of workspaceFolders) {
				// vsebuildscript/xxx.commands.json 확인
				const vsebuildscriptPath = vscode.Uri.joinPath(folder.uri, 'vsebuildscript', fileName);
				try {
					await vscode.workspace.fs.stat(vsebuildscriptPath);
					axonLog(`✅ ${fileName} 발견 (workspace folder/vsebuildscript): ${folder.name}`);
					return vsebuildscriptPath;
				} catch {
					// 없으면 buildscript 확인
				}

				// buildscript/xxx.commands.json 확인
				const buildscriptPath = vscode.Uri.joinPath(folder.uri, 'buildscript', fileName);
				try {
					await vscode.workspace.fs.stat(buildscriptPath);
					axonLog(`✅ ${fileName} 발견 (workspace folder/buildscript): ${folder.name}`);
					return buildscriptPath;
				} catch {
					continue;
				}
			}
			
			axonLog(`⚠️ Workspace 폴더에서 ${fileName}을 찾지 못함: ${workspaceFolders.map(f => f.name).join(', ')}`);
		}

		// 2단계: .code-workspace 파일 위치 기준 1-depth 검색
		const workspaceFile = vscode.workspace.workspaceFile;
		if (workspaceFile && workspaceFile.scheme === 'file') {
			axonLog(`🔍 .code-workspace 파일 위치에서 ${fileName} 1-depth 검색 시작...`);
			const workspaceDir = vscode.Uri.joinPath(workspaceFile, '..');
			
			const result = await this.searchCommandsJsonInDirectory(workspaceDir, fileName);
			if (result) {
				return result;
			}
			
			axonLog(`⚠️ .code-workspace 위치에서도 ${fileName}을 찾지 못함: ${workspaceDir.path}`);
		}

		// 3단계: 못 찾았으면 null 반환
		return null;
	}

	private async tryLoadYoctoCommandsGroups(): Promise<string[] | null> {
		const jsonUri = await this.findCommandsJsonFile('yocto.commands.json');
		
		if (!jsonUri) {
			return null;
		}

		try {
			const content = await vscode.workspace.fs.readFile(jsonUri);
			const text = Buffer.from(content).toString('utf8');
			const parsed = JSON.parse(text) as { groups?: Record<string, unknown> };
			const groups = parsed.groups && typeof parsed.groups === 'object' ? Object.keys(parsed.groups) : [];
			
			if (groups.length > 0) {
				axonLog(`✅ yocto.commands.json 로드 성공: ${groups.length}개 그룹`);
				return groups;
			}
			
			return null;
		} catch (e) {
			axonLog(`⚠️ yocto.commands.json 파싱 실패: ${e}`);
			return null;
		}
	}

	private async tryLoadAutolinuxCommandsGroups(): Promise<string[] | null> {
		const jsonUri = await this.findCommandsJsonFile('autolinux.commands.json');
		
		if (!jsonUri) {
			return null;
		}

		try {
			const content = await vscode.workspace.fs.readFile(jsonUri);
			const text = Buffer.from(content).toString('utf8');
			const parsed = JSON.parse(text) as { groups?: Record<string, unknown> };
			const groups = parsed.groups && typeof parsed.groups === 'object' ? Object.keys(parsed.groups) : [];
			
			if (groups.length > 0) {
				axonLog(`✅ autolinux.commands.json 로드 성공: ${groups.length}개 그룹`);
				return groups;
			}
			
			return null;
		} catch (e) {
			axonLog(`⚠️ autolinux.commands.json 파싱 실패: ${e}`);
			return null;
		}
	}

	private async tryLoadMcuCommandsGroups(): Promise<string[] | null> {
		const jsonUri = await this.findCommandsJsonFile('mcu.commands.json');
		
		if (!jsonUri) {
			return null;
		}

		try {
			const content = await vscode.workspace.fs.readFile(jsonUri);
			const text = Buffer.from(content).toString('utf8');
			const parsed = JSON.parse(text) as { groups?: Record<string, unknown> };
			const groups = parsed.groups && typeof parsed.groups === 'object' ? Object.keys(parsed.groups) : [];
			
			if (groups.length > 0) {
				axonLog(`✅ mcu.commands.json 로드 성공: ${groups.length}개 그룹`);
				return groups;
			}
			
			return null;
		} catch (e) {
			axonLog(`⚠️ mcu.commands.json 파싱 실패: ${e}`);
			return null;
		}
	}

	private async getBuildYoctoAutolinuxItems(): Promise<AxonTreeItem[]> {
		const groups = await this.tryLoadAutolinuxCommandsGroups();

		// JSON 파일이 없거나 읽기 실패하면 기존 하드코딩 메뉴 유지
		if (!groups || groups.length === 0) {
			return [
				// JSON 생성 안내 버튼
				new AxonTreeItem(
					'⚠️ autolinux.commands.json 없음 (생성)',
					'new-file',
					vscode.TreeItemCollapsibleState.None,
					'autolinuxCommandsMissing',
					{
						command: 'axon.createAutolinuxCommandsJson',
						title: 'Create autolinux.commands.json'
					}
				),
				// 주요 액션 버튼
				new AxonTreeItem(
					'▶ Build Image',
					'rocket',
					vscode.TreeItemCollapsibleState.None,
					'autolinuxActionButton',
					{
						command: 'axon.buildAutolinux',
						title: 'Build Image'
					}
				),
				new AxonTreeItem(
					'🔄 Update Sources',
					'sync',
					vscode.TreeItemCollapsibleState.None,
					'autolinuxActionButton',
					{
						command: 'axon.autolinuxUpdate',
						title: 'Update Sources',
						tooltip: '⚠️ Warning: Local changes will be lost'
					}
				),
				new AxonTreeItem(
					'🗑️ Clean Build',
					'trash',
					vscode.TreeItemCollapsibleState.None,
					'autolinuxActionButton',
					{
						command: 'axon.autolinuxClean',
						title: 'Clean Build'
					}
				),
				new AxonTreeItem(
					'📦 Make FAI',
					'package',
					vscode.TreeItemCollapsibleState.None,
					'autolinuxAction',
					{
						command: 'axon.autolinuxMakeFai',
						title: 'Make FAI'
					}
				),
				new AxonTreeItem(
					'ℹ️ Show Info',
					'info',
					vscode.TreeItemCollapsibleState.None,
					'autolinuxAction',
					{
						command: 'axon.autolinuxInfo',
						title: 'Show Info'
					}
				),
				new AxonTreeItem(
					'📁 Make Update Directory',
					'folder',
					vscode.TreeItemCollapsibleState.None,
					'autolinuxAction',
					{
						command: 'axon.autolinuxMakeUpdateDir',
						title: 'Make Update Directory'
					}
				)
			];
		}

		// JSON 기반 동적 메뉴 (groups 키 목록)
		return groups.map(groupName => {
			const lower = groupName.toLowerCase();
			const isClean = lower.includes('clean');
			const isUpdate = lower.includes('update');
			const isFai = lower.includes('fai');
			const isInfo = lower.includes('info');

			let icon = 'rocket';
			let labelPrefix = '▶ ';
			let context = 'autolinuxActionButton';

			if (isClean) {
				icon = 'trash';
				labelPrefix = '🗑️ ';
			} else if (isUpdate) {
				icon = 'sync';
				labelPrefix = '🔄 ';
			} else if (isFai) {
				icon = 'package';
				labelPrefix = '📦 ';
				context = 'autolinuxAction';
			} else if (isInfo) {
				icon = 'info';
				labelPrefix = 'ℹ️ ';
				context = 'autolinuxAction';
			} else if (lower.includes('make_updatedir')) {
				icon = 'folder';
				labelPrefix = '📁 ';
				context = 'autolinuxAction';
			}

			const title = groupName;
			const label = `${labelPrefix}${title}`;

			return new AxonTreeItem(
				label,
				icon,
				vscode.TreeItemCollapsibleState.None,
				context,
				{
					command: 'axon.runAutolinuxJsonGroup',
					title: title,
					arguments: [groupName]
				}
			);
		});
	}

	private async getBuildMcuItems(): Promise<AxonTreeItem[]> {
		const groups = await this.tryLoadMcuCommandsGroups();

		// JSON 파일이 없거나 읽기 실패하면 기존 하드코딩 메뉴 유지
		if (!groups || groups.length === 0) {
			return [
				// JSON 생성 안내 버튼
				new AxonTreeItem(
					'⚠️ mcu.commands.json 없음 (생성)',
					'new-file',
					vscode.TreeItemCollapsibleState.None,
					'mcuCommandsMissing',
					{
						command: 'axon.createMcuCommandsJson',
						title: 'Create mcu.commands.json'
					}
				),
				// 빌드 버튼
				new AxonTreeItem(
					'▶ Build (make)',
					'rocket',
					vscode.TreeItemCollapsibleState.None,
					'mcuBuildButton',
					{
						command: 'axon.mcuBuildMake',
						title: 'Build Make'
					}
				),
				new AxonTreeItem(
					'▶ Build All',
					'circuit-board',
					vscode.TreeItemCollapsibleState.None,
					'mcuBuildButton',
					{
						command: 'axon.mcuBuildAll',
						title: 'Build All'
					}
				),
				new AxonTreeItem(
					'🗑️ Clean',
					'trash',
					vscode.TreeItemCollapsibleState.None,
					'mcuClean',
					{
						command: 'axon.mcuClean',
						title: 'Clean'
					}
				),
				new AxonTreeItem(
					'🔧 Build Option Extraction',
					'tools',
					vscode.TreeItemCollapsibleState.None,
					'mcuAction',
					{
						command: 'axon.mcuBuildOptionExtraction',
						title: 'Build Option Extraction'
					}
				)
			];
		}

		// JSON 기반 동적 메뉴 (groups 키 목록)
		return groups.map(groupName => {
			const lower = groupName.toLowerCase();
			const isClean = lower.includes('clean');
			const isBuild = lower.includes('build');

			let icon = 'rocket';
			let labelPrefix = '▶ ';
			let context = 'mcuBuildButton';

			if (isClean) {
				icon = 'trash';
				labelPrefix = '🗑️ ';
				context = 'mcuClean';
			} else if (lower.includes('extraction')) {
				icon = 'tools';
				labelPrefix = '🔧 ';
				context = 'mcuAction';
			} else if (isBuild) {
				if (lower.includes('all')) {
					icon = 'circuit-board';
				}
			}

			const title = groupName;
			const label = `${labelPrefix}${title}`;

			return new AxonTreeItem(
				label,
				icon,
				vscode.TreeItemCollapsibleState.None,
				context,
				{
					command: 'axon.runMcuJsonGroup',
					title: title,
					arguments: [groupName]
				}
			);
		});
	}

	private getDevtoolItems(): AxonTreeItem[] {
		return [
			new AxonTreeItem(
				'🔧 Create & Modify',
				'beaker',
				vscode.TreeItemCollapsibleState.None,
				'devtoolAction',
				{
					command: 'axon.devtoolCreateModify',
					title: 'Create & Modify'
				}
			),
			new AxonTreeItem(
				'▶ Build',
				'play',
				vscode.TreeItemCollapsibleState.None,
				'devtoolAction',
				{
					command: 'axon.devtoolBuild',
					title: 'Build'
				}
			),
			new AxonTreeItem(
				'✓ Finish',
				'check',
				vscode.TreeItemCollapsibleState.None,
				'devtoolAction',
				{
					command: 'axon.devtoolFinish',
					title: 'Finish'
				}
			)
		];
	}
}

/**
 * Axon TreeItem
 */
export class AxonTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		iconName: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly contextValue: string,
		command?: vscode.Command
	) {
		super(label, collapsibleState);
		this.iconPath = new vscode.ThemeIcon(iconName);
		if (command) {
			this.command = command;
			if (command.tooltip) {
				this.tooltip = command.tooltip;
			}
		}
	}
}

