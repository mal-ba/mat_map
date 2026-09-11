const axios = require('axios');
const { fetchNaverPlaceDetail, fetchNaverReviewsAndPhotos, findNaverPlaceId } = require('./naverPlaceScraper');

/**
 * 검증 흐름: 네이버 → 카카오 → 구글 (병렬)
 * 하나라도 찾으면 AI 최종 판단 → verified
 * 셋 다 못 찾으면 → pending
 * + 네이버에서 잡힌 경우, 평점/리뷰/사진까지 가져와 AI가 리뷰 신뢰도를 별도로 분석
 */
async function verifyPlace({ name, address, lat, lng }) {
  const [naverResult, kakaoResult, googleResult] = await Promise.all([
    searchNaverPlace(name, lat, lng),
    searchKakaoPlace(name, lat, lng),
    searchGooglePlace(name, lat, lng),
  ]);

  const sources = [
    naverResult && '네이버',
    kakaoResult && '카카오',
    googleResult && '구글',
  ].filter(Boolean);

  console.log(`[verifyPlace] "${name}" — ${sources.length ? sources.join('·') + ' 발견' : '세 곳 모두 미등록'}`);

  if (!sources.length) {
    // 이름 키워드 검색으로는 못 찾았지만, 등록 위치(좌표) 근처에 동일한 상호가 실제로 있는지 마지막으로 대조
    // (신규 오픈처럼 아직 키워드 검색엔 안 잡혀도, 그 자리 자체엔 업체가 등록돼 있는 경우를 구제)
    const nearby = await searchNearbyPlaceNames(lat, lng, 50);
    const addressMatch = nearby.find(p => namesMatch(p.place_name, name));
    if (addressMatch) {
      return {
        status: 'verified',
        reason: `이름 검색으로는 못 찾았지만, 등록 위치 근처(${Math.round(addressMatch.distanceMeters)}m)에 동일한 상호 "${addressMatch.place_name}"가 확인되어 승인되었습니다.`,
        kakao_place_id: addressMatch.id,
      };
    }
    return {
      status: 'pending',
      reason: '네이버·카카오·구글 어디에서도 확인되지 않았습니다. 검토 후 공개됩니다.',
    };
  }

  const found = [naverResult, kakaoResult, googleResult].find(r => r && r.distanceMeters <= 500);
  const tooFar = [naverResult, kakaoResult, googleResult].find(r => r);

  if (!found) {
    return {
      status: 'rejected',
      reason: `등록 위치와 실제 업체 사이 거리가 ${Math.round(tooFar.distanceMeters)}m로 너무 멉니다. (${sources.join('·')} 발견)`,
      naver_place_id: naverResult?.id,
      kakao_place_id: kakaoResult?.id,
    };
  }

  const aiVerdict = await aiDoubleCheck({
    name, address,
    foundName: found.place_name,
    category: found.category_name,
    source: sources.join('·'),
  });

  // 네이버에서 잡힌 경우, 평점/리뷰/사진을 가져와 AI 리뷰 신뢰도 분석 + 평점 게이트 적용
  let naverExtra = {};
  // 리뷰가 있는데 4점 이상 비율이 50% 미만이면 반려 — 리뷰가 아예 없으면(신규 오픈 등) 이 기준을 적용하지 않음
  let ratingGate = { passed: true, reason: '' };

  if (naverResult) {
    naverResult.id = await findNaverPlaceId(naverResult.place_name || name, lat, lng);
  }

  if (naverResult?.id) {
    const [detail, content] = await Promise.all([
      fetchNaverPlaceDetail(naverResult.id),
      fetchNaverReviewsAndPhotos(naverResult.id),
    ]);
    const contentAnalysis = await analyzeNaverContent({
      reviews: content.reviews,
      photoUrls: content.photos,
    });

    const ratedReviews = content.reviews.filter(r => typeof r.rating === 'number');
    if (ratedReviews.length > 0) {
      const highCount = ratedReviews.filter(r => r.rating >= 4).length;
      const highRatio = highCount / ratedReviews.length;
      ratingGate = {
        passed: highRatio >= 0.5,
        reason: `리뷰 ${ratedReviews.length}개 중 4점 이상 ${highCount}개(${Math.round(highRatio * 100)}%)`,
      };
    }

    naverExtra = {
      naver_rating: detail?.rating ?? null,
      naver_review_count: detail?.reviewCount ?? null,
      review_trust_score: contentAnalysis.trustScore,
      review_summary: contentAnalysis.summary,
      photo_authenticity_note: contentAnalysis.photoNote,
      naver_photo_url: content.photos?.[0] || null, // AI가 네이버에서 직접 가져온 대표 사진
      naver_reviews: content.reviews.slice(0, 5), // 지도에서 실제 리뷰 내용을 보여주기 위해 원문도 같이 저장
    };
  }

  const finalApprove = aiVerdict.approve && ratingGate.passed;
  const reasonParts = [aiVerdict.reason];
  if (!ratingGate.passed) reasonParts.push(`평점 기준 미달 — ${ratingGate.reason}`);
  else if (ratingGate.reason) reasonParts.push(ratingGate.reason);

  return {
    status: finalApprove ? 'verified' : 'rejected',
    reason: `${sources.join('·')} 확인 / ${reasonParts.filter(Boolean).join(' / ')}`,
    naver_place_id: naverResult?.id,
    kakao_place_id: kakaoResult?.id,
    ...naverExtra,
  };
}

// ── 네이버 장소 검색 (NAVER API HUB — 지역 검색) ─────────────────
// 2026-09 기준: 예전에 쓰던 map-place/v1/search(NCP Maps)는 신규 Application에서
// 더 이상 선택할 수 없게 되어(콘솔 API 선택 목록에서 사라짐) 항상 실패하고 있었음.
// 대신 NAVER API HUB의 "지역(Local Search)" API로 교체.
// 주의: 이 API는 네이버 플레이스 고유 ID(naver_place_id)를 반환하지 않음 —
// 이름/주소/좌표로 실존 여부·거리만 확인 가능하고, 리뷰 스크래핑(m.place.naver.com/restaurant/{id})에
// 쓸 ID는 별도로 구해야 함. 그 전까지는 naverResult.id가 항상 null이라
// verifyPlace()의 네이버 리뷰 신뢰도 분석 단계(naverResult?.id 체크)는 계속 스킵됨.
async function searchNaverPlace(name, lat, lng) {
  const clientId = process.env.NAVER_SEARCH_CLIENT_ID;
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn(`[searchNaverPlace] "${name}" — NAVER_SEARCH_CLIENT_ID/SECRET 환경변수 없음, 스킵`);
    return null;
  }

  try {
    const res = await axios.get('https://naverapihub.apigw.ntruss.com/search/v1/local', {
      params: { query: name, display: 5, sort: 'random' },
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
      },
    });
    const items = res.data?.items;
    if (!items?.length) {
      console.log(`[searchNaverPlace] "${name}" — 지역 검색 결과 0건`);
      return null;
    }

    let nearest = null;
    for (const item of items) {
      // mapx/mapy는 WGS84 기준 경도/위도 (문서 확인됨, 좌표계 변환 불필요)
      const placeLng = parseFloat(item.mapx);
      const placeLat = parseFloat(item.mapy);
      if (!placeLat || !placeLng) continue;
      const dist = getDistanceMeters(lat, lng, placeLat, placeLng);
      if (!nearest || dist < nearest) nearest = dist;
      if (dist <= 1000) {
        return {
          place_name: stripHtmlTags(item.title),
          category_name: item.category || '',
          id: null, // 지역 검색 API는 place id를 제공하지 않음 (위 주석 참고)
          distanceMeters: dist,
        };
      }
    }
    console.log(`[searchNaverPlace] "${name}" — ${items.length}건 검색됐지만 1km 이내 매칭 없음 (최근접 ${nearest ? Math.round(nearest) + 'm' : '좌표 없음'})`);
    return null;
  } catch (err) {
    console.error(
      '[searchNaverPlace]', err.message,
      '— 응답 본문:', JSON.stringify(err.response?.data || {}),
      '— clientId 앞 4자리:', clientId ? clientId.slice(0, 4) : '(없음)'
    );
    return null;
  }
}

// 지역 검색 API의 title에는 검색어 매칭 부분에 <b> 태그가 섞여 옴
function stripHtmlTags(str) {
  return (str || '').replace(/<[^>]*>/g, '');
}

// ── 좌표 근처 상호명 조회 (이름 키워드 검색이 실패했을 때 마지막 대조용) ──
async function searchNearbyPlaceNames(lat, lng, radius = 50) {
  if (!process.env.KAKAO_REST_API_KEY || lat == null || lng == null) return [];
  try {
    const [foodRes, cafeRes] = await Promise.all([
      axios.get('https://dapi.kakao.com/v2/local/search/category.json', {
        headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
        params: { category_group_code: 'FD6', x: lng, y: lat, radius, sort: 'distance' },
      }),
      axios.get('https://dapi.kakao.com/v2/local/search/category.json', {
        headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
        params: { category_group_code: 'CE7', x: lng, y: lat, radius, sort: 'distance' },
      }),
    ]);
    const docs = [...(foodRes.data?.documents || []), ...(cafeRes.data?.documents || [])];
    return docs.map((d) => ({
      place_name: d.place_name,
      id: d.id,
      distanceMeters: Number(d.distance || 0),
    }));
  } catch (err) {
    console.error('[searchNearbyPlaceNames]', err.message);
    return [];
  }
}

// 한글/영문/숫자만 남기고 공백·기호 제거 후 비교 — "쿠마스시"와 "쿠마스시 용산점" 같은 표기 차이를 흡수
function normalizeName(str) {
  return (str || '').replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
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

// ── 거리 계산 ──────────────────────────────────────────────────
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── AI 호출 (Claude → Gemini → 없으면 null 반환) ────────────────
// imageBlocks: [{ media_type, base64 }] 형태의 배열 (선택)
// JSON 문자열을 그대로 반환 — 호출부에서 JSON.parse 처리
async function callAiJudge(prompt, imageBlocks = []) {
  if (process.env.ANTHROPIC_API_KEY) {
    const content = [
      ...imageBlocks.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.media_type, data: img.base64 },
      })),
      { type: 'text', text: prompt },
    ];
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-6', max_tokens: 400, messages: [{ role: 'user', content }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );
    return res.data.content.map((b) => b.text || '').join('');
  }

  if (process.env.GEMINI_API_KEY) {
    // 무료 티어(Gemini 2.5 Flash) — 카드 등록 없이 aistudio.google.com에서 키 발급 가능
    const parts = [
      ...imageBlocks.map((img) => ({ inline_data: { mime_type: img.media_type, data: img.base64 } })),
      { text: prompt },
    ];
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ parts }] },
      { headers: { 'content-type': 'application/json' } }
    );
    return res.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  }

  if (process.env.GROQ_API_KEY) {
    // 무료 티어(Llama 3.3 70B) — console.groq.com, 구글 계정 가입, 카드/나이 제한 없음
    // 텍스트 전용 — 사진(imageBlocks)은 분석하지 않고 리뷰 텍스트/이름 판단만 수행
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }] },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' } }
    );
    return res.data?.choices?.[0]?.message?.content || '';
  }

  return null; // 셋 다 없음 — 호출부에서 자동승인 등 기본값 처리
}

function parseAiJson(text) {
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ── AI 최종 판단 (실존 여부 / 명백히 이상한 등록인지) ───────────
async function aiDoubleCheck({ name, address, foundName, category, source }) {
  const prompt = `다음 장소가 실제로 존재하는 신뢰할 만한 음식점/카페인지 판단해줘.
등록된 이름: ${name}
등록된 주소: ${address}
지도 매칭 이름(${source}): ${foundName}
카테고리: ${category}
이름이 명백히 다른 업종이거나 완전히 다른 상호면 반려.
JSON으로만 답해: {"approve": true|false, "reason": "한 문장 이유"}`;
  try {
    const text = await callAiJudge(prompt);
    if (text == null) {
      return { approve: true, reason: `${source} 확인으로 자동 승인 (AI 키 미설정)` };
    }
    return parseAiJson(text);
  } catch (err) {
    console.error('[aiDoubleCheck]', err.message);
    return { approve: true, reason: 'AI 오류로 기본 승인' };
  }
}

// ── AI 리뷰/사진 신뢰도 분석 (네이버 콘텐츠 기반) ────────────────
async function analyzeNaverContent({ reviews, photoUrls }) {
  if (!reviews.length && !photoUrls.length) {
    return { trustScore: null, adLikeCount: 0, photoNote: '분석할 데이터 없음', summary: '' };
  }

  // 사진 최대 3장만 base64로 변환 (토큰/비용 절약)
  const imageBlocks = [];
  for (const url of photoUrls.slice(0, 3)) {
    try {
      const img = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
      imageBlocks.push({
        media_type: img.headers['content-type'] || 'image/jpeg',
        base64: Buffer.from(img.data).toString('base64'),
      });
    } catch (err) {
      console.error('[analyzeNaverContent photo]', err.message);
    }
  }

  const reviewTexts = reviews.map((r, i) => `[${i + 1}] (${r.rating ?? '?'}점) ${r.text}`).join('\n');
  const prompt = `아래는 네이버 플레이스에서 가져온 실제 리뷰와 사진이야.
1) 리뷰 텍스트가 광고성/협찬성인지 실제 방문 후기인지 판단해줘.
   광고성 신호: 상투적 칭찬 반복, 구체적 방문 디테일 부재, 메뉴/이벤트 부자연스러운 강조
   실제 후기 신호: 대기시간·특정 메뉴 맛·재방문 의사 등 구체적 묘사, 단점도 언급
2) 첨부된 사진이 실제 방문객이 찍은 사진(음식/매장 내부, 자연스러운 구도)인지, 업체가 올린 홍보용/스튜디오 사진에 가까운지 판단해줘.

리뷰 목록:
${reviewTexts || '(리뷰 없음)'}

JSON으로만 답해:
{"trustScore": 0-100, "adLikeCount": 숫자, "photoNote": "사진 판단 한 문장", "summary": "전체 한 문장 요약"}`;

  try {
    const text = await callAiJudge(prompt, imageBlocks);
    if (text == null) {
      return { trustScore: null, adLikeCount: 0, photoNote: 'AI 키 미설정', summary: '' };
    }
    return parseAiJson(text);
  } catch (err) {
    console.error('[analyzeNaverContent]', err.message);
    return { trustScore: null, adLikeCount: 0, photoNote: 'AI 오류', summary: 'AI 분석 오류' };
  }
}

module.exports = {
  verifyPlace,
  searchNaverPlace,
  getDistanceMeters,
  analyzeNaverContent,
};
