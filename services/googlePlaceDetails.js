const axios = require('axios');

/**
 * 가격대(price_level)·영업시간(opening_hours)·영업상태(business_status)를
 * 구글 플레이스 API에서 가져와 places 테이블에 채워 넣는 서비스.
 *
 * verifyPlace.js / naverRefresh.js와 같은 패턴:
 *   - 등록 시(routes/places.js) 자동 1회 호출
 *   - 관리자 페이지 버튼으로 개별/전체 재조회 가능 (routes/places.js에 라우트 추가)
 *   - scripts/backfillPlaceDetails.js 로 기존 데이터 일괄 백필
 */

// ── 이름+좌표로 구글 place_id 찾기 (Find Place from Text) ──
async function findGooglePlaceId(name, lat, lng) {
  if (!process.env.GOOGLE_PLACES_API_KEY) return null;
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', {
      params: {
        input: name,
        inputtype: 'textquery',
        locationbias: `circle:300@${lat},${lng}`,
        fields: 'place_id,name,geometry',
        language: 'ko',
        key: process.env.GOOGLE_PLACES_API_KEY,
      },
    });
    const candidate = res.data?.candidates?.[0];
    return candidate?.place_id || null;
  } catch (err) {
    console.error('[findGooglePlaceId]', err.message);
    return null;
  }
}

// ── place_id로 상세정보 조회 (Place Details) ──
async function fetchGooglePlaceDetails(placeId) {
  if (!process.env.GOOGLE_PLACES_API_KEY || !placeId) return null;
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: {
        place_id: placeId,
        fields: 'price_level,opening_hours,business_status,rating,user_ratings_total',
        language: 'ko',
        key: process.env.GOOGLE_PLACES_API_KEY,
      },
    });
    const result = res.data?.result;
    if (!result) return null;
    return {
      price_level: result.price_level ?? null, // 0(무료)~4(매우 비쌈), 정보 없으면 null
      opening_hours: result.opening_hours?.weekday_text || null, // ["월요일: 09:00~21:00", ...]
      open_now: result.opening_hours?.open_now ?? null,
      business_status: result.business_status || null, // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
      google_rating: result.rating ?? null,
      google_review_count: result.user_ratings_total ?? null,
    };
  } catch (err) {
    console.error('[fetchGooglePlaceDetails]', err.message);
    return null;
  }
}

// ── 가게 하나에 대해 필요한 필드를 채워서 반환 (호출부에서 supabase update에 그대로 사용) ──
// naverRefresh.js의 refreshNaverContentForPlace와 동일한 반환 형태: { updated, fields } | { updated: false, reason }
async function refreshPlaceDetailsForPlace(place) {
  let placeId = place.google_place_id;
  if (!placeId) {
    placeId = await findGooglePlaceId(place.name, place.lat, place.lng);
    if (!placeId) return { updated: false, reason: '구글에서 이 가게를 찾지 못했어요' };
  }

  const details = await fetchGooglePlaceDetails(placeId);
  if (!details) return { updated: false, reason: '구글 상세정보 조회 실패' };

  return {
    updated: true,
    fields: {
      google_place_id: placeId,
      price_level: details.price_level,
      opening_hours: details.opening_hours,
      business_status: details.business_status,
      place_details_updated_at: new Date().toISOString(),
    },
  };
}

module.exports = {
  findGooglePlaceId,
  fetchGooglePlaceDetails,
  refreshPlaceDetailsForPlace,
};
