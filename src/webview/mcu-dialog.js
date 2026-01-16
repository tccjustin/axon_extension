// 성능 측정: 스크립트 시작 시점
const scriptStartTime = performance.now();
console.log('[Performance] Script start:', scriptStartTime);

const vscode = acquireVsCodeApi();
let selectedPath = '';
let projectName = '';
let folderCreated = false;

// DOM이 준비되면 엘리먼트 참조 설정
let projectPathInput, gitUrlInput, buildtoolInput, createBtn;
let createFolderBtn;

// DOMContentLoaded 이벤트 측정
document.addEventListener('DOMContentLoaded', () => {
    const domReadyTime = performance.now();
    console.log('[Performance] DOMContentLoaded:', domReadyTime);
    vscode.postMessage({
        command: 'performanceMetric',
        metric: 'DOMContentLoaded',
        time: domReadyTime
    });
    
    // 즉시 초기화 (다른 다이얼로그와 동일하게)
    initializeUI();
});

// UI 초기화
function initializeUI() {
    // DOM 요소 참조 설정
    projectPathInput = document.getElementById('projectPath');
    gitUrlInput = document.getElementById('gitUrl');
    buildtoolInput = document.getElementById('buildtool');
    createBtn = document.getElementById('createBtn');
    createFolderBtn = document.getElementById('createFolderBtn');
    
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
    console.log('[MCU Validate] === START ===');
    console.log('[MCU Validate] projectPathInput exists:', !!projectPathInput);
    console.log('[MCU Validate] gitUrlInput exists:', !!gitUrlInput);
    console.log('[MCU Validate] createBtn exists:', !!createBtn);
    
    if (!projectPathInput || !gitUrlInput || !createBtn) {
        console.warn('[MCU Validate] Some elements are not initialized yet!');
        return;
    }
    
    const projectPathValid = projectPathInput.value.trim() !== '';
    const gitUrlValid = gitUrlInput.value.trim() !== '';
    const folderValid = folderCreated === true;
    
    console.log('[MCU Validate] projectPath:', projectPathInput.value);
    console.log('[MCU Validate] gitUrl:', gitUrlInput.value);
    console.log('[MCU Validate] projectPathValid:', projectPathValid, 'gitUrlValid:', gitUrlValid);
    
    // 생성 버튼 활성화 조건: 폴더 생성 완료 + 프로젝트 경로 + Git URL
    const shouldEnable = projectPathValid && gitUrlValid && folderValid;
    createBtn.disabled = !shouldEnable;
    console.log('[MCU Validate] Should enable:', shouldEnable, '-> Create button disabled:', createBtn.disabled);
    console.log('[MCU Validate] === END ===');
}

function setupEventListeners() {
    projectPathInput.oninput = () => {
        // 사용자가 경로를 수정할 때마다 selectedPath와 projectName 업데이트
        const fullPath = projectPathInput.value.trim();
        // 경로가 바뀌면 폴더 생성 상태 초기화
        folderCreated = false;
        if (createFolderBtn) {
            createFolderBtn.disabled = false;
            createFolderBtn.textContent = 'Create Folder';
        }
        if (fullPath) {
            const pathParts = fullPath.split('/');
            projectName = pathParts[pathParts.length - 1];
            selectedPath = pathParts.slice(0, -1).join('/');
            console.log('[MCU Dialog] Path input changed - selectedPath:', selectedPath, 'projectName:', projectName);
        }
        validate();
    };

    document.getElementById('createFolderBtn').onclick = () => {
        // 버튼 상태 변경
        createFolderBtn.disabled = true;
        createFolderBtn.textContent = 'Creating...';

        vscode.postMessage({ command: 'createFolder' });
    };

    document.getElementById('browseBuildtoolBtn').onclick = () => {
        vscode.postMessage({ command: 'browseBuildtool' });
    };

    document.getElementById('cancelBtn').onclick = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    // 생성 버튼 - Git clone 수행
    createBtn.onclick = () => {
        if (createBtn.disabled) return;
        
        const gitUrl = gitUrlInput.value.trim();
        const fullPath = projectPathInput.value.trim();
        
        if (!fullPath) {
            alert('프로젝트 경로를 입력하세요.');
            return;
        }

        if (!gitUrl) {
            alert('Git URL이 설정되지 않았습니다. Settings에서 확인하세요.');
            return;
        }

        // 경로에서 프로젝트 이름 추출
        const pathParts = fullPath.split('/');
        const projectName = pathParts[pathParts.length - 1] || '';

        if (!projectName) {
            alert('프로젝트 이름을 입력하세요.');
            return;
        }

        // 생성 버튼 비활성화
        createBtn.disabled = true;
        createBtn.textContent = '생성 중...';
        projectPathInput.disabled = true;

        console.log('[MCU Create] Sending create request with fullPath:', fullPath);

        vscode.postMessage({
            command: 'createProject',
            data: {
                projectName: projectName,
                projectPath: fullPath,
                gitUrl: gitUrl,
                buildtool: buildtoolInput.value.trim() || undefined
            }
        });
    };
}

window.addEventListener('message', e => {
    const msg = e.data;
    console.log('[MCU Dialog] Received message:', msg.command, msg);
    
    if (msg.command === 'init') {
        console.log('========================================');
        console.log('[MCU Dialog] Init message received');
        console.log('[MCU Dialog] - gitUrl:', msg.gitUrl);
        console.log('[MCU Dialog] - buildtoolPath:', msg.buildtoolPath);
        console.log('[MCU Dialog] - buildtoolPath type:', typeof msg.buildtoolPath);
        console.log('[MCU Dialog] - buildtoolPath length:', msg.buildtoolPath ? msg.buildtoolPath.length : 0);
        console.log('[MCU Dialog] - buildtoolPath is empty:', msg.buildtoolPath === '');
        console.log('========================================');
        
        // Settings에서 받은 Git URL을 hidden input에 설정
        if (msg.gitUrl) {
            gitUrlInput.value = msg.gitUrl;
            console.log('[MCU Dialog] ✅ Git URL set to:', gitUrlInput.value);
        } else {
            console.log('[MCU Dialog] ⚠️ No gitUrl in init message');
        }
        
        // Settings에서 받은 Build Tools Path 설정
        if (msg.buildtoolPath) {
            buildtoolInput.value = msg.buildtoolPath;
            console.log('[MCU Dialog] ✅ Build Tools Path set to:', buildtoolInput.value);
        } else {
            console.log('[MCU Dialog] ⚠️ No buildtoolPath in init message (or empty string)');
        }
        
        validate();
    } else if (msg.command === 'setBuildtoolPath') {
        console.log('[MCU Dialog] Buildtool path set to:', msg.path);
        buildtoolInput.value = msg.path;
    } else if (msg.command === 'folderCreated') {
        if (msg.success) {
            folderCreated = true;
            if (msg.path) {
                // 생성된 경로를 input에 반영
                projectPathInput.value = msg.path;
                // selectedPath와 projectName 업데이트
                const pathParts = msg.path.split('/').filter(p => p);
                projectName = pathParts[pathParts.length - 1] || '';
                selectedPath = '/' + pathParts.slice(0, -1).join('/');
            }
            if (createFolderBtn) {
                createFolderBtn.disabled = true;
                createFolderBtn.textContent = 'Created';
            }
        } else {
            folderCreated = false;
            if (createFolderBtn) {
                createFolderBtn.disabled = false;
                createFolderBtn.textContent = 'Create Folder';
            }
            if (!msg.cancelled && msg.error) {
                alert('폴더 생성 실패: ' + msg.error);
            }
        }
        validate();
    } else if (msg.command === 'projectCreated') {
        if (msg.success) {
            vscode.postMessage({ command: 'cancel' }); // 성공 시 다이얼로그 닫기
        } else {
            // 실패 시 버튼 복원
            createBtn.disabled = false;
            createBtn.textContent = '생성';
            projectPathInput.disabled = false;
            if (msg.error) {
                alert('프로젝트 생성 실패: ' + msg.error);
            }
        }
    }
});



