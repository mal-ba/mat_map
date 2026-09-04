const express = require('express');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const supabase = require('../services/supabase');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 구글 로그인
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'credential 누락' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('google_sub', payload.sub)
      .maybeSingle();

    let user = existing;
    if (!user) {
      const { data: created, error } = await supabase
        .from('users')
        .insert({
          google_sub: payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
        })
        .select()
        .single();
      if (error) throw error;
      user = created;
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({ user: { id: user.id, name: user.name, picture: user.picture, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: '구글 로그인 검증 실패' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// JWT만 검증 (userId, email 반환)
router.get('/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ userId: decoded.userId, email: decoded.email });
  } catch {
    res.status(401).json({ error: '토큰 만료/무효' });
  }
});

// 세션 복원용 - JWT 검증 후 Supabase에서 전체 프로필 반환
router.get('/profile', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, picture')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) return res.status(401).json({ error: '유저 없음' });

    res.json({ id: user.id, name: user.name, email: user.email, picture: user.picture });
  } catch {
    res.status(401).json({ error: '토큰 만료/무효' });
  }
});

module.exports = router;
