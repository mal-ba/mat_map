const express = require('express');
const multer = require('multer');
const supabase = require('../services/supabase');
const requireAuth = require('./requireAuth');
const { verifyPlace, searchNaverPlace } = require('../services/verifyPlace');

const router = express.Router();

// 관리자 이메일만 반려 목록 조회/재검증/삭제 가능
const ADMIN_EMAILS = ['jehoon100703@gmail.com'];
function requireAdmin(req, res, next) {
  if (!ADMIN_EMAILS.includes(req.user?.email)) {
    return res.status(403).json({ error: '관리자만 할 수 있어요' });
  }
  next();
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

module.exports = router;
