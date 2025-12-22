import * as vscode from 'vscode';
import { axonLog, axonSuccess, axonError } from '../../logger';
import { executeShellTask, cloneGitRepository } from '../common/shell-utils';
import { createVscodeSettings as createVscodeSettingsUtil } from '../common/vscode-utils';

/**
 * Autolinux 프로젝트 생성 데이터
 */
export interface AutolinuxProjectData {
	projectName: string;
	projectUri: vscode.Uri;
	autolinuxGitUrl: string;
	// Configuration 데이터
	platform?: string;
	sdkTemplate?: string;
	manifest?: string;
	machine?: string;
	buildVersion?: string;
	mainFeatures?: string[];
	subFeatures?: string[];
	// Build Tools 데이터
	sourceMirror?: string;
	buildtool?: string;
}

/**
 * Autolinux 프로젝트 생성 작업을 처리하는 클래스
 */
export class AutolinuxProjectCreator {
	/**
	 * Autolinux 프로젝트 생성 메인 함수
	 */
	static async createAutolinuxProject(data: AutolinuxProjectData): Promise<void> {
		const { projectName, projectUri, autolinuxGitUrl, platform, sdkTemplate, manifest, machine, buildVersion, mainFeatures, subFeatures, sourceMirror, buildtool } = data;

		// projectUri는 이미 전체 경로 (projectPath + projectName)를 포함하고 있음
		const projectFullUri = projectUri;

		// 프로젝트 폴더 존재 여부 확인
		let folderAlreadyExists = false;
		try {
			const stat = await vscode.workspace.fs.stat(projectFullUri);
			folderAlreadyExists = true;
			
			// Load 단계에서 생성된 폴더일 수 있으므로 허용
			axonLog(`📁 프로젝트 폴더가 이미 존재합니다 (Load 단계에서 생성됨): ${projectFullUri.toString()}`);
		} catch (error) {
			// 'FileNotFound' 오류는 정상적인 경우이므로 무시하고 계속 진행
			folderAlreadyExists = false;
		}

		// 프로젝트 폴더 생성 (아직 없는 경우만)
		if (!folderAlreadyExists) {
			axonLog(`📂 새 Autolinux 프로젝트 폴더 생성: ${projectFullUri.toString()}`);
			await vscode.workspace.fs.createDirectory(projectFullUri);
		} else {
			axonLog(`📂 기존 Autolinux 프로젝트 폴더 사용: ${projectFullUri.toString()}`);
		}

		const projectPath = projectFullUri.scheme === 'file'
			? projectFullUri.fsPath
			: projectFullUri.path;

		axonLog(`🔄 Autolinux 프로젝트 생성 완료`);
		axonLog(`ℹ️ Build script는 이미 Load 단계에서 클론되었습니다.`);

		// Build Tools & Source Mirror 경로 설정 (Configuration 전)
		if (sourceMirror || buildtool) {
			axonLog(`⚙️ sdk.py 파일 업데이트 중...`);
			await this.updateSdkPyPaths(projectFullUri, sourceMirror, buildtool);
			
			// tools 폴더 생성 (autolinux FTP 다운로드 건너뛰기용)
			axonLog(`📁 tools 폴더 생성 중...`);
			await this.createToolsFolder(projectFullUri);
		}

		// Configuration이 제공된 경우 autolinux configure 실행
		if (sdkTemplate && manifest && machine) {
			axonLog(`⚙️ Autolinux Configuration 실행 중...`);
			await this.runAutolinuxConfigure(projectFullUri, {
				sdkTemplate,
				manifest,
				machine,
				buildVersion: buildVersion || 'qa',
				mainFeatures: mainFeatures || [],
				subFeatures: subFeatures || []
			});
			axonSuccess(`✅ Autolinux Configuration이 완료되었습니다.`);
		}

		// .vscode/settings.json 생성
		axonLog(`⚙️ Autolinux 프로젝트 설정 파일을 생성합니다: .vscode/settings.json`);
		await createVscodeSettingsUtil(projectFullUri, {
			'axon.projectType': 'yocto_project_autolinux',
			'axon.yocto.projectRoot': projectPath,
			'axon.yocto.autolinux.sdk': sdkTemplate,
			'axon.yocto.autolinux.machine': machine,
			'axon.yocto.autolinux.buildVersion': buildVersion
		});
		axonSuccess(`✅ 프로젝트 설정 파일이 생성되었습니다.`);

		// 생성된 프로젝트 폴더를 VS Code에서 열기
		await vscode.commands.executeCommand('vscode.openFolder', projectFullUri, { forceNewWindow: true });
		axonSuccess(`✅ Autolinux 프로젝트 생성이 완료되었습니다.`);
	}

	/**
	 * Autolinux build script 클론
	 * Load 버튼을 눌렀을 때 호출됨
	 */
	static async cloneAutolinuxScript(autolinuxGitUrl: string, projectPath: vscode.Uri): Promise<void> {
		axonLog(`🔄 Cloning autolinux build script...`);
		
		const projectPathStr = projectPath.scheme === 'file' ? projectPath.fsPath : projectPath.path;
		
		// 프로젝트 폴더가 없으면 생성
		try {
			await vscode.workspace.fs.createDirectory(projectPath);
			axonLog(`✅ 프로젝트 폴더 생성: ${projectPathStr}`);
		} catch (error) {
			// 폴더가 이미 존재하면 무시
			axonLog(`📁 프로젝트 폴더가 이미 존재하거나 생성 중 오류 (계속 진행): ${error}`);
		}
		
		// git clone 실행
		await executeShellTask({
			command: `git clone ${autolinuxGitUrl}`,
			cwd: projectPathStr,
			taskName: 'Clone Autolinux Build Script',
			taskId: 'autolinuxCloneBuildScript',
			showTerminal: true
		});
		
		axonSuccess(`✅ Autolinux build script 클론 완료`);
	}

	/**
	 * Autolinux Configure 실행
	 */
	static async runAutolinuxConfigure(projectPath: vscode.Uri, config: {
		sdkTemplate: string;
		manifest: string;
		machine: string;
		buildVersion: string;
		mainFeatures: string[];
		subFeatures: string[];
	}): Promise<void> {
		const projectPathStr = projectPath.scheme === 'file' ? projectPath.fsPath : projectPath.path;
		
		axonLog(`🔧 Running autolinux configure...`);
		axonLog(`   SDK: ${config.sdkTemplate}`);
		axonLog(`   Manifest: ${config.manifest}`);
		axonLog(`   Machine: ${config.machine}`);
		axonLog(`   Build Version: ${config.buildVersion}`);
		axonLog(`   Main Features: ${config.mainFeatures.join(', ') || 'None'}`);
		axonLog(`   Sub Features: ${config.subFeatures.join(', ') || 'None'}`);

		// build-autolinux 디렉토리로 이동
		const autolinuxPath = `${projectPathStr}/build-autolinux`;

		// autolinux 명령어 구성
		let command = `cd ${autolinuxPath} && ./autolinux -c configure`;
		command += ` --sdk ${config.sdkTemplate}`;
		command += ` --manifest ${config.manifest}`;
		command += ` --machine ${config.machine}`;
		command += ` --buildversion ${config.buildVersion}`;
		
		// Main features 추가
		if (config.mainFeatures.length > 0) {
			command += ` --features ${config.mainFeatures.join(',')}`;
		}
		
		// Sub features 추가 (sub machine이 있는 경우)
		if (config.subFeatures.length > 0) {
			command += ` --sub-features ${config.subFeatures.join(',')}`;
		}

		// 명령어 실행
		await executeShellTask({
			command: command,
			cwd: projectPathStr,
			taskName: 'Autolinux Configure',
			taskId: 'autolinuxConfigure',
			showTerminal: true
		});

		axonSuccess(`✅ Autolinux configure 실행 완료`);
	}

	/**
	 * Platform과 SDK 목록 읽기 (sdk.py에서 Platform 정보 파싱)
	 */
	static async loadPlatformsAndSdks(projectPath: vscode.Uri): Promise<{[platform: string]: string[]}> {
		try {
			const projectPathStr = projectPath.scheme === 'file' ? projectPath.fsPath : projectPath.path;
			const buildAutolinuxPath = `${projectPathStr}/build-autolinux`;
			
			axonLog(`🔍 Platform 및 SDK 목록 로딩...`);
			
			// Python 스크립트로 sdk.py의 SDK 딕셔너리 파싱
			const pythonScript = `import sys
import json
sys.path.insert(0, '${buildAutolinuxPath}/template')

try:
    from sdk import SDK
    print(json.dumps(SDK))
except Exception as e:
    import sys
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)
`;

			// 임시 Python 파일 생성
			const tempScript = Buffer.from(pythonScript, 'utf-8');
			const scriptUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', '.temp_load_platforms.py');
			await vscode.workspace.fs.writeFile(scriptUri, tempScript);
			
			// Python 실행 및 출력 캡처
			const outputPath = `${buildAutolinuxPath}/.temp_platforms_output.json`;
			await executeShellTask({
				command: `cd ${buildAutolinuxPath} && python3 .temp_load_platforms.py > .temp_platforms_output.json 2>&1`,
				cwd: buildAutolinuxPath,
				taskName: 'Load Platforms',
				taskId: 'loadPlatforms',
				showTerminal: false
			});

			// 결과 읽기
			const outputUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', '.temp_platforms_output.json');
			const outputContent = await vscode.workspace.fs.readFile(outputUri);
			const outputText = Buffer.from(outputContent).toString('utf-8');
			
			// 임시 파일 삭제
			try {
				await vscode.workspace.fs.delete(scriptUri);
				await vscode.workspace.fs.delete(outputUri);
			} catch (e) {
				// 삭제 실패는 무시
			}
			
			const platforms = JSON.parse(outputText);
			if (platforms.error) {
				throw new Error(platforms.error);
			}

			axonLog(`✅ Platform 목록 로드 완료: ${Object.keys(platforms).length}개`);
			return platforms;
		} catch (error) {
			axonError(`❌ Platform 목록 로드 실패: ${error}`);
			throw new Error(`Platform 정보를 읽을 수 없습니다: ${error}`);
		}
	}

	/**
	 * SDK에서 Manifest와 Machine 목록 추출
	 */
	static async loadManifestsAndMachines(projectPath: vscode.Uri, sdkTemplate: string): Promise<{
		manifests: string[];
		machines: string[];
	}> {
		const projectPathStr = projectPath.scheme === 'file' ? projectPath.fsPath : projectPath.path;
		const buildAutolinuxPath = `${projectPathStr}/build-autolinux`;
		
		axonLog(`🔍 SDK 템플릿 파싱: ${sdkTemplate}`);
		
		// Python 스크립트 작성
		const pythonScript = `import sys
import json
sys.path.insert(0, '${buildAutolinuxPath}/template')

try:
    # SDK 템플릿 모듈 import
    sdk_module = __import__('${sdkTemplate}')
    
    result = {
        'manifests': [],
        'machines': []
    }
    
    # Manifest 목록 추출 (Manifests 속성)
    if hasattr(sdk_module, 'Manifests'):
        manifests = sdk_module.Manifests
        if isinstance(manifests, list):
            # [[xml, date], ...] 형식에서 xml만 추출
            result['manifests'] = [m[0] if isinstance(m, list) and len(m) > 0 else str(m) for m in manifests]
    
    # Machine 목록 추출 (Machines 속성)
    if hasattr(sdk_module, 'Machines'):
        machines = sdk_module.Machines
        if isinstance(machines, dict):
            # dict인 경우 모든 value를 flat하게
            all_machines = []
            for key, value in machines.items():
                if isinstance(value, list):
                    all_machines.extend(value)
                else:
                    all_machines.append(str(value))
            result['machines'] = all_machines
        elif isinstance(machines, list):
            result['machines'] = machines
    
    # JSON 출력
    print(json.dumps(result))
    
except Exception as e:
    import sys
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)
`;

		try {
			// 임시 Python 파일 생성
			const tempScript = Buffer.from(pythonScript, 'utf-8');
			const scriptUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', '.temp_parse_sdk.py');
			await vscode.workspace.fs.writeFile(scriptUri, tempScript);
			
			// Python 실행 및 출력 캡처
			await executeShellTask({
				command: `cd ${buildAutolinuxPath} && python3 .temp_parse_sdk.py > .temp_sdk_output.json 2>&1`,
				cwd: buildAutolinuxPath,
				taskName: 'Parse SDK Template',
				taskId: 'parseSdkTemplate',
				showTerminal: false
			});

			// 결과 읽기
			const outputUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', '.temp_sdk_output.json');
			const outputContent = await vscode.workspace.fs.readFile(outputUri);
			const outputText = Buffer.from(outputContent).toString('utf-8');
			
			// 임시 파일 삭제
			try {
				await vscode.workspace.fs.delete(scriptUri);
				await vscode.workspace.fs.delete(outputUri);
			} catch (e) {
				// 삭제 실패는 무시
			}
			
			// JSON 파싱
			const data = JSON.parse(outputText);
			
			if (data.error) {
				throw new Error(data.error);
			}
			
			axonLog(`✅ Manifest: ${data.manifests.length}개, Machine: ${data.machines.length}개`);
			
			return {
				manifests: data.manifests || [],
				machines: data.machines || []
			};
			
		} catch (error) {
			axonError(`❌ SDK 파싱 실패: ${error}`);
			
			// 에러 시 기본값 반환
			axonLog(`⚠️ 기본값으로 대체합니다`);
			return {
				manifests: ['linux_yp4.0_cgw_1.0.0_dev.xml', 'linux_yp4.0_cgw_1.0.0_qa.xml'],
				machines: ['tcn1000-main', 'tcn1000x-main']
			};
		}
	}

	/**
	 * Machine에 맞는 Feature 목록 동적 생성
	 * classes/feature.py의 Feature 클래스를 Python으로 실행하여 Feature 목록 가져옴
	 */
	static async loadFeatures(
		projectPath: vscode.Uri,
		sdkTemplate: string,
		manifest: string,
		machine: string
	): Promise<{
		mainFeatures: Array<{name: string; enabled: boolean; desc: string}>;
		subFeatures: Array<{name: string; enabled: boolean; desc: string}>;
	}> {
		const projectPathStr = projectPath.scheme === 'file' ? projectPath.fsPath : projectPath.path;
		const buildAutolinuxPath = `${projectPathStr}/build-autolinux`;
		
		axonLog(`🔍 Feature 목록 로딩: ${machine} (SDK: ${sdkTemplate}, Manifest: ${manifest})`);
		
		// SDK에서 chipset 추출 (예: tcc807x_linux_ivi -> tcc807x)
		const chipset = sdkTemplate.split('_')[0]; // SDK 이름의 첫 부분이 chipset
		const core = machine.split('-')[1]; // main or sub
		
		// Manifest에서 date 추출 (예: tcc807x_linux_ivi_k5.10_0.3.0.xml -> 2023/07/07)
		// SDK 템플릿 파일에서 Manifests를 읽어서 date를 찾아야 함
		
		// Python 스크립트 작성 - Feature 클래스 사용
		const pythonScript = `import sys
import os
import json
sys.path.insert(0, '${buildAutolinuxPath}')
sys.path.insert(0, '${buildAutolinuxPath}/template')
sys.path.insert(0, '${buildAutolinuxPath}/classes')
sys.path.insert(0, '${buildAutolinuxPath}/classes/features')
os.chdir('${buildAutolinuxPath}')  # Feature 클래스가 상대 경로를 사용하므로 작업 디렉토리 변경

try:
    # SDK 모듈 import하여 manifest date와 Features 찾기
    sdk_module = __import__('${sdkTemplate}')
    manifest_date = 'up-to-date'
    main_func_list = []
    sub_func_list = []
    
    if hasattr(sdk_module, 'Manifests'):
        for m in sdk_module.Manifests:
            if isinstance(m, list) and m[0] == '${manifest}':
                manifest_date = m[1] if len(m) > 1 else 'up-to-date'
                break
    
    # SDK 템플릿에서 MainFeatures, SubFeatures 가져오기 (있으면)
    if hasattr(sdk_module, 'MainFeatures'):
        main_func_list = sdk_module.MainFeatures
    if hasattr(sdk_module, 'SubFeatures'):
        sub_func_list = sdk_module.SubFeatures
    
    # Feature 클래스 import
    from feature import Feature
    
    # Feature 인스턴스 생성 (5개 인자 전달)
    # loadMain=True, loadSub=True로 설정하여 기본 Feature를 로드
    feature_obj = Feature('${chipset}', manifest_date, '${sdkTemplate}', main_func_list, sub_func_list, True, True)
    
    # Main Features 가져오기
    main_features = feature_obj.getFeatureList('main')
    sub_features = feature_obj.getFeatureList('sub')
    
    result = {
        'mainFeatures': [{'name': f[0], 'enabled': f[1], 'desc': f[2]} for f in main_features],
        'subFeatures': [{'name': f[0], 'enabled': f[1], 'desc': f[2]} for f in sub_features]
    }
    
    print(json.dumps(result))
    
except Exception as e:
    import traceback
    print(json.dumps({'error': str(e), 'traceback': traceback.format_exc()}), file=sys.stderr)
    sys.exit(1)
`;

		try {
			// 임시 Python 파일 생성
			const tempScript = Buffer.from(pythonScript, 'utf-8');
			const scriptUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', '.temp_load_features.py');
			await vscode.workspace.fs.writeFile(scriptUri, tempScript);
			
		// Python 실행 및 출력 캡처
		const outputPath = `${buildAutolinuxPath}/.temp_features_output.json`;
		
		try {
			await executeShellTask({
				command: `cd ${buildAutolinuxPath} && python3 .temp_load_features.py > .temp_features_output.json 2>&1`,
				cwd: buildAutolinuxPath,
				taskName: 'Load Features',
				taskId: 'loadFeatures',
				showTerminal: false
			});
		} catch (execError) {
			// 실행 실패 시에도 출력 파일을 읽어봄
			axonLog(`⚠️ Python 스크립트 실행 실패: ${execError}`);
		}

		// 결과 읽기 (실패해도 출력 파일이 있을 수 있음)
		const outputUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', '.temp_features_output.json');
		let outputContent;
		let outputText = '';
		
		try {
			outputContent = await vscode.workspace.fs.readFile(outputUri);
			outputText = Buffer.from(outputContent).toString('utf-8');
		} catch (readError) {
			axonError(`❌ 출력 파일 읽기 실패: ${readError}`);
			throw new Error(`출력 파일을 읽을 수 없습니다: ${readError}`);
		}
		
		// 디버깅: 출력 내용 로그 (처음 1000자)
		axonLog(`📄 Python 스크립트 출력:\n${outputText.substring(0, 1000)}${outputText.length > 1000 ? '\n...(생략)' : ''}`);
		
		// 에러가 있는지 먼저 확인
		if (outputText.includes('Traceback') || outputText.includes('Error')) {
			axonLog(`⚠️ Python 스크립트 실행 중 문제 발생 가능. 전체 출력:\n${outputText}`);
		}
		
		// 임시 파일 삭제 (에러 시에는 삭제하지 않음)
		const hasError = outputText.includes('Traceback') || outputText.includes('Error');
		if (!hasError) {
			try {
				await vscode.workspace.fs.delete(scriptUri);
				await vscode.workspace.fs.delete(outputUri);
			} catch (e) {
				// 삭제 실패는 무시
			}
		} else {
			axonLog(`🔍 디버깅을 위해 임시 파일 유지: ${scriptUri.path}, ${outputUri.path}`);
		}
		
		// JSON 파싱
		let data;
		try {
			data = JSON.parse(outputText);
		} catch (parseError) {
			axonError(`❌ JSON 파싱 실패: ${parseError}`);
			axonLog(`출력 내용: ${outputText}`);
			throw new Error(`JSON 파싱 실패: ${parseError}`);
		}
		
		if (data.error) {
			axonError(`Feature 로딩 에러: ${data.error}`);
			if (data.traceback) {
				axonLog(data.traceback);
			}
			throw new Error(data.error);
		}
		
		axonLog(`✅ Main Features: ${data.mainFeatures.length}개, Sub Features: ${data.subFeatures.length}개`);
		
		// 디버깅: Feature 목록 출력
		const mainFeatureNames = data.mainFeatures.map((f: any) => f.name);
		const subFeatureNames = data.subFeatures.map((f: any) => f.name);
		
		axonLog(`📋 Main Features (${mainFeatureNames.length}개):`);
		mainFeatureNames.forEach((name: string, idx: number) => {
			axonLog(`  ${idx + 1}. ${name}`);
		});
		
		axonLog(`📋 Sub Features (${subFeatureNames.length}개):`);
		subFeatureNames.forEach((name: string, idx: number) => {
			axonLog(`  ${idx + 1}. ${name}`);
		});
		
		return {
			mainFeatures: data.mainFeatures || [],
			subFeatures: data.subFeatures || []
		};
			
		} catch (error) {
			axonError(`❌ Feature 로딩 실패: ${error}`);
			
			// 에러 시 빈 배열 반환
			return {
				mainFeatures: [],
				subFeatures: []
			};
		}
	}

	/**
	 * SDK 템플릿에서 MainImages/SubImages 로딩
	 */
	static async loadImages(projectPath: vscode.Uri, sdk: string, machine: string): Promise<{
		mainImages: Array<{ name: string; date: string }>;
		subImages: Array<{ name: string; date: string }>;
	}> {
		try {
			const sdkTemplateFile = `${sdk}.py`;
			const templateUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', 'template', sdkTemplateFile);
			
			axonLog(`📋 이미지 목록 로딩: ${sdkTemplateFile}`);
			
			// 경로 처리 (원격 환경 지원)
			const projectPathForPython = projectPath.scheme === 'file' ? projectPath.fsPath : projectPath.path;
			const templatePath = `${projectPathForPython}/build-autolinux/template`;
			
			// Python 스크립트 생성
			const pythonScript = `
import sys
import json
import os

# 템플릿 경로 추가
template_path = '${templatePath}'
if template_path not in sys.path:
    sys.path.insert(0, template_path)

try:
    # SDK 모듈 import
    tmp = __import__('${sdk}')
    
    main_images = []
    sub_images = []
    
    # MainImages 파싱
    if hasattr(tmp, 'MainImages'):
        for item in tmp.MainImages:
            if isinstance(item, list) and len(item) >= 2:
                main_images.append({'name': item[0], 'date': item[1]})
    
    # SubImages 파싱
    if hasattr(tmp, 'SubImages'):
        for item in tmp.SubImages:
            if isinstance(item, list) and len(item) >= 2:
                sub_images.append({'name': item[0], 'date': item[1]})
    
    result = {
        'mainImages': main_images,
        'subImages': sub_images
    }
    
    print(json.dumps(result))
except Exception as e:
    import traceback
    error_info = {
        'error': str(e),
        'traceback': traceback.format_exc(),
        'template_path': template_path,
        'sdk': '${sdk}'
    }
    print(json.dumps(error_info), file=sys.stderr)
    sys.exit(1)
`;
			
			// 임시 파일 생성 및 실행
			const tempScriptUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', '.temp_load_images.py');
			const tempOutputUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', '.temp_images_output.json');
			
			await vscode.workspace.fs.writeFile(tempScriptUri, Buffer.from(pythonScript, 'utf-8'));
			
			// Python 실행
			const projectPathStr = projectPath.scheme === 'file' ? projectPath.fsPath : projectPath.path;
			const tempScriptPath = tempScriptUri.scheme === 'file' ? tempScriptUri.fsPath : tempScriptUri.path;
			const tempOutputPath = tempOutputUri.scheme === 'file' ? tempOutputUri.fsPath : tempOutputUri.path;
			
			try {
				await executeShellTask({
					command: `python3 ${tempScriptPath} > ${tempOutputPath} 2>&1`,
					cwd: projectPathStr,
					taskName: 'Load Autolinux Images',
					taskId: 'loadAutolinuxImages',
					showTerminal: false
				});
			} catch (execError) {
				// Python 실행 실패 시 출력 파일 읽어서 에러 확인
				try {
					const errorContent = await vscode.workspace.fs.readFile(tempOutputUri);
					const errorText = Buffer.from(errorContent).toString('utf-8');
					axonError(`Python 실행 에러:\n${errorText}`);
					throw new Error(`Python script failed: ${errorText}`);
				} catch {
					throw new Error(`Python script execution failed: ${execError}`);
				}
			}
			
			// 결과 읽기
			let outputText = '';
			try {
				const outputContent = await vscode.workspace.fs.readFile(tempOutputUri);
				outputText = Buffer.from(outputContent).toString('utf-8');
			} catch (readError) {
				axonError(`출력 파일 읽기 실패: ${readError}`);
				throw new Error(`Failed to read output file: ${readError}`);
			}
			
			// 임시 파일 삭제
			try {
				await vscode.workspace.fs.delete(tempScriptUri);
				await vscode.workspace.fs.delete(tempOutputUri);
			} catch {}
			
			// JSON 파싱
			let data: any;
			try {
				data = JSON.parse(outputText);
			} catch (parseError) {
				axonError(`JSON 파싱 실패. 출력:\n${outputText}`);
				throw new Error(`Failed to parse JSON: ${outputText}`);
			}
			
			if (data.error) {
				throw new Error(data.error);
			}
			
			axonLog(`✅ Main Images: ${data.mainImages.length}개, Sub Images: ${data.subImages.length}개`);
			
			return {
				mainImages: data.mainImages || [],
				subImages: data.subImages || []
			};
			
		} catch (error) {
			axonError(`❌ 이미지 로딩 실패: ${error}`);
			
			// 에러 시 빈 배열 반환
			return {
				mainImages: [],
				subImages: []
			};
		}
	}

	/**
	 * tools 폴더 생성 (autolinux FTP 다운로드 건너뛰기용)
	 */
	static async createToolsFolder(projectPath: vscode.Uri): Promise<void> {
		try {
			const toolsUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', 'tools');
			
			// tools 폴더가 이미 있는지 확인
			try {
				await vscode.workspace.fs.stat(toolsUri);
				axonLog(`📁 tools 폴더가 이미 존재합니다: ${toolsUri.toString()}`);
				return;
			} catch {
				// 폴더가 없으면 생성
				await vscode.workspace.fs.createDirectory(toolsUri);
				axonSuccess(`✅ tools 폴더 생성 완료: ${toolsUri.toString()}`);
			}
		} catch (error) {
			axonError(`❌ tools 폴더 생성 실패: ${error}`);
			throw error;
		}
	}

	/**
	 * sdk.py 파일의 SOURCE_MIRROR와 BUILDTOOL 경로 업데이트
	 */
	static async updateSdkPyPaths(
		projectPath: vscode.Uri,
		sourceMirror?: string,
		buildtool?: string
	): Promise<void> {
		try {
			const sdkPyUri = vscode.Uri.joinPath(projectPath, 'build-autolinux', 'template', 'sdk.py');
			
			axonLog(`📝 sdk.py 파일 읽기: ${sdkPyUri.toString()}`);
			
			// 파일 읽기
			const content = await vscode.workspace.fs.readFile(sdkPyUri);
			let text = Buffer.from(content).toString('utf-8');
			
			// SOURCE_MIRROR 경로 수정
			if (sourceMirror) {
				const sourceMirrorRegex = /SOURCE_MIRROR\s*=\s*['"].*['"]/;
				if (sourceMirrorRegex.test(text)) {
					text = text.replace(sourceMirrorRegex, `SOURCE_MIRROR = '${sourceMirror}'`);
					axonLog(`✅ SOURCE_MIRROR 설정: ${sourceMirror}`);
				} else {
					axonError(`⚠️ SOURCE_MIRROR 패턴을 찾을 수 없습니다`);
				}
			}
			
			// BUILDTOOL 경로 수정
			if (buildtool) {
				const buildtoolRegex = /BUILDTOOL\s*=\s*['"].*['"]/;
				if (buildtoolRegex.test(text)) {
					text = text.replace(buildtoolRegex, `BUILDTOOL = '${buildtool}'`);
					axonLog(`✅ BUILDTOOL 설정: ${buildtool}`);
				} else {
					axonError(`⚠️ BUILDTOOL 패턴을 찾을 수 없습니다`);
				}
			}
			
			// 파일 쓰기
			await vscode.workspace.fs.writeFile(sdkPyUri, Buffer.from(text, 'utf-8'));
			
			axonSuccess(`✅ sdk.py 파일 업데이트 완료`);
		} catch (error) {
			axonError(`❌ sdk.py 업데이트 실패: ${error}`);
			throw error;
		}
	}
}

