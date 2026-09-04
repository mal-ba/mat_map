require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const placesRoutes = require('./routes/places');

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

// 주소 → 좌표 변환 (카카오 1차 → 구글 fallback)
app.get('/api/geocode', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: '주소가 필요합니다' });

  try {
    // 1차: 카카오 지오코딩 (한국 주소에 강함)
    const kakaoRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
      { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } }
    );
    const kakaoData = await kakaoRes.json();

    if (kakaoData.documents?.length) {
      const { x: lng, y: lat, address_name } = kakaoData.documents[0];
      console.log(`[geocode] 카카오 성공: ${address_name}`);
      return res.json({ lat: parseFloat(lat), lng: parseFloat(lng), address_name });
    }

    // 2차: 카카오가 못 찾으면 구글 지오코딩으로 fallback
    console.log(`[geocode] 카카오 실패, 구글 fallback 시도: ${address}`);
    const googleRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_PLACES_API_KEY}&language=ko&region=KR`
    );
    const googleData = await googleRes.json();

    if (googleData.results?.length) {
      const { lat, lng } = googleData.results[0].geometry.location;
      const address_name = googleData.results[0].formatted_address;
      console.log(`[geocode] 구글 성공: ${address_name}`);
      return res.json({ lat, lng, address_name });
    }

    return res.status(404).json({ error: '주소를 찾을 수 없어요. 더 자세한 주소를 입력해보세요.' });
  } catch (err) {
    console.error('[geocode] 오류:', err.message);
    res.status(500).json({ error: '주소 검색 중 오류가 발생했어요' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/places', placesRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행중: http://localhost:${PORT}`));
