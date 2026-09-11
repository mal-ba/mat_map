const axios = require('axios');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Referer': 'https://m.place.naver.com/',
};

// map.naver.com은 위 HEADERS의 Referer(m.place.naver.com)와 도메인이 달라 403으로 막힘 —
// 이 요청 전용으로 Referer/Origin을 map.naver.com에 맞춰서 따로 둠
const MAP_SEARCH_HEADERS = {
  'User-Agent': HEADERS['User-Agent'],
  'Referer': 'https://map.naver.com/',
  'Origin': 'https://map.naver.com',
};

// __APOLLO_STATE__ (Apollo GraphQL 클라이언트 상태)가 SSR HTML에 그대로 박혀 있어서 그걸 파싱
// 주의: 비공식 방식 — 네이버가 페이지 구조를 바꾸면 이 정규식/키 이름을 다시 맞춰야 함
function extractApolloState(html) {
  const match = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{.*?\});/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// 평점 + 리뷰수
async function fetchNaverPlaceDetail(naverPlaceId) {
  if (!naverPlaceId) return null;
  try {
    const res = await axios.get(`https://m.place.naver.com/restaurant/${naverPlaceId}/home`, {
      headers: HEADERS,
      timeout: 8000,
    });
    const state = extractApolloState(res.data);
    if (!state) return null;

    let rating = null;
    let reviewCount = null;
    for (const [key, node] of Object.entries(state)) {
      if (/^(Restaurant|PlaceDetail)Base:/.test(key)) {
        if (node.visitorReviewScore != null) rating = Number(node.visitorReviewScore);
        if (node.visitorReviewCount != null) reviewCount = node.visitorReviewCount;
      }
    }
    return { rating, reviewCount };
  } catch (err) {
    console.error('[fetchNaverPlaceDetail]', err.message);
    return null;
  }
}

// 방문자 리뷰 텍스트 + 사진 URL
async function fetchNaverReviewsAndPhotos(naverPlaceId, max = 10) {
  if (!naverPlaceId) return { reviews: [], photos: [] };
  try {
    const res = await axios.get(`https://m.place.naver.com/restaurant/${naverPlaceId}/review/visitor`, {
      headers: HEADERS,
      timeout: 8000,
    });
    const state = extractApolloState(res.data);
    if (!state) return { reviews: [], photos: [] };

    const reviews = [];
    const photos = [];
    for (const [key, node] of Object.entries(state)) {
      if (key.startsWith('VisitorReview:') && node.body) {
        reviews.push({ text: node.body, rating: node.rating ?? null });
      }
      if (key.startsWith('Photo:') && node.url) {
        photos.push(node.url);
      }
    }
    return { reviews: reviews.slice(0, max), photos: photos.slice(0, max) };
  } catch (err) {
    console.error('[fetchNaverReviewsAndPhotos]', err.message);
    return { reviews: [], photos: [] };
  }
}

// 이름+좌표로 네이버 플레이스 고유 ID를 찾는다.
// (NAVER API HUB의 "지역 검색"은 이름/주소/좌표만 주고 ID는 안 줘서, 리뷰 스크래핑에 쓸
//  m.place.naver.com/restaurant/{id} 의 {id}를 별도로 구해야 함)
// map.naver.com이 검색 결과 화면을 그릴 때 내부적으로 호출하는 비공식 API를 사용.
// ⚠️ 미검증: 이 샌드박스에서는 naver.com 계열 도메인으로 네트워크 요청이 막혀 있어
//   실제 응답 구조를 직접 확인하지 못했음. 배포 후 콘솔 로그의 [findNaverPlaceId] 줄을
//   꼭 확인해서 실제로 ID가 잡히는지, 안 잡히면 에러 메시지가 뭔지 점검할 것.
//   실패해도 null만 반환하고 기존 verified/pending/rejected 판정에는 영향 없음
//   (리뷰 분석 단계만 계속 스킵될 뿐).
async function findNaverPlaceId(name, lat, lng) {
  try {
    const params = { query: name, type: 'all', page: '1', displayCount: '5' };
    if (lat != null && lng != null) params.searchCoord = `${lng};${lat}`;
    const res = await axios.get('https://map.naver.com/p/api/search/allSearch', {
      params,
      headers: MAP_SEARCH_HEADERS,
      timeout: 8000,
    });
    const list = res.data?.place?.list;
    if (!Array.isArray(list) || !list.length) {
      console.log(`[findNaverPlaceId] "${name}" — 실패. ncaptcha: ${JSON.stringify(res.data?.ncaptcha ?? null)} — 원본 응답(최대 1200자): ${JSON.stringify(res.data ?? {}).slice(0, 1200)}`);
      return null;
    }
    return list[0]?.id || null;
  } catch (err) {
    console.error(
      '[findNaverPlaceId]', err.message,
      '— status:', err.response?.status,
      '— 응답 본문:', typeof err.response?.data === 'string' ? err.response.data.slice(0, 200) : JSON.stringify(err.response?.data || {}).slice(0, 200),
      '— query:', name
    );
    return null;
  }
}

module.exports = { fetchNaverPlaceDetail, fetchNaverReviewsAndPhotos, findNaverPlaceId };
