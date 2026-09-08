// ---------- 콘솔 에러 수집 (진단 패널용) ----------
const _consoleLogs = [];
const _origConsoleError = console.error;
const _origConsoleWarn = console.warn;
console.error = function(...args) {
  _consoleLogs.push({ type: 'error', msg: args.join(' '), time: new Date().toLocaleTimeString() });
  _origConsoleError.apply(console, args);
};
console.warn = function(...args) {
  _consoleLogs.push({ type: 'warn', msg: args.join(' '), time: new Date().toLocaleTimeString() });
  _origConsoleWarn.apply(console, args);
};

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
    `https://openapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${clientId}`,
    (resolve) => resolve()
  );
}

function loadGoogleMapsSDK() {
  const key = window.__CONFIG__.GOOGLE_MAPS_JS_KEY;
  return loadScriptOnce(
    'google',
    `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&v=weekly`,
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

  // console.error 가로채기 — 네이버 인증 실패 감지
  let naverAuthError = null;
  const origError = console.error;
  console.error = function(...args) {
    const msg = args.join(' ');
    if (msg.includes('Authentication Failed') || msg.includes('인증이 실패')) {
      naverAuthError = msg;
    }
    origError.apply(console, args);
  };

  await loadNaverSDK();
  console.error = origError; // 원복

  const clientId = window.__CONFIG__?.NAVER_MAP_CLIENT_ID || '(없음)';

  if (naverAuthError || typeof naver === 'undefined' || !naver.maps) {
    document.getElementById('map-naver').innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
      'flex-direction:column;gap:10px;color:#5A4F3F;font-family:Noto Sans KR,sans-serif;padding:24px;text-align:center;">' +
      '<div style="font-size:28px;">⚠️</div>' +
      '<div style="font-size:14px;font-weight:700;color:#B23A2E;">네이버 지도 인증 실패</div>' +
      '<div style="font-size:11px;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:4px;' +
      'padding:10px 14px;text-align:left;max-width:320px;word-break:break-all;line-height:1.8;">' +
      '<b>Client ID:</b> ' + clientId.slice(0,10) + '...<br>' +
      '<b>등록 URL:</b> ' + location.origin + '<br>' +
      '<b>에러:</b> ' + (naverAuthError || 'SDK 로드 실패') +
      '</div>' +
      '<div style="font-size:11px;color:#888;margin-top:4px;">NCP → Maps → Application에서<br>Web 서비스 URL 확인 후 최대 30분 대기</div>' +
      '</div>';
    return;
  }

  const center = new naver.maps.LatLng(37.5665, 126.978);
  maps.naver = new naver.maps.Map('map-naver', { center, zoom: 13 });

  // 탭 전환 후 컨테이너 크기 재계산
  setTimeout(() => {
    naver.maps.Event.trigger(maps.naver, 'resize');
    maps.naver.setCenter(center);
  }, 100);

  renderNaverMarkers(placesCache);
}

async function initGoogleMap() {
  if (maps.google) return;
  await loadGoogleMapsSDK();
  const center = { lat: 37.5665, lng: 126.978 };
  maps.google = new google.maps.Map(document.getElementById('map-google'), {
    center, zoom: 12,
    streetViewControl: false,
    mapTypeControl: false,
  });

  // 스트리트뷰 파노라마 초기화 (한 번만)
  maps.streetview = new google.maps.StreetViewPanorama(
    document.getElementById('streetview-map'),
    { visible: false, addressControl: true, fullscreenControl: false }
  );
  maps.google.setStreetView(maps.streetview);

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
    marker.addListener('click', () => {
      maps.google.panTo(position);
      openStreetView(p.lat, p.lng, p.name);
    });
    return marker;
  });
}

function openStreetView(lat, lng, name) {
  const sv = new google.maps.StreetViewService();
  sv.getPanorama({ location: { lat, lng }, radius: 100 }, (data, status) => {
    const pane = document.getElementById('streetview-pane');
    const label = document.getElementById('streetview-label');

    if (status === google.maps.StreetViewStatus.OK) {
      maps.streetview.setPosition({ lat, lng });
      maps.streetview.setVisible(true);
      pane.classList.remove('hidden');
      if (label) label.textContent = name || '';
    } else {
      // 100m 안에 스트리트뷰 없으면 반경 늘려서 재시도
      sv.getPanorama({ location: { lat, lng }, radius: 500 }, (data2, status2) => {
        if (status2 === google.maps.StreetViewStatus.OK) {
          maps.streetview.setPosition(data2.location.latLng);
          maps.streetview.setVisible(true);
          pane.classList.remove('hidden');
          if (label) label.textContent = `${name || ''} (근처)`;
        } else {
          alert(`"${name}" 주변에 스트리트뷰가 없어요.`);
        }
      });
    }
  });
}

function closeStreetView() {
  if (maps.streetview) maps.streetview.setVisible(false);
  document.getElementById('streetview-pane').classList.add('hidden');
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
      if (provider === 'naver') {
        await initNaverMap();
        if (maps.naver) {
          naver.maps.Event.trigger(maps.naver, 'resize');
          maps.naver.setCenter(new naver.maps.LatLng(37.5665, 126.978));
        }
      }
      if (provider === 'google') {
        await initGoogleMap();
        // 탭 전환 후 컨테이너 크기 재계산 (없으면 타일 안 뜸)
        if (maps.google) {
          google.maps.event.trigger(maps.google, 'resize');
          maps.google.setCenter({ lat: 37.5665, lng: 126.978 });
        }
      }
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
// GSI 스크립트 onload 후 호출됨 (DOMContentLoaded가 아님)
function initGoogleLogin() {
  if (!window.__CONFIG__?.GOOGLE_CLIENT_ID) return;

  google.accounts.id.initialize({
    client_id: window.__CONFIG__.GOOGLE_CLIENT_ID,
    callback: onGoogleCredential,
  });
}

// 전역 함수로 노출 — innerHTML로 버튼을 새로 만들 때도 onclick으로 항상 호출 가능
window.triggerGoogleLogin = function () {
  if (!window.google?.accounts?.id) {
    alert('Google 로그인 준비 중입니다. 잠시 후 다시 눌러주세요.');
    return;
  }
  google.accounts.id.prompt((notification) => {
    // FedCM이 조용히 거부되면 팝업 방식으로 fallback
    if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
      google.accounts.id.renderButton(
        document.getElementById('authArea'),
        { theme: 'outline', size: 'medium', text: 'signin_with', locale: 'ko' }
      );
    }
  });
};

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
      ${isAdmin() ? '<button onclick="openDiagPanel()" style="margin-left:6px;background:none;border:1.5px solid #5A4F3F;border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer;" title="진단 패널">🛠️</button>' : ''}
      <button id="logoutBtn" class="btn-ghost" style="margin-left:6px;font-size:12px;">로그아웃</button>
    `;
    addBtn.disabled = false;
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      currentUser = null;
      addBtn.disabled = true;
      area.innerHTML = `<button class="btn-ghost" onclick="triggerGoogleLogin()">Google로 시작하기</button>`;
    });
  } else {
    area.innerHTML = `<button class="btn-ghost" onclick="triggerGoogleLogin()">Google로 시작하기</button>`;
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
  setupRegisterModal();
  await restoreSession(); // 쿠키에 저장된 로그인 세션 복원
  loadPlaces();
});

// 페이지 로드 시 기존 로그인 세션 복원
async function restoreSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return; // 로그인 안 된 상태면 그냥 패스
    const data = await res.json();
    if (data.userId) {
      // me 엔드포인트는 userId/email만 줌 → 이름/사진은 Supabase에서 추가로 가져옴
      const profileRes = await fetch('/api/auth/profile', { credentials: 'include' });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        currentUser = profile;
      } else {
        currentUser = { name: data.email.split('@')[0], email: data.email };
      }
      renderAuthArea();
    }
  } catch (err) {
    // 세션 복원 실패는 조용히 무시 (비로그인 상태로 시작)
    console.log('[restoreSession] 로그인 세션 없음');
  }
}


// ---------- 관리자 체크 ----------
const ADMIN_EMAILS = [
  'jehoon100703@gmail.com',
];

function isAdmin() {
  return currentUser && ADMIN_EMAILS.includes(currentUser.email);
}

// ---------- 진단 패널 ----------
window.openDiagPanel = function() {
  const cfg = window.__CONFIG__ || {};
  const errors = _consoleLogs.filter(l => l.type === 'error');
  const warns = _consoleLogs.filter(l => l.type === 'warn');

  const existing = document.getElementById('diagPanel');
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.id = 'diagPanel';
  panel.style.cssText = `
    position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);
    overflow-y:auto;font-family:monospace;font-size:12px;color:#0f0;padding:16px;
  `;

  const cfg_rows = Object.entries(cfg).map(([k,v]) => {
    const display = v ? (v.length > 12 ? v.slice(0,10)+'...' : v) : '❌ 없음';
    const ok = v ? '✅' : '❌';
    return `<tr><td style="color:#aaa;padding:2px 8px 2px 0">${k}</td><td>${ok} ${display}</td></tr>`;
  }).join('');

  const map_rows = [
    ['카카오맵', maps.kakao ? '✅ 로드됨' : '❌ 미로드'],
    ['네이버지도', maps.naver ? '✅ 로드됨' : '❌ 미로드'],
    ['구글맵', maps.google ? '✅ 로드됨' : '❌ 미로드'],
  ].map(([k,v]) => `<tr><td style="color:#aaa;padding:2px 8px 2px 0">${k}</td><td>${v}</td></tr>`).join('');

  const err_rows = errors.length
    ? errors.map(e => `<div style="color:#f66;margin:2px 0">[${e.time}] ${e.msg.slice(0,120)}</div>`).join('')
    : '<div style="color:#888">에러 없음</div>';

  panel.innerHTML = `
    <div style="max-width:600px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <b style="font-size:16px;color:#fff">🛠️ 찐맛집 진단 패널</b>
        <button onclick="document.getElementById('diagPanel').remove()" style="background:#B23A2E;color:#fff;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:13px">✕ 닫기</button>
      </div>

      <div style="margin-bottom:12px">
        <div style="color:#ff0;margin-bottom:6px">📋 환경변수 (config.js)</div>
        <table>${cfg_rows}</table>
      </div>

      <div style="margin-bottom:12px">
        <div style="color:#ff0;margin-bottom:6px">🗺️ 지도 상태</div>
        <table>${map_rows}</table>
        <div style="color:#aaa;margin-top:4px">현재 탭: ${currentProvider}</div>
        <div style="color:#aaa">등록된 맛집: ${placesCache.length}개</div>
      </div>

      <div style="margin-bottom:12px">
        <div style="color:#ff0;margin-bottom:6px">🔴 에러 로그 (${errors.length}개)</div>
        ${err_rows}
      </div>

      <div style="margin-bottom:12px">
        <div style="color:#ff0;margin-bottom:6px">🔗 빠른 링크</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <a href="/config.js" target="_blank" style="color:#0ff;text-decoration:none;border:1px solid #0ff;padding:4px 10px;border-radius:4px">config.js</a>
          <a href="/naver-test.html" target="_blank" style="color:#0ff;text-decoration:none;border:1px solid #0ff;padding:4px 10px;border-radius:4px">네이버 테스트</a>
          <a href="/admin.html" target="_blank" style="color:#0ff;text-decoration:none;border:1px solid #0ff;padding:4px 10px;border-radius:4px">관리자 페이지</a>
          <a href="/api/places" target="_blank" style="color:#0ff;text-decoration:none;border:1px solid #0ff;padding:4px 10px;border-radius:4px">API 확인</a>
        </div>
      </div>

      <div style="color:#555;font-size:11px;margin-top:16px">
        ${new Date().toLocaleString()} | ${navigator.userAgent.slice(0,60)}
      </div>
    </div>
  `;
  document.body.appendChild(panel);
};