// scripts/recheckStalePlaceDetails.js
//
// verified 상태이면서 구글 상세정보(business_status)를 마지막으로 확인한 지
// PLACE_DETAILS_STALE_DAYS일이 지난 가게를 다시 조회한다.
// 폐업(CLOSED_PERMANENTLY)이 확인되면 status를 'rejected'로 내려서
// GET /places(지도 노출 목록, status='verified'만 조회함)에서 자동으로 빠지게 한다.
//
// 기존 routes/places.js의 refresh-place-details-all과 같은 refreshPlaceDetailsForPlace()를
// 재사용하되, 대상 조건만 "place_details_updated_at이 null이거나 오래된 곳"으로 확장한 버전.
//
// 실행: node scripts/recheckStalePlaceDetails.js
// Render Cron Job에 등록해서 주기적으로(예: 매주 1회) 돌리는 걸 권장.
// 필요하면 .env / Render 환경변수에 PLACE_DETAILS_STALE_DAYS=90 같은 값으로 주기 조정 가능.

require('dotenv').config();
const supabase = require('../services/supabase');
const { refreshPlaceDetailsForPlace } = require('../services/googlePlaceDetails');

const STALE_DAYS = Number(process.env.PLACE_DETAILS_STALE_DAYS || 90);
const DELAY_MS = 300; // 구글 API 호출 과부하 방지용 딜레이 (기존 refresh-place-details-all과 동일 값)

async function main() {
  const staleBefore = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // place_details_updated_at이 null(한 번도 백필 안 됨)이거나 STALE_DAYS일보다 오래된 verified 가게
  const { data: places, error } = await supabase
    .from('places')
    .select('*')
    .eq('status', 'verified')
    .or(`place_details_updated_at.is.null,place_details_updated_at.lt.${staleBefore}`);

  if (error) {
    console.error('[recheckStalePlaceDetails] 대상 조회 실패:', error.message);
    process.exit(1);
  }

  const summary = { total: places.length, updated: 0, closedAndDelisted: 0, skipped: 0, failed: 0 };
  console.log(`[recheckStalePlaceDetails] 대상 ${places.length}곳 재조회 시작 (기준: ${STALE_DAYS}일 경과)`);

  for (const place of places) {
    try {
      const result = await refreshPlaceDetailsForPlace(place);

      if (!result.updated) {
        summary.skipped++;
        continue;
      }

      const update = { ...result.fields };

      // 폐업이 확인되면 verified 상태를 내려서 지도 노출 목록에서 자동으로 빠지게 함
      if (update.business_status === 'CLOSED_PERMANENTLY') {
        update.status = 'rejected';
        update.verify_reason = `구글 플레이스에서 폐업(CLOSED_PERMANENTLY) 확인됨 — ${new Date().toISOString().slice(0, 10)} 자동 재검증`;
        summary.closedAndDelisted++;
        console.log(`[recheckStalePlaceDetails] 폐업 확인 → 지도에서 제외: "${place.name}" (${place.id})`);
      }

      const { error: updateError } = await supabase
        .from('places')
        .update(update)
        .eq('id', place.id);

      if (updateError) {
        console.error(`[recheckStalePlaceDetails] "${place.name}" 업데이트 실패:`, updateError.message);
        summary.failed++;
        continue;
      }
      summary.updated++;
    } catch (err) {
      console.error(`[recheckStalePlaceDetails] "${place.name}" 처리 중 오류:`, err.message);
      summary.failed++;
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log('[recheckStalePlaceDetails] 완료:', summary);
  process.exit(0);
}

main();
