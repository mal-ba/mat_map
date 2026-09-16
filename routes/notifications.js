const express = require('express');
const supabase = require('../services/supabase');
const requireAuth = require('./requireAuth');

const router = express.Router();

// 내 알림 목록 (최근 50개, 최신순)
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, place_id, type, message, read_at, created_at, places(name)')
    .eq('user_id', req.user.userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 안 읽은 알림 개수 — 종 아이콘 배지 표시용
router.get('/unread-count', requireAuth, async (req, res) => {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.userId)
    .is('read_at', null);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ count: count || 0 });
});

// 알림 읽음 처리
router.post('/:id/read', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
