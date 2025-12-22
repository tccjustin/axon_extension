# 📦 Marketplace 배포 가이드

## 🔑 1단계: Personal Access Token (PAT) 생성

### PAT 생성 방법

1. **Azure DevOps 접속**
   - https://dev.azure.com 방문
   - Microsoft 계정으로 로그인

2. **PAT 생성**
   - 우측 상단 사용자 아이콘 클릭
   - "Personal access tokens" 선택
   - "New Token" 클릭

3. **토큰 설정**
   ```
   Name: VSCode Marketplace Axon
   Organization: All accessible organizations
   Expiration: 90 days (또는 원하는 기간)
   Scopes: Custom defined
   
   ✅ Marketplace
      ✅ Acquire
      ✅ Manage  ← 반드시 체크!
   ```

4. **토큰 복사**
   - 생성된 토큰을 안전한 곳에 저장 (다시 볼 수 없음!)

## 🔐 2단계: 로그인

터미널에서 다음 명령어 실행:

```bash
npx vsce login justin-lee
```

PAT 입력 프롬프트가 나오면 생성한 토큰을 붙여넣기

## 🚀 3단계: 배포

### 방법 1: publish.bat 사용 (추천)

```bash
.\publish.bat
```

대화형 메뉴에서 선택:
- `1`: Patch 버전 (0.4.8 → 0.4.9)
- `2`: Minor 버전 (0.4.8 → 0.5.0)
- `3`: Major 버전 (0.4.8 → 1.0.0)
- `4`: 특정 버전 지정

### 방법 2: npm 스크립트 사용

```bash
# Patch 버전 배포 (0.4.8 → 0.4.9)
npm run publish:patch

# Minor 버전 배포 (0.4.8 → 0.5.0)
npm run publish:minor

# Major 버전 배포 (0.4.8 → 1.0.0)
npm run publish:major
```

### 방법 3: 직접 명령어 사용

```bash
# 빌드
npm run build:full

# 배포
npx vsce publish patch
# 또는
npx vsce publish 0.4.9
```

## ✅ 4단계: 배포 확인

1. **Marketplace 확인**
   - https://marketplace.visualstudio.com/items?itemName=justin-lee.axon
   - 업데이트가 반영되기까지 5-10분 소요

2. **관리 페이지 확인**
   - https://marketplace.visualstudio.com/manage/publishers/justin-lee

## 📌 5단계: Git 태그 생성 (선택사항)

배포 후 버전 태그 생성:

```bash
# 새 버전 확인
git status

# 변경사항 커밋
git add package.json package-lock.json
git commit -m "chore: Bump version to 0.4.9"

# 태그 생성
git tag v0.4.9

# 푸시
git push origin 2025-last
git push origin v0.4.9
```

## 🔄 업데이트 배포 프로세스

### 일반적인 업데이트 워크플로우

1. **코드 변경 및 테스트**
   ```bash
   npm run build
   # 로컬에서 테스트
   ```

2. **변경사항 커밋**
   ```bash
   git add .
   git commit -m "feat: Add new feature"
   git push
   ```

3. **배포**
   ```bash
   .\publish.bat
   # 또는
   npm run publish:patch
   ```

4. **Git 태그 생성**
   ```bash
   git tag v0.4.9
   git push origin v0.4.9
   ```

## 🛠️ 문제 해결

### PAT 인증 실패

```
ERROR: The Personal Access Token verification has failed
```

**해결 방법:**
1. PAT이 만료되었는지 확인
2. Marketplace - Manage 권한이 있는지 확인
3. 새 PAT 생성 후 다시 로그인

### 버전 충돌

```
ERROR: Extension 'justin-lee.axon' version 0.4.8 already exists
```

**해결 방법:**
- 버전을 증가시켜야 함
- `npm run publish:patch` 사용 (자동 증가)

### 빌드 실패

```
ERROR: Compilation failed
```

**해결 방법:**
```bash
# 클린 빌드
rm -rf out node_modules
npm install
npm run build:full
```

## 📊 배포 체크리스트

배포 전 확인사항:

- [ ] 모든 기능이 정상 작동하는지 테스트
- [ ] README.md가 최신 상태인지 확인
- [ ] CHANGELOG 업데이트 (있는 경우)
- [ ] package.json의 description이 명확한지 확인
- [ ] 아이콘 파일이 포함되어 있는지 확인
- [ ] 불필요한 파일이 .vscodeignore에 포함되었는지 확인
- [ ] 빌드가 성공하는지 확인 (`npm run build:full`)
- [ ] Git 변경사항이 모두 커밋되었는지 확인

## 🔗 유용한 링크

- **Marketplace 관리**: https://marketplace.visualstudio.com/manage/publishers/justin-lee
- **Extension 페이지**: https://marketplace.visualstudio.com/items?itemName=justin-lee.axon
- **Azure DevOps**: https://dev.azure.com
- **vsce 문서**: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

## 💡 팁

1. **자동 버전 관리**: `publish:patch`, `publish:minor`, `publish:major` 사용
2. **테스트 배포**: 먼저 `npm run build:full`로 로컬 테스트
3. **버전 전략**: 
   - Patch (0.0.x): 버그 수정
   - Minor (0.x.0): 새 기능 추가
   - Major (x.0.0): Breaking changes
4. **배포 주기**: 안정적인 기능이 완성되면 배포
5. **문서 업데이트**: 배포 전 README.md 업데이트 필수

