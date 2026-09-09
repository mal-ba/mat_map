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
let currentProvider = 'jjin';
let placesCache = [];

const maps = { jjin: null, kakao: null, naver: null, google: null };
let searchMarkers = [];
let jjinCluster = null;
let kakaoCluster = null;
let searchOverlay = null;
const markers = { jjin: [], kakao: [], naver: [], google: [] };
const previewMarkers = { jjin: null, kakao: null, naver: null, google: null }; // 등록 모달용 미리보기 마커
const sdkPromises = {};

// ---------- 찐지도 (Leaflet + OpenStreetMap) ----------
window.jjinMyLocation = function() {
  if (!maps.jjin) return;
  if (!navigator.geolocation) { alert('위치 정보를 지원하지 않는 브라우저예요.'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      maps.jjin.setView([lat, lng], 16);
      // 내 위치 마커
      if (window._myLocMarker) maps.jjin.removeLayer(window._myLocMarker);
      window._myLocMarker = window.L.circleMarker([lat, lng], {
        radius: 10, color: '#1a73e8', fillColor: '#4285f4', fillOpacity: 0.9, weight: 3
      }).addTo(maps.jjin).bindPopup('📍 현재 내 위치').openPopup();
    },
    () => alert('위치 정보를 가져올 수 없어요. 브라우저 권한을 확인해주세요.')
  );
};

window.jjinFitAll = function() {
  if (!maps.jjin || !jjinCluster) return;
  const bounds = jjinCluster.getBounds();
  if (bounds.isValid()) maps.jjin.fitBounds(bounds.pad(0.1));
};

function getCategoryEmoji(cat) {
  if (!cat) return '🍽️';
  if (cat.includes('한식')) return '🍚';
  if (cat.includes('카페') || cat.includes('디저트')) return '☕';
  if (cat.includes('고기') || cat.includes('구이')) return '🥩';
  if (cat.includes('분식') || cat.includes('간식')) return '🍢';
  if (cat.includes('일식')) return '🍱';
  if (cat.includes('양식')) return '🍝';
  if (cat.includes('중식')) return '🥢';
  return '🍽️';
}

function getCategoryColor(cat) {
  if (!cat) return '#241E17';
  if (cat.includes('한식')) return '#B23A2E';
  if (cat.includes('카페') || cat.includes('디저트')) return '#D9A441';
  if (cat.includes('고기') || cat.includes('구이')) return '#8B4513';
  if (cat.includes('분식') || cat.includes('간식')) return '#4A90D9';
  if (cat.includes('일식')) return '#6B4E9B';
  if (cat.includes('양식')) return '#2E7D32';
  if (cat.includes('중식')) return '#C62828';
  return '#241E17';
}

function initJjinMap() {
  if (maps.jjin) return;
  if (!window.L) { console.error('[JjinMap] Leaflet 미로드'); return; }

  const L = window.L;
  maps.jjin = L.map('map-jjin', {
    center: [37.5665, 126.978],
    zoom: 12,
    zoomControl: false,
  });

  // OpenStreetMap 타일 (한국어 지명 표시, 네이버 지도 스타일)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(maps.jjin);

  // 기본 줌 컨트롤 제거하고 커스텀으로
  // L.control.zoom는 이미 false로 꺼둠

  // 커스텀 컨트롤 버튼 추가
  const JjinControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function() {
      const div = L.DomUtil.create('div', '');
      div.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:8px;margin-right:8px;';
      div.innerHTML = `
        <button onclick="maps.jjin.zoomIn()" title="확대"
          style="width:38px;height:38px;background:#fff;border:2px solid rgba(0,0,0,.25);
          border-radius:4px;font-size:18px;cursor:pointer;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.2);">+</button>
        <button onclick="maps.jjin.zoomOut()" title="축소"
          style="width:38px;height:38px;background:#fff;border:2px solid rgba(0,0,0,.25);
          border-radius:4px;font-size:18px;cursor:pointer;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.2);">−</button>
        <button onclick="jjinMyLocation()" title="내 위치"
          style="width:38px;height:38px;background:#fff;border:2px solid rgba(0,0,0,.25);
          border-radius:4px;font-size:18px;cursor:pointer;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.2);">📍</button>
        <button onclick="jjinFitAll()" title="전체 보기"
          style="width:38px;height:38px;background:#fff;border:2px solid rgba(0,0,0,.25);
          border-radius:4px;font-size:18px;cursor:pointer;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.2);">⊞</button>
      `;
      L.DomEvent.disableClickPropagation(div);
      return div;
    }
  });
  new JjinControl().addTo(maps.jjin);

  // 지도 클릭 등록 없음

  renderJjinMarkers(placesCache);
  setTimeout(() => maps.jjin.invalidateSize(), 200);
}

function renderJjinMarkers(places) {
  if (!maps.jjin || !window.L) return;
  const L = window.L;

  // 기존 클러스터 제거
  if (jjinCluster) maps.jjin.removeLayer(jjinCluster);
  markers.jjin = [];

  // 클러스터 그룹 생성
  jjinCluster = L.markerClusterGroup({
    maxClusterRadius: 40,
    disableClusteringAtZoom: 10, // 줌 10 이상(30km 이내)이면 개별 마커로 표시
    spiderfyOnMaxZoom: true,
    iconCreateFunction: (cluster) => {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div style="width:38px;height:38px;border-radius:50%;
          background:#B23A2E;color:#E7DCC3;border:3px solid #fff;
          display:flex;align-items:center;justify-content:center;
          font-weight:900;font-size:13px;
          box-shadow:0 2px 8px rgba(0,0,0,.35);
          font-family:'Noto Sans KR',sans-serif;">${count}</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        className: '',
      });
    },
  });

  places.forEach(p => {
    const color = getCategoryColor(p.category);
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;
        background:${color};border:2.5px solid #fff;
        box-shadow:0 2px 6px rgba(0,0,0,.35);transform:rotate(-45deg);"></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });

    const marker = L.marker([p.lat, p.lng], { icon });
    const imgHtml = p.image_url
      ? `<img src="${escapeHtml(p.image_url)}" style="width:100%;height:90px;object-fit:cover;border-radius:4px;margin-bottom:6px;" onerror="this.style.display='none'" />`
      : `<div style="width:100%;height:60px;background:${getCategoryColor(p.category)}22;border-radius:4px;margin-bottom:6px;display:flex;align-items:center;justify-content:center;font-size:28px;">${getCategoryEmoji(p.category)}</div>`;
    marker.bindPopup(`
      <div style="font-family:'Noto Sans KR',sans-serif;min-width:180px;max-width:220px;">
        ${imgHtml}
        <b style="font-size:14px;">${escapeHtml(p.name)}</b>
        <div style="font-size:11px;color:#5A4F3F;margin:3px 0;">${escapeHtml(p.address || '')}</div>
        ${p.category ? `<div style="font-size:11px;color:#888;">${escapeHtml(p.category)}</div>` : ''}
        ${p.comment ? `<div style="font-size:12px;margin-top:5px;">${escapeHtml(p.comment)}</div>` : ''}
      </div>
    `, { maxWidth: 240 });

    jjinCluster.addLayer(marker);
    markers.jjin.push(marker);
  });

  maps.jjin.addLayer(jjinCluster);
}

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
    `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services,clusterer`,
    (resolve) => window.kakao.maps.load(resolve)
  );
}

function loadNaverSDK() {
  const clientId = window.__CONFIG__.NAVER_MAP_CLIENT_ID;
  return loadScriptOnce(
    'naver',
    `https://openapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}`,
    (resolve) => resolve()
  );
}

function loadGoogleMapsSDK() {
  const key = window.__CONFIG__.GOOGLE_MAPS_JS_KEY;
  return loadScriptOnce(
    'google',
    `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly`,
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

// 컨테이너에 실제 크기가 생길 때까지 대기
function waitForSize(el, maxMs = 2000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) return resolve();
      if (Date.now() - t0 > maxMs) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function initGoogleMap() {
  if (maps.google) return;
  await loadGoogleMapsSDK();
  const center = { lat: 37.5665, lng: 126.978 };
  maps.google = new google.maps.Map(document.getElementById('map-google'), {
    center, zoom: 12,
    backgroundColor: '#aad3df',
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
  // 찐지도
  if (maps.jjin && window.L) {
    if (previewMarkers.jjin) maps.jjin.removeLayer(previewMarkers.jjin);
    previewMarkers.jjin = window.L.marker([lat, lng]).addTo(maps.jjin);
    maps.jjin.setView([lat, lng], 15);
  }
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
  if (previewMarkers.jjin && maps.jjin) { maps.jjin.removeLayer(previewMarkers.jjin); previewMarkers.jjin = null; }
  if (previewMarkers.kakao) { previewMarkers.kakao.setMap(null); previewMarkers.kakao = null; }
  if (previewMarkers.naver) { previewMarkers.naver.setMap(null); previewMarkers.naver = null; }
  if (previewMarkers.google) { previewMarkers.google.setMap(null); previewMarkers.google = null; }
}

// ---------- 마커 렌더링 ----------
function shouldShow(place, mapName) {
  if (!place.show_on_maps) return true; // 기존 데이터는 모두 표시
  return place.show_on_maps.includes(mapName);
}

function renderKakaoMarkers(places) {
  if (!maps.kakao) return;
  markers.kakao.forEach((m) => m.setMap(null));
  if (kakaoCluster) kakaoCluster.clear();

  const filtered = places.filter(p => shouldShow(p, 'kakao'));

  if (!kakaoCluster) {
    kakaoCluster = new kakao.maps.MarkerClusterer({
      map: maps.kakao,
      averageCenter: true,
      minLevel: 9, // 레벨 9 이상(약 30km+ 뷰)에서만 묶음
      styles: [{
        width: '40px', height: '40px',
        background: '#B23A2E',
        color: '#E7DCC3',
        borderRadius: '50%',
        border: '3px solid #fff',
        textAlign: 'center',
        lineHeight: '34px',
        fontWeight: '900',
        fontSize: '14px',
        fontFamily: "'Noto Sans KR', sans-serif",
        boxShadow: '0 2px 8px rgba(0,0,0,.35)',
      }],
    });
  }

  markers.kakao = filtered.map((p) => {
    const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(p.lat, p.lng) });
    const infowindow = new kakao.maps.InfoWindow({
      content: `<div style="padding:8px 12px;font-family:'Noto Sans KR',sans-serif;min-width:140px;">
        <b style="font-size:13px;">${escapeHtml(p.name)}</b>
        <div style="font-size:11px;color:#5A4F3F;margin-top:2px;">${escapeHtml(p.category||'')}</div>
        ${p.comment ? `<div style="font-size:11px;margin-top:3px;">${escapeHtml(p.comment)}</div>` : ''}
      </div>`,
      removable: true,
    });
    kakao.maps.event.addListener(marker, 'click', () => {
      infowindow.open(maps.kakao, marker);
      maps.kakao.panTo(marker.getPosition());
    });
    return marker;
  });

  kakaoCluster.addMarkers(markers.kakao);
}

function renderNaverMarkers(places) {
  if (!maps.naver) return;
  markers.naver.forEach((m) => m.setMap(null));
  markers.naver = places.filter(p => shouldShow(p, 'naver')).map((p) => {
    const position = new naver.maps.LatLng(p.lat, p.lng);
    const marker = new naver.maps.Marker({ position, map: maps.naver });
    naver.maps.Event.addListener(marker, 'click', () => maps.naver.panTo(position));
    return marker;
  });
}

function renderGoogleMarkers(places) {
  if (!maps.google) return;
  markers.google.forEach((m) => m.setMap(null));
  markers.google = places.filter(p => shouldShow(p, 'google')).map((p) => {
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
  renderJjinMarkers(places);
  renderKakaoMarkers(places);
  renderNaverMarkers(places);
  renderGoogleMarkers(places);
}


// ---------- 지도 검색창 토글 ----------
window.toggleMapSearch = function() {
  const bar = document.getElementById('mapSearchBar');
  const btn = document.getElementById('searchToggleBtn');
  const isHidden = bar.style.display === 'none' || !bar.style.display || bar.classList.contains('search-hidden');
  if (isHidden) {
    bar.style.display = 'flex';
    bar.classList.remove('search-hidden');
    btn.style.background = '#B23A2E';
    btn.style.color = '#E7DCC3';
    document.getElementById('mapSearchInput').focus();
  } else {
    bar.style.display = 'none';
    bar.classList.add('search-hidden');
    btn.style.background = '#fff';
    btn.style.color = '#241E17';
  }
};

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

      if (provider === 'jjin') {
        initJjinMap();
        if (maps.jjin) setTimeout(() => maps.jjin.invalidateSize(), 200);
      }
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
        if (maps.google) {
          await waitForSize(document.getElementById('map-google'));
          google.maps.event.trigger(maps.google, 'resize');
          maps.google.setCenter({ lat: 37.5665, lng: 126.978 });
        }
      }
    });
  });
}

function panActiveMapTo(lat, lng) {
  if (currentProvider === 'jjin' && maps.jjin) {
    maps.jjin.setView([lat, lng], 16);
  } else if (currentProvider === 'kakao' && maps.kakao) {
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

// ---------- 뱃지 시스템 ----------
const BADGE_INFO = [
  { level: 0, emoji: '',   name: '탐험 시작',   required: 0  },
  { level: 1, emoji: '🌱', name: '새싹 탐험가', required: 15  },
  { level: 2, emoji: '🌿', name: '풋내기 맛집러',required: 30  },
  { level: 3, emoji: '🌲', name: '맛집 탐험가', required: 60  },
  { level: 4, emoji: '⭐', name: '맛집 마스터', required: 120 },
  { level: 5, emoji: '🌟', name: '맛집 전설',   required: 240 },
  { level: 6, emoji: '👑', name: '찐맛집 레전드',required: 480 },
];

function getBadgeInfo(level) {
  return BADGE_INFO[Math.min(level, BADGE_INFO.length - 1)];
}

function getNextBadge(level) {
  return BADGE_INFO[Math.min(level + 1, BADGE_INFO.length - 1)];
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

const LOGGED_OUT_AREA_HTML = `
  <button class="btn-ghost" onclick="triggerGoogleLogin()">Google로 시작하기</button>
  <button class="btn-ghost" onclick="openAuthModal()" style="margin-left:6px;">이메일로 시작하기</button>
`;

function renderAuthArea() {
  const area = document.getElementById('authArea');
  const addBtn = document.getElementById('addBtn');
  if (currentUser) {
    const displayName = currentUser.display_name || currentUser.name || '익명';
    const avatarSrc = currentUser.avatar_url || currentUser.picture;
    area.innerHTML = `
      <a href="/profile.html" style="display:flex;align-items:center;gap:6px;text-decoration:none;color:inherit;">
        ${avatarSrc
          ? `<img src="${avatarSrc}" alt="" style="width:26px;height:26px;border-radius:50%;object-fit:cover;border:1.5px solid #241E17;" />`
          : `<span style="width:26px;height:26px;border-radius:50%;background:#D9A441;border:1.5px solid #241E17;display:flex;align-items:center;justify-content:center;font-size:13px;">👤</span>`}
        <span style="font-size:13px;font-weight:700">${escapeHtml(displayName)}님</span>
      </a>
      ${isAdmin() ? '<button onclick="openDiagPanel()" style="margin-left:6px;background:none;border:1.5px solid #5A4F3F;border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer;" title="진단 패널">🛠️</button>' : ''}
      <button id="logoutBtn" class="btn-ghost" style="margin-left:6px;font-size:12px;">로그아웃</button>
    `;
    addBtn.disabled = false;
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      currentUser = null;
      addBtn.disabled = true;
      area.innerHTML = LOGGED_OUT_AREA_HTML;
    });
  } else {
    area.innerHTML = LOGGED_OUT_AREA_HTML;
  }
}

// ---------- 이메일 로그인/회원가입 모달 ----------
window.openAuthModal = function () {
  document.getElementById('authModal').showModal();
};

function setupAuthModal() {
  const modal = document.getElementById('authModal');
  const tabLogin = document.getElementById('authTabLogin');
  const tabSignup = document.getElementById('authTabSignup');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');

  function showTab(which) {
    const isLogin = which === 'login';
    loginForm.style.display = isLogin ? 'block' : 'none';
    signupForm.style.display = isLogin ? 'none' : 'block';
    tabLogin.style.borderBottom = isLogin ? '3px solid #B23A2E' : 'none';
    tabLogin.style.color = isLogin ? 'inherit' : '#5A4F3F';
    tabSignup.style.borderBottom = isLogin ? 'none' : '3px solid #B23A2E';
    tabSignup.style.color = isLogin ? '#5A4F3F' : 'inherit';
  }
  tabLogin.addEventListener('click', () => showTab('login'));
  tabSignup.addEventListener('click', () => showTab('signup'));

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    const fd = new FormData(loginForm);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || '로그인에 실패했어요'; return; }
    currentUser = data.user;
    renderAuthArea();
    modal.close();
    loginForm.reset();
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('signupError');
    errEl.textContent = '';
    const fd = new FormData(signupForm);
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: fd.get('name'), email: fd.get('email'), password: fd.get('password') }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || '회원가입에 실패했어요'; return; }
    currentUser = data.user;
    renderAuthArea();
    modal.close();
    signupForm.reset();
  });
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

    // 선택된 지도 수집
    const selectedMaps = ['kakao','naver','google'].filter(m =>
      form.querySelector(`input[name="map_${m}"]`)?.checked
    );
    if (!selectedMaps.length) {
      alert('최소 하나의 지도를 선택해주세요.');
      return;
    }
    body.show_on_maps = selectedMaps.join(',');
    delete body.map_kakao; delete body.map_naver; delete body.map_google;

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

      if (result.duplicate) {
        alert('⚠️ 중복 등록 불가\n' + result.error);
      } else if (result.status === 'verified') {
        alert('✅ 검증 완료! 지도에 공개되었습니다.\n🏅 등록 뱃지가 업데이트됐어요!');
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
  initJjinMap(); // 찐지도 기본 로드
  setupRegisterModal();
  setupAuthModal();
  await restoreSession(); // 쿠키에 저장된 로그인 세션 복원
  loadPlaces();
});



// ---------- 카카오 장소 검색 ----------
function searchKakaoPlaces(keyword) {
  if (!keyword.trim() || !maps.kakao) return;
  clearSearchMarkers();

  const ps = new kakao.maps.services.Places();
  ps.keywordSearch(keyword, (data, status) => {
    if (status !== kakao.maps.services.Status.OK) {
      showSearchMsg('검색 결과가 없어요.');
      return;
    }
    showSearchMsg('');

    // 검색 범위에 맞게 지도 이동
    const bounds = new kakao.maps.LatLngBounds();

    data.forEach((place) => {
      const pos = new kakao.maps.LatLng(place.y, place.x);
      bounds.extend(pos);

      // 검색 결과 마커 (파란색 구분)
      const marker = new kakao.maps.Marker({
        position: pos,
        map: maps.kakao,
        image: new kakao.maps.MarkerImage(
          'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
          new kakao.maps.Size(24, 35)
        ),
      });

      kakao.maps.event.addListener(marker, 'click', () => {
        showPlaceOverlay(place, pos, marker);
      });

      searchMarkers.push(marker);
    });

    maps.kakao.setBounds(bounds);
  }, {
    location: maps.kakao.getCenter(),
    radius: 10000,
    sort: kakao.maps.services.SortBy.DISTANCE,
  });
}

function showPlaceOverlay(place, pos, marker) {
  if (searchOverlay) searchOverlay.setMap(null);

  const content = `
    <div style="background:#fff;border:2px solid #241E17;border-radius:6px;padding:12px 14px;
                min-width:200px;max-width:260px;box-shadow:0 2px 8px rgba(0,0,0,0.2);
                font-family:'Noto Sans KR',sans-serif;">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(place.place_name)}</div>
      <div style="font-size:12px;color:#5A4F3F;margin-bottom:8px;">${escapeHtml(place.address_name)}</div>
      ${place.category_name ? `<div style="font-size:11px;color:#888;margin-bottom:8px;">${escapeHtml(place.category_name)}</div>` : ''}
      <button onclick="registerFromSearch(${JSON.stringify(place.place_name).replace(/"/g,'&quot;')}, ${JSON.stringify(place.address_name).replace(/"/g,'&quot;')}, ${place.y}, ${place.x})"
        style="width:100%;background:#B23A2E;color:#E7DCC3;border:none;border-radius:4px;
               padding:8px;font-size:13px;font-weight:700;cursor:pointer;">
        ✅ 찐맛집으로 등록
      </button>
      <button onclick="if(searchOverlay)searchOverlay.setMap(null)"
        style="width:100%;background:none;border:1.5px solid #ccc;border-radius:4px;
               padding:6px;font-size:12px;cursor:pointer;margin-top:4px;">
        닫기
      </button>
    </div>
  `;

  searchOverlay = new kakao.maps.CustomOverlay({
    position: pos,
    content,
    yAnchor: 1.3,
    map: maps.kakao,
  });
}

window.registerFromSearch = function(name, address, lat, lng) {
  if (searchOverlay) searchOverlay.setMap(null);

  // 등록 모달 열고 값 채우기
  const modal = document.getElementById('registerModal');
  modal.querySelector('input[name="name"]').value = name;
  modal.querySelector('input[name="address"]').value = address;
  document.getElementById('latInput').value = lat;
  document.getElementById('lngInput').value = lng;

  // 주소 검색 결과 표시
  document.getElementById('geocodeStatus').textContent = '✅';
  document.getElementById('geocodeResult').textContent = `📍 ${address}`;
  document.getElementById('geocodeResult').style.color = '#22c55e';

  // 지도에 미리보기 마커
  showPreviewMarker(parseFloat(lat), parseFloat(lng));

  modal.showModal();
};

function clearSearchMarkers() {
  searchMarkers.forEach(m => m.setMap(null));
  searchMarkers = [];
  if (searchOverlay) { searchOverlay.setMap(null); searchOverlay = null; }
}

function showSearchMsg(msg) {
  const el = document.getElementById('searchMsg');
  if (el) el.textContent = msg;
}

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
      // 접속 기록 업데이트 (로그인 확인 후 비동기 호출)
      if (currentUser) fetch('/api/auth/visit', { method: 'POST', credentials: 'include' }).catch(() => {});
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
        <div style="color:#ff0;margin-bottom:6px">🏅 내 뱃지</div>
        ${(() => {
          const b = getBadgeInfo(currentUser?.badge_level || 0);
          const nb = getNextBadge(currentUser?.badge_level || 0);
          const cnt = currentUser?.registered_count || 0;
          return `<div style="color:#0f0">${b.emoji || '–'} ${b.name} (등록 ${cnt}개)</div>
          <div style="color:#aaa;font-size:11px;">다음 등급: ${nb.name} — ${nb.required}개 필요 (${Math.max(0, nb.required - cnt)}개 남음)</div>`;
        })()}
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