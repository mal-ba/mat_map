const express = require('express');
const multer = require('multer');
const supabase = require('../services/supabase');
const requireAuth = require('./requireAuth');
const { writeLimiter } = require('../middleware/rateLimit');
const { verifyPlace, searchNaverPlace } = require('../services/verifyPlace');
const { refreshNaverContentForPlace } = require('../services/naverRefresh');
const { refreshPlaceDetailsForPlace } = require('../services/googlePlaceDetails');
const { regionKey, regionLabel } = require('../services/region');

const router = express.Router();

// 관리자 이메일만 반려 목록 조회/재검증/삭제 가능
const ADMIN_EMAILS = ['jehoon100703@gmail.com'];
function requireAdmin(req, res, next) {
  if (!ADMIN_EMAILS.includes(req.user?.email)) {
    return res.status(403).json({ error: '관리자만 할 수 있어요' });
  }
  next();
}

// ── 중복 체크용 헬퍼 ─────────────────────────────────────────
function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeName(s) {
  return (s || '').toLowerCase().replace(/[\s·\-_.,()]/g, '');
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// 이름이 '비슷한지' — 완전히 같거나, 한쪽이 다른 쪽을 포함하거나(지점명 등), 오타 수준 차이
function isSimilarName(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const dist = levenshtein(na, nb);
  return dist / Math.max(na.length, nb.length) <= 0.25;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('이미지 파일만 업로드할 수 있어요'));
    cb(null, true);
  },
});

// 맛집 등록 폼에서 쓰는 사진 업로드 (등록 전이라 place id 없이 유저별 경로에 저장)
router.post('/photo-upload', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '이미지 파일이 없어요' });
  try {
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const filePath = `${req.user.userId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('place-photos')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage.from('place-photos').getPublicUrl(filePath);
    res.json({ url: pub.publicUrl });
  } catch (err) {
    console.error('[places/photo-upload]', err.message);
    res.status(500).json({ error: '사진 업로드에 실패했어요' });
  }
});

// 지도에 표시할 목록 - 검증된 것만 공개
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('places')
    .select('*')
    .eq('status', 'verified')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[places GET] Supabase 에러:', error.message);
    return res.status(500).json({ error: error.message });
  }

  const places = data ?? [];

  // 가게별 추천수 집계 + 같은 지역(시/도+시군구) 안에서의 순위 계산
  // (추천을 가장 많이 받은 가게가 그 지역 1위 = region_rank === 1)
  const { data: recData, error: recError } = await supabase
    .from('recommends')
    .select('place_id');
  if (recError) console.error('[places GET] recommends 집계 에러:', recError.message);

  const recommendCounts = new Map();
  (recData ?? []).forEach((r) => {
    recommendCounts.set(r.place_id, (recommendCounts.get(r.place_id) || 0) + 1);
  });

  const byRegion = new Map();
  places.forEach((p) => {
    p.recommend_count = recommendCounts.get(p.id) || 0;
    p.region_label = regionLabel(p.address);
    const key = regionKey(p.address);
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key).push(p);
  });
  byRegion.forEach((group) => {
    group
      .slice()
      .sort((a, b) =>
        b.recommend_count - a.recommend_count ||
        new Date(a.created_at) - new Date(b.created_at)
      )
      .forEach((p, i) => { p.region_rank = i + 1; });
  });

  res.json(places);
});

// 내가 등록한 목록 (대기중/반려 포함, 마이페이지용)
// + 다른 사람이 등록했지만 내가 사업자 인증(claim)을 받아 소유권이 승인된 가게도 포함
// -> 가게 관리(owner-dashboard.html)에서 이 목록을 그대로 쓰기 때문에, 승인되면 바로 관리 대상이 됨
router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('places')
    .select('*')
    .or(`submitted_by.eq.${req.user.userId},and(owner_id.eq.${req.user.userId},owner_claim_status.eq.approved)`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[places GET /mine] Supabase 에러:', error.message);
    return res.status(500).json({ error: error.message });
  }
  res.json(data ?? []);
});

// ── 사업자 본인 인증(가게 claim) ────────────────────────────
// 가게 이름/주소로 검색 (이미 누군가 등록해놓은 내 가게를 찾기 위함)
router.get('/search', requireAuth, async (req, res) => {
  // or() 필터 문법이 쉼표/괄호를 구분자로 쓰기 때문에 검색어에서 미리 제거
  const q = (req.query.q || '').trim().replace(/[,()%]/g, '');
  if (!q) return res.json([]);

  const { data, error } = await supabase
    .from('places')
    .select('id, name, address, category, status, owner_id, owner_claim_status')
    .neq('status', 'rejected')
    .or(`name.ilike.%${q}%,address.ilike.%${q}%`)
    .limit(20);

  if (error) {
    console.error('[places GET /search] Supabase 에러:', error.message);
    return res.status(500).json({ error: error.message });
  }
  res.json(data ?? []);
});

// 내 사업자 인증 신청 현황 (claim.html에서 진행 상태 보여줄 때 사용)
router.get('/my-claims', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('places')
    .select('id, name, address, owner_claim_status, owner_claim_requested_at')
    .eq('owner_id', req.user.userId)
    .order('owner_claim_requested_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// 특정 가게에 대해 "내 가게예요" 인증 신청
router.post('/:id/claim', requireAuth, async (req, res) => {
  const { phone, biz_number, note } = req.body;
  if (!phone || !biz_number) {
    return res.status(400).json({ error: '연락처와 사업자등록번호는 필수예요' });
  }

  const { data: place, error: findError } = await supabase
    .from('places')
    .select('id, owner_id, owner_claim_status')
    .eq('id', req.params.id)
    .single();
  if (findError || !place) return res.status(404).json({ error: '가게를 찾을 수 없어요' });

  if (place.owner_claim_status === 'approved') {
    return res.status(409).json({ error: '이미 사업자 인증이 완료된 가게예요' });
  }
  if (place.owner_claim_status === 'pending' && place.owner_id === req.user.userId) {
    return res.status(409).json({ error: '이미 인증 신청을 넣어두셨어요. 검토를 기다려주세요' });
  }

  const { data, error } = await supabase
    .from('places')
    .update({
      owner_id: req.user.userId,
      owner_claim_status: 'pending',
      owner_claim_phone: phone,
      owner_claim_biz_number: biz_number,
      owner_claim_note: note || null,
      owner_claim_requested_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) {
    console.error('[places POST /:id/claim] Supabase 에러:', error.message);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// 검토 대기 중인 claim 목록 (관리자용)
router.get('/claims/pending', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('places')
    .select('id, name, address, owner_id, owner_claim_phone, owner_claim_biz_number, owner_claim_note, owner_claim_requested_at, users:owner_id(email, name)')
    .eq('owner_claim_status', 'pending')
    .order('owner_claim_requested_at', { ascending: true });

  if (error) {
    console.error('[places GET /claims/pending] Supabase 에러:', error.message);
    return res.status(500).json({ error: error.message });
  }
  res.json(data ?? []);
});

// claim 승인/반려 (관리자용)
router.post('/:id/claim/:decision', requireAuth, requireAdmin, async (req, res) => {
  const { decision } = req.params;
  if (!['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'decision은 approve 또는 reject여야 해요' });
  }

  const { data, error } = await supabase
    .from('places')
    .update({
      owner_claim_status: decision === 'approve' ? 'approved' : 'rejected',
      owner_claim_reviewed_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('owner_claim_status', 'pending') // 대기 중인 것만 처리 (중복 승인 방지)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ error: '대기 중인 인증 신청을 찾을 수 없어요' });
  }
  res.json(data);
});

// 새 맛집 등록 -> 즉시 공개 X, 자동 검증 로직 통과해야 지도에 뜸
const LISTING_TYPES = ['verified', 'new_opening'];

router.post('/', writeLimiter, requireAuth, async (req, res) => {
  const { name, address, lat, lng, category, comment, image_url, show_on_maps } = req.body;
  const listing_type = LISTING_TYPES.includes(req.body.listing_type) ? req.body.listing_type : 'verified';
  if (!name || !address || lat == null || lng == null) {
    return res.status(400).json({ error: '이름/주소/좌표는 필수입니다' });
  }

  // ── 중복 체크 ─────────────────────────────────────────────
  // 1. 같은 kakao_place_id가 이미 있는지
  const { data: existingByKakao } = await supabase
    .from('places')
    .select('id, name')
    .eq('kakao_place_id', name) // 임시; 실제 kakao_place_id는 아래 verdict에서 나옴
    .neq('status', 'rejected')
    .limit(1);

  // 2. 좌표 기준 100m 이내 중복 체크 (위도 0.001 ≈ 111m)
  const { data: nearbyPlaces } = await supabase
    .from('places')
    .select('id, name, lat, lng')
    .neq('status', 'rejected')
    .gte('lat', lat - 0.001)
    .lte('lat', lat + 0.001)
    .gte('lng', lng - 0.0015)
    .lte('lng', lng + 0.0015);

  if (nearbyPlaces?.length) {
    // 아주 가까우면(같은 건물/자리 수준) 이름이 달라도 중복으로 보고,
    // 애매하게 가까운 정도(같은 골목/거리)면 이름까지 비슷할 때만 중복으로 처리
    // → 상가가 밀집한 지역에서 서로 다른 가게가 100m 이내에 있는 건 흔한 일이라
    //   단순 거리만으로 막으면 오탐이 너무 많이 나서 이름 유사도를 같이 봄
    const TIGHT_RADIUS_M = 25;
    const LOOSE_RADIUS_M = 100;
    const tooClose = nearbyPlaces.find(p => {
      const dist = haversineMeters(lat, lng, p.lat, p.lng);
      if (dist < TIGHT_RADIUS_M) return true;
      if (dist < LOOSE_RADIUS_M) return isSimilarName(name, p.name);
      return false;
    });
    if (tooClose) {
      return res.status(409).json({
        error: `이미 등록된 가게와 너무 가까워요. "${tooClose.name}"이(가) 근처에 있어요.`,
        duplicate: true,
      });
    }
  }
  // ─────────────────────────────────────────────────────────

  const verdict = await verifyPlace({ name, address, lat, lng, comment });
  const finalImageUrl = image_url || verdict.naver_photo_url || null; // 사용자 업로드 우선, 없으면 AI가 네이버에서 가져온 사진

  // 가격대/영업시간은 구글에서 못 찾아도 등록 자체는 막지 않음 — 실패하면 조용히 스킵
  let placeDetails = {};
  try {
    const detailResult = await refreshPlaceDetailsForPlace({ name, lat, lng, google_place_id: null });
    if (detailResult.updated) placeDetails = detailResult.fields;
  } catch (err) {
    console.error('[places POST] 구글 상세정보 조회 실패:', err.message);
  }

  const { data, error } = await supabase
    .from('places')
    .insert({
      name,
      address,
      lat,
      lng,
      category,
      comment,
      image_url: finalImageUrl,
      submitted_by: req.user.userId,
      status: verdict.status,
      verify_reason: verdict.reason,
      kakao_place_id: verdict.kakao_place_id,
      naver_place_id: verdict.naver_place_id,
      naver_rating: verdict.naver_rating,
      naver_review_count: verdict.naver_review_count,
      review_trust_score: verdict.review_trust_score,
      review_summary: verdict.review_summary,
      photo_authenticity_note: verdict.photo_authenticity_note,
      naver_reviews: verdict.naver_reviews || null,
      tags: verdict.tags || [],
      listing_type,
      show_on_maps: show_on_maps || 'kakao,naver,google',
      google_place_id: placeDetails.google_place_id || null,
      price_level: placeDetails.price_level ?? null,
      opening_hours: placeDetails.opening_hours || null,
      business_status: placeDetails.business_status || null,
      place_details_updated_at: placeDetails.place_details_updated_at || null,
    })
    .select()
    .single();

  if (error) {
    console.error('[places POST] Supabase 에러:', error.message);
    return res.status(500).json({ error: error.message });
  }

  // verified 등록 시 사용자 등록수 + 뱃지 업데이트
  // kakao_place_id 중복 체크 (같은 가게가 이미 등록됐는지)
  if (data.kakao_place_id) {
    const { data: dupKakao } = await supabase
      .from('places')
      .select('id, name')
      .eq('naver_place_id', data.naver_place_id)
      .neq('id', data.id)
      .neq('status', 'rejected')
      .limit(1);
    if (dupKakao?.length) {
      // 중복이면 방금 등록한 것 삭제하고 오류 반환
      await supabase.from('places').delete().eq('id', data.id);
      return res.status(409).json({
        error: `이미 등록된 가게예요. "${dupKakao[0].name}"이(가) 같은 곳이에요.`,
        duplicate: true,
      });
    }
  }

  if (data.status === 'verified') {
    const { data: userData } = await supabase
      .from('users')
      .select('registered_count')
      .eq('id', req.user.userId)
      .single();

    const newCount = (userData?.registered_count || 0) + 1;
    const LEVELS = [120, 60, 30, 15, 10, 5];
    let badgeLevel = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      if (newCount >= LEVELS[i]) { badgeLevel = LEVELS.length - i; break; }
    }

    await supabase.from('users').update({
      registered_count: newCount,
      badge_level: badgeLevel,
    }).eq('id', req.user.userId);
  }

  res.json(data);
});

// 반려된 가게 목록 (관리자용)
router.get('/rejected', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('places')
    .select('*')
    .eq('status', 'rejected')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// 반려된 가게를 네이버 지도 기준으로 재검증 (찾아지면 바로 공개)
router.post('/:id/retry-naver', requireAuth, requireAdmin, async (req, res) => {
  const { data: place, error: findError } = await supabase
    .from('places')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (findError || !place) return res.status(404).json({ error: '가게를 찾을 수 없어요' });

  try {
    const found = await searchNaverPlace(place.name, place.lat, place.lng);
    if (!found || found.distanceMeters > 500) {
      return res.json({
        verified: false,
        message: found
          ? `네이버에서 찾았지만 등록 위치와 ${Math.round(found.distanceMeters)}m 떨어져 있어요.`
          : '네이버 지도에서 이 가게를 찾을 수 없어요.',
      });
    }

    const { data: updated, error } = await supabase
      .from('places')
      .update({
        status: 'verified',
        verify_reason: `관리자 재검증 — 네이버 확인 (${Math.round(found.distanceMeters)}m 이내)`,
        naver_place_id: found.id,
      })
      .eq('id', place.id)
      .select()
      .single();
    if (error) throw error;

    res.json({ verified: true, place: updated });
  } catch (err) {
    console.error('[places/retry-naver]', err.message);
    res.status(500).json({ error: '재검증 중 오류가 발생했어요' });
  }
});

// 반려된 가게 삭제 (관리자용)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase.from('places').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: true });
});

// naver_reviews가 비어있는 verified 가게 목록 (관리자 페이지에서 백필 대상 확인용)
router.get('/missing-naver-content', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('places')
    .select('id, name, address, naver_reviews')
    .eq('status', 'verified')
    .is('naver_reviews', null)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// 이미 등록된 가게 하나의 네이버 평점/리뷰/사진을 다시 가져와 채움 (관리자용)
router.post('/:id/refresh-naver-content', requireAuth, requireAdmin, async (req, res) => {
  const { data: place, error: findError } = await supabase
    .from('places')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (findError || !place) return res.status(404).json({ error: '가게를 찾을 수 없어요' });

  try {
    const result = await refreshNaverContentForPlace(place);
    if (!result.updated) return res.json({ updated: false, message: result.reason });

    const { data: updated, error } = await supabase
      .from('places')
      .update(result.fields)
      .eq('id', place.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ updated: true, place: updated });
  } catch (err) {
    console.error('[places/refresh-naver-content]', err.message);
    res.status(500).json({ error: '네이버 정보를 가져오는 중 오류가 발생했어요' });
  }
});

// naver_reviews가 비어있는 verified 가게 전체를 순회하며 일괄 백필 (관리자용, 시간이 걸릴 수 있음)
router.post('/refresh-naver-content-all', requireAuth, requireAdmin, async (req, res) => {
  const { data: places, error } = await supabase
    .from('places')
    .select('*')
    .eq('status', 'verified')
    .is('naver_reviews', null);
  if (error) return res.status(500).json({ error: error.message });

  const summary = { total: places.length, updated: 0, skipped: 0, failed: 0 };
  for (const place of places) {
    try {
      const result = await refreshNaverContentForPlace(place);
      if (!result.updated) { summary.skipped++; continue; }
      const { error: updateError } = await supabase.from('places').update(result.fields).eq('id', place.id);
      if (updateError) { summary.failed++; continue; }
      summary.updated++;
    } catch (err) {
      console.error('[places/refresh-naver-content-all]', place.name, err.message);
      summary.failed++;
    }
    await new Promise((r) => setTimeout(r, 300)); // 네이버/카카오 호출 과부하 방지용 딜레이
  }
  res.json(summary);
});

// price_level/opening_hours가 비어있는 verified 가게 목록 (관리자 페이지에서 백필 대상 확인용)
router.get('/missing-place-details', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('places')
    .select('id, name, address, price_level, opening_hours')
    .eq('status', 'verified')
    .is('place_details_updated_at', null)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// 이미 등록된 가게 하나의 가격대/영업시간을 다시 가져와 채움 (관리자용)
router.post('/:id/refresh-place-details', requireAuth, requireAdmin, async (req, res) => {
  const { data: place, error: findError } = await supabase
    .from('places')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (findError || !place) return res.status(404).json({ error: '가게를 찾을 수 없어요' });

  try {
    const result = await refreshPlaceDetailsForPlace(place);
    if (!result.updated) return res.json({ updated: false, message: result.reason });

    const { data: updated, error } = await supabase
      .from('places')
      .update(result.fields)
      .eq('id', place.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ updated: true, place: updated });
  } catch (err) {
    console.error('[places/refresh-place-details]', err.message);
    res.status(500).json({ error: '가격대/영업시간을 가져오는 중 오류가 발생했어요' });
  }
});

// price_level/opening_hours가 비어있는 verified 가게 전체를 순회하며 일괄 백필 (관리자용, 시간이 걸릴 수 있음)
router.post('/refresh-place-details-all', requireAuth, requireAdmin, async (req, res) => {
  const { data: places, error } = await supabase
    .from('places')
    .select('*')
    .eq('status', 'verified')
    .is('place_details_updated_at', null);
  if (error) return res.status(500).json({ error: error.message });

  const summary = { total: places.length, updated: 0, skipped: 0, failed: 0 };
  for (const place of places) {
    try {
      const result = await refreshPlaceDetailsForPlace(place);
      if (!result.updated) { summary.skipped++; continue; }
      const { error: updateError } = await supabase.from('places').update(result.fields).eq('id', place.id);
      if (updateError) { summary.failed++; continue; }
      summary.updated++;
    } catch (err) {
      console.error('[places/refresh-place-details-all]', place.name, err.message);
      summary.failed++;
    }
    await new Promise((r) => setTimeout(r, 300)); // 구글 API 호출 과부하 방지용 딜레이
  }
  res.json(summary);
});

// 개인화 추천 근거로 쓰기 위한 조회 로그 — 실패해도 화면 흐름엔 영향 없음
router.post('/:id/view', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('place_views')
    .insert({ user_id: req.user.userId, place_id: req.params.id });
  if (error) console.error('[places/:id/view]', error.message);
  res.json({ ok: true });
});

// ── 찜하기(즐겨찾기) ─────────────────────────────────────────
// 찜 추가 (이미 찜한 상태에서 다시 눌러도 에러 없이 그대로 유지)
router.post('/:id/like', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('likes')
    .upsert({ user_id: req.user.userId, place_id: req.params.id }, { onConflict: 'user_id,place_id' });
  if (error) {
    console.error('[places/:id/like]', error.message);
    return res.status(500).json({ error: '찜하기에 실패했어요' });
  }
  res.json({ liked: true });
});

// 찜 취소
router.delete('/:id/like', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('likes')
    .delete()
    .eq('user_id', req.user.userId)
    .eq('place_id', req.params.id);
  if (error) {
    console.error('[places/:id/unlike]', error.message);
    return res.status(500).json({ error: '찜 취소에 실패했어요' });
  }
  res.json({ liked: false });
});

// 내가 찜한 가게 id 목록 — 홈/지도 화면에서 하트 아이콘 상태 표시용 (가볍게)
router.get('/my-likes', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('likes')
    .select('place_id')
    .eq('user_id', req.user.userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json((data ?? []).map((r) => r.place_id));
});

// 내가 찜한 가게 전체 정보 — 마이페이지 "찜한 가게" 탭용
router.get('/liked', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('likes')
    .select('created_at, places(*)')
    .eq('user_id', req.user.userId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data ?? []).map((r) => r.places).filter(Boolean));
});

// ── 추천하기 ─────────────────────────────────────────────────
// 찜(개인 보관함, 위의 likes)과는 별개의 신호. 한 사용자가 같은 가게를 여러 번
// 추천해도 1표로만 집계되며(upsert), 이 추천수가 GET '/'의 region_rank 계산에 쓰인다.
router.post('/:id/recommend', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('recommends')
    .upsert({ user_id: req.user.userId, place_id: req.params.id }, { onConflict: 'user_id,place_id' });
  if (error) {
    console.error('[places/:id/recommend]', error.message);
    return res.status(500).json({ error: '추천에 실패했어요' });
  }
  res.json({ recommended: true });
});

// 추천 취소
router.delete('/:id/recommend', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('recommends')
    .delete()
    .eq('user_id', req.user.userId)
    .eq('place_id', req.params.id);
  if (error) {
    console.error('[places/:id/unrecommend]', error.message);
    return res.status(500).json({ error: '추천 취소에 실패했어요' });
  }
  res.json({ recommended: false });
});

// 내가 추천한 가게 id 목록 — 지도/목록 화면에서 추천 버튼 상태 표시용
router.get('/my-recommends', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('recommends')
    .select('place_id')
    .eq('user_id', req.user.userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json((data ?? []).map((r) => r.place_id));
});

// ── 랭킹/트렌드 ─────────────────────────────────────────────
// "이번 주 인기 맛집"은 매주 월요일 00:00에 한 번만 새로 계산되어
// weekly_trending 테이블에 저장되고, 다음 월요일까지는 그 스냅샷을 그대로 보여준다.
// (조회 때마다 실시간 재계산하지 않음 — 계산은 /trending/refresh 에서만 일어남)
router.get('/trending', async (req, res) => {
  const { data: snapshot, error } = await supabase
    .from('weekly_trending')
    .select('rank, score, places(*)')
    .order('rank', { ascending: true });
  if (error) {
    console.error('[places/trending] read', error.message);
    return res.status(500).json({ error: error.message });
  }

  const places = (snapshot ?? [])
    .filter((row) => row.places && row.places.status === 'verified')
    .map((row) => row.places);
  res.json(places);
});

// 이번 주 랭킹을 실제로 계산해서 weekly_trending 테이블을 통째로 교체하는 공통 로직.
// 점수 = 최근 7일 조회수 1점 + 찜 3점, 상위 10개.
async function recomputeWeeklyTrending() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: views, error: viewErr }, { data: likesData, error: likeErr }] = await Promise.all([
    supabase.from('place_views').select('place_id').gte('created_at', since),
    supabase.from('likes').select('place_id').gte('created_at', since),
  ]);
  if (viewErr) console.error('[trending] views', viewErr.message);
  if (likeErr) console.error('[trending] likes', likeErr.message);

  const score = new Map();
  (views ?? []).forEach((v) => score.set(v.place_id, (score.get(v.place_id) || 0) + 1));
  (likesData ?? []).forEach((l) => score.set(l.place_id, (score.get(l.place_id) || 0) + 3));

  const top = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // 기존 스냅샷 전체 삭제 후 새 TOP 10으로 교체
  const { error: delErr } = await supabase.from('weekly_trending').delete().gte('rank', 0);
  if (delErr) throw new Error(delErr.message);

  if (top.length) {
    const rows = top.map(([place_id, s], i) => ({ rank: i + 1, place_id, score: s }));
    const { error: insErr } = await supabase.from('weekly_trending').insert(rows);
    if (insErr) throw new Error(insErr.message);
  }

  return { count: top.length, refreshed_at: new Date().toISOString() };
}

// 외부 크론(예: Render Cron Job)이 매주 월요일 00:00(KST)에 한 번 호출해야 함.
router.post('/trending/refresh', async (req, res) => {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: '권한 없음' });
  }
  try {
    const result = await recomputeWeeklyTrending();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[places/trending/refresh]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 관리자가 admin.html에서 수동으로 즉시 새로고침할 때 씀 (정기 갱신은 위 크론이 담당).
router.post('/trending/refresh-now', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await recomputeWeeklyTrending();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[places/trending/refresh-now]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 가게 상세 페이지(place.html)에서 가게 하나의 전체 정보를 가져올 때 사용
// 다른 GET 라우트(/mine, /trending 등)와 경로가 겹치지 않도록 파일 맨 마지막에 둠
router.get('/:id', async (req, res) => {
  const { data: place, error } = await supabase
    .from('places')
    .select('*')
    .eq('id', req.params.id)
    .eq('status', 'verified')
    .maybeSingle();

  if (error) {
    console.error('[places/:id GET]', error.message);
    return res.status(500).json({ error: error.message });
  }
  if (!place) return res.status(404).json({ error: '가게를 찾을 수 없어요.' });

  const { data: recData, error: recError } = await supabase
    .from('recommends')
    .select('place_id')
    .eq('place_id', place.id);
  if (recError) console.error('[places/:id GET] recommends 집계 에러:', recError.message);

  place.recommend_count = (recData ?? []).length;
  place.region_label = regionLabel(place.address);

  res.json(place);
});

// ── 사장님 가게 정보 관리 (메뉴 · 사진 · 기본정보) ──────────────────
// 사업자 인증(claim)이 관리자 승인까지 끝난 사장님만, 본인 가게에 한해 직접 수정 가능
async function requireApprovedOwner(req, res, next) {
  const { data: place, error } = await supabase
    .from('places')
    .select('id, owner_id, owner_claim_status, owner_edit_until')
    .eq('id', req.params.id)
    .single();
  if (error || !place) return res.status(404).json({ error: '가게를 찾을 수 없어요' });
  if (place.owner_id !== req.user.userId || place.owner_claim_status !== 'approved') {
    return res.status(403).json({ error: '이 가게를 관리할 권한이 없어요' });
  }
  const hasActiveAccess = place.owner_edit_until && new Date(place.owner_edit_until) > new Date();
  if (!hasActiveAccess) {
    return res.status(402).json({ error: '가게 관리 이용권을 먼저 구매해주세요', needsPayment: true });
  }
  req.place = place;
  next();
}

// 가게 기본 정보 수정 (소개글, 영업시간)
router.put('/:id/owner-edit', requireAuth, requireApprovedOwner, async (req, res) => {
  const { comment, opening_hours } = req.body;
  const update = {};
  if (comment !== undefined) update.comment = comment;
  if (opening_hours !== undefined) update.opening_hours = opening_hours;
  if (!Object.keys(update).length) return res.status(400).json({ error: '수정할 내용이 없어요' });

  const { data, error } = await supabase
    .from('places')
    .update(update)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 메뉴 목록 조회 (공개 — place.html에서도 사용)
router.get('/:id/menus', async (req, res) => {
  const { data, error } = await supabase
    .from('place_menus')
    .select('*')
    .eq('place_id', req.params.id)
    .order('display_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// 메뉴 추가
router.post('/:id/menus', requireAuth, requireApprovedOwner, async (req, res) => {
  const { name, price, photo_url, is_sold_out } = req.body;
  if (!name) return res.status(400).json({ error: '메뉴 이름은 필수예요' });

  const { data, error } = await supabase
    .from('place_menus')
    .insert({
      place_id: req.params.id,
      name,
      price: price ?? null,
      photo_url: photo_url ?? null,
      is_sold_out: !!is_sold_out,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 메뉴 수정
router.put('/:id/menus/:menuId', requireAuth, requireApprovedOwner, async (req, res) => {
  const { name, price, photo_url, is_sold_out, display_order } = req.body;
  const update = { updated_at: new Date().toISOString() };
  if (name !== undefined) update.name = name;
  if (price !== undefined) update.price = price;
  if (photo_url !== undefined) update.photo_url = photo_url;
  if (is_sold_out !== undefined) update.is_sold_out = !!is_sold_out;
  if (display_order !== undefined) update.display_order = display_order;

  const { data, error } = await supabase
    .from('place_menus')
    .update(update)
    .eq('id', req.params.menuId)
    .eq('place_id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: '메뉴를 찾을 수 없어요' });
  res.json(data);
});

// 메뉴 삭제
router.delete('/:id/menus/:menuId', requireAuth, requireApprovedOwner, async (req, res) => {
  const { error } = await supabase
    .from('place_menus')
    .delete()
    .eq('id', req.params.menuId)
    .eq('place_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// 가게 사진 목록 조회 (공개 — place.html 갤러리용)
router.get('/:id/photos', async (req, res) => {
  const { data, error } = await supabase
    .from('place_photos')
    .select('*')
    .eq('place_id', req.params.id)
    .order('display_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// 가게 사진 업로드 (기존 /photo-upload와 같은 방식, place-photos 버킷 재사용)
router.post('/:id/photos', requireAuth, requireApprovedOwner, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '이미지 파일이 없어요' });
  try {
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const filePath = `${req.params.id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('place-photos')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage.from('place-photos').getPublicUrl(filePath);

    const { data, error } = await supabase
      .from('place_photos')
      .insert({ place_id: req.params.id, photo_url: pub.publicUrl })
      .select()
      .single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('[places/:id/photos POST]', err.message);
    res.status(500).json({ error: '사진 업로드에 실패했어요' });
  }
});

// 가게 사진 삭제
router.delete('/:id/photos/:photoId', requireAuth, requireApprovedOwner, async (req, res) => {
  const { error } = await supabase
    .from('place_photos')
    .delete()
    .eq('id', req.params.photoId)
    .eq('place_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
