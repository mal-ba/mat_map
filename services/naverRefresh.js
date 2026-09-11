const { searchNaverPlace, analyzeNaverContent } = require('./verifyPlace');
const { fetchNaverPlaceDetail, fetchNaverReviewsAndPhotos } = require('./naverPlaceScraper');

// 이미 등록된 가게 하나의 네이버 평점/리뷰/사진을 다시 가져와서 채워 넣는다
// (naver_place_id가 없으면 이름+좌표로 네이버 재검색부터 시도)
// places.js(수동 관리자 버튼)와 scripts/refreshNaverContent.js(자동 스케줄러)가 공용으로 사용
async function refreshNaverContentForPlace(place) {
  let naverPlaceId = place.naver_place_id;
  if (!naverPlaceId) {
    const found = await searchNaverPlace(place.name, place.lat, place.lng);
    if (!found) return { updated: false, reason: '네이버에서 이 가게를 찾지 못했어요' };
    naverPlaceId = found.id;
  }

  const [detail, content] = await Promise.all([
    fetchNaverPlaceDetail(naverPlaceId),
    fetchNaverReviewsAndPhotos(naverPlaceId),
  ]);
  const analysis = await analyzeNaverContent({ reviews: content.reviews, photoUrls: content.photos });

  const fields = {
    naver_place_id: naverPlaceId,
    naver_rating: detail?.rating ?? null,
    naver_review_count: detail?.reviewCount ?? null,
    review_trust_score: analysis.trustScore,
    review_summary: analysis.summary,
    photo_authenticity_note: analysis.photoNote,
    naver_reviews: content.reviews.slice(0, 5),
    naver_reviews_updated_at: new Date().toISOString(),
  };
  // 사용자가 직접 올린 사진이 없을 때만 네이버 사진으로 채워줌 (기존 사진 덮어쓰지 않음)
  if (!place.image_url && content.photos?.[0]) fields.image_url = content.photos[0];

  return { updated: true, fields };
}

module.exports = { refreshNaverContentForPlace };
