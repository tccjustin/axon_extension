const vscode = acquireVsCodeApi();
let selectedPath = '';
let projectName = '';

// DOM이 준비되면 엘리먼트 참조 설정
let projectPathInput, createBtn;
let autolinuxGitUrlInput, loadBtn;
let browseBtn;
let isLoaded = false;

// Configuration 관련 변수
let configSection, platform, sdkTemplate, manifest, machine;
let buildVersionRadios;
let mainFeaturesGroup, subFeaturesGroup;
let mainFeaturesCheckboxes, subFeaturesCheckboxes;
let platformList = {};
let sdkList = [];
let manifestList = [];
let machineList = [];
let mainFeatureList = [];
let subFeatureList = [];

// Build Tools 관련 변수
let buildToolsSection, sourceMirrorInput, buildtoolInput;
let browseMirrorBtn, browseBuildtoolBtn;
let sourceMirrorPath = '';
let buildtoolPath = '';

// DOMContentLoaded 이벤트
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
});

// UI 초기화
function initializeUI() {
    // DOM 요소 참조 설정
    projectPathInput = document.getElementById('projectPath');
    createBtn = document.getElementById('createBtn');
    
    // Autolinux 관련 요소
    autolinuxGitUrlInput = document.getElementById('autolinuxGitUrl');
    loadBtn = document.getElementById('loadBtn');
    
    // 추가 요소
    browseBtn = document.getElementById('browseBtn');
    
    // Build Tools 요소
    buildToolsSection = document.getElementById('buildToolsSection');
    sourceMirrorInput = document.getElementById('sourceMirror');
    buildtoolInput = document.getElementById('buildtool');
    browseMirrorBtn = document.getElementById('browseMirrorBtn');
    browseBuildtoolBtn = document.getElementById('browseBuildtoolBtn');
    
    // Configuration 요소
    configSection = document.getElementById('configSection');
    platform = document.getElementById('platform');
    sdkTemplate = document.getElementById('sdkTemplate');
    manifest = document.getElementById('manifest');
    machine = document.getElementById('machine');
    buildVersionRadios = document.querySelectorAll('input[name="buildVersion"]');
    mainFeaturesGroup = document.getElementById('mainFeaturesGroup');
    subFeaturesGroup = document.getElementById('subFeaturesGroup');
    mainFeaturesCheckboxes = document.getElementById('mainFeaturesCheckboxes');
    subFeaturesCheckboxes = document.getElementById('subFeaturesCheckboxes');
    
    // 이벤트 리스너 설정
    setupEventListeners();
}

function validate() {
    if (!createBtn) return;
    
    const projectPathValid = projectPathInput.value.trim() !== '';
    const autolinuxGitUrlValid = autolinuxGitUrlInput.value.trim() !== ''; // hidden input이지만 여전히 필요
    
    // Configuration 필드 검증 (Load 후에만)
    let configValid = true;
    if (isLoaded) {
        const platformValid = platform.value !== '';
        const sdkValid = sdkTemplate.value !== '';
        const manifestValid = manifest.value !== '';
        const machineValid = machine.value !== '';
        configValid = platformValid && sdkValid && manifestValid && machineValid;
    }
    
    // Load 버튼 활성화 조건: 프로젝트 경로 + Git URL
    if (loadBtn) {
        loadBtn.disabled = !(projectPathValid && autolinuxGitUrlValid);
    }
    
    // 생성 버튼 활성화 조건: Load 완료 + 모든 Configuration 선택
    createBtn.disabled = !(projectPathValid && autolinuxGitUrlValid && isLoaded && configValid);
}

function setupEventListeners() {
    projectPathInput.oninput = validate;
    // autolinuxGitUrlInput은 hidden이므로 oninput 불필요

    // Autolinux Git 클론 버튼
    loadBtn.onclick = () => {
        const autolinuxGitUrl = autolinuxGitUrlInput.value.trim();
        const fullPath = projectPathInput.value.trim();
        
        if (!fullPath) {
            alert('프로젝트 경로를 입력하세요.');
            return;
        }
        
        if (!autolinuxGitUrl) {
            alert('Autobuild script Git Repository URL을 입력하세요.');
            return;
        }

        if (!fullPath) {
            alert('프로젝트 경로를 먼저 입력해주세요.');
            return;
        }

    // 프로젝트 경로에서 프로젝트 이름 자동 추출 (전역 변수에 저장)
    selectedPath = fullPath;
    projectName = fullPath.split('/').filter(p => p).pop() || 'autolinux-project';

    // Load 버튼 비활성화
    loadBtn.disabled = true;
    loadBtn.textContent = '로딩 중...';

    // 입력 필드 비활성화 (Load 시작 시점부터)
    projectPathInput.disabled = true;
    browseBtn.disabled = true;
    autolinuxGitUrlInput.disabled = true;

    vscode.postMessage({
        command: 'loadAutolinux',
        autolinuxGitUrl: autolinuxGitUrl,
        projectPath: selectedPath,  // 중복 제거: fullPath를 그대로 사용
        projectName: projectName
    });
    };

    browseBtn.onclick = () => {
        vscode.postMessage({ command: 'browseFolder' });
    };

    document.getElementById('cancelBtn').onclick = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    createBtn.onclick = () => {
        if (createBtn.disabled) return;
        createBtn.disabled = true;
        createBtn.textContent = '생성 중...';
        
        // 전역 변수 사용 (이미 loadBtn에서 설정됨)
        
        // Configuration 데이터 수집
        const selectedMainFeatures = Array.from(mainFeaturesCheckboxes.querySelectorAll('input[type="checkbox"]'))
            .filter(cb => cb.checked)
            .map(cb => cb.value);
        
        const selectedSubFeatures = Array.from(subFeaturesCheckboxes.querySelectorAll('input[type="checkbox"]'))
            .filter(cb => cb.checked)
            .map(cb => cb.value);
        
        const selectedBuildVersion = Array.from(buildVersionRadios)
            .find(radio => radio.checked)?.value || 'qa';
        
        vscode.postMessage({
            command: 'createProject',
                data: {
                projectName: projectName,
                projectPath: selectedPath,  // 중복 제거
                autolinuxGitUrl: autolinuxGitUrlInput.value.trim(),
                // Configuration 데이터
                platform: platform.value,
                sdkTemplate: sdkTemplate.value,
                manifest: manifest.value,
                machine: machine.value,
                buildVersion: selectedBuildVersion,
                mainFeatures: selectedMainFeatures,
                subFeatures: selectedSubFeatures,
                // Build Tools 데이터
                sourceMirror: sourceMirrorPath,
                buildtool: buildtoolPath
            }
        });
    };

    // Configuration 이벤트 리스너
    platform.onchange = () => {
        if (platform.value) {
            // Platform에 맞는 SDK 목록 필터링
            updateSdkSelectForPlatform(platform.value);
        }
        validate();
    };

    sdkTemplate.onchange = () => {
        if (sdkTemplate.value) {
            vscode.postMessage({
                command: 'loadManifestsAndMachines',
                sdkTemplate: sdkTemplate.value,
                projectPath: selectedPath,  // 중복 제거
                projectName: projectName
            });
        }
        validate();
    };

    manifest.onchange = validate;
    
    machine.onchange = () => {
        if (machine.value && sdkTemplate.value && manifest.value) {
            // Machine 선택 시 Features 로드
            vscode.postMessage({
                command: 'loadFeatures',
                sdkTemplate: sdkTemplate.value,
                manifest: manifest.value,
                machine: machine.value,
                projectPath: selectedPath,  // 중복 제거
                projectName: projectName
            });
        }
        validate();
    };

    // Build Tools 이벤트 리스너
    browseMirrorBtn.onclick = () => {
        vscode.postMessage({
            command: 'browseSourceMirror'
        });
    };

    browseBuildtoolBtn.onclick = () => {
        vscode.postMessage({
            command: 'browseBuildtool'
        });
    };
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'init') {
        // Settings에서 받은 Git URL을 input에 설정
        if (msg.autolinuxGitUrl) {
            autolinuxGitUrlInput.value = msg.autolinuxGitUrl;
        }
        validate();
    } else if (msg.command === 'setFolderPath') {
        // 선택된 경로를 input에 설정 (사용자가 마지막 폴더명을 수정할 수 있음)
        projectPathInput.value = msg.path;
        
        // 커서를 input 필드의 마지막으로 이동
        projectPathInput.focus();
        projectPathInput.setSelectionRange(msg.path.length, msg.path.length);
        
        validate();
    } else if (msg.command === 'autolinuxLoaded') {
        isLoaded = true;
        
        // UI 업데이트
        loadBtn.disabled = false;
        loadBtn.textContent = 'Load';
        
        // User Settings에서 저장된 경로 확인 및 자동 설정
        sourceMirrorPath = msg.savedSourceMirror || '';
        buildtoolPath = msg.savedBuildtool || '';
        
        // input 필드에 저장된 경로 표시
        if (sourceMirrorPath) {
            sourceMirrorInput.value = sourceMirrorPath;
        }
        if (buildtoolPath) {
            buildtoolInput.value = buildtoolPath;
        }
        
        // Build Tools 섹션 항상 표시 (숨기지 않음!)
        buildToolsSection.style.display = 'block';
        sourceMirrorInput.disabled = false;
        buildtoolInput.disabled = false;
        browseMirrorBtn.disabled = false;
        browseBuildtoolBtn.disabled = false;
        
        // 저장된 경로가 있으면 로그 출력
        if (sourceMirrorPath || buildtoolPath) {
            console.log('✅ 저장된 Build Tools 경로 로드:', {
                sourceMirror: sourceMirrorPath || '없음',
                buildtool: buildtoolPath || '없음'
            });
        }
        
        // Configuration 섹션 표시 및 활성화
        configSection.style.display = 'block';
        enableConfigurationSection();
        
        // 자동으로 Platform과 SDK 목록 로드
        vscode.postMessage({
            command: 'refreshPlatformsAndSdks',
            projectPath: selectedPath,  // 중복 제거
            projectName: projectName
        });
        
        validate();
        
        console.log('Autolinux build script cloned successfully');
    } else if (msg.command === 'autolinuxLoadError') {
        alert('Autolinux build script 클론에 실패했습니다: ' + msg.error);
        
        // Load 버튼 복구
        loadBtn.disabled = false;
        loadBtn.textContent = 'Load';
        
        // 에러 발생 시 입력 필드 다시 활성화 (사용자가 수정할 수 있도록)
        projectPathInput.disabled = false;
        browseBtn.disabled = false;
        autolinuxGitUrlInput.disabled = false;
        
        isLoaded = false;
        validate();
    } else if (msg.command === 'platformsAndSdksLoaded') {
        platformList = msg.platforms;
        updatePlatformSelect();
    } else if (msg.command === 'platformsAndSdksLoadError') {
        alert('Platform 목록 로드 실패: ' + msg.error);
    } else if (msg.command === 'manifestsAndMachinesLoaded') {
        manifestList = msg.manifests;
        machineList = msg.machines;
        updateManifestSelect();
        updateMachineSelect();
    } else if (msg.command === 'featuresLoaded') {
        mainFeatureList = msg.mainFeatures || [];
        subFeatureList = msg.subFeatures || [];
        updateMainFeaturesCheckboxes();
        updateSubFeaturesCheckboxes();
    } else if (msg.command === 'featuresLoadError') {
        alert('Feature 목록 로드 실패: ' + msg.error);
    } else if (msg.command === 'setSourceMirrorPath') {
        sourceMirrorPath = msg.path;
        sourceMirrorInput.value = msg.path;
    } else if (msg.command === 'setBuildtoolPath') {
        buildtoolPath = msg.path;
        buildtoolInput.value = msg.path;
    } else if (msg.command === 'projectCreated') {
        createBtn.disabled = false;
        createBtn.textContent = '생성 & Configure';
    }
});

// Configuration 섹션 활성화
function enableConfigurationSection() {
    platform.disabled = false;
    sdkTemplate.disabled = false;
    manifest.disabled = false;
    machine.disabled = false;
    buildVersionRadios.forEach(radio => radio.disabled = false);
}

// Platform 목록 업데이트
function updatePlatformSelect() {
    platform.innerHTML = '<option value="">Select Platform...</option>';
    Object.keys(platformList).sort().forEach(p => {
        const option = document.createElement('option');
        option.value = p;
        option.textContent = p;
        platform.appendChild(option);
    });
}

// Platform에 맞는 SDK 목록 필터링
function updateSdkSelectForPlatform(selectedPlatform) {
    sdkTemplate.innerHTML = '<option value="">Select SDK...</option>';
    if (platformList[selectedPlatform]) {
        platformList[selectedPlatform].forEach(sdk => {
            const option = document.createElement('option');
            option.value = sdk;
            option.textContent = sdk;
            sdkTemplate.appendChild(option);
        });
    }
    // SDK 선택 초기화
    sdkTemplate.value = '';
    manifest.innerHTML = '<option value="">Select Manifest...</option>';
    machine.innerHTML = '<option value="">Select Machine...</option>';
    mainFeaturesGroup.style.display = 'none';
    subFeaturesGroup.style.display = 'none';
}

// Manifest 목록 업데이트
function updateManifestSelect() {
    manifest.innerHTML = '<option value="">Select Manifest...</option>';
    manifestList.forEach(m => {
        const option = document.createElement('option');
        option.value = m;
        option.textContent = m;
        manifest.appendChild(option);
    });
}

// Machine 목록 업데이트
function updateMachineSelect() {
    machine.innerHTML = '<option value="">Select Machine...</option>';
    machineList.forEach(m => {
        const option = document.createElement('option');
        option.value = m;
        option.textContent = m;
        machine.appendChild(option);
    });
}

// Main Features 체크박스 업데이트
function updateMainFeaturesCheckboxes() {
    if (mainFeatureList.length > 0) {
        mainFeaturesCheckboxes.innerHTML = '';
        mainFeatureList.forEach(feature => {
            const label = document.createElement('label');
            label.className = 'checkbox-label';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = feature.name;
            checkbox.checked = feature.enabled || false;
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'feature-name';
            nameSpan.textContent = feature.name;
            
            label.appendChild(checkbox);
            label.appendChild(nameSpan);
            
            // 설명이 있으면 추가
            if (feature.desc) {
                const descSpan = document.createElement('span');
                descSpan.className = 'feature-desc';
                descSpan.textContent = feature.desc;
                label.appendChild(descSpan);
            }
            
            mainFeaturesCheckboxes.appendChild(label);
        });
        mainFeaturesGroup.style.display = 'block';
        const machineName = machine.value;
        document.getElementById('mainFeaturesLabel').textContent = 
            `${machineName} Features`;
    } else {
        mainFeaturesGroup.style.display = 'none';
    }
}

// Sub Features 체크박스 업데이트
function updateSubFeaturesCheckboxes() {
    if (subFeatureList.length > 0) {
        subFeaturesCheckboxes.innerHTML = '';
        subFeatureList.forEach(feature => {
            const label = document.createElement('label');
            label.className = 'checkbox-label';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = feature.name;
            checkbox.checked = feature.enabled || false;
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'feature-name';
            nameSpan.textContent = feature.name;
            
            label.appendChild(checkbox);
            label.appendChild(nameSpan);
            
            // 설명이 있으면 추가
            if (feature.desc) {
                const descSpan = document.createElement('span');
                descSpan.className = 'feature-desc';
                descSpan.textContent = feature.desc;
                label.appendChild(descSpan);
            }
            
            subFeaturesCheckboxes.appendChild(label);
        });
        subFeaturesGroup.style.display = 'block';
        // Sub machine 이름 추출 (main을 sub로 변경)
        const machineName = machine.value.replace('-main', '-sub');
        document.getElementById('subFeaturesLabel').textContent = 
            `${machineName} Features`;
    } else {
        subFeaturesGroup.style.display = 'none';
    }
}

