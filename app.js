let map, tempMarker;
let currentUser = null;
const markers = [];

// ---------- 카카오맵 로드 & 초기화 ----------
function loadKakaoSDK() {
  return new Promise((resolve) => {
    const key = window.__CONFIG__.KAKAO_JS_KEY;
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`;
    script.onload = () => window.kakao.maps.load(resolve);
    document.head.appendChild(script);
  });
}

async function initMap() {
  await loadKakaoSDK();
  const center = new kakao.maps.LatLng(37.5665, 126.9780); // 서울시청 기본값
  map = new kakao.maps.Map(document.getElementById('map'), { center, level: 6 });

  // 등록 모달이 열려있을 때 지도 클릭 -> 좌표 자동 입력
  kakao.maps.event.addListener(map, 'click', (mouseEvent) => {
    const modal = document.getElementById('registerModal');
    if (!modal.open) return;
    const latlng = mouseEvent.latLng;
    document.querySelector('input[name=lat]').value = latlng.getLat().toFixed(6);
    document.querySelector('input[name=lng]').value = latlng.getLng().toFixed(6);

    if (tempMarker) tempMarker.setMap(null);
    tempMarker = new kakao.maps.Marker({ position: latlng, map });
  });

  loadPlaces();
}

function renderMarkers(places) {
  markers.forEach((m) => m.setMap(null));
  markers.length = 0;

  places.forEach((p) => {
    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(p.lat, p.lng),
      map,
    });
    kakao.maps.event.addListener(marker, 'click', () => {
      map.panTo(marker.getPosition());
    });
    markers.push(marker);
  });
}

// ---------- 목록 ----------
async function loadPlaces() {
  const res = await fetch('/api/places');
  const places = await res.json();

  const list = document.getElementById('placeList');
  if (!places.length) {
    list.innerHTML = '<li class="empty-state">아직 검증된 맛집이 없어요.<br>첫 번째로 등록해보세요.</li>';
  } else {
    list.innerHTML = places
      .map(
        (p) => `
      <li class="place-card" data-lat="${p.lat}" data-lng="${p.lng}">
        <div class="verified-badge">인증</div>
        <h3>${escapeHtml(p.name)}</h3>
        <div class="addr">${escapeHtml(p.address)}${p.category ? ' · ' + escapeHtml(p.category) : ''}</div>
        ${p.comment ? `<div class="comment">${escapeHtml(p.comment)}</div>` : ''}
      </li>`
      )
      .join('');

    list.querySelectorAll('.place-card').forEach((card) => {
      card.addEventListener('click', () => {
        const pos = new kakao.maps.LatLng(card.dataset.lat, card.dataset.lng);
        map.panTo(pos);
      });
    });
  }

  renderMarkers(places);
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
    area.innerHTML = `<span style="font-size:13px;font-weight:700">${escapeHtml(currentUser.name)}님 환영해요</span>`;
    addBtn.disabled = false;
  }
}

// ---------- 등록 모달 ----------
function setupRegisterModal() {
  const modal = document.getElementById('registerModal');
  const form = document.getElementById('registerForm');
  const overlay = document.getElementById('verifyOverlay');

  document.getElementById('addBtn').addEventListener('click', () => {
    modal.showModal();
  });
  document.getElementById('cancelBtn').addEventListener('click', () => {
    modal.close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    body.lat = parseFloat(body.lat);
    body.lng = parseFloat(body.lng);

    if (isNaN(body.lat) || isNaN(body.lng)) {
      alert('지도를 클릭해서 위치를 지정해주세요.');
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
      form.reset();

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

// ---------- 시작 ----------
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  initGoogleLogin();
  setupRegisterModal();
});
