const vscode = acquireVsCodeApi();

window.addEventListener('load', () => {
    // === Create Projects ===
    document.getElementById('btn-create-mcu').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.createMcuStandaloneProject' });
    });
    document.getElementById('btn-create-yocto').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.createYoctoProject' });
    });

    // === Configurations ===
    document.getElementById('btn-edit-ap-conf').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.editApLocalConf' });
    });
    document.getElementById('btn-edit-mcu-conf').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.editMcuLocalConf' });
    });
    document.getElementById('btn-edit-branch-srcrev').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.editBranchSrcrev' });
    });
    document.getElementById('btn-vscode-exclude').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.vscodeExcludeFolders' });
    });

    // === Build MCU ===
    document.getElementById('btn-mcu-select-core').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.mcuSelectCore' });
    });
    document.getElementById('btn-mcu-build-all').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.mcuBuildAll' });
    });
    document.getElementById('btn-mcu-build-make').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.mcuBuildMake' });
    });
    document.getElementById('btn-mcu-clean').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.mcuClean' });
    });
    document.getElementById('btn-mcu-fwdn').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.FWDN_ALL' });
    });

    // === Build Yocto ===
    document.getElementById('btn-yocto-build-ap').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.buildYoctoAp' });
    });
    document.getElementById('btn-yocto-build-mcu').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.buildYoctoMcu' });
    });
    document.getElementById('btn-yocto-build-kernel').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.buildYoctoKernel' });
    });
    document.getElementById('btn-yocto-clean-ap').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.cleanYoctoAp' });
    });
    document.getElementById('btn-yocto-clean-mcu').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.cleanYoctoMcu' });
    });
    document.getElementById('btn-yocto-clean-all').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.cleanYoctoAll' });
    });


    // === Build DevTool ===
    document.getElementById('btn-devtool-create-modify').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.devtoolCreateModify' });
    });
    document.getElementById('btn-devtool-build').addEventListener('click', () => {
        vscode.postMessage({ command: 'execute', action: 'axon.devtoolBuild' });
    });

});

// Handle messages sent from the extension to the webview
window.addEventListener('message', event => {
    const message = event.data; // The json data that the extension sent
    switch (message.type) {
        case 'updateState':
            if (message.core) {
                document.getElementById('current-core-label').textContent = `Selected Core: ${message.core}`;
            }
            break;
        case 'updateRecipes':
            if (message.recipes) {
                updateRecipesList(message.recipes);
            }
            break;
    }
});

function updateRecipesList(recipes) {
    const container = document.getElementById('devtool-recipes-list');
    container.innerHTML = '';
    
    if (!recipes || recipes.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.textContent = 'No recipes added';
        emptyMsg.style.padding = '4px 12px';
        emptyMsg.style.opacity = '0.7';
        container.appendChild(emptyMsg);
        return;
    }

    recipes.forEach(recipe => {
        const btn = document.createElement('button');
        btn.className = 'secondary';
        // devtoolBuild command takes an argument, we need to handle that
        btn.innerHTML = `<span class="codicon codicon-beaker"></span> Build ${recipe}`;
        btn.title = `Build ${recipe}`;
        btn.addEventListener('click', () => {
            vscode.postMessage({ command: 'execute', action: 'axon.devtoolBuild', args: [recipe] });
        });
        container.appendChild(btn);
    });
}

