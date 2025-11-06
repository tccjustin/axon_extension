const vscode = acquireVsCodeApi();
let selectedPath = '';

// DOM이 준비되면 엘리먼트 참조 설정
let projectNameInput, projectPathInput, createBtn;
let manifestGitUrlInput, loadManifestsBtn, manifestSelectGroup, manifestSelect;
let manifestList = [];
let browseBtn, warningMessage;

// DOMContentLoaded 이벤트
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
});

// UI 초기화
function initializeUI() {
    // DOM 요소 참조 설정
    projectNameInput = document.getElementById('projectName');
    projectPathInput = document.getElementById('projectPath');
    createBtn = document.getElementById('createBtn');
    
    // Manifest 관련 요소
    manifestGitUrlInput = document.getElementById('manifestGitUrl');
    loadManifestsBtn = document.getElementById('loadManifestsBtn');
    manifestSelectGroup = document.getElementById('manifestSelectGroup');
    manifestSelect = document.getElementById('manifestSelect');
    
    // 추가 요소
    browseBtn = document.getElementById('browseBtn');
    warningMessage = document.getElementById('warningMessage');
    
    // 이벤트 리스너 설정
    setupEventListeners();
}

function validate() {
    if (!createBtn) return;
    
    const projectNameValid = projectNameInput.value.trim() !== '';
    const projectPathValid = selectedPath !== '';
    const manifestGitUrlValid = manifestGitUrlInput.value.trim() !== '';
    const manifestSelected = manifestSelect.value !== '';
    
    createBtn.disabled = !(projectNameValid && projectPathValid && manifestGitUrlValid && manifestSelected);
}

function setupEventListeners() {
    projectNameInput.oninput = validate;
    manifestGitUrlInput.oninput = validate;
    manifestSelect.onchange = validate;

    // Manifest 로드 버튼
    loadManifestsBtn.onclick = () => {
        const manifestGitUrl = manifestGitUrlInput.value.trim();
        const projectName = projectNameInput.value.trim();
        
        if (!manifestGitUrl) {
            alert('Manifest Git 저장소 URL을 입력하세요.');
            return;
        }

        if (!projectName) {
            alert('프로젝트 이름을 먼저 입력해주세요.');
            return;
        }

        if (!selectedPath) {
            alert('프로젝트 생성 위치를 먼저 선택해주세요.');
            return;
        }

        // Load 버튼 비활성화
        loadManifestsBtn.disabled = true;
        loadManifestsBtn.textContent = '로딩 중...';

        // 입력 필드 비활성화 (Load 시작 시점부터)
        projectNameInput.disabled = true;
        browseBtn.disabled = true;
        manifestGitUrlInput.disabled = true;

        vscode.postMessage({
            command: 'loadManifests',
            manifestGitUrl: manifestGitUrl,
            projectPath: selectedPath,
            projectName: projectName
        });
    };

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
                manifestGitUrl: manifestGitUrlInput.value.trim(),
                selectedManifest: manifestSelect.value
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
        
        // 경고 메시지 표시
        warningMessage.style.display = 'flex';
        
        // 입력 필드는 비활성화 유지 (Load 버튼 클릭 시 이미 비활성화됨)
        
        validate();
        
        console.log(`Loaded ${manifestList.length} manifests`);
    } else if (msg.command === 'manifestLoadError') {
        alert('Manifest 목록을 불러오는데 실패했습니다: ' + msg.error);
        
        // Load 버튼 복구
        loadManifestsBtn.disabled = false;
        loadManifestsBtn.textContent = 'Load';
        
        // 에러 발생 시 입력 필드 다시 활성화 (사용자가 수정할 수 있도록)
        projectNameInput.disabled = false;
        browseBtn.disabled = false;
        manifestGitUrlInput.disabled = false;
    } else if (msg.command === 'projectCreated') {
        createBtn.disabled = false;
        createBtn.textContent = '생성';
    }
});




