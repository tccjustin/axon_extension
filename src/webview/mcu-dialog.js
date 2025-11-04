// 성능 측정: 스크립트 시작 시점
const scriptStartTime = performance.now();
console.log('[Performance] Script start:', scriptStartTime);

const vscode = acquireVsCodeApi();
let selectedPath = '';

// DOM이 준비되면 엘리먼트 참조 설정
let projectNameInput, projectPathInput, gitUrlInput, branchNameInput, createBtn;

// DOMContentLoaded 이벤트 측정
document.addEventListener('DOMContentLoaded', () => {
    const domReadyTime = performance.now();
    console.log('[Performance] DOMContentLoaded:', domReadyTime);
    vscode.postMessage({
        command: 'performanceMetric',
        metric: 'DOMContentLoaded',
        time: domReadyTime
    });
    
    // 초기 페인트 후 초기화 (지연 초기화로 첫 렌더링 최적화)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            initializeUI();
        });
    });
});

// UI 초기화 (첫 페인트 이후 실행)
function initializeUI() {
    // DOM 요소 참조 설정
    projectNameInput = document.getElementById('projectName');
    projectPathInput = document.getElementById('projectPath');
    gitUrlInput = document.getElementById('gitUrl');
    branchNameInput = document.getElementById('branchName');
    createBtn = document.getElementById('createBtn');
    
    // 이벤트 리스너 설정
    setupEventListeners();
    
    console.log('[Performance] UI initialized');
}

// 모든 리소스 로드 완료 측정
window.addEventListener('load', () => {
    const loadTime = performance.now();
    console.log('[Performance] Window load:', loadTime);
    vscode.postMessage({
        command: 'performanceMetric',
        metric: 'WindowLoad',
        time: loadTime
    });
    
    // 실제 렌더링 완료 시점 측정 (다음 프레임)
    requestAnimationFrame(() => {
        const renderCompleteTime = performance.now();
        console.log('[Performance] First paint complete:', renderCompleteTime);
        vscode.postMessage({
            command: 'performanceMetric',
            metric: 'RenderComplete',
            time: renderCompleteTime
        });
    });
});

function validate() {
    if (createBtn) {
        createBtn.disabled = !projectNameInput.value.trim() || !selectedPath || !gitUrlInput.value.trim();
    }
}

function setupEventListeners() {
    projectNameInput.oninput = validate;
    gitUrlInput.oninput = validate;

    document.getElementById('browseBtn').onclick = () => {
        vscode.postMessage({ command: 'browseFolder' });
    };

    document.getElementById('cancelBtn').onclick = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    createBtn.onclick = () => {
        if (createBtn.disabled) return;
        createBtn.disabled = true;
        createBtn.textContent = '생성 중...';
        
        vscode.postMessage({
            command: 'createProject',
            data: {
                projectName: projectNameInput.value.trim(),
                projectPath: selectedPath,
                gitUrl: gitUrlInput.value.trim(),
                branchName: branchNameInput.value.trim()
            }
        });
    };
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'setFolderPath') {
        selectedPath = msg.path;
        projectPathInput.value = msg.path;
        validate();
    } else if (msg.command === 'projectCreated') {
        createBtn.disabled = false;
        createBtn.textContent = '생성';
    }
});



