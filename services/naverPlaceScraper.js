const axios = require('axios');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Referer': 'https://m.place.naver.com/',
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

module.exports = { fetchNaverPlaceDetail, fetchNaverReviewsAndPhotos };
