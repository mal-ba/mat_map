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

// 프론트에 카카오/구글 키를 안전하게 전달 (JS 키는 원래 공개되는 키라 문제 없음)
app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(
    `window.__CONFIG__ = ${JSON.stringify({
      KAKAO_JS_KEY: process.env.KAKAO_JS_KEY || '',
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    })};`
  );
});

app.use('/api/auth', authRoutes);
app.use('/api/places', placesRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행중: http://localhost:${PORT}`));
