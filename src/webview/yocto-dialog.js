const vscode = acquireVsCodeApi();
let selectedPath = '';
let projectName = '';
let folderCreated = false;

// DOM이 준비되면 엘리먼트 참조 설정
let projectPathInput, createBtn;
let manifestGitUrlInput, loadManifestsBtn, manifestSelectGroup, manifestSelect;
let manifestList = [];
let createFolderBtn, warningMessage;
let sourceMirrorPathInput, buildtoolPathInput, browseSourceMirrorBtn, browseBuildtoolBtn;

// DOMContentLoaded 이벤트
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
});

// UI 초기화
function initializeUI() {
    // DOM 요소 참조 설정
    projectPathInput = document.getElementById('projectPath');
    createBtn = document.getElementById('createBtn');
    
    // Manifest 관련 요소
    manifestGitUrlInput = document.getElementById('manifestGitUrl');
    loadManifestsBtn = document.getElementById('loadManifestsBtn');
    manifestSelectGroup = document.getElementById('manifestSelectGroup');
    manifestSelect = document.getElementById('manifestSelect');
    
    // 추가 요소
    createFolderBtn = document.getElementById('createFolderBtn');
    
    // Build Tools 요소
    sourceMirrorPathInput = document.getElementById('sourceMirrorPath');
    buildtoolPathInput = document.getElementById('buildtoolPath');
    browseSourceMirrorBtn = document.getElementById('browseSourceMirrorBtn');
    browseBuildtoolBtn = document.getElementById('browseBuildtoolBtn');
    
    // 이벤트 리스너 설정
    setupEventListeners();
}

function validate() {
    if (!createBtn) return;
    
    const projectPathValid = projectPathInput.value.trim() !== '';
    const manifestGitUrlValid = manifestGitUrlInput.value.trim() !== '';
    const manifestSelected = manifestSelect.value !== '';
    const folderValid = folderCreated === true;
    
    // Load 버튼 활성화 조건: 폴더 생성 완료 + 프로젝트 경로 + Manifest Git URL
    if (loadManifestsBtn) {
        loadManifestsBtn.disabled = !(projectPathValid && manifestGitUrlValid && folderValid);
    }
    
    // 생성 버튼 활성화 조건: 폴더 생성 완료 + 모든 필드 + Manifest 선택
    createBtn.disabled = !(projectPathValid && manifestGitUrlValid && manifestSelected && folderValid);
}

function setupEventListeners() {
    projectPathInput.oninput = () => {
        // 경로가 바뀌면 폴더 생성 상태 초기화
        folderCreated = false;
        if (createFolderBtn) {
            createFolderBtn.disabled = false;
            createFolderBtn.textContent = 'Create Folder';
        }
        validate();
    };
    manifestSelect.onchange = validate;

    // Manifest 로드 버튼
    loadManifestsBtn.onclick = () => {
        const manifestGitUrl = manifestGitUrlInput.value.trim();
        const fullPath = projectPathInput.value.trim();
        
        if (!fullPath) {
            alert('프로젝트 경로를 입력하세요.');
            return;
        }

        if (!manifestGitUrl) {
            alert('Manifest Git URL이 설정되지 않았습니다. Settings에서 확인하세요.');
            return;
        }

        // 경로에서 프로젝트 이름과 상위 경로 분리
        const pathParts = fullPath.split('/').filter(p => p);  // 빈 문자열 제거
        projectName = pathParts.pop() || '';
        selectedPath = '/' + pathParts.join('/');

        if (!projectName) {
            alert('프로젝트 이름을 입력하세요.');
            return;
        }

        // Load 버튼 비활성화
        loadManifestsBtn.disabled = true;
        loadManifestsBtn.textContent = '로딩 중...';

        // 입력 필드 비활성화 (Load 시작 시점부터)
        projectPathInput.disabled = true;
        createFolderBtn.disabled = true;

        vscode.postMessage({
            command: 'loadManifests',
            manifestGitUrl: manifestGitUrl,
            projectPath: selectedPath,
            projectName: projectName
        });
    };

    document.getElementById('createFolderBtn').onclick = () => {
        createFolderBtn.disabled = true;
        createFolderBtn.textContent = 'Creating...';
        vscode.postMessage({ command: 'createFolder' });
    };

    // Build Tools Browse 버튼
    browseSourceMirrorBtn.onclick = () => {
        vscode.postMessage({ command: 'browseSourceMirror' });
    };

    browseBuildtoolBtn.onclick = () => {
        vscode.postMessage({ command: 'browseBuildtool' });
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
                projectName: projectName,
                projectPath: selectedPath,
                manifestGitUrl: manifestGitUrlInput.value.trim(),
                selectedManifest: manifestSelect.value,
                sourceMirrorPath: sourceMirrorPathInput.value.trim(),
                buildtoolPath: buildtoolPathInput.value.trim()
            }
        });
    };
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'init') {
        // Settings에서 받은 Manifest Git URL을 hidden input에 설정
        if (msg.manifestGitUrl) {
            manifestGitUrlInput.value = msg.manifestGitUrl;
        }
        // Settings에서 받은 Build Tools 경로 설정
        if (msg.sourceMirrorPath) {
            sourceMirrorPathInput.value = msg.sourceMirrorPath;
        }
        if (msg.buildtoolPath) {
            buildtoolPathInput.value = msg.buildtoolPath;
        }
        validate();
    } else if (msg.command === 'setSourceMirrorPath') {
        sourceMirrorPathInput.value = msg.path;
    } else if (msg.command === 'setBuildtoolPath') {
        buildtoolPathInput.value = msg.path;
    } else if (msg.command === 'folderCreated') {
        if (msg.success) {
            folderCreated = true;
            if (msg.path) {
                projectPathInput.value = msg.path;
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
    } else if (msg.command === 'manifestListLoaded') {
        manifestList = msg.manifests;
        
        // Select box 업데이트
        manifestSelect.innerHTML = '<option value="">-- 선택하세요 --</option>';
        manifestList.forEach(manifest => {
            const option = document.createElement('option');
            option.value = manifest;
            option.textContent = manifest;
            manifestSelect.appendChild(option);
        });
        
        // UI 업데이트
        manifestSelectGroup.style.display = 'block';
        loadManifestsBtn.disabled = false;
        loadManifestsBtn.textContent = 'Load';
        
        // 입력 필드는 비활성화 유지 (Load 버튼 클릭 시 이미 비활성화됨)
        
        validate();
        
        console.log(`Loaded ${manifestList.length} manifests`);
    } else if (msg.command === 'manifestLoadError') {
        alert('Manifest 목록을 불러오는데 실패했습니다: ' + msg.error);
        
        // Load 버튼 복구
        loadManifestsBtn.disabled = false;
        loadManifestsBtn.textContent = 'Load';
        
        // 에러 발생 시 입력 필드 다시 활성화 (사용자가 수정할 수 있도록)
        projectPathInput.disabled = false;
        createFolderBtn.disabled = false;
        createFolderBtn.textContent = 'Create Folder';
    } else if (msg.command === 'projectCreated') {
        createBtn.disabled = false;
        createBtn.textContent = '생성';
    }
});




