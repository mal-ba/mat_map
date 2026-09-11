// 네이버 평점/리뷰를 주기적으로 다시 가져와 최신 상태로 유지하는 스크립트.
// Render Cron Job의 Command로 등록해서 매일/매주 자동 실행하면 됨.
//
// 사용법:
//   node scripts/refreshNaverContent.js            → 기본값: naver_reviews가 비어있는 것만 (missing)
//   node scripts/refreshNaverContent.js all        → verified 전체를 다시 가져옴 (평점/리뷰 최신화)
//   node scripts/refreshNaverContent.js missing    → naver_reviews가 비어있는 것만

require('dotenv').config();
const supabase = require('../services/supabase');
const { refreshNaverContentForPlace } = require('../services/naverRefresh');

const MODE = (process.argv[2] || 'missing').toLowerCase(); // 'all' | 'missing'

async function main() {
  let query = supabase.from('places').select('*').eq('status', 'verified');
  if (MODE === 'missing') query = query.is('naver_reviews', null);

  const { data: places, error } = await query;
  if (error) {
    console.error('[refreshNaverContent] 조회 실패:', error.message);
    process.exit(1);
  }

  console.log(`[refreshNaverContent] 시작 — 모드: ${MODE}, 대상: ${places.length}개`);

  let updated = 0, skipped = 0, failed = 0;
  for (const place of places) {
    try {
      const result = await refreshNaverContentForPlace(place);
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
      console.log(`  - 갱신: ${place.name} (평점 ${result.fields.naver_rating ?? '?'})`);
    } catch (err) {
      failed++;
      console.error(`  - 오류: ${place.name} — ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300)); // 네이버/카카오 호출 과부하 방지
  }

  console.log(`[refreshNaverContent] 완료 — 갱신 ${updated} / 스킵 ${skipped} / 실패 ${failed}`);
  process.exit(0);
}

main();
