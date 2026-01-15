import * as vscode from 'vscode';

/**
 * Axon Options TreeView Provider
 * Build Option Extraction 등 옵션 관련 기능 제공
 */
export class AxonOptionsProvider implements vscode.TreeDataProvider<AxonTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<AxonTreeItem | undefined | null | void> = new vscode.EventEmitter<AxonTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<AxonTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private projectType: string | undefined;

	constructor() {
		this.loadProjectType();
	}

	private loadProjectType(): void {
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
			return Promise.resolve(this.getOptionsItems());
		}
		return Promise.resolve([]);
	}

	private getOptionsItems(): AxonTreeItem[] {
		const items: AxonTreeItem[] = [];

		// MCU 프로젝트인 경우 Build Option Extraction 추가
		if (this.projectType === 'mcu_project') {
			items.push(
				new AxonTreeItem(
					'🔧 Build Option Extraction',
					'tools',
					vscode.TreeItemCollapsibleState.None,
					'mcuBuildOptionExtraction',
					{
						command: 'axon.buildOptionExtraction',
						title: 'Build Option Extraction'
					},
					'Extract build options for IntelliSense'
				)
			);
		}

		// 프로젝트 타입이 설정되지 않은 경우
		if (!this.projectType || this.projectType === '') {
			items.push(
				new AxonTreeItem(
					'⚠️ 프로젝트 타입 미설정',
					'warning',
					vscode.TreeItemCollapsibleState.None,
					'noProjectType',
					undefined,
					'먼저 Project Control에서 프로젝트 타입을 설정하세요'
				)
			);
		}

		return items;
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
		command?: vscode.Command,
		description?: string
	) {
		super(label, collapsibleState);
		this.iconPath = new vscode.ThemeIcon(iconName);
		if (command) {
			this.command = command;
			if (command.tooltip) {
				this.tooltip = command.tooltip;
			}
		}
		if (description) {
			this.description = description;
		}
	}
}

