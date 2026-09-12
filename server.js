require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const placesRoutes = require('./routes/places');
const communityRoutes = require('./routes/community');
const paymentsRoutes = require('./routes/payments');

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

// fetch + JSON 파싱을 안전하게 — 응답이 비어있거나 JSON이 아니어도 예외를 던지지 않고
// { ok, status, data, raw } 형태로 돌려줘서, 한 단계가 깨져도 다음 단계로 계속 진행할 수 있게 함
async function safeFetchJson(label, url, options) {
  try {
    const res = await fetch(url, options);
    const rawText = await res.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (parseErr) {
      console.log(`[geocode] ${label} — JSON 파싱 실패 (status:${res.status}), 원문: ${rawText.slice(0, 300) || '(빈 응답)'}`);
      return { ok: false, status: res.status, data: null };
    }
    if (!res.ok) {
      console.log(`[geocode] ${label} — status:${res.status}, 응답: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { ok: res.ok, status: res.status, data };
  } catch (networkErr) {
    console.log(`[geocode] ${label} — 네트워크 오류: ${networkErr.message}`);
    return { ok: false, status: 0, data: null };
  }
}

// 주소 → 좌표 변환 (네이버 1차 → 카카오 → 구글 → 이름 기반 장소검색 fallback)
app.get('/api/geocode', async (req, res) => {
  const { address, name } = req.query;
  if (!address) return res.status(400).json({ error: '주소가 필요합니다' });

  console.log(`[geocode] 시작 — 주소: "${address}", 이름: "${name || '(없음)'}"`);
  console.log(`[geocode] 키 상태 — NAVER_MAP_CLIENT_ID: ${process.env.NAVER_MAP_CLIENT_ID ? 'O' : '❌ 없음'}, NAVER_CLIENT_SECRET: ${process.env.NAVER_CLIENT_SECRET ? 'O' : '❌ 없음'}, KAKAO_REST_API_KEY: ${process.env.KAKAO_REST_API_KEY ? 'O' : '❌ 없음'}, GOOGLE_PLACES_API_KEY: ${process.env.GOOGLE_PLACES_API_KEY ? 'O' : '❌ 없음'}`);

  // 1차: 네이버 지오코딩
  if (process.env.NAVER_CLIENT_SECRET) {
    const { data: naverData } = await safeFetchJson(
      '네이버',
      `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`,
      { headers: NAVER_HEADERS() }
    );
    if (naverData?.addresses?.length) {
      const { x: lng, y: lat, roadAddress, jibunAddress } = naverData.addresses[0];
      const address_name = roadAddress || jibunAddress;
      console.log(`[geocode] 네이버 성공: ${address_name}`);
      return res.json({ lat: parseFloat(lat), lng: parseFloat(lng), address_name });
    }
  } else {
    console.log('[geocode] 네이버 스킵 — NAVER_CLIENT_SECRET 없음');
  }

  // 2차: 카카오 주소 검색
  const { data: kakaoData } = await safeFetchJson(
    '카카오 주소 검색',
    `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
    { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } }
  );
  if (kakaoData?.documents?.length) {
    const { x: lng, y: lat, address_name } = kakaoData.documents[0];
    console.log(`[geocode] 카카오 주소 검색 성공: ${address_name}`);
    return res.json({ lat: parseFloat(lat), lng: parseFloat(lng), address_name });
  }

  // 3차: 구글
  const { data: googleData } = await safeFetchJson(
    '구글',
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_PLACES_API_KEY}&language=ko&region=KR`
  );
  if (googleData?.results?.length) {
    const { lat, lng } = googleData.results[0].geometry.location;
    console.log(`[geocode] 구글 성공: ${googleData.results[0].formatted_address}`);
    return res.json({ lat, lng, address_name: googleData.results[0].formatted_address });
  }

  // 4차: 셋 다 주소로는 못 찾았을 때 — 가게 이름으로 카카오 장소(키워드) 검색해서 좌표를 대신 확보
  // (신축 복합건물처럼 지번 주소가 지오코딩 DB와 어긋나 있어도, 이미 카카오에 등록된 가게 이름으로는 찾히는 경우가 있음)
  if (name && process.env.KAKAO_REST_API_KEY) {
    console.log(`[geocode] 이름으로 장소 검색 시도: "${name}"`);
    const { data: kakaoPlaceData } = await safeFetchJson(
      '이름 검색',
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(name)}`,
      { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } }
    );
    const doc = kakaoPlaceData?.documents?.[0];
    if (doc) {
      console.log(`[geocode] 이름 검색 성공: ${doc.place_name} (${doc.road_address_name || doc.address_name})`);
      return res.json({
        lat: parseFloat(doc.y),
        lng: parseFloat(doc.x),
        address_name: doc.road_address_name || doc.address_name,
      });
    }
  } else if (!name) {
    console.log('[geocode] 이름 검색 스킵 — name 파라미터가 안 넘어옴 (프론트가 예전 app.js를 쓰고 있을 가능성)');
  } else {
    console.log('[geocode] 이름 검색 스킵 — KAKAO_REST_API_KEY 없음');
  }

  console.log(`[geocode] 최종 실패 — "${address}" (이름: "${name || '(없음)'}") 어떤 방법으로도 못 찾음`);
  return res.status(404).json({ error: '주소를 찾을 수 없어요.' });
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
app.use('/api/payments', paymentsRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행중: http://localhost:${PORT}`));
