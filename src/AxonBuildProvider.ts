import * as vscode from 'vscode';

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
			return this.getRootItems();
		}
		return this.getChildItems(element);
	}

	private getRootItems(): AxonTreeItem[] {
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
			case 'mcu_project':
				return this.getBuildMcuItems();
			case 'yocto_project':
				return this.getBuildYoctoItems();
			case 'yocto_project_autolinux':
				return this.getBuildYoctoAutolinuxItems();
			default:
				return [];
		}
	}

	private getChildItems(element: AxonTreeItem): AxonTreeItem[] {
		switch (element.contextValue) {
			case 'configuration':
				return this.getConfigurationItems();
			case 'build':
				return this.getBuildItems();
			case 'buildYocto':
				return this.getBuildYoctoItems();
			case 'buildYoctoAutolinux':
				return this.getBuildYoctoAutolinuxItems();
			case 'buildMcu':
				return this.getBuildMcuItems();
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

		if (this.projectType === 'mcu_project') {
			items.push(new AxonTreeItem(
				'MCU',
				'circuit-board',
				vscode.TreeItemCollapsibleState.Collapsed,
				'buildMcu'
			));
		}

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

	private getBuildMcuItems(): AxonTreeItem[] {
		return [
			// 주요 빌드 버튼
			new AxonTreeItem(
				'▶ Build All',
				'rocket',
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
				'mcuCleanButton',
				{
					command: 'axon.mcuClean',
					title: 'Clean'
				}
			),
			new AxonTreeItem(
				'▶ Build m7-0',
				'play',
				vscode.TreeItemCollapsibleState.None,
				'mcuBuild',
				{
					command: 'axon.mcuBuildMake',
					title: 'Build m7-0',
					arguments: ['m7-0']
				}
			),
			new AxonTreeItem(
				'▶ Build m7-1',
				'play',
				vscode.TreeItemCollapsibleState.None,
				'mcuBuild',
				{
					command: 'axon.mcuBuildMake',
					title: 'Build m7-1',
					arguments: ['m7-1']
				}
			),
			new AxonTreeItem(
				'▶ Build m7-2',
				'play',
				vscode.TreeItemCollapsibleState.None,
				'mcuBuild',
				{
					command: 'axon.mcuBuildMake',
					title: 'Build m7-2',
					arguments: ['m7-2']
				}
			),
			new AxonTreeItem(
				'▶ Build m7-np',
				'play',
				vscode.TreeItemCollapsibleState.None,
				'mcuBuild',
				{
					command: 'axon.mcuBuildMake',
					title: 'Build m7-np',
					arguments: ['m7-np']
				}
			)
		];
	}

	private getBuildYoctoItems(): AxonTreeItem[] {
		return [
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

	private getBuildYoctoAutolinuxItems(): AxonTreeItem[] {
		return [
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

