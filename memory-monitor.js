// memory-monitor.js
// 서버 메모리 사용량을 1분마다 로그로 남겨서, OOM(메모리 초과)으로 죽기 전
// 메모리가 어떻게 올라가는지 Render 로그에서 확인할 수 있게 해줍니다.

function startMemoryMonitor(intervalMs = 60000) {
  setInterval(() => {
    const used = process.memoryUsage();
    const rss = Math.round(used.rss / 1024 / 1024);        // 실제 점유 메모리
    const heapUsed = Math.round(used.heapUsed / 1024 / 1024); // JS 힙 사용량
    const heapTotal = Math.round(used.heapTotal / 1024 / 1024);

    console.log(
      `[메모리 체크] RSS: ${rss}MB / Heap: ${heapUsed}MB / HeapTotal: ${heapTotal}MB`
    );

    // Render 무료 플랜 한도(512MB)에 가까워지면 경고 로그
    if (rss > 400) {
      console.warn(`[메모리 경고] RSS가 ${rss}MB로 위험 수준입니다 (한도 512MB)`);
    }
  }, intervalMs);
}

module.exports = { startMemoryMonitor };
