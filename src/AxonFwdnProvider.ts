import * as vscode from 'vscode';

/**
 * Axon FWDN TreeView Provider
 */
export class AxonFwdnProvider implements vscode.TreeDataProvider<AxonTreeItem> {
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

	getChildren(element?: AxonTreeItem): Thenable<AxonTreeItem[]> {
		if (!element) {
			return Promise.resolve(this.getFwdnItems());
		}
		return Promise.resolve([]);
	}

	private getFwdnItems(): AxonTreeItem[] {
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

		return [
			// 주요 FWDN 버튼
			new AxonTreeItem(
				'▶ Run FWDN',
				'rocket',
				vscode.TreeItemCollapsibleState.None,
				'fwdnActionButton',
				{
					command: 'axon.FWDN_ALL',
					title: 'Run FWDN'
				}
			),
			new AxonTreeItem(
				'⚠️ Low Level Format',
				'trash',
				vscode.TreeItemCollapsibleState.None,
				'fwdnActionButton',
				{
					command: 'axon.FWDN_LOW_FORMAT',
					title: 'Low Level Format',
					tooltip: '⚠️ Warning: This will erase all data!'
				}
			),
			new AxonTreeItem(
				'📄 Specific Image File',
				'file',
				vscode.TreeItemCollapsibleState.None,
				'fwdnAction',
				{
					command: 'axon.FWDN_AVAILABLE_IMAGE',
					title: 'Specific Image File'
				}
			),
			new AxonTreeItem(
				'💾 Read Partition (Dump)',
				'cloud-download',
				vscode.TreeItemCollapsibleState.None,
				'fwdnAction',
				{
					command: 'axon.FWDN_READ_PARTITION',
					title: 'Read Partition (Dump)'
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

