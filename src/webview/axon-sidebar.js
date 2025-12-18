const vscode = acquireVsCodeApi();

// === Performance Profiling ===
const perf = {
    marks: {},
    start: (name) => {
        perf.marks[name] = performance.now();
    },
    end: (name) => {
        if (!perf.marks[name]) return 0;
        const duration = performance.now() - perf.marks[name];
        console.log(`⏱️ [PERF] ${name}: ${duration.toFixed(2)}ms`);
        return duration;
    },
    measure: (name, startMark, endMark) => {
        const start = perf.marks[startMark] || 0;
        const end = perf.marks[endMark] || performance.now();
        const duration = end - start;
        console.log(`⏱️ [PERF] ${name}: ${duration.toFixed(2)}ms`);
        return duration;
    },
    report: () => {
        const total = performance.now() - perf.marks['script-start'];
        console.log('\n📊 ============ Performance Report ============');
        console.log(`🎯 Total Loading Time: ${total.toFixed(2)}ms`);
        console.log('📋 Breakdown:');
        for (const [key, startTime] of Object.entries(perf.marks)) {
            if (key.startsWith('end-')) continue;
            const endKey = `end-${key}`;
            if (perf.marks[endKey]) {
                const duration = perf.marks[endKey] - startTime;
                console.log(`   - ${key}: ${duration.toFixed(2)}ms`);
            }
        }
        console.log('============================================\n');
        
        // Send to extension for logging
        vscode.postMessage({ 
            command: 'perf-report', 
            total: total.toFixed(2),
            marks: perf.marks
        });
    }
};

// Notify that script has started (earliest possible point)
console.log('🎬 [PERF] Webview script loaded and executing...');
console.log(`📍 [PERF] Performance.now at script start: ${performance.now().toFixed(2)}ms`);
perf.start('script-start');

// Check if this is a reload or first load
const isReload = window.performance && window.performance.navigation && window.performance.navigation.type === 1;
console.log(`🔄 [PERF] Is page reload: ${isReload}`);

// Notify extension that webview is visible
vscode.postMessage({ command: 'webview-visible' });

// === State Management ===
const state = vscode.getState() || {};

function saveState() {
    vscode.setState(state);
}

// === Early DOM-based State Restoration (before load event) ===
// This runs immediately as the script loads, before images/resources
(function() {
    perf.start('state-restore');
    // Restore selects
    if (state.selects) {
        for (const [id, value] of Object.entries(state.selects)) {
            const el = document.getElementById(id);
            if (el) el.value = value;
        }
    }
    // Restore details
    if (state.details) {
        for (const [id, open] of Object.entries(state.details)) {
            const el = document.getElementById(id);
            if (el) el.open = open;
        }
    }
    perf.marks['end-state-restore'] = performance.now();
    perf.end('state-restore');
})();

// === Event Delegation Setup (more efficient than individual listeners) ===
document.addEventListener('DOMContentLoaded', () => {
    perf.start('dom-ready');
    
    perf.start('event-delegation-setup');
    // Delegate all button clicks
    document.body.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        const id = target.id;
        switch(id) {
            // Create Projects
            case 'btn-run-create-project': {
                const select = document.getElementById('create-project-select');
                const value = select.value;
                let action;
                if (value === 'mcu') {
                    action = 'axon.createMcuStandaloneProject';
                } else if (value === 'yocto-autolinux') {
                    action = 'axon.createAutolinuxProject';
                } else {
                    action = 'axon.createYoctoProject';
                }
                vscode.postMessage({ 
                    command: 'execute', 
                    action: action
                });
                break;
            }
            // Configurations
            case 'btn-set-project-type': {
                const select = document.getElementById('project-type-select');
                vscode.postMessage({ command: 'execute', action: 'axon.setProjectType', args: [select.value] });
                break;
            }
            case 'btn-edit-ap-conf':
                vscode.postMessage({ command: 'execute', action: 'axon.editApLocalConf' });
                break;
            case 'btn-edit-mcu-conf':
                vscode.postMessage({ command: 'execute', action: 'axon.editMcuLocalConf' });
                break;
            case 'btn-edit-branch-srcrev':
                vscode.postMessage({ command: 'execute', action: 'axon.editBranchSrcrev' });
                break;
            case 'btn-vscode-exclude':
                vscode.postMessage({ command: 'execute', action: 'axon.vscodeExcludeFolders' });
                break;
            case 'btn-build-option-extraction':
                vscode.postMessage({ command: 'execute', action: 'axon.buildOptionExtraction' });
                break;
            // Build MCU
            case 'btn-mcu-run-build': {
                const select = document.getElementById('mcu-build-select');
                const value = select.value;
                vscode.postMessage({ 
                    command: 'execute', 
                    action: value === 'all' ? 'axon.mcuBuildAll' : 'axon.mcuBuildMake',
                    args: value === 'all' ? undefined : [value]
                });
                break;
            }
            case 'btn-mcu-clean':
                vscode.postMessage({ command: 'execute', action: 'axon.mcuClean' });
                break;
            case 'btn-run-fwdn': {
                const select = document.getElementById('fwdn-mode-select');
                const actions = { 
                    'run-fwdn': 'axon.FWDN_ALL', 
                    'low-format': 'axon.FWDN_LOW_FORMAT' 
                };
                vscode.postMessage({ command: 'execute', action: actions[select.value] });
                break;
            }
            case 'btn-fwdn-available-image':
                vscode.postMessage({ command: 'execute', action: 'axon.FWDN_AVAILABLE_IMAGE' });
                break;
            // Build Yocto
            case 'btn-yocto-run-build': {
                const select = document.getElementById('yocto-build-select');
                const actions = { ap: 'axon.buildYoctoAp', mcu: 'axon.buildYoctoMcu', kernel: 'axon.buildYoctoKernel' };
                vscode.postMessage({ command: 'execute', action: actions[select.value] });
                break;
            }
            case 'btn-yocto-run-clean': {
                const select = document.getElementById('yocto-clean-select');
                const actions = { ap: 'axon.cleanYoctoAp', mcu: 'axon.cleanYoctoMcu', all: 'axon.cleanYoctoAll' };
                vscode.postMessage({ command: 'execute', action: actions[select.value] });
                break;
            }
            // Build Yocto(autolinux)
            case 'btn-yocto-autolinux-run-build': {
                const select = document.getElementById('yocto-autolinux-build-select');
                if (select.value === 'build') {
                    vscode.postMessage({ command: 'execute', action: 'axon.buildAutolinux' });
                }
                break;
            }
            // DevTool
            case 'btn-devtool-create-modify': {
                const select = document.getElementById('devtool-recipe-select');
                vscode.postMessage({ command: 'execute', action: 'axon.devtoolCreateModify', args: [select.value] });
                break;
            }
            case 'btn-devtool-run-build-recipe': {
                const select = document.getElementById('devtool-build-recipe-select');
                if (select.value) {
                    vscode.postMessage({ command: 'execute', action: 'axon.devtoolBuild', args: [select.value] });
                }
                break;
            }
            case 'btn-devtool-run-finish-recipe': {
                const select = document.getElementById('devtool-finish-recipe-select');
                if (select.value) {
                    vscode.postMessage({ command: 'execute', action: 'axon.devtoolFinish', args: [select.value] });
                }
                break;
            }
        }
    });

    // Delegate select changes
    document.body.addEventListener('change', (e) => {
        const target = e.target;
        if (target.tagName !== 'SELECT') return;

        // Save state
        if (!state.selects) state.selects = {};
        state.selects[target.id] = target.value;
        saveState();

        // Sync MCU Core selection with extension immediately
        if (target.id === 'mcu-build-select') {
            vscode.postMessage({ command: 'execute', action: 'axon.setLastSelectedCore', args: [target.value] });
        }
    });

    // Delegate details toggle
    document.body.addEventListener('toggle', (e) => {
        const target = e.target;
        if (target.tagName !== 'DETAILS' || !target.id) return;

        if (!state.details) state.details = {};
        state.details[target.id] = target.open;
        saveState();
    }, true); // Use capture phase for details
    
    perf.marks['end-event-delegation-setup'] = performance.now();
    perf.end('event-delegation-setup');
    
    perf.marks['end-dom-ready'] = performance.now();
    perf.end('dom-ready');
    
    // 초기 로드 시 projectType 확인 (없으면 섹션 숨기기)
    // syncAllState에서 메시지가 오기 전까지는 기본적으로 숨김 처리
    updateProjectTypeUI('');
    
    // Report after everything is ready
    setTimeout(() => perf.report(), 0);
});

// === Message Handler ===
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'updateState':
            perf.start('update-state');
            if (message.core !== undefined) {
                const select = document.getElementById('mcu-build-select');
                if (select && message.core) {
                    const options = Array.from(select.options).map(opt => opt.value);
                    if (options.includes(message.core)) {
                        select.value = message.core;
                    }
                }
            }
            if (message.projectType !== undefined) {
                updateProjectTypeUI(message.projectType);
            }
            perf.marks['end-update-state'] = performance.now();
            perf.end('update-state');
            break;
        case 'updateRecipes':
            perf.start('update-recipes');
            if (message.recipes !== undefined) {
                updateRecipesList(message.recipes);
            }
            perf.marks['end-update-recipes'] = performance.now();
            perf.end('update-recipes');
            break;
    }
});

// === Helper Functions ===
function updateProjectTypeUI(projectType) {
    const label = document.getElementById('current-project-type');
    if (label) {
        const displayMap = { 
            mcu_project: 'MCU Project', 
            yocto_project: 'Yocto Project',
            yocto_autolinux: 'Yocto Project (autolinux)',
            yocto_project_autolinux: 'Yocto Project (autolinux)'
        };
        label.textContent = `Current: ${displayMap[projectType] || 'None'}`;
    }

    const select = document.getElementById('project-type-select');
    if (select && projectType) {
        // yocto_project_autolinux는 UI에서 yocto_autolinux로 표시
        const uiProjectType = projectType === 'yocto_project_autolinux' ? 'yocto_autolinux' : projectType;
        select.value = uiProjectType;
    }

    // projectType이 없으면 Build, FWDN 섹션만 숨기기 (Configuration은 프로젝트 타입 선택을 위해 항상 표시)
    const hasProjectType = projectType && projectType.trim() !== '';
    const buildSection = document.getElementById('section-build');
    const fwdnSection = document.getElementById('section-fwdn');
    
    if (buildSection) buildSection.classList.toggle('hidden', !hasProjectType);
    if (fwdnSection) fwdnSection.classList.toggle('hidden', !hasProjectType);

    // Batch DOM reads/writes
    const groups = {
        mcu: document.getElementById('group-mcu-build'),
        yocto: document.getElementById('group-yocto-build'),
        yoctoAutolinux: document.getElementById('group-yocto-autolinux'),
        devtool: document.getElementById('group-devtool'),
        yoctoConfig: document.getElementById('group-yocto-config'),
        buildOptionExtraction: document.getElementById('group-build-option-extraction')
    };

    // projectType이 없으면 Yocto 설정 그룹도 숨기기
    if (!hasProjectType) {
        if (groups.yoctoConfig) groups.yoctoConfig.classList.add('hidden');
        return; // projectType이 없으면 여기서 종료
    }

    // projectType이 있을 때 그룹별 표시/숨김 처리
    const isYocto = projectType === 'yocto_project';
    const isMcu = projectType === 'mcu_project';
    const isYoctoAutolinux = projectType === 'yocto_autolinux' || projectType === 'yocto_project_autolinux';

    // MCU 빌드: MCU 프로젝트일 때만 표시
    if (groups.mcu) groups.mcu.classList.toggle('hidden', !isMcu);
    
    // Yocto 빌드: Yocto 프로젝트일 때만 표시
    if (groups.yocto) groups.yocto.classList.toggle('hidden', !isYocto);
    
    // Yocto(autolinux) 빌드: autolinux 프로젝트일 때만 표시
    if (groups.yoctoAutolinux) groups.yoctoAutolinux.classList.toggle('hidden', !isYoctoAutolinux);
    
    // DevTool: Yocto 프로젝트일 때만 표시 (autolinux는 제외)
    if (groups.devtool) groups.devtool.classList.toggle('hidden', !isYocto);
    
    // Yocto Config: Yocto 프로젝트일 때만 표시 (autolinux는 제외)
    if (groups.yoctoConfig) groups.yoctoConfig.classList.toggle('hidden', !isYocto);
    
    // Build Option Extraction: MCU 프로젝트일 때만 표시
    if (groups.buildOptionExtraction) groups.buildOptionExtraction.classList.toggle('hidden', !isMcu);
}

function updateRecipesList(recipes) {
    const buildSelect = document.getElementById('devtool-build-recipe-select');
    const finishSelect = document.getElementById('devtool-finish-recipe-select');
    
    // Use DocumentFragment for efficient batch DOM update
    const fragment = document.createDocumentFragment();
    
    if (!recipes || recipes.length === 0) {
        const option = document.createElement('option');
        option.text = 'No recipes available';
        option.value = '';
        option.disabled = true;
        option.selected = true;
        fragment.appendChild(option);
    } else {
        recipes.forEach(recipe => {
            const option = document.createElement('option');
            option.value = recipe;
            option.text = recipe;
            fragment.appendChild(option);
        });
    }
    
    // Update both select elements
    if (buildSelect) {
        buildSelect.innerHTML = '';
        buildSelect.appendChild(fragment.cloneNode(true));
    }
    
    if (finishSelect) {
        finishSelect.innerHTML = '';
        finishSelect.appendChild(fragment.cloneNode(true));
    }
}

