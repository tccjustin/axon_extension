# 🔑 Personal Access Token (PAT) 생성 가이드

## ⚠️ Marketplace 권한이 안 보이는 경우

Azure DevOps에서 Marketplace 옵션이 안 보이는 경우가 있습니다.

## ✅ 해결 방법 (추천 순서)

### 방법 1: Full Access 사용 (가장 쉬움) ⭐

1. https://dev.azure.com 접속
2. 우측 상단 **사용자 아이콘** 클릭
3. **Personal access tokens** 선택
4. **+ New Token** 클릭
5. 설정:
   ```
   Name: VSCode Marketplace
   Organization: All accessible organizations
   Expiration: 90 days (또는 원하는 기간)
   
   Scopes: Full access  ← 라디오 버튼 선택!
   ```
6. **Create** 클릭
7. 생성된 토큰 복사 (다시 볼 수 없음!)

### 방법 2: Show all scopes 사용

1. https://dev.azure.com 접속
2. Personal access tokens → New Token
3. Scopes: **Custom defined** 선택
4. **"Show all scopes"** 링크 클릭 (맨 아래)
5. 스크롤해서 **Marketplace** 섹션 찾기
6. 다음 체크:
   - ✅ Marketplace (Acquire)
   - ✅ Marketplace (Manage)
   - ✅ Marketplace (Publish)
7. Create 클릭

### 방법 3: Visual Studio Marketplace에서 직접 생성

1. https://marketplace.visualstudio.com/manage 접속
2. 로그인
3. 우측 상단 **Create publisher** 또는 기존 publisher 선택
4. **Get a Personal Access Token** 링크 클릭
5. Azure DevOps로 리다이렉트됨
6. 토큰 생성

## 🔍 Publisher 확인

배포하기 전에 정확한 publisher 이름을 확인하세요:

1. https://marketplace.visualstudio.com/manage 접속
2. 본인의 publisher 목록 확인
3. publisher ID 확인 (예: `justinlee-tcc`, `justin-lee` 등)

## 📝 토큰 생성 후 할 일

### 1. 로그인 테스트

```bash
npx vsce login [YOUR-PUBLISHER-ID]
```

프롬프트가 나오면 생성한 PAT 붙여넣기

### 2. 로그인 성공 확인

```
Personal Access Token for publisher '[YOUR-PUBLISHER-ID]': 
The Personal Access Token verification succeeded for the publisher '[YOUR-PUBLISHER-ID]'.
```

이 메시지가 나오면 성공!

### 3. 배포

```bash
# 방법 1: 스크립트 사용
.\publish.bat

# 방법 2: npm 명령어
npm run publish:patch

# 방법 3: 직접 명령어
npx vsce publish patch
```

## ❌ 자주 발생하는 오류

### 오류 1: TF400813 권한 오류

```
ERROR: TF400813: The user is not authorized to access this resource.
```

**원인:**
- PAT에 Marketplace 권한이 없음
- 만료된 토큰

**해결:**
- Full access로 새 토큰 생성
- 또는 Marketplace (Manage) 권한 확인

### 오류 2: Publisher not found

```
ERROR: Publisher 'xxx' not found
```

**원인:**
- Publisher ID가 잘못됨

**해결:**
- https://marketplace.visualstudio.com/manage 에서 정확한 ID 확인

### 오류 3: 버전 충돌

```
ERROR: Extension version already exists
```

**원인:**
- 같은 버전이 이미 배포됨

**해결:**
- 버전 번호 증가 필요
- `npm run publish:patch` 사용 (자동 증가)

## 💡 팁

1. **Full access 토큰 사용**: 가장 확실하고 간단함
2. **토큰 저장**: 안전한 곳에 보관 (비밀번호 관리자 추천)
3. **만료 기간**: 90일 설정 후 만료 전 갱신
4. **여러 토큰**: 용도별로 여러 개 생성 가능

## 🔗 유용한 링크

- **Azure DevOps**: https://dev.azure.com
- **Marketplace 관리**: https://marketplace.visualstudio.com/manage
- **vsce 문서**: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- **PAT 문서**: https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate

