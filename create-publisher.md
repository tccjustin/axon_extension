# Publisher 생성 가이드

## 🆕 새 Publisher 생성 방법

### 1. Marketplace에서 생성

1. https://marketplace.visualstudio.com/manage 접속
2. **Create publisher** 버튼 클릭
3. 정보 입력:
   ```
   Publisher ID: justinlee-tcc (또는 원하는 ID)
   Publisher name: Justin Lee
   Email: (본인 이메일)
   ```
4. **Create** 클릭

### 2. 명령어로 생성

```bash
npx @vscode/vsce create-publisher justinlee-tcc
```

프롬프트에 따라 정보 입력

## 🔄 기존 Publisher 사용

만약 다른 publisher ID를 이미 가지고 있다면:

1. https://marketplace.visualstudio.com/manage 에서 확인
2. 실제 publisher ID를 package.json에 반영

```json
{
  "publisher": "실제-publisher-id"
}
```

## 💡 문제 해결

### Publisher가 다른 조직에 속한 경우

만약 `justinlee-tcc`가 다른 Azure DevOps 조직에 속해 있다면:

**옵션 1: 해당 조직의 토큰 사용**
- 해당 조직에서 PAT 생성
- Full access 권한으로 생성

**옵션 2: 새 Publisher 생성**
- 본인 계정으로 새 publisher 생성
- 다른 ID 사용 (예: `jhlee17-tcc`, `justinlee-dev` 등)

**옵션 3: Publisher 이전**
- 기존 publisher의 소유자에게 권한 요청
- 또는 publisher를 본인 조직으로 이전

