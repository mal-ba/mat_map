const express = require('express');
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');

const router = express.Router();

const ADMIN_EMAILS = ['jehoon100703@gmail.com'];

// 로그인 안 해도 신고는 가능 — 되어 있으면 누가 신고했는지만 같이 기록
function softAuth(req, res, next) {
  const token = req.cookies?.token;
  if (token) {
    try { req.user = jwt.verify(token, process.env.JWT_SECRET); } catch { /* 무시하고 비로그인으로 진행 */ }
  }
  next();
}

function requireAdmin(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: '로그인이 필요합니다' });
  }
  if (!ADMIN_EMAILS.includes(req.user.email)) {
    return res.status(403).json({ error: '관리자만 할 수 있어요' });
  }
  next();
}

const REASON_TYPES = ['closed', 'wrong_info', 'fake_review', 'bad_photo', 'other'];

// 맛집 신고 등록 (누구나)
router.post('/', softAuth, async (req, res) => {
  const { place_id, reason_type, description } = req.body;
  if (!place_id || !REASON_TYPES.includes(reason_type)) {
    return res.status(400).json({ error: '신고 대상과 사유를 확인해주세요' });
  }

  try {
    const { data, error } = await supabase
      .from('reports')
      .insert({
        place_id,
        reporter_id: req.user?.userId || null,
        reason_type,
        description: (description || '').slice(0, 1000),
      })
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, report: data });
  } catch (err) {
    console.error('[reports/create]', err.message);
    res.status(500).json({ error: '신고 접수 중 오류가 발생했어요' });
  }
});

// 관리자 — 신고 목록 (기본: 대기중인 것부터)
router.get('/', requireAdmin, async (req, res) => {
  const status = req.query.status; // 없으면 전체
  try {
    let query = supabase
      .from('reports')
      .select('id, place_id, reporter_id, reason_type, description, status, admin_note, created_at, resolved_at, places(name, address, status)')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[reports/list]', err.message);
    res.status(500).json({ error: '목록을 불러오지 못했어요' });
  }
});

// 관리자 — 신고 상태 변경 (검토/처리완료/반려 + 메모)
router.patch('/:id', requireAdmin, async (req, res) => {
  const { status, admin_note } = req.body;
  const VALID = ['pending', 'reviewing', 'resolved', 'dismissed'];
  if (status && !VALID.includes(status)) {
    return res.status(400).json({ error: '올바르지 않은 상태값이에요' });
  }
  try {
    const patch = {};
    if (status) patch.status = status;
    if (admin_note !== undefined) patch.admin_note = admin_note;
    if (status === 'resolved' || status === 'dismissed') patch.resolved_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('reports')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, report: data });
  } catch (err) {
    console.error('[reports/update]', err.message);
    res.status(500).json({ error: '업데이트 중 오류가 발생했어요' });
  }
});

module.exports = router;
