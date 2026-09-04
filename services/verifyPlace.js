const axios = require('axios');

/**
 * 검증 흐름:
 * 1) 카카오 로컬 검색 → 있으면 AI 최종 판단
 * 2) 카카오 없으면 → 구글 Places 검색 → 있으면 AI 최종 판단
 * 3) 둘 다 없으면 → pending (수동 검토)
 */
async function verifyPlace({ name, address, lat, lng }) {

  // ── 1차: 카카오 검색 ──────────────────────────────────────
  const kakaoResult = await searchKakaoPlace(name, lat, lng);

  if (kakaoResult) {
    if (kakaoResult.distanceMeters > 500) {
      return {
        status: 'rejected',
        reason: `등록 위치와 실제 업체(${kakaoResult.place_name}) 간 거리가 ${Math.round(kakaoResult.distanceMeters)}m로 너무 멉니다.`,
        kakao_place_id: kakaoResult.id,
      };
    }

    const aiVerdict = await aiDoubleCheck({
      name, address,
      foundName: kakaoResult.place_name,
      category: kakaoResult.category_name,
      source: '카카오',
    });

    return {
      status: aiVerdict.approve ? 'verified' : 'rejected',
      reason: aiVerdict.reason,
      kakao_place_id: kakaoResult.id,
    };
  }

  // ── 2차: 구글 Places 검색 (카카오 미등록 시) ──────────────
  console.log(`[verifyPlace] 카카오 미등록, 구글 Places 검색 시도: ${name}`);
  const googleResult = await searchGooglePlace(name, lat, lng);

  if (googleResult) {
    const aiVerdict = await aiDoubleCheck({
      name, address,
      foundName: googleResult.place_name,
      category: googleResult.category_name,
      source: '구글',
    });

    return {
      status: aiVerdict.approve ? 'verified' : 'pending',
      reason: `카카오 미등록 / 구글 확인: ${aiVerdict.reason}`,
    };
  }

  // ── 3차: 둘 다 못 찾음 → pending (수동 검토) ──────────────
  console.log(`[verifyPlace] 카카오·구글 모두 미등록: ${name}`);
  return {
    status: 'pending',
    reason: '카카오·구글 지도 모두에서 확인되지 않았습니다. 검토 후 공개됩니다.',
  };
}

// ── 카카오 키워드 검색 ────────────────────────────────────────
async function searchKakaoPlace(name, lat, lng) {
  if (!process.env.KAKAO_REST_API_KEY) return mockSearch(name);

  try {
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
  } catch (err) {
    console.error('[searchKakaoPlace] 오류:', err.message);
    return null;
  }
}

// ── 구글 Places 근처 검색 ─────────────────────────────────────
async function searchGooglePlace(name, lat, lng) {
  if (!process.env.GOOGLE_PLACES_API_KEY) return null;

  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
      params: {
        keyword: name,
        location: `${lat},${lng}`,
        radius: 1000,
        language: 'ko',
        key: process.env.GOOGLE_PLACES_API_KEY,
      },
    });

    const place = res.data?.results?.[0];
    if (!place) return null;

    // 거리 체크 (구글은 distance를 직접 안 줘서 계산)
    const dist = getDistanceMeters(lat, lng,
      place.geometry.location.lat,
      place.geometry.location.lng
    );

    if (dist > 1000) return null;

    return {
      place_name: place.name,
      category_name: place.types?.[0]?.replace(/_/g, ' ') || '',
    };
  } catch (err) {
    console.error('[searchGooglePlace] 오류:', err.message);
    return null;
  }
}

// ── 두 좌표 사이 거리 계산 (미터) ────────────────────────────
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── AI 최종 판단 ──────────────────────────────────────────────
async function aiDoubleCheck({ name, address, foundName, category, source }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { approve: true, reason: `${source} 존재 확인으로 자동 승인 (AI 키 미설정)` };
  }

  const prompt = `다음 장소가 실제로 존재하는 신뢰할 만한 음식점인지 판단해줘.
등록된 이름: ${name}
등록된 주소: ${address}
${source}맵 매칭 이름: ${foundName}
${source}맵 카테고리: ${category}

이름이 서로 명백히 다른 업종이거나 완전히 다른 상호면 반려.
JSON으로만 답해: {"approve": true|false, "reason": "한 문장 이유"}`;

  try {
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
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('[aiDoubleCheck] 오류:', err.message);
    return { approve: true, reason: 'AI 응답 오류로 기본 승인 처리' };
  }
}

function mockSearch(name) {
  return { place_name: name, category_name: '음식점', id: 'mock-id', distanceMeters: 0 };
}

module.exports = { verifyPlace };
