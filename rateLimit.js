const rateLimit = require('express-rate-limit');

// ── 일반 API 요청 제한 ──
// 같은 IP가 15분 동안 300번 넘게 /api/* 를 두드리면 차단.
// 지도 이동/검색은 요청이 잦을 수 있어 넉넉하게 잡음.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

// ── 민감한 쓰기 작업 제한 (가게 등록, 관리자 강제 등록 등) ──
// 검증 로직을 무한 반복 요청으로 역추적(블랙박스 분석)하는 걸 막기 위해 훨씬 빡빡하게 잡음.
const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '단시간에 너무 많은 등록 요청이 감지되었습니다. 1시간 후 다시 시도해주세요.' },
});

module.exports = { generalLimiter, writeLimiter };
