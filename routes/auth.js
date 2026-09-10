const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const supabase = require('../services/supabase');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 이메일 인증코드 발송용
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// 프로필 사진 업로드용 (메모리에 잠깐 올렸다가 바로 Supabase Storage로 전송)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('이미지 파일만 업로드할 수 있어요'));
    cb(null, true);
  },
});

function issueToken(res, user) {
  const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

// 소셜 로그인 공통 처리: 같은 이메일 계정이 있으면 연결, 없으면 새로 생성
async function findOrCreateSocialUser({ provider, providerId, email, name, picture }) {
  const providerCol = { google: 'google_sub', kakao: 'kakao_sub', naver: 'naver_sub' }[provider];

  const { data: byProvider } = await supabase
    .from('users')
    .select('*')
    .eq(providerCol, providerId)
    .maybeSingle();
  if (byProvider) {
    const nameChanged = name && name !== byProvider.name;
    const pictureChanged = picture && picture !== byProvider.picture;
    if (nameChanged || pictureChanged) {
      const updates = {};
      if (nameChanged) {
        updates.name = name;
        // 표시이름을 따로 커스텀한 적 없다면(예전 name과 같다면) 표시이름도 같이 갱신
        if (!byProvider.display_name || byProvider.display_name === byProvider.name) {
          updates.display_name = name;
        }
      }
      if (pictureChanged) updates.picture = picture;
      const { data: updated, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', byProvider.id)
        .select()
        .single();
      if (error) throw error;
      return updated;
    }
    return byProvider;
  }

  if (email) {
    const { data: byEmail } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (byEmail) {
      const { data: linked, error } = await supabase
        .from('users')
        .update({ [providerCol]: providerId, picture: byEmail.picture || picture })
        .eq('id', byEmail.id)
        .select()
        .single();
      if (error) throw error;
      return linked;
    }
  }

  const { data: created, error } = await supabase
    .from('users')
    .insert({ [providerCol]: providerId, email, name, display_name: name, picture })
    .select()
    .single();
  if (error) throw error;
  return created;
}

function frontendRedirect(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// 구글 로그인 (Google Identity Services에서 받은 credential 검증)
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'credential 누락' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const user = await findOrCreateSocialUser({
      provider: 'google',
      providerId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    });

    issueToken(res, user);

    res.json({
      user: {
        id: user.id,
        name: user.display_name || user.name,
        picture: user.avatar_url || user.picture,
        email: user.email,
        onboarding_completed: user.onboarding_completed,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: '구글 로그인 검증 실패' });
  }
});

// 카카오 로그인 — 1) 카카오 인증 화면으로 리다이렉트
router.get('/kakao', (req, res) => {
  const url = new URL('https://kauth.kakao.com/oauth/authorize');
  url.searchParams.set('client_id', process.env.KAKAO_REST_API_KEY);
  url.searchParams.set('redirect_uri', process.env.KAKAO_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  res.redirect(url.toString());
});

// 카카오 로그인 — 2) 콜백: code를 토큰으로 교환하고 프로필 조회 후 로그인 처리
router.get('/kakao/callback', async (req, res) => {
  const { code } = req.query;
  const base = frontendRedirect(req);
  if (!code) return res.redirect(`${base}/login.html?error=kakao`);

  try {
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KAKAO_REST_API_KEY,
        client_secret: process.env.KAKAO_CLIENT_SECRET,
        redirect_uri: process.env.KAKAO_REDIRECT_URI,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[kakao/callback] 토큰 응답 상세:', JSON.stringify(tokenData));
      throw new Error('카카오 토큰 발급 실패');
    }

    const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = await meRes.json();
    const account = me.kakao_account || {};

    const user = await findOrCreateSocialUser({
      provider: 'kakao',
      providerId: String(me.id),
      email: account.email || null,
      name: account.profile?.nickname || '카카오 사용자',
      picture: account.profile?.profile_image_url || null,
    });

    issueToken(res, user);
    res.redirect(user.onboarding_completed ? base : `${base}/onboarding.html`);
  } catch (err) {
    console.error('[kakao/callback]', err.message);
    res.redirect(`${base}/login.html?error=kakao`);
  }
});

// 네이버 로그인 — 1) 네이버 인증 화면으로 리다이렉트 (CSRF 방지용 state 쿠키 발급)
router.get('/naver', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('naver_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 5 * 60 * 1000 });

  const url = new URL('https://nid.naver.com/oauth2.0/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.NAVER_LOGIN_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.NAVER_LOGIN_REDIRECT_URI);
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

// 네이버 로그인 — 2) 콜백
router.get('/naver/callback', async (req, res) => {
  const { code, state } = req.query;
  const base = frontendRedirect(req);
  const savedState = req.cookies?.naver_oauth_state;
  res.clearCookie('naver_oauth_state');

  if (!code || !state || state !== savedState) return res.redirect(`${base}/login.html?error=naver`);

  try {
    const tokenRes = await fetch(
      `https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${process.env.NAVER_LOGIN_CLIENT_ID}&client_secret=${process.env.NAVER_LOGIN_CLIENT_SECRET}&code=${code}&state=${state}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[naver/callback] 토큰 응답 상세:', JSON.stringify(tokenData));
      throw new Error('네이버 토큰 발급 실패');
    }

    const meRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = await meRes.json();
    const profile = me.response || {};

    const user = await findOrCreateSocialUser({
      provider: 'naver',
      providerId: profile.id,
      email: profile.email || null,
      name: profile.name || profile.nickname || '네이버 사용자',
      picture: profile.profile_image || null,
    });

    issueToken(res, user);
    res.redirect(user.onboarding_completed ? base : `${base}/onboarding.html`);
  } catch (err) {
    console.error('[naver/callback]', err.message);
    res.redirect(`${base}/login.html?error=naver`);
  }
});

// 이메일 인증코드 발송
router.post('/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요' });

  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id, password_hash')
      .eq('email', email)
      .maybeSingle();
    if (existing?.password_hash) return res.status(409).json({ error: '이미 가입된 이메일이에요' });

    const code = String(crypto.randomInt(100000, 999999));
    await supabase.from('email_verifications').delete().eq('email', email);
    await supabase.from('email_verifications').insert({
      email,
      code,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: '[찐맛집] 이메일 인증코드',
      html: `<p>인증코드: <b style="font-size:20px;">${code}</b></p><p>10분 안에 입력해주세요.</p>`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[send-code]', err.message);
    res.status(500).json({ error: '인증코드 발송에 실패했어요' });
  }
});

// 이메일 인증코드 확인
router.post('/verify-code', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: '이메일과 코드를 입력해주세요' });

  try {
    const { data: row } = await supabase
      .from('email_verifications')
      .select('*')
      .eq('email', email)
      .eq('code', code)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) return res.status(400).json({ error: '인증코드가 올바르지 않아요' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: '인증코드가 만료됐어요' });

    await supabase.from('email_verifications').update({ verified: true }).eq('id', row.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[verify-code]', err.message);
    res.status(500).json({ error: '인증 확인 중 오류가 발생했어요' });
  }
});

// 이메일 회원가입 (인증코드 확인 완료된 이메일만 가능)
router.post('/signup', async (req, res) => {
  const { email, password, name, code } = req.body;
  if (!email || !password || !code) return res.status(400).json({ error: '이메일, 비밀번호, 인증코드를 입력해주세요' });
  if (password.length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 해요' });

  try {
    const { data: verifiedRow } = await supabase
      .from('email_verifications')
      .select('*')
      .eq('email', email)
      .eq('code', code)
      .eq('verified', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!verifiedRow || new Date(verifiedRow.expires_at) < new Date()) {
      return res.status(400).json({ error: '이메일 인증을 먼저 완료해주세요' });
    }

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) return res.status(409).json({ error: '이미 가입된 이메일이에요' });

    const password_hash = await bcrypt.hash(password, 10);
    const { data: user, error } = await supabase
      .from('users')
      .insert({
        email,
        password_hash,
        name: name?.trim() || email.split('@')[0],
        display_name: name?.trim() || email.split('@')[0],
      })
      .select()
      .single();
    if (error) throw error;

    await supabase.from('email_verifications').delete().eq('email', email);

    issueToken(res, user);
    res.json({ user: { id: user.id, name: user.display_name || user.name, picture: user.avatar_url || null, email: user.email, onboarding_completed: user.onboarding_completed } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '회원가입 중 오류가 발생했어요' });
  }
});

// 이메일 로그인
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요' });

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않아요' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않아요' });

    issueToken(res, user);
    res.json({ user: { id: user.id, name: user.display_name || user.name, picture: user.avatar_url || user.picture, email: user.email, onboarding_completed: user.onboarding_completed } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '로그인 중 오류가 발생했어요' });
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
      .select('id, name, email, picture, avatar_url, display_name, bio, birthdate, role, onboarding_completed, badge_level, registered_count, visit_count')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) return res.status(401).json({ error: '유저 없음' });

    res.json(user);
  } catch {
    res.status(401).json({ error: '토큰 만료/무효' });
  }
});

// 뱃지 레벨 계산 (5개부터 시작, 5→10→15→30→60→120)
function calcBadge(count) {
  const LEVELS = [120, 60, 30, 15, 10, 5];
  for (let i = 0; i < LEVELS.length; i++) {
    if (count >= LEVELS[i]) return LEVELS.length - i;
  }
  return 0;
}

// 접속 기록 업데이트
router.post('/visit', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: '비로그인' });
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // visit_count 현재값 가져와서 +1
    const { data: u } = await supabase.from('users').select('visit_count').eq('id', decoded.userId).single();
    await supabase.from('users').update({
      last_visited_at: new Date().toISOString(),
      visit_count: (u?.visit_count || 0) + 1,
    }).eq('id', decoded.userId);
    res.json({ ok: true });
  } catch { res.status(401).json({ error: '토큰 오류' }); }
});

// 프로필 업데이트
router.put('/profile', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { display_name, bio } = req.body;
    const { data, error } = await supabase
      .from('users')
      .update({ display_name, bio })
      .eq('id', decoded.userId)
      .select('id, name, email, picture, avatar_url, display_name, bio, birthdate, role, onboarding_completed, badge_level, registered_count, visit_count')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch { res.status(401).json({ error: '토큰 오류' }); }
});

// 온보딩 완료 처리 (가입 직후 생년월일/별명 필수, 소개글은 선택)
router.put('/onboarding', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { display_name, birthdate, bio, role } = req.body;

    if (!display_name?.trim()) return res.status(400).json({ error: '별명을 입력해주세요' });
    if (!birthdate) return res.status(400).json({ error: '생년월일을 입력해주세요' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return res.status(400).json({ error: '생년월일 형식이 올바르지 않아요' });
    const todayStr = new Date().toISOString().split('T')[0];
    if (birthdate > todayStr) return res.status(400).json({ error: '생년월일은 오늘 이전 날짜만 가능해요' });
    if (!['customer', 'owner'].includes(role)) return res.status(400).json({ error: '고객/사장 중 하나를 선택해주세요' });

    const { data, error } = await supabase
      .from('users')
      .update({
        display_name: display_name.trim(),
        birthdate,
        bio: bio?.trim() || null,
        role,
        onboarding_completed: true,
      })
      .eq('id', decoded.userId)
      .select('id, name, email, picture, avatar_url, display_name, bio, birthdate, role, onboarding_completed, badge_level, registered_count, visit_count')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch { res.status(401).json({ error: '토큰 오류' }); }
});
router.post('/profile/avatar', upload.single('avatar'), async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  if (!req.file) return res.status(400).json({ error: '이미지 파일이 없어요' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const filePath = `${decoded.userId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(filePath);
    const avatar_url = pub.publicUrl;

    const { data, error } = await supabase
      .from('users')
      .update({ avatar_url })
      .eq('id', decoded.userId)
      .select('id, name, email, picture, avatar_url, display_name, bio, birthdate, role, onboarding_completed, badge_level, registered_count, visit_count')
      .single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('[profile/avatar]', err.message);
    res.status(500).json({ error: '사진 업로드에 실패했어요' });
  }
});

// 공개 프로필 조회
router.get('/public-profile/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, display_name, picture, avatar_url, bio, badge_level, registered_count')
    .eq('id', req.params.userId)
    .single();
  if (error || !data) return res.status(404).json({ error: '유저 없음' });
  res.json(data);
});

// 유저의 등록 맛집 목록
router.get('/public-places/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('places')
    .select('id, name, address, category, comment, status, created_at')
    .eq('submitted_by', req.params.userId)
    .eq('status', 'verified')
    .order('created_at', { ascending: false });
  res.json(data || []);
});

module.exports = router;
