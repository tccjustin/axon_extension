import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class AxonSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'axonSidebar';

    private _view?: vscode.WebviewView;
    private devtoolRecipes: string[] = [];
    private _rawHtmlContent: string = '';
    private _resolveStartTime: number = 0;
    private _webviewReadyTime: number = 0;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._resolveStartTime = Date.now();
        console.log('\n🚀 ============================================');
        console.log('⏱️ [PERF-EXT] resolveWebviewView STARTED');
        console.log('============================================');

        this._view = webviewView;

        const optionsTime = Date.now();
        
        // IMPORTANT: Set retainContextWhenHidden explicitly
        (webviewView as any).retainContextWhenHidden = true;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        console.log(`⏱️ [PERF-EXT] Set webview options (with retainContext): ${Date.now() - optionsTime}ms`);

        const htmlStartTime = Date.now();
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        console.log(`⏱️ [PERF-EXT] HTML generation: ${Date.now() - htmlStartTime}ms`);
        console.log(`⏱️ [PERF-EXT] resolveWebviewView method completed: ${Date.now() - this._resolveStartTime}ms`);

        webviewView.webview.onDidReceiveMessage(data => {
            if (data.command === 'execute') {
                const args = data.args || [];
                vscode.commands.executeCommand(data.action, ...args);
            } else if (data.command === 'perf-report') {
                // Log performance report from webview
                this._webviewReadyTime = Date.now();
                const totalTime = this._webviewReadyTime - this._resolveStartTime;
                
                console.log('\n📊 ============ COMPLETE LOADING REPORT ============');
                console.log(`🎯 Total Time (Extension Start → Webview Ready): ${totalTime}ms`);
                console.log(`   ├─ Extension Processing: ${Date.now() - this._resolveStartTime}ms`);
                console.log(`   ├─ Webview Initialization: ${totalTime - parseFloat(data.total)}ms`);
                console.log(`   └─ Webview Script Execution: ${data.total}ms`);
                console.log('=====================================================\n');
                
                if (totalTime > 500) {
                    console.warn('⚠️ WARNING: Total loading time exceeds 500ms!');
                    console.warn('   This indicates webview process initialization delay.');
                    console.warn('   Consider using retainContextWhenHidden option.');
                }
            } else if (data.command === 'webview-visible') {
                const visibleTime = Date.now() - this._resolveStartTime;
                console.log(`👁️ [PERF-EXT] Webview became visible: ${visibleTime}ms after resolve`);
            }
        });

        // Send initial state only after a short delay to let DOM settle
        const syncStartTime = Date.now();
        setTimeout(() => {
            this.syncAllState();
            console.log(`⏱️ [PERF-EXT] Initial sync (delayed): ${Date.now() - syncStartTime}ms`);
        }, 10);

        // Listen for visibility changes
        webviewView.onDidChangeVisibility(() => {
            const visibilityStartTime = Date.now();
            console.log('\n🔄 ============================================');
            console.log(`⏱️ [PERF-EXT] Webview visibility changed: ${webviewView.visible ? 'VISIBLE' : 'HIDDEN'}`);
            console.log('============================================');
            
            if (webviewView.visible) {
                console.log('⏱️ [PERF-EXT] Syncing state for visible webview...');
                // Small delay to ensure webview is ready
                setTimeout(() => {
                    this.syncAllState();
                    console.log(`⏱️ [PERF-EXT] Visibility change sync: ${Date.now() - visibilityStartTime}ms\n`);
                }, 10);
            } else {
                console.log('⏱️ [PERF-EXT] Webview hidden - context retained (not destroyed)');
            }
        });
    }

    public syncAllState() {
        if (!this._view || !this._view.visible) {
            return;
        }

        const startTime = Date.now();

        const configStartTime = Date.now();
        const config = vscode.workspace.getConfiguration('axon');
        const projectType = config.get<string>('projectType', '');
        const recipes = config.get<string[]>('devtool.recipes', []);
        this.devtoolRecipes = recipes;
        console.log(`⏱️ [PERF-EXT] Config read: ${Date.now() - configStartTime}ms`);

        // Send combined state in a single message
        const msgStartTime = Date.now();
        this._view.webview.postMessage({ 
            type: 'updateState', 
            projectType: projectType 
        });
        console.log(`⏱️ [PERF-EXT] Send updateState message: ${Date.now() - msgStartTime}ms`);

        // Send recipes separately (only if needed)
        if (recipes.length > 0 || this.devtoolRecipes.length > 0) {
            const recipesMsgStartTime = Date.now();
            this._view.webview.postMessage({ 
                type: 'updateRecipes', 
                recipes: this.devtoolRecipes 
            });
            console.log(`⏱️ [PERF-EXT] Send updateRecipes message: ${Date.now() - recipesMsgStartTime}ms`);
        }

        console.log(`⏱️ [PERF-EXT] syncAllState total: ${Date.now() - startTime}ms`);
    }


    public addDevtoolRecipe(recipeName: string) {
        if (!this.devtoolRecipes.includes(recipeName)) {
            this.devtoolRecipes.push(recipeName);
            this.saveDevtoolRecipes();
            this.updateRecipesList();
        }
    }

    public loadDevtoolRecipes() {
        const config = vscode.workspace.getConfiguration('axon');
        const recipes = config.get<string[]>('devtool.recipes', []);
        this.devtoolRecipes = recipes;
        this.updateRecipesList();
    }

    public sendProjectType() {
        const config = vscode.workspace.getConfiguration('axon');
        let projectType = config.get<string>('projectType', '');
        
        // yocto_project_autolinux를 yocto_autolinux로 변환 (UI 호환성)
        if (projectType === 'yocto_project_autolinux') {
            projectType = 'yocto_autolinux';
        }
        
        if (this._view) {
            this._view.webview.postMessage({ type: 'updateState', projectType: projectType });
        }
    }

    private saveDevtoolRecipes() {
        const config = vscode.workspace.getConfiguration('axon');
        config.update('devtool.recipes', this.devtoolRecipes, vscode.ConfigurationTarget.Workspace);
    }

    private updateRecipesList() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'updateRecipes', recipes: this.devtoolRecipes });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'axon-sidebar.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'axon-sidebar.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        // Load the HTML file (cached)
        let htmlContent = this._rawHtmlContent;
        if (!htmlContent) {
            const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'axon-sidebar.html');
            try {
                 const fsPath = htmlPath.fsPath;
                 htmlContent = fs.readFileSync(fsPath, 'utf-8');
                 this._rawHtmlContent = htmlContent;
            } catch (e) {
                console.error('Error loading HTML:', e);
                return `<!DOCTYPE html><html><body>Error loading HTML: ${e}</body></html>`;
            }
        }

        // Replace placeholders with URIs
        htmlContent = htmlContent.replace('axon-sidebar.css', styleUri.toString());
        htmlContent = htmlContent.replace('axon-sidebar.js', scriptUri.toString());
        
        // Add Codicons
        htmlContent = htmlContent.replace('</head>', `<link href="${codiconsUri}" rel="stylesheet" />\n</head>`);

        return htmlContent;
    }
}
