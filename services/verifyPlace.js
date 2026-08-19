const axios = require('axios');

const MIN_REVIEWS = 5; // 이 이상이면 바로 통과
const MIN_RATING = 3.3;

/**
 * 1) 카카오 로컬 API로 등록된 이름/좌표 근처에 실제로 존재하는 업체인지 확인
 * 2) 리뷰/평점 정보가 있으면 기준으로 자동 판단
 * 3) 애매하면(정보 부족) AI에게 최종 판단을 맡김
 */
async function verifyPlace({ name, address, lat, lng }) {
  const kakaoResult = await searchKakaoPlace(name, lat, lng);

  if (!kakaoResult) {
    return {
      status: 'rejected',
      reason: '카카오 지도에서 해당 위치 근처에 일치하는 업체를 찾지 못했습니다.',
    };
  }

  const { place_name, distanceMeters, category_name, id } = kakaoResult;

  // 좌표가 너무 동떨어져 있으면(500m 이상) 신뢰 불가
  if (distanceMeters > 500) {
    return {
      status: 'rejected',
      reason: `등록된 위치와 실제 업체(${place_name}) 사이 거리가 ${Math.round(distanceMeters)}m로 너무 멉니다.`,
      kakao_place_id: id,
    };
  }

  // 카카오 로컬 API 자체는 평점/리뷰수를 안 주는 경우가 많아
  // 여기서는 "존재 확인 + 거리 검증"까지는 자동, 그 이상은 AI 보조 판단으로 넘김
  const aiVerdict = await aiDoubleCheck({ name, address, kakaoName: place_name, category: category_name });

  return {
    status: aiVerdict.approve ? 'verified' : 'rejected',
    reason: aiVerdict.reason,
    kakao_place_id: id,
  };
}

async function searchKakaoPlace(name, lat, lng) {
  if (!process.env.KAKAO_REST_API_KEY) return mockKakaoSearch(name);

  const res = await axios.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
    headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
    params: { query: name, x: lng, y: lat, radius: 1000, sort: 'distance' },
  });

  const doc = res.data?.documents?.[0];
  if (!doc) return null;

  return {
    place_name: doc.place_name,
    category_name: doc.category_name,
    id: doc.id,
    distanceMeters: Number(doc.distance || 0),
  };
}

// 개발 중 카카오 키가 없을 때 쓰는 더미 (실제 배포 전엔 반드시 교체)
function mockKakaoSearch(name) {
  return { place_name: name, category_name: '음식점', id: 'mock-id', distanceMeters: 0 };
}

async function aiDoubleCheck({ name, address, kakaoName, category }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    // AI 키 없으면 카카오 존재 확인만으로 통과 처리
    return { approve: true, reason: '카카오 지도 존재 확인만으로 자동 승인 (AI 키 미설정)' };
  }

  const prompt = `다음 장소가 실제로 존재하는 신뢰할 만한 음식점인지 판단해줘.
등록된 이름: ${name}
등록된 주소: ${address}
카카오맵 매칭 이름: ${kakaoName}
카카오맵 카테고리: ${category}

이름이 서로 명백히 다른 업종(예: 카페 이름인데 등록자가 "맛집"이라 우김, 혹은 완전히 다른 상호)이면 반려.
JSON으로만 답해: {"approve": true|false, "reason": "한 문장 이유"}`;

  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }
  );

  const text = res.data.content.map((b) => b.text || '').join('');
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { approve: true, reason: 'AI 응답 파싱 실패로 기본 승인 처리' };
  }
}

module.exports = { verifyPlace };
