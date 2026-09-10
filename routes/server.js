require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const placesRoutes = require('./routes/places');
const communityRoutes = require('./routes/community');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 프론트에 지도/로그인 키를 안전하게 전달
app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(
    `window.__CONFIG__ = ${JSON.stringify({
      KAKAO_JS_KEY: process.env.KAKAO_JS_KEY || '',
      NAVER_MAP_CLIENT_ID: process.env.NAVER_MAP_CLIENT_ID || '',
      GOOGLE_MAPS_JS_KEY: process.env.GOOGLE_MAPS_JS_KEY || '',
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    })};`
  );
});

const NAVER_HEADERS = () => ({
  'X-NCP-APIGW-API-KEY-ID': process.env.NAVER_MAP_CLIENT_ID,
  'X-NCP-APIGW-API-KEY': process.env.NAVER_CLIENT_SECRET,
});

// 주소 → 좌표 변환 (네이버 1차 → 카카오 → 구글 fallback)
app.get('/api/geocode', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: '주소가 필요합니다' });

  try {
    // 1차: 네이버 지오코딩
    if (process.env.NAVER_CLIENT_SECRET) {
      const naverRes = await fetch(
        `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`,
        { headers: NAVER_HEADERS() }
      );
      const naverData = await naverRes.json();
      if (naverData.addresses?.length) {
        const { x: lng, y: lat, roadAddress, jibunAddress } = naverData.addresses[0];
        const address_name = roadAddress || jibunAddress;
        console.log(`[geocode] 네이버 성공: ${address_name}`);
        return res.json({ lat: parseFloat(lat), lng: parseFloat(lng), address_name });
      }
    }

    // 2차: 카카오
    console.log(`[geocode] 네이버 실패, 카카오 시도: ${address}`);
    const kakaoRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
      { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } }
    );
    const kakaoData = await kakaoRes.json();
    if (kakaoData.documents?.length) {
      const { x: lng, y: lat, address_name } = kakaoData.documents[0];
      return res.json({ lat: parseFloat(lat), lng: parseFloat(lng), address_name });
    }

    // 3차: 구글
    const googleRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_PLACES_API_KEY}&language=ko&region=KR`
    );
    const googleData = await googleRes.json();
    if (googleData.results?.length) {
      const { lat, lng } = googleData.results[0].geometry.location;
      return res.json({ lat, lng, address_name: googleData.results[0].formatted_address });
    }

    return res.status(404).json({ error: '주소를 찾을 수 없어요.' });
  } catch (err) {
    console.error('[geocode] 오류:', err.message);
    res.status(500).json({ error: '주소 검색 중 오류가 발생했어요' });
  }
});

// 장소 검색 (네이버 Place Search → 지도에 표시)
app.get('/api/search-places', async (req, res) => {
  const { query, lat, lng } = req.query;
  if (!query) return res.status(400).json({ error: '검색어 필요' });

  try {
    const coord = lat && lng ? `&coordinate=${lng},${lat}` : '';
    const r = await fetch(
      `https://naveropenapi.apigw.ntruss.com/map-place/v1/search?query=${encodeURIComponent(query)}${coord}`,
      { headers: NAVER_HEADERS() }
    );
    const data = await r.json();
    const places = (data.places || []).map(p => ({
      place_name: p.name,
      address_name: p.roadAddress || p.address,
      lat: parseFloat(p.y),
      lng: parseFloat(p.x),
      category: p.category,
      naver_place_id: p.id,
    }));
    res.json(places);
  } catch (err) {
    console.error('[search-places]', err.message);
    res.status(500).json([]);
  }
});

// 관리자 강제 등록 (검증 생략, 바로 verified)
app.post('/api/admin/force-place', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });

  const jwt = require('jsonwebtoken');
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: '토큰 만료' }); }

  const { name, address, lat, lng, category, comment } = req.body;
  if (!name || !address || lat == null || lng == null) {
    return res.status(400).json({ error: '필수 항목 누락' });
  }

  const supabase = require('./services/supabase');
  const { data, error } = await supabase
    .from('places')
    .insert({
      name, address, lat, lng, category, comment,
      submitted_by: decoded.userId,
      status: 'verified',
      verify_reason: '관리자 직접 등록',
    })
    .select().single();

  if (error) {
    console.error('[admin/force-place]', error.message);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// 카카오 장소 대표사진 프록시 (CORS 우회)
app.get('/api/place-image', async (req, res) => {
  const { place_id } = req.query;
  if (!place_id) return res.status(400).json({ error: 'place_id 필요' });
  try {
    const r = await fetch(
      `https://place.map.kakao.com/main/v/${place_id}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://map.kakao.com/' } }
    );
    const json = await r.json();
    const img = json?.basicInfo?.mainphotourl || json?.basicInfo?.photoList?.[0]?.orgurl || null;
    res.json({ image_url: img });
  } catch {
    res.json({ image_url: null });
  }
});

// 관리자용 유저 접속 현황
app.get('/api/admin/users', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: '비로그인' });
  try {
    const jwt = require('jsonwebtoken');
    jwt.verify(token, process.env.JWT_SECRET);
    const supabase = require('./services/supabase');
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, badge_level, registered_count, visit_count, last_visited_at, created_at')
      .order('last_visited_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch { res.status(401).json({ error: '인증 오류' }); }
});

app.use('/api/auth', authRoutes);
app.use('/api/places', placesRoutes);
app.use('/api/community', communityRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행중: http://localhost:${PORT}`));
