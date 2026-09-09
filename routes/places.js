const express = require('express');
const supabase = require('../services/supabase');
const requireAuth = require('./requireAuth');
const { verifyPlace } = require('../services/verifyPlace');

const router = express.Router();

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
  res.json(data ?? []);
});

// 내가 등록한 목록 (대기중/반려 포함, 마이페이지용)
router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('places')
    .select('*')
    .eq('submitted_by', req.user.userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[places GET /mine] Supabase 에러:', error.message);
    return res.status(500).json({ error: error.message });
  }
  res.json(data ?? []);
});

// 새 맛집 등록 -> 즉시 공개 X, 자동 검증 로직 통과해야 지도에 뜸
router.post('/', requireAuth, async (req, res) => {
  const { name, address, lat, lng, category, comment, image_url, show_on_maps } = req.body;
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
    // 실제 거리 계산 (하버사인)
    const tooClose = nearbyPlaces.find(p => {
      const dLat = (p.lat - lat) * Math.PI / 180;
      const dLng = (p.lng - lng) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 +
        Math.cos(lat*Math.PI/180) * Math.cos(p.lat*Math.PI/180) * Math.sin(dLng/2)**2;
      const dist = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return dist < 100; // 100m 이내
    });
    if (tooClose) {
      return res.status(409).json({
        error: `이미 등록된 가게와 너무 가까워요. "${tooClose.name}"이(가) 근처에 있어요.`,
        duplicate: true,
      });
    }
  }
  // ─────────────────────────────────────────────────────────

  const verdict = await verifyPlace({ name, address, lat, lng });

  const { data, error } = await supabase
    .from('places')
    .insert({
      name,
      address,
      lat,
      lng,
      category,
      comment,
      image_url,
      submitted_by: req.user.userId,
      status: verdict.status,
      verify_reason: verdict.reason,
      kakao_place_id: verdict.kakao_place_id,
      show_on_maps: show_on_maps || 'kakao,naver,google',
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
    const LEVELS = [480, 240, 120, 60, 30, 15];
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

module.exports = router;
