// Suno.com 콘솔에서 직접 실행할 테스트 스크립트
// F12 → Console에 붙여넣기

(async function testBlobDownload() {
  console.log('🎵 Starting Blob URL capture test...');
  
  // 1. Download File 버튼 찾기
  const buttons = Array.from(document.querySelectorAll('button'));
  const downloadBtn = buttons.find(b => 
    b.textContent?.includes('Download File') && !b.disabled
  );
  
  if (!downloadBtn) {
    console.error('❌ Download File button not found or disabled');
    console.log('Available buttons:', buttons.map(b => b.textContent?.trim()).filter(Boolean));
    return;
  }
  
  console.log('✅ Found Download File button');
  
  // 2. Blob URL 캡처 설정
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeName === 'A') {
          const anchor = node;
          if (anchor.href && anchor.href.startsWith('blob:')) {
            console.log('🔗 Blob URL detected:', anchor.href);
            console.log('📁 Download attribute:', anchor.download);
            
            // Blob을 실제 파일로 변환
            fetch(anchor.href)
              .then(res => res.blob())
              .then(blob => {
                console.log('📦 Blob size:', blob.size, 'bytes');
                console.log('📦 Blob type:', blob.type);
                
                // Object URL 생성
                const objectUrl = URL.createObjectURL(blob);
                console.log('✅ Object URL created:', objectUrl);
                
                // 다운로드 트리거
                const a = document.createElement('a');
                a.href = objectUrl;
                a.download = anchor.download || 'test-suno.wav';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                
                console.log('✅ Download triggered!');
                
                setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
              })
              .catch(err => {
                console.error('❌ Blob fetch failed:', err);
              });
            
            observer.disconnect();
          }
        }
      }
    }
  });
  
  // 3. 감시 시작
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  console.log('👀 Watching for Blob URLs...');
  
  // 4. Download File 버튼 클릭
  downloadBtn.click();
  console.log('🖱️ Clicked Download File button');
  
  // 5. 타임아웃
  setTimeout(() => {
    observer.disconnect();
    console.log('⏱️ Timeout - no Blob URL detected');
  }, 10000);
})();
