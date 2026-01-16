import * as vscode from 'vscode';
import { axonLog } from '../../logger';
import { findProjectRootByShell } from './shell-utils';

type ProjectFamily = 'mcu' | 'yocto' | 'autolinux';

export type ProjectTypeActionMode = 'create' | 'set';

export type YoctoBuildConstraints = {
	ap?: {
		supportedMachines?: string[];
		supportedVersions?: string[];
	};
	mcu?: {
		supportedMachines?: string[];
		supportedVersions?: string[];
	};
};

export type ProjectRootFinderSpec =
	| {
			type: 'shellFind';
			findPattern: string;
			findType: 'd' | 'f';
			maxDepth: number;
			parentLevels: number;
			excludePattern?: string;
			searchPath?: string;
			usePathPattern?: boolean;
			followSymlinks?: boolean;
			settingKey: string; // 예: axon.yocto.projectRoot
	  }
	| {
			type: 'workspaceChildDir';
			childDirName: string; // 예: build-autolinux
			settingKey: string; // 예: axon.yocto.projectRoot
	  };

export interface ProjectTypeLeaf {
	id: string;
	family: ProjectFamily;
	settingsPatch: Record<string, unknown>;
	createPreset?: {
		mcuGitUrl?: string;
		mcuGitBranch?: string;
		bootfirmwareGitUrl?: string;
		yoctoManifestGitUrl?: string;
		autolinuxGitUrl?: string;
	};
	yoctoBuildConstraints?: YoctoBuildConstraints;
	projectRootFinder?: ProjectRootFinderSpec;
}

export interface ProjectTypeTreeNode {
	label: string;
	description?: string;
	children?: ProjectTypeTreeNode[];
	leaf?: ProjectTypeLeaf;
}

interface ProjectTypeRegistryFile {
	schemaVersion: number;
	tree: ProjectTypeTreeNode[];
}

function findLeafById(nodes: ProjectTypeTreeNode[], id: string): ProjectTypeLeaf | undefined {
	for (const node of nodes) {
		if (node.leaf?.id === id) return node.leaf;
		if (node.children && node.children.length > 0) {
			const found = findLeafById(node.children, id);
			if (found) return found;
		}
	}
	return undefined;
}

export async function getProjectTypeLeafById(id: string): Promise<ProjectTypeLeaf | undefined> {
	const registry = await loadRegistryJson();
	if (!registry || !Array.isArray(registry.tree)) return undefined;
	return findLeafById(registry.tree, id);
}

function getExtensionPath(): string {
	// VS Code 확장 ID는 보통 `${publisher}.${name}` 형식입니다.
	// 이 레포는 package.json 기준으로 JustinLee-tcc.axon-dev 이므로 우선 그 값을 시도하고,
	// 기존/레거시 ID도 함께 시도한 뒤, 마지막으로 extensions.all에서 name으로 탐색합니다.
	const candidates = [
		'JustinLee-tcc.axon-dev',
		'justinlee-tcc.axon-dev',
		'justin-lee.axon' // 레거시/오래된 ID
	];

	for (const id of candidates) {
		const ext = vscode.extensions.getExtension(id);
		if (ext) return ext.extensionPath;
	}

	const byName = vscode.extensions.all.find(e => e.packageJSON?.name === 'axon-dev');
	if (byName) return byName.extensionPath;

	throw new Error('Axon extension 정보를 찾을 수 없습니다. (axon-dev)');
}

async function tryStat(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function loadRegistryJson(): Promise<ProjectTypeRegistryFile> {
	// 1) 워크스페이스 오버라이드: vsebuildscript/project-types.json
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder) {
		const wsOverride = vscode.Uri.joinPath(workspaceFolder.uri, 'vsebuildscript', 'project-types.json');
		if (await tryStat(wsOverride)) {
			axonLog(`✅ project-types.json 로드: workspace override (${wsOverride.toString()})`);
			const content = await vscode.workspace.fs.readFile(wsOverride);
			return JSON.parse(Buffer.from(content).toString('utf8')) as ProjectTypeRegistryFile;
		}
	}

	// 2) 기본값: extension buildscript/project-types.json
	const extensionPath = getExtensionPath();
	const bundled = vscode.Uri.file(`${extensionPath}/buildscript/project-types.json`);
	axonLog(`✅ project-types.json 로드: bundled (${bundled.toString()})`);
	const bundledContent = await vscode.workspace.fs.readFile(bundled);
	return JSON.parse(Buffer.from(bundledContent).toString('utf8')) as ProjectTypeRegistryFile;
}

function flattenCurrentPathLabels(path: ProjectTypeTreeNode[]): string {
	return path.map(n => n.label).join(' > ');
}

export async function selectProjectTypeLeaf(
	mode: ProjectTypeActionMode
): Promise<{ leaf: ProjectTypeLeaf; breadcrumb: string } | undefined> {
	const registry = await loadRegistryJson();
	if (!registry || !Array.isArray(registry.tree)) {
		throw new Error('project-types.json 형식이 올바르지 않습니다. (tree 없음)');
	}

	let currentNodes = registry.tree;
	const stack: ProjectTypeTreeNode[] = [];

	while (true) {
		const items: Array<vscode.QuickPickItem & { node?: ProjectTypeTreeNode; isBack?: boolean }> = [];

		if (stack.length > 0) {
			items.push({
				label: '$(arrow-left) Back',
				description: flattenCurrentPathLabels(stack),
				isBack: true
			});
		}

		for (const node of currentNodes) {
			const isLeaf = !!node.leaf;
			const hasChildren = Array.isArray(node.children) && node.children.length > 0;

			const suffix = hasChildren ? '$(chevron-right)' : isLeaf ? '$(check)' : '';
			const label = suffix ? `${node.label}  ${suffix}` : node.label;

			items.push({
				label,
				description: node.description,
				node
			});
		}

		const picked = await vscode.window.showQuickPick(items, {
			title: mode === 'create' ? 'Create Project' : 'Set Project Type',
			placeHolder: mode === 'create' ? '생성할 프로젝트 타입을 선택하세요' : '프로젝트 타입을 선택하세요',
			ignoreFocusOut: true
		});

		if (!picked) return undefined;

		if (picked.isBack) {
			stack.pop();
			currentNodes = stack.length === 0 ? registry.tree : (stack[stack.length - 1].children || registry.tree);
			continue;
		}

		const node = picked.node;
		if (!node) return undefined;

		// leaf 선택
		if (node.leaf) {
			const breadcrumb = stack.length === 0 ? node.label : `${flattenCurrentPathLabels(stack)} > ${node.label}`;
			return { leaf: node.leaf, breadcrumb };
		}

		// children로 이동
		if (node.children && node.children.length > 0) {
			stack.push(node);
			currentNodes = node.children;
			continue;
		}

		// leaf도 children도 없으면 무시 (데이터 이상)
		return undefined;
	}
}

export function getProjectFamilyFromProjectType(projectType: string | undefined): ProjectFamily | undefined {
	if (!projectType) return undefined;
	if (projectType.startsWith('yocto_project_autolinux')) return 'autolinux';
	if (projectType.startsWith('yocto_project')) return 'yocto';
	if (projectType.startsWith('mcu_project')) return 'mcu';
	return undefined;
}

async function applySettingPatchToWorkspace(patch: Record<string, unknown>): Promise<void> {
	for (const [fullKey, value] of Object.entries(patch)) {
		// fullKey 예: axon.projectType / axon.yocto.apBuildScript
		const parts = fullKey.split('.');
		if (parts.length < 2) continue;

		const section = parts.slice(0, parts.length - 1).join('.');
		const key = parts[parts.length - 1];
		await vscode.workspace.getConfiguration(section).update(key, value, vscode.ConfigurationTarget.Workspace);
	}
}

async function resolveProjectRootByFinder(spec: ProjectRootFinderSpec): Promise<string | null> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) return null;

	if (spec.type === 'shellFind') {
		return await findProjectRootByShell({
			workspaceFolder,
			findPattern: spec.findPattern,
			findType: spec.findType,
			maxDepth: spec.maxDepth,
			parentLevels: spec.parentLevels,
			excludePattern: spec.excludePattern,
			searchPath: spec.searchPath ?? '.',
			usePathPattern: spec.usePathPattern ?? false,
			followSymlinks: spec.followSymlinks ?? false,
			taskName: 'Find Project Root',
			taskId: 'axon-find-project-root',
			resultFilePrefix: 'axon_project_root'
		});
	}

	if (spec.type === 'workspaceChildDir') {
		const folders = vscode.workspace.workspaceFolders || [];

		for (const folder of folders) {
			const candidate = vscode.Uri.joinPath(folder.uri, spec.childDirName);
			if (await tryStat(candidate)) {
				// childDirName이 존재하는 "프로젝트 루트"는 folder.uri
				return folder.uri.path;
			}
		}

		// .code-workspace 위치 1-depth 탐색 (AutolinuxManager와 동일 컨셉)
		const workspaceFile = vscode.workspace.workspaceFile;
		if (workspaceFile && workspaceFile.scheme === 'file') {
			const workspaceDir = vscode.Uri.joinPath(workspaceFile, '..');
			try {
				const entries = await vscode.workspace.fs.readDirectory(workspaceDir);
				for (const [name, type] of entries) {
					if (type !== vscode.FileType.Directory) continue;
					const candidate = vscode.Uri.joinPath(workspaceDir, name, spec.childDirName);
					if (await tryStat(candidate)) {
						return vscode.Uri.joinPath(workspaceDir, name).path;
					}
				}
			} catch {
				// ignore
			}
		}

		return null;
	}

	return null;
}

export async function applyProjectTypeLeafForSetMode(leaf: ProjectTypeLeaf): Promise<void> {
	// 1) settingsPatch 적용
	await applySettingPatchToWorkspace(leaf.settingsPatch);

	// 2) projectRoot 탐색(옵션)
	if (leaf.projectRootFinder) {
		axonLog(`🔍 projectRoot 탐색 시작: ${leaf.projectRootFinder.type}`);
		const root = await resolveProjectRootByFinder(leaf.projectRootFinder);
		if (root && root.trim() !== '') {
			await applySettingPatchToWorkspace({ [leaf.projectRootFinder.settingKey]: root });
			axonLog(`✅ projectRoot 저장: ${leaf.projectRootFinder.settingKey}=${root}`);
		} else {
			axonLog(`⚠️ projectRoot를 찾지 못했습니다. (${leaf.projectRootFinder.type})`);
		}
	}
}


