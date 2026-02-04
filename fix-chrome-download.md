# Chrome 다운로드 문제 해결 방법

## 🔍 증상
- Suno.com, Google Drive 등 모든 사이트에서 다운로드 안 됨
- 다운로드 버튼 클릭해도 파일이 저장되지 않음

## 💡 해결 방법

### 방법 1: Chrome 다운로드 설정 확인

1. Chrome 주소창에 입력:
   ```
   chrome://settings/downloads
   ```

2. 확인할 항목:
   - ✅ **위치:** Downloads 폴더가 제대로 설정되어 있는지
   - ✅ **다운로드 전 저장 위치 묻기:** 이 옵션 끄기 (자동 다운로드)
   - ✅ 폴더 접근 권한이 있는지

3. 다운로드 폴더 변경:
   - "변경" 버튼 클릭
   - `C:\Users\tweve\Downloads` 선택
   - 또는 새 폴더 생성: `D:\Downloads`

### 방법 2: Chrome 플래그 확인

1. Chrome 주소창에 입력:
   ```
   chrome://flags
   ```

2. 검색: `download`

3. 확인할 플래그:
   - `Enable download bubble` → Disabled로 설정
   - `Parallel downloading` → Enabled로 설정

4. Chrome 재시작

### 방법 3: 새 Chrome 프로필 생성

현재 프로필이 손상되었을 가능성:

1. Chrome 주소창에 입력:
   ```
   chrome://settings/manageProfile
   ```

2. "다른 사용자 추가" 클릭

3. 새 프로필에서 다운로드 테스트

### 방법 4: Downloads 폴더 권한 확인

1. 파일 탐색기에서 `C:\Users\tweve\Downloads` 우클릭

2. 속성 → 보안 탭

3. "편집" 클릭

4. 본인 계정에 "전체 제어" 권한 부여

### 방법 5: Chrome 캐시 삭제

1. Chrome 주소창에 입력:
   ```
   chrome://settings/clearBrowserData
   ```

2. 시간 범위: "전체 기간"

3. 체크 항목:
   - ✅ 캐시된 이미지 및 파일
   - ✅ 쿠키 및 기타 사이트 데이터

4. "데이터 삭제" 클릭

### 방법 6: 확장 프로그램 비활성화 테스트

1. Chrome 주소창에 입력:
   ```
   chrome://extensions
   ```

2. 모든 확장 프로그램 일시적으로 끄기

3. 다운로드 테스트

4. 문제 없으면 하나씩 켜가며 원인 찾기

### 방법 7: 레지스트리 확인 (고급)

Windows 레지스트리에서 Chrome 다운로드 정책 확인:

```
regedit → HKEY_CURRENT_USER\Software\Policies\Google\Chrome
```

- `DownloadDirectory` 값 확인
- `DownloadRestrictions` 값이 3 (모두 차단)인지 확인

### 방법 8: 다른 브라우저 테스트

1. Edge 또는 Firefox에서 다운로드 테스트
2. 정상 작동하면 Chrome 재설치 고려

## 🚀 빠른 테스트 명령어

PowerShell에서 실행:

```powershell
# Downloads 폴더 권한 확인
icacls "C:\Users\tweve\Downloads"

# 새 Downloads 폴더 생성 및 테스트
New-Item -Path "D:\TestDownloads" -ItemType Directory -Force
```

## 🔧 임시 우회 방법 (Suno.com용)

Chrome 콘솔에서 직접 실행:

```javascript
// Blob URL을 Base64로 변환 후 복사
async function downloadBlobAsBase64() {
  const links = document.querySelectorAll('a[href^="blob:"]');
  if (!links.length) {
    console.log('No blob URLs found. Click "Download File" first.');
    return;
  }
  
  const blobUrl = links[0].href;
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  
  // Blob을 Base64로 변환
  const reader = new FileReader();
  reader.onloadend = function() {
    const base64 = reader.result;
    console.log('Base64 data (copy this):');
    console.log(base64);
    
    // 클립보드에 복사
    navigator.clipboard.writeText(base64);
    alert('Base64 데이터가 클립보드에 복사되었습니다!');
  };
  reader.readAsDataURL(blob);
}

downloadBlobAsBase64();
```

그 다음:
1. Base64 데이터를 복사
2. https://base64.guru/converter/decode/audio 접속
3. 붙여넣기 → WAV 파일로 변환

---

## ✅ 추천 순서

1. **방법 1** (설정 확인) → 가장 간단
2. **방법 4** (폴더 권한) → 자주 발생하는 문제
3. **방법 3** (새 프로필) → 프로필 손상 시
4. **방법 8** (다른 브라우저) → Chrome 문제 확인
