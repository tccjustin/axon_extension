import * as vscode from 'vscode';
import { getProjectFamilyFromProjectType } from './projects/common/project-type-registry';

/**
 * Axon Project Creation TreeView Provider
 */
export class AxonProjectCreationProvider implements vscode.TreeDataProvider<AxonTreeItem> {
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
			return Promise.resolve(this.getProjectCreationItems());
		}
		return Promise.resolve([]);
	}

	private getProjectCreationItems(): AxonTreeItem[] {
		// 현재 프로젝트 타입 표시
		let projectTypeDescription = 'Not set';
		const family = getProjectFamilyFromProjectType(this.projectType);
		if (family === 'mcu') {
			projectTypeDescription = `Current: MCU (${this.projectType})`;
		} else if (family === 'yocto') {
			projectTypeDescription = `Current: Yocto (${this.projectType})`;
		} else if (family === 'autolinux') {
			projectTypeDescription = `Current: Yocto (autolinux) (${this.projectType})`;
		}

		return [
			// Create Project 버튼 (QuickPick)
			new AxonTreeItem(
				'➕ Create Project',
				'add',
				vscode.TreeItemCollapsibleState.None,
				'createProjectButton',
				{
					command: 'axon.createProject',
					title: 'Create Project'
				}
			),
			// Set Project Type
			new AxonTreeItem(
				'⚙️ Set Project Type',
				'settings-gear',
				vscode.TreeItemCollapsibleState.None,
				'configButton',
				{
					command: 'axon.setProjectType',
					title: 'Set Project Type'
				},
				projectTypeDescription
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

