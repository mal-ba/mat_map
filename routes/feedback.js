const express = require('express');
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');

const router = express.Router();

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);

function softAuth(req, res, next) {
  const token = req.cookies?.token;
  if (token) {
    try { req.user = jwt.verify(token, process.env.JWT_SECRET); } catch { /* 비로그인으로 진행 */ }
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

const TYPES = ['bug', 'suggestion', 'other'];

// 버그/건의사항 제보 (누구나)
router.post('/', softAuth, async (req, res) => {
  const { type, content, contact_email, page_url } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: '내용을 입력해주세요' });
  }
  try {
    const { data, error } = await supabase
      .from('feedback')
      .insert({
        user_id: req.user?.userId || null,
        type: TYPES.includes(type) ? type : 'other',
        content: content.slice(0, 2000),
        contact_email: (contact_email || '').slice(0, 200) || null,
        page_url: (page_url || '').slice(0, 500) || null,
      })
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, feedback: data });
  } catch (err) {
    console.error('[feedback/create]', err.message);
    res.status(500).json({ error: '제보 접수 중 오류가 발생했어요' });
  }
});

// 관리자 — 목록
router.get('/', requireAdmin, async (req, res) => {
  const status = req.query.status;
  try {
    let query = supabase
      .from('feedback')
      .select('id, user_id, type, content, contact_email, page_url, status, admin_note, created_at, resolved_at, users(name, email)')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[feedback/list]', err.message);
    res.status(500).json({ error: '목록을 불러오지 못했어요' });
  }
});

// 관리자 — 상태 변경
router.patch('/:id', requireAdmin, async (req, res) => {
  const { status, admin_note } = req.body;
  const VALID = ['new', 'in_progress', 'done'];
  if (status && !VALID.includes(status)) {
    return res.status(400).json({ error: '올바르지 않은 상태값이에요' });
  }
  try {
    const patch = {};
    if (status) patch.status = status;
    if (admin_note !== undefined) patch.admin_note = admin_note;
    if (status === 'done') patch.resolved_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('feedback')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, feedback: data });
  } catch (err) {
    console.error('[feedback/update]', err.message);
    res.status(500).json({ error: '업데이트 중 오류가 발생했어요' });
  }
});

module.exports = router;
