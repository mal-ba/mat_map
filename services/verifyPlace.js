const axios = require('axios');

/**
 * 검증 흐름:
 * 카카오 + 네이버 + 구글 세 곳 동시 검색
 * → 하나라도 찾으면 AI 최종 판단 → verified
 * → 셋 다 못 찾으면 → pending (수동 검토)
 */
async function verifyPlace({ name, address, lat, lng }) {
  // 세 곳 병렬 검색
  const [kakaoResult, naverResult, googleResult] = await Promise.all([
    searchKakaoPlace(name, lat, lng),
    searchNaverPlace(name, lat, lng),
    searchGooglePlace(name, lat, lng),
  ]);

  const sources = [
    kakaoResult && '카카오',
    naverResult && '네이버',
    googleResult && '구글',
  ].filter(Boolean);

  console.log(`[verifyPlace] "${name}" — ${sources.length ? sources.join('·') + ' 발견' : '세 곳 모두 미등록'}`);

  // 셋 다 못 찾으면 pending
  if (!sources.length) {
    return {
      status: 'pending',
      reason: '카카오·네이버·구글 어디에서도 확인되지 않았습니다. 검토 후 공개됩니다.',
    };
  }

  // 거리 체크: 찾은 것 중 가장 가까운 결과 기준
  const found = [kakaoResult, naverResult, googleResult].find(r => r && r.distanceMeters <= 500);
  const tooFar = [kakaoResult, naverResult, googleResult].find(r => r);

  if (!found) {
    return {
      status: 'rejected',
      reason: `등록 위치와 실제 업체 사이 거리가 ${Math.round(tooFar.distanceMeters)}m로 너무 멉니다. (${sources.join('·')} 발견)`,
      kakao_place_id: kakaoResult?.id,
    };
  }

  // AI 최종 판단
  const aiVerdict = await aiDoubleCheck({
    name, address,
    foundName: found.place_name,
    category: found.category_name,
    source: sources.join('·'),
  });

  return {
    status: aiVerdict.approve ? 'verified' : 'rejected',
    reason: `${sources.join('·')} 확인 / ${aiVerdict.reason}`,
    kakao_place_id: kakaoResult?.id,
  };
}

// ── 카카오 키워드 검색 ─────────────────────────────────────────
async function searchKakaoPlace(name, lat, lng) {
  if (!process.env.KAKAO_REST_API_KEY) return null;
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
    console.error('[searchKakaoPlace]', err.message);
    return null;
  }
}

// ── 네이버 지역 검색 ───────────────────────────────────────────
// developers.naver.com 에서 발급 (일반 네이버 계정으로 가능)
// 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
async function searchNaverPlace(name, lat, lng) {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) return null;
  try {
    const res = await axios.get('https://openapi.naver.com/v1/search/local.json', {
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      },
      params: { query: name, display: 5 },
    });

    const items = res.data?.items;
    if (!items?.length) return null;

    // mapx/mapy → WGS84 변환 (네이버는 1e7 곱해진 정수로 줌)
    for (const item of items) {
      const placeLat = item.mapy / 1e7;
      const placeLng = item.mapx / 1e7;
      const dist = getDistanceMeters(lat, lng, placeLat, placeLng);
      if (dist <= 1000) {
        return {
          place_name: item.title.replace(/<[^>]+>/g, ''), // HTML 태그 제거
          category_name: item.category || '',
          distanceMeters: dist,
        };
      }
    }
    return null;
  } catch (err) {
    console.error('[searchNaverPlace]', err.message);
    return null;
  }
}

// ── 구글 Places 근처 검색 ──────────────────────────────────────
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

    const dist = getDistanceMeters(lat, lng,
      place.geometry.location.lat,
      place.geometry.location.lng
    );
    if (dist > 1000) return null;

    return {
      place_name: place.name,
      category_name: place.types?.[0]?.replace(/_/g, ' ') || '',
      distanceMeters: dist,
    };
  } catch (err) {
    console.error('[searchGooglePlace]', err.message);
    return null;
  }
}

// ── 거리 계산 (미터) ───────────────────────────────────────────
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── AI 최종 판단 ───────────────────────────────────────────────
async function aiDoubleCheck({ name, address, foundName, category, source }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { approve: true, reason: `${source} 확인으로 자동 승인 (AI 키 미설정)` };
  }
  const prompt = `다음 장소가 실제로 존재하는 신뢰할 만한 음식점/카페인지 판단해줘.
등록된 이름: ${name}
등록된 주소: ${address}
지도 매칭 이름(${source}): ${foundName}
카테고리: ${category}

이름이 명백히 다른 업종이거나 완전히 다른 상호면 반려. 아닌 경우 통과.
JSON으로만 답해: {"approve": true|false, "reason": "한 문장 이유"}`;
  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-6', max_tokens: 200, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );
    const text = res.data.content.map(b => b.text || '').join('');
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (err) {
    console.error('[aiDoubleCheck]', err.message);
    return { approve: true, reason: 'AI 오류로 기본 승인' };
  }
}

module.exports = { verifyPlace };
