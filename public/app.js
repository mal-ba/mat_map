let currentUser = null;
let currentProvider = 'kakao';
let placesCache = [];

const maps = { kakao: null, naver: null, google: null };
const markers = { kakao: [], naver: [], google: [] };
const previewMarkers = { kakao: null, naver: null, google: null }; // 등록 모달용 미리보기 마커
const sdkPromises = {};

// ---------- SDK 지연 로드 ----------
function loadScriptOnce(key, src, onReady) {
  if (sdkPromises[key]) return sdkPromises[key];
  sdkPromises[key] = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => onReady(resolve);
    document.head.appendChild(script);
  });
  return sdkPromises[key];
}

function loadKakaoSDK() {
  const key = window.__CONFIG__.KAKAO_JS_KEY;
  return loadScriptOnce(
    'kakao',
    `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`,
    (resolve) => window.kakao.maps.load(resolve)
  );
}

function loadNaverSDK() {
  const clientId = window.__CONFIG__.NAVER_MAP_CLIENT_ID;
  return loadScriptOnce(
    'naver',
    `https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${clientId}`,
    (resolve) => resolve()
  );
}

function loadGoogleMapsSDK() {
  const key = window.__CONFIG__.GOOGLE_MAPS_JS_KEY;
  return loadScriptOnce(
    'google',
    `https://maps.googleapis.com/maps/api/js?key=${key}`,
    (resolve) => resolve()
  );
}

// ---------- 지도 초기화 ----------
async function initKakaoMap() {
  if (maps.kakao) return;
  await loadKakaoSDK();
  const center = new kakao.maps.LatLng(37.5665, 126.978);
  maps.kakao = new kakao.maps.Map(document.getElementById('map-kakao'), { center, level: 6 });
  renderKakaoMarkers(placesCache);
}

async function initNaverMap() {
  if (maps.naver) return;
  await loadNaverSDK();
  const center = new naver.maps.LatLng(37.5665, 126.978);
  maps.naver = new naver.maps.Map('map-naver', { center, zoom: 13 });
  renderNaverMarkers(placesCache);
}

async function initGoogleMap() {
  if (maps.google) return;
  await loadGoogleMapsSDK();
  const center = { lat: 37.5665, lng: 126.978 };
  maps.google = new google.maps.Map(document.getElementById('map-google'), { center, zoom: 12 });
  renderGoogleMarkers(placesCache);
}

// ---------- 미리보기 마커 (주소 검색 결과) ----------
function showPreviewMarker(lat, lng) {
  // 카카오
  if (maps.kakao) {
    if (previewMarkers.kakao) previewMarkers.kakao.setMap(null);
    const pos = new kakao.maps.LatLng(lat, lng);
    previewMarkers.kakao = new kakao.maps.Marker({ position: pos, map: maps.kakao });
    maps.kakao.panTo(pos);
  }
  // 네이버
  if (maps.naver) {
    if (previewMarkers.naver) previewMarkers.naver.setMap(null);
    const pos = new naver.maps.LatLng(lat, lng);
    previewMarkers.naver = new naver.maps.Marker({ position: pos, map: maps.naver });
    maps.naver.panTo(pos);
  }
  // 구글
  if (maps.google) {
    if (previewMarkers.google) previewMarkers.google.setMap(null);
    const pos = { lat, lng };
    previewMarkers.google = new google.maps.Marker({ position: pos, map: maps.google });
    maps.google.panTo(pos);
  }
}

function clearPreviewMarkers() {
  if (previewMarkers.kakao) { previewMarkers.kakao.setMap(null); previewMarkers.kakao = null; }
  if (previewMarkers.naver) { previewMarkers.naver.setMap(null); previewMarkers.naver = null; }
  if (previewMarkers.google) { previewMarkers.google.setMap(null); previewMarkers.google = null; }
}

// ---------- 마커 렌더링 ----------
function renderKakaoMarkers(places) {
  if (!maps.kakao) return;
  markers.kakao.forEach((m) => m.setMap(null));
  markers.kakao = places.map((p) => {
    const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(p.lat, p.lng), map: maps.kakao });
    kakao.maps.event.addListener(marker, 'click', () => maps.kakao.panTo(marker.getPosition()));
    return marker;
  });
}

function renderNaverMarkers(places) {
  if (!maps.naver) return;
  markers.naver.forEach((m) => m.setMap(null));
  markers.naver = places.map((p) => {
    const position = new naver.maps.LatLng(p.lat, p.lng);
    const marker = new naver.maps.Marker({ position, map: maps.naver });
    naver.maps.Event.addListener(marker, 'click', () => maps.naver.panTo(position));
    return marker;
  });
}

function renderGoogleMarkers(places) {
  if (!maps.google) return;
  markers.google.forEach((m) => m.setMap(null));
  markers.google = places.map((p) => {
    const position = { lat: p.lat, lng: p.lng };
    const marker = new google.maps.Marker({ position, map: maps.google });
    marker.addListener('click', () => maps.google.panTo(position));
    return marker;
  });
}

function renderAllMarkers(places) {
  renderKakaoMarkers(places);
  renderNaverMarkers(places);
  renderGoogleMarkers(places);
}

// ---------- 지도 탭 전환 ----------
function setupMapTabs() {
  document.querySelectorAll('.map-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      const provider = tab.dataset.provider;
      if (provider === currentProvider) return;

      document.querySelectorAll('.map-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.map-instance').forEach((el) => el.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`map-${provider}`).classList.add('active');
      currentProvider = provider;

      if (provider === 'kakao') await initKakaoMap();
      if (provider === 'naver') await initNaverMap();
      if (provider === 'google') await initGoogleMap();
    });
  });
}

function panActiveMapTo(lat, lng) {
  if (currentProvider === 'kakao' && maps.kakao) {
    maps.kakao.panTo(new kakao.maps.LatLng(lat, lng));
  } else if (currentProvider === 'naver' && maps.naver) {
    maps.naver.panTo(new naver.maps.LatLng(lat, lng));
  } else if (currentProvider === 'google' && maps.google) {
    maps.google.panTo({ lat, lng });
  }
}

// ---------- 주소 → 좌표 자동 변환 ----------
let geocodeTimer = null;

async function geocodeAddress(address) {
  const statusEl = document.getElementById('geocodeStatus');
  const resultEl = document.getElementById('geocodeResult');
  const latInput = document.getElementById('latInput');
  const lngInput = document.getElementById('lngInput');

  if (!address.trim()) {
    statusEl.textContent = '';
    resultEl.textContent = '';
    latInput.value = '';
    lngInput.value = '';
    clearPreviewMarkers();
    return;
  }

  statusEl.textContent = '🔍';
  resultEl.textContent = '주소 검색 중...';
  resultEl.style.color = '#888';

  try {
    const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
    if (!res.ok) {
      const err = await res.json();
      statusEl.textContent = '❌';
      resultEl.textContent = err.error || '주소를 찾을 수 없어요';
      resultEl.style.color = '#ef4444';
      latInput.value = '';
      lngInput.value = '';
      clearPreviewMarkers();
      return;
    }

    const { lat, lng, address_name } = await res.json();
    latInput.value = lat;
    lngInput.value = lng;
    statusEl.textContent = '✅';
    resultEl.textContent = `📍 ${address_name}`;
    resultEl.style.color = '#22c55e';
    showPreviewMarker(lat, lng);
  } catch (err) {
    statusEl.textContent = '❌';
    resultEl.textContent = '주소 검색 중 오류가 발생했어요';
    resultEl.style.color = '#ef4444';
  }
}

// ---------- 목록 ----------
async function loadPlaces() {
  try {
    const res = await fetch('/api/places');

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[loadPlaces] 서버 에러:', res.status, err.error || '');
      placesCache = [];
      renderAllMarkers([]);
      showEmptyState();
      return;
    }

    const data = await res.json();
    placesCache = Array.isArray(data) ? data : [];

    const list = document.getElementById('placeList');
    if (!placesCache.length) {
      showEmptyState();
    } else {
      list.innerHTML = placesCache
        .map(
          (p) => `
        <li class="place-card" data-lat="${p.lat}" data-lng="${p.lng}">
          <div class="verified-badge">인증</div>
          <h3>${escapeHtml(p.name)}</h3>
          <div class="addr">${escapeHtml(p.address)}${p.category ? ' · ' + escapeHtml(p.category) : ''}</div>
          ${p.rating ? `<div class="rating">⭐ ${p.rating} (리뷰 ${p.review_count ?? 0}개)</div>` : ''}
          ${p.comment ? `<div class="comment">${escapeHtml(p.comment)}</div>` : ''}
        </li>`
        )
        .join('');

      list.querySelectorAll('.place-card').forEach((card) => {
        card.addEventListener('click', () => {
          panActiveMapTo(parseFloat(card.dataset.lat), parseFloat(card.dataset.lng));
        });
      });
    }

    renderAllMarkers(placesCache);
  } catch (err) {
    console.error('[loadPlaces] fetch 실패:', err);
    placesCache = [];
    renderAllMarkers([]);
    showEmptyState();
  }
}

function showEmptyState() {
  const list = document.getElementById('placeList');
  list.innerHTML = '<li class="empty-state">아직 검증된 맛집이 없어요.<br>첫 번째로 등록해보세요.</li>';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- 구글 로그인 ----------
function initGoogleLogin() {
  if (!window.google || !window.__CONFIG__.GOOGLE_CLIENT_ID) return;

  google.accounts.id.initialize({
    client_id: window.__CONFIG__.GOOGLE_CLIENT_ID,
    callback: onGoogleCredential,
  });

  document.getElementById('loginBtn').addEventListener('click', () => {
    google.accounts.id.prompt();
  });
}

async function onGoogleCredential(response) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential: response.credential }),
  });
  if (!res.ok) return alert('로그인에 실패했어요.');
  const data = await res.json();
  currentUser = data.user;
  renderAuthArea();
}

function renderAuthArea() {
  const area = document.getElementById('authArea');
  const addBtn = document.getElementById('addBtn');
  if (currentUser) {
    area.innerHTML = `
      <span style="font-size:13px;font-weight:700">${escapeHtml(currentUser.name)}님 환영해요</span>
      <button id="logoutBtn" class="btn-ghost" style="margin-left:8px;font-size:12px;">로그아웃</button>
    `;
    addBtn.disabled = false;
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      currentUser = null;
      addBtn.disabled = true;
      area.innerHTML = `<button id="loginBtn" class="btn-ghost">Google로 시작하기</button>`;
      document.getElementById('loginBtn').addEventListener('click', () => {
        google.accounts.id.prompt();
      });
    });
  } else {
    area.innerHTML = `<button id="loginBtn" class="btn-ghost">Google로 시작하기</button>`;
    document.getElementById('loginBtn').addEventListener('click', () => {
      google.accounts.id.prompt();
    });
  }
}

// ---------- 등록 모달 ----------
function setupRegisterModal() {
  const modal = document.getElementById('registerModal');
  const form = document.getElementById('registerForm');
  const overlay = document.getElementById('verifyOverlay');
  const addressInput = document.getElementById('addressInput');

  // 주소 입력 시 디바운스 후 자동 지오코딩
  addressInput.addEventListener('input', () => {
    clearTimeout(geocodeTimer);
    geocodeTimer = setTimeout(() => {
      geocodeAddress(addressInput.value);
    }, 600); // 0.6초 후 자동 검색
  });

  document.getElementById('addBtn').addEventListener('click', () => {
    modal.showModal();
  });

  document.getElementById('cancelBtn').addEventListener('click', () => {
    modal.close();
    resetForm();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    body.lat = parseFloat(body.lat);
    body.lng = parseFloat(body.lng);

    if (isNaN(body.lat) || isNaN(body.lng)) {
      alert('주소를 입력하면 자동으로 위치가 검색됩니다.\n주소를 다시 확인해주세요.');
      return;
    }

    modal.close();
    overlay.classList.remove('hidden');

    try {
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const result = await res.json();
      overlay.classList.add('hidden');
      resetForm();

      if (result.status === 'verified') {
        alert('검증 완료! 지도에 공개되었습니다.');
      } else {
        alert(`검증 보류/반려: ${result.verify_reason || '사유 없음'}`);
      }
      loadPlaces();
    } catch (err) {
      overlay.classList.add('hidden');
      alert('등록 중 오류가 발생했어요.');
    }
  });
}

function resetForm() {
  document.getElementById('registerForm').reset();
  document.getElementById('geocodeStatus').textContent = '';
  document.getElementById('geocodeResult').textContent = '';
  document.getElementById('latInput').value = '';
  document.getElementById('lngInput').value = '';
  clearPreviewMarkers();
}

// ---------- 시작 ----------
window.addEventListener('DOMContentLoaded', async () => {
  setupMapTabs();
  await initKakaoMap();
  initGoogleLogin();
  setupRegisterModal();
  loadPlaces();
});
