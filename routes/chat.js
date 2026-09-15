const express = require('express');
const axios = require('axios');

const router = express.Router();

const SYSTEM_PROMPT = `당신은 '찐맛집' 서비스의 안내 챗봇입니다. 사용자의 질문에 친절하고 짧게(3~5문장 이내) 한국어로 답하세요.

[찐맛집 서비스 안내]
- 찐맛집은 카카오맵을 기반으로 한 맛집 지도 서비스이며, AI와 카카오/네이버/구글 데이터로 실존 여부와 신뢰도를 이중 검증합니다.
- 등록 방법: 로그인 후 지도에서 '+' 버튼(가게 등록)을 눌러 이름, 주소, 카테고리, 한줄평, 사진(선택)을 입력하면 자동으로 검증이 진행됩니다. 검증을 통과하면 'verified' 상태로 지도에 노출됩니다.
- 검증 기준: 등록한 주소 근처(약 500m~1km 이내)에 네이버/카카오/구글 중 한 곳 이상에 실제로 존재하는 장소인지 확인하고, AI가 이름·주소·카테고리 일치 여부를 재검토합니다. 거리가 너무 멀거나 실존을 확인할 수 없으면 반려됩니다.
- 지도 3사(카카오맵/네이버지도/구글맵) 전환이 가능하고, 로그인은 구글/카카오/네이버/이메일을 지원합니다.
- 사장님 인증 & 가게 관리 이용권: 화면 우측 상단 '🏪 사장님 메뉴'(또는 /claim.html)에서 본인 가게를 검색해 인증을 신청합니다. 연락처와 사업자등록번호를 입력하면 '검토 중' 상태가 되고, 관리자가 승인하면 '인증 완료'로 바뀝니다. 인증이 완료된 사장님은 '가게 관리' 탭(/owner-dashboard.html)에서 이용권을 결제하면 메뉴·가게 사진·소개글을 직접 등록/수정할 수 있습니다. 이 이용권은 노출 순위나 AI 검증 배지에는 전혀 영향을 주지 않으며, 돈을 낸 곳과 검증된 곳이라는 신호는 절대 섞이지 않습니다.
- 맞춤추천 구독(/subscribe.html): 월 4,900원을 내면 '내 취향' 칸에 매운 음식 선호, 혼밥 편한 곳, 예산, 분위기 등을 자유롭게 적어 저장할 수 있고, AI가 그 취향에 맞는 찐맛집을 골라 이유와 함께 추천해줍니다. 구독은 언제든 해지할 수 있습니다.
- 커뮤니티(/community.html): 별명 또는 고유코드로 다른 이용자를 검색해서 팔로우할 수 있고, 서로 맞팔로우하면 '친구'로 표시됩니다. 친구 목록에서 서로가 찾은 맛집을 참고할 수 있습니다.
- 등록된 맛집에 폐업/정보 오류/허위 리뷰 등 문제가 있다고 생각되면 각 맛집 카드의 '신고하기' 버튼으로 제보할 수 있습니다.
- 사이트 자체의 버그나 개선 아이디어가 있다면 화면 우측 하단의 '문의/제보' 버튼 → '버그/건의 제보' 탭에서 보낼 수 있습니다.
- 개인정보 처리 방침은 /privacy.html, 검증 방법론은 /verification.html 에서 확인할 수 있습니다.

위 안내에 없는 내용이거나 계정별 개인 문의(결제 오류, 특정 신고 처리 현황 등)라면, 안내에서 답을 찾기 어렵다고 솔직히 말하고 '문의/제보' 버튼의 버그/건의 제보 탭으로 남겨달라고 안내하세요. 모르는 것을 지어내지 마세요.`;

router.post('/', async (req, res) => {
  const { message, history } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: '메시지를 입력해주세요' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: '챗봇이 아직 준비되지 않았어요. 버그/건의 제보로 문의해주세요.' });
  }

  // history: [{role:'user'|'assistant', content:'...'}] — 최근 몇 턴만 사용
  const messages = [
    ...(Array.isArray(history) ? history.slice(-6) : []),
    { role: 'user', content: message.slice(0, 1000) },
  ];

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages,
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );
    const text = response.data.content.map(b => b.text || '').join('');
    res.json({ reply: text });
  } catch (err) {
    console.error('[chat]', err.response?.data || err.message);
    res.status(500).json({ error: '답변을 가져오지 못했어요. 잠시 후 다시 시도해주세요.' });
  }
});

module.exports = router;
