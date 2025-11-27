import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class AxonSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'axonSidebar';

    private _view?: vscode.WebviewView;
    private lastSelectedCore: string = '';
    private devtoolRecipes: string[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.command) {
                case 'execute':
                    if (data.args) {
                        vscode.commands.executeCommand(data.action, ...data.args);
                    } else {
                        vscode.commands.executeCommand(data.action);
                    }
                    break;
            }
        });

        // Send initial state
        this.updateCoreStatus(this.lastSelectedCore);
        this.loadDevtoolRecipes(); // Load and send
    }

    public updateCoreStatus(core: string) {
        this.lastSelectedCore = core;
        if (this._view) {
            this._view.webview.postMessage({ type: 'updateState', core: core });
        }
    }

    public setLastSelectedCore(core: string) {
        this.updateCoreStatus(core);
    }

    public getLastSelectedCore(): string {
        return this.lastSelectedCore;
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

        // Load the HTML file
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'axon-sidebar.html');
        let htmlContent = '';
        try {
             const fsPath = htmlPath.fsPath;
             htmlContent = fs.readFileSync(fsPath, 'utf-8');
        } catch (e) {
            console.error('Error loading HTML:', e);
            return `<!DOCTYPE html><html><body>Error loading HTML: ${e}</body></html>`;
        }

        // Replace placeholders with URIs
        htmlContent = htmlContent.replace('axon-sidebar.css', styleUri.toString());
        htmlContent = htmlContent.replace('axon-sidebar.js', scriptUri.toString());
        
        // Add Codicons
        htmlContent = htmlContent.replace('</head>', `<link href="${codiconsUri}" rel="stylesheet" />\n</head>`);

        return htmlContent;
    }
}
