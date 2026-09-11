const express = require('express');
const supabase = require('../services/supabase');
const requireAuth = require('./requireAuth');

const router = express.Router();

// 유저 검색 (별명 또는 고유 코드로만) — 계정 원래 이름(name)은 검색 대상에서 제외
// 나 자신은 제외, 팔로우 상태도 같이 내려줌
router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim().replace(/[,()%]/g, '');
  if (!q) return res.json([]);

  try {
    const { data: found, error } = await supabase
      .from('users')
      .select('id, name, display_name, picture, avatar_url, user_code')
      .or(`display_name.ilike.%${q}%,user_code.ilike.%${q}%`)
      .neq('id', req.user.userId)
      .limit(20);
    if (error) throw error;

    const { data: myFollowing } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', req.user.userId);
    const followingSet = new Set((myFollowing || []).map(f => f.followee_id));

    const { data: myFollowers } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('followee_id', req.user.userId);
    const followerSet = new Set((myFollowers || []).map(f => f.follower_id));

    res.json((found || []).map(u => ({
      id: u.id,
      name: u.display_name || u.name,
      avatar_url: u.avatar_url || u.picture,
      user_code: u.user_code,
      following: followingSet.has(u.id),
      isFriend: followingSet.has(u.id) && followerSet.has(u.id),
    })));
  } catch (err) {
    console.error('[community/search]', err.message);
    res.status(500).json({ error: '검색 중 오류가 발생했어요' });
  }
});

// 팔로우
router.post('/follow/:userId', requireAuth, async (req, res) => {
  if (req.params.userId === req.user.userId) return res.status(400).json({ error: '자기 자신은 팔로우할 수 없어요' });
  const { error } = await supabase
    .from('follows')
    .upsert({ follower_id: req.user.userId, followee_id: req.params.userId }, { onConflict: 'follower_id,followee_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// 언팔로우
router.delete('/follow/:userId', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', req.user.userId)
    .eq('followee_id', req.params.userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// 내 친구 목록 (맞팔로우된 사람만)
router.get('/friends', requireAuth, async (req, res) => {
  try {
    const { data: following, error: e1 } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', req.user.userId);
    if (e1) throw e1;
    const followingIds = (following || []).map(f => f.followee_id);
    if (!followingIds.length) return res.json([]);

    const { data: followers, error: e2 } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('followee_id', req.user.userId)
      .in('follower_id', followingIds);
    if (e2) throw e2;
    const friendIds = (followers || []).map(f => f.follower_id);
    if (!friendIds.length) return res.json([]);

    const { data: friends, error: e3 } = await supabase
      .from('users')
      .select('id, name, display_name, picture, avatar_url')
      .in('id', friendIds);
    if (e3) throw e3;

    res.json((friends || []).map(u => ({
      id: u.id,
      name: u.display_name || u.name,
      avatar_url: u.avatar_url || u.picture,
    })));
  } catch (err) {
    console.error('[community/friends]', err.message);
    res.status(500).json({ error: '친구 목록을 불러오지 못했어요' });
  }
});

module.exports = router;
