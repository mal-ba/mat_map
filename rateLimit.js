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

// ── 로그인 시도 제한 ──
// 같은 IP가 15분 동안 10번 넘게 로그인을 실패해도 시도하면 차단.
// 비밀번호 무차별 대입(brute force)을 막기 위한 용도라, generalLimiter보다 훨씬 빡빡함.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.' },
});

// ── 이메일 인증코드 발송 제한 ──
// 같은 IP가 1시간 동안 5번 넘게 인증코드 발송을 요청하면 차단.
// 다른 사람 이메일로 스팸성 인증코드를 계속 보내는 걸 막기 위함.
const sendCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '인증코드 요청이 너무 많습니다. 1시간 후 다시 시도해주세요.' },
});

// ── 이메일 인증코드 확인(대입) 제한 ──
// 6자리 코드(10만~99만9999 = 최대 90만 가지)를 무차별 대입하는 걸 막기 위해
// 같은 IP가 10분(코드 유효시간과 동일) 동안 15번 넘게 틀리면 차단.
const verifyCodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10분
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '인증코드 확인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

module.exports = { generalLimiter, writeLimiter, loginLimiter, sendCodeLimiter, verifyCodeLimiter };
