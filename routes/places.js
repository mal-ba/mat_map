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

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 내가 등록한 목록 (대기중/반려 포함, 마이페이지용)
router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('places')
    .select('*')
    .eq('submitted_by', req.user.userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 새 맛집 등록 -> 즉시 공개 X, 자동 검증 로직 통과해야 지도에 뜸
router.post('/', requireAuth, async (req, res) => {
  const { name, address, lat, lng, category, comment, image_url } = req.body;
  if (!name || !address || lat == null || lng == null) {
    return res.status(400).json({ error: '이름/주소/좌표는 필수입니다' });
  }

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
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
