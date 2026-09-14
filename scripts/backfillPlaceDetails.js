// 이미 등록된 가게들의 가격대(price_level)·영업시간(opening_hours)을
// 구글 플레이스 API에서 한 번에 가져와 채워 넣는 일회성 스크립트.
//
// 사용법 (로컬 또는 Render Shell에서):
//   node scripts/backfillPlaceDetails.js            → 기본값: 아직 안 채워진 것만 (missing)
//   node scripts/backfillPlaceDetails.js all        → verified 전체를 다시 가져옴 (최신화)

require('dotenv').config();
const supabase = require('../services/supabase');
const { refreshPlaceDetailsForPlace } = require('../services/googlePlaceDetails');

const MODE = (process.argv[2] || 'missing').toLowerCase(); // 'all' | 'missing'

async function main() {
  let query = supabase.from('places').select('*').eq('status', 'verified');
  if (MODE === 'missing') query = query.is('place_details_updated_at', null);

  const { data: places, error } = await query;
  if (error) {
    console.error('[backfillPlaceDetails] 조회 실패:', error.message);
    process.exit(1);
  }

  console.log(`[backfillPlaceDetails] 시작 — 모드: ${MODE}, 대상: ${places.length}개`);
  console.log(`[backfillPlaceDetails] 키 상태 — GOOGLE_PLACES_API_KEY: ${process.env.GOOGLE_PLACES_API_KEY ? 'O' : '❌ 없음'}`);

  let updated = 0, skipped = 0, failed = 0;
  for (const place of places) {
    try {
      const result = await refreshPlaceDetailsForPlace(place);
      if (!result.updated) {
        skipped++;
        console.log(`  - 스킵: ${place.name} (${result.reason})`);
        continue;
      }
      const { error: updateError } = await supabase.from('places').update(result.fields).eq('id', place.id);
      if (updateError) {
        failed++;
        console.error(`  - 실패: ${place.name} — ${updateError.message}`);
        continue;
      }
      updated++;
      console.log(`  - 갱신: ${place.name} (가격대 ${result.fields.price_level ?? '?'})`);
    } catch (err) {
      failed++;
      console.error(`  - 오류: ${place.name} — ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300)); // 구글 API 호출 과부하 방지
  }

  console.log(`[backfillPlaceDetails] 완료 — 갱신 ${updated} / 스킵 ${skipped} / 실패 ${failed}`);
  process.exit(0);
}

main();
