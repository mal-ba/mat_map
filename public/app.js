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
let naverClusterMarkers = []; // 네이버 지도에서 그려진 클러스터/단일 마커 오버레이 전체
let naverPlacesForCluster = [];
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
  if (!maps.jjin || !markers.jjin.length) return;
  const bounds = window.L.featureGroup(markers.jjin).getBounds();
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
  if (!cat) return '#1C1917';
  if (cat.includes('한식')) return '#E1392A';
  if (cat.includes('카페') || cat.includes('디저트')) return '#D9A441';
  if (cat.includes('고기') || cat.includes('구이')) return '#8B4513';
  if (cat.includes('분식') || cat.includes('간식')) return '#4A90D9';
  if (cat.includes('일식')) return '#6B4E9B';
  if (cat.includes('양식')) return '#2E7D32';
  if (cat.includes('중식')) return '#C62828';
  return '#1C1917';
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

// ---------- 거리 기반 클러스터링 (모든 지도 공통, 30km 기준) ----------
const CLUSTER_RADIUS_KM = 100;

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 반경(km) 이내에 있는 맛집들을 하나의 그룹으로 묶는다 (모든 지도가 이 결과를 공유)
function clusterByDistance(places, radiusKm = CLUSTER_RADIUS_KM) {
  const used = new Array(places.length).fill(false);
  const groups = [];
  for (let i = 0; i < places.length; i++) {
    if (used[i]) continue;
    const group = [places[i]];
    used[i] = true;
    for (let j = i + 1; j < places.length; j++) {
      if (used[j]) continue;
      if (getDistanceKm(places[i].lat, places[i].lng, places[j].lat, places[j].lng) <= radiusKm) {
        group.push(places[j]);
        used[j] = true;
      }
    }
    groups.push({
      places: group,
      lat: group.reduce((s, p) => s + p.lat, 0) / group.length,
      lng: group.reduce((s, p) => s + p.lng, 0) / group.length,
      count: group.length,
    });
  }
  return groups;
}

function clusterBubbleHtml(count) {
  return `<div style="width:38px;height:38px;border-radius:50%;
    background:#E1392A;color:#FFFFFF;border:3px solid #fff;
    display:flex;align-items:center;justify-content:center;
    font-weight:900;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.35);
    font-family:'Noto Sans KR',sans-serif;">${count}</div>`;
}

function placePopupHtml(p) {
  const imgHtml = p.image_url
    ? `<img src="${escapeHtml(p.image_url)}" style="width:100%;height:90px;object-fit:cover;border-radius:4px;margin-bottom:6px;" onerror="this.style.display='none'" />`
    : `<div style="width:100%;height:60px;background:${getCategoryColor(p.category)}22;border-radius:4px;margin-bottom:6px;display:flex;align-items:center;justify-content:center;font-size:28px;">${getCategoryEmoji(p.category)}</div>`;
  return `
    <div style="font-family:'Noto Sans KR',sans-serif;min-width:180px;max-width:220px;">
      ${imgHtml}
      <b style="font-size:14px;">${escapeHtml(p.name)}</b>
      <div style="font-size:11px;color:#8A8580;margin:3px 0;">${escapeHtml(p.address || '')}</div>
      ${p.category ? `<div style="font-size:11px;color:#888;">${escapeHtml(p.category)}</div>` : ''}
      ${p.comment ? `<div style="font-size:12px;margin-top:5px;">${escapeHtml(p.comment)}</div>` : ''}
      <button onclick="viewStreetView(${p.lat}, ${p.lng}, ${JSON.stringify(p.name)})"
        style="margin-top:6px;width:100%;font-size:12px;font-weight:700;background:none;
        border:1.5px solid #ccc;border-radius:4px;padding:5px;cursor:pointer;">🚶 거리뷰</button>
    </div>`;
}

function renderJjinMarkers(places) {
  if (!maps.jjin || !window.L) return;
  const L = window.L;

  markers.jjin.forEach((m) => maps.jjin.removeLayer(m));
  markers.jjin = [];

  const groups = clusterByDistance(places);

  groups.forEach((group) => {
    let marker;
    if (group.count === 1) {
      const p = group.places[0];
      const color = getCategoryColor(p.category);
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;
          background:${color};border:2.5px solid #fff;
          box-shadow:0 2px 6px rgba(0,0,0,.35);transform:rotate(-45deg);"></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });
      marker = L.marker([p.lat, p.lng], { icon });
      marker.bindPopup(placePopupHtml(p), { maxWidth: 240 });
    } else {
      const icon = L.divIcon({
        className: '',
        html: clusterBubbleHtml(group.count),
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });
      marker = L.marker([group.lat, group.lng], { icon });
      marker.on('click', () => {
        maps.jjin.setView([group.lat, group.lng], Math.min(maps.jjin.getZoom() + 3, 18));
      });
    }
    marker.addTo(maps.jjin);
    markers.jjin.push(marker);
  });
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
      'flex-direction:column;gap:10px;color:#8A8580;font-family:Noto Sans KR,sans-serif;padding:24px;text-align:center;">' +
      '<div style="font-size:28px;">⚠️</div>' +
      '<div style="font-size:14px;font-weight:700;color:#E1392A;">네이버 지도 인증 실패</div>' +
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

  await ensureStreetView();
  maps.google.setStreetView(maps.streetview);

  renderGoogleMarkers(placesCache);
}

// 구글맵 탭을 열지 않아도(등급 잠김 상태여도) 거리뷰 자체는 바로 쓸 수 있도록 분리
async function ensureStreetView() {
  if (maps.streetview) return;
  await loadGoogleMapsSDK();
  maps.streetview = new google.maps.StreetViewPanorama(
    document.getElementById('streetview-map'),
    { visible: false, addressControl: true, fullscreenControl: false }
  );
}

// 리스트/팝업 어디서든 호출 가능한 거리뷰 진입점
window.viewStreetView = async function (lat, lng, name) {
  await ensureStreetView();
  openStreetView(parseFloat(lat), parseFloat(lng), name);
};

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
  markers.kakao = [];

  const groups = clusterByDistance(places.filter(p => shouldShow(p, 'kakao')));

  groups.forEach((group) => {
    if (group.count === 1) {
      const p = group.places[0];
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(p.lat, p.lng), map: maps.kakao });
      const infowindow = new kakao.maps.InfoWindow({
        content: `<div style="padding:8px 12px;font-family:'Noto Sans KR',sans-serif;min-width:140px;">
          <b style="font-size:13px;">${escapeHtml(p.name)}</b>
          <div style="font-size:11px;color:#8A8580;margin-top:2px;">${escapeHtml(p.category||'')}</div>
          ${p.comment ? `<div style="font-size:11px;margin-top:3px;">${escapeHtml(p.comment)}</div>` : ''}
          <button onclick="viewStreetView(${p.lat}, ${p.lng}, ${JSON.stringify(p.name)})"
            style="margin-top:6px;width:100%;font-size:12px;font-weight:700;background:none;
            border:1.5px solid #ccc;border-radius:4px;padding:4px;cursor:pointer;">🚶 거리뷰</button>
        </div>`,
        removable: true,
      });
      kakao.maps.event.addListener(marker, 'click', () => {
        infowindow.open(maps.kakao, marker);
        maps.kakao.panTo(marker.getPosition());
      });
      markers.kakao.push(marker);
    } else {
      const content = document.createElement('div');
      content.innerHTML = clusterBubbleHtml(group.count);
      content.style.cursor = 'pointer';
      const position = new kakao.maps.LatLng(group.lat, group.lng);
      const overlay = new kakao.maps.CustomOverlay({ position, content, yAnchor: 0.5 });
      overlay.setMap(maps.kakao);
      content.addEventListener('click', () => {
        maps.kakao.setLevel(Math.max(maps.kakao.getLevel() - 3, 1));
        maps.kakao.panTo(position);
      });
      markers.kakao.push(overlay); // CustomOverlay도 setMap(null)로 동일하게 제거 가능
    }
  });
}

function renderNaverMarkers(places) {
  if (!maps.naver) return;
  naverPlacesForCluster = places.filter(p => shouldShow(p, 'naver'));
  drawNaverClusters();
}

function drawNaverClusters() {
  if (!maps.naver) return;
  naverClusterMarkers.forEach((m) => m.setMap(null));
  naverClusterMarkers = [];

  const groups = clusterByDistance(naverPlacesForCluster);

  groups.forEach((group) => {
    const position = new naver.maps.LatLng(group.lat, group.lng);

    if (group.count === 1) {
      const marker = new naver.maps.Marker({ position, map: maps.naver });
      naver.maps.Event.addListener(marker, 'click', () => maps.naver.panTo(position));
      naverClusterMarkers.push(marker);
    } else {
      const marker = new naver.maps.Marker({
        position,
        map: maps.naver,
        icon: { content: clusterBubbleHtml(group.count), anchor: new naver.maps.Point(19, 19) },
      });
      naver.maps.Event.addListener(marker, 'click', () => {
        maps.naver.setCenter(position);
        maps.naver.setZoom(Math.min(maps.naver.getZoom() + 3, 18));
      });
      naverClusterMarkers.push(marker);
    }
  });
}

function renderGoogleMarkers(places) {
  if (!maps.google) return;
  markers.google.forEach((m) => m.setMap(null));
  markers.google = [];

  const groups = clusterByDistance(places.filter(p => shouldShow(p, 'google')));

  groups.forEach((group) => {
    if (group.count === 1) {
      const p = group.places[0];
      const position = { lat: p.lat, lng: p.lng };
      const marker = new google.maps.Marker({ position, map: maps.google });
      marker.addListener('click', () => {
        maps.google.panTo(position);
        openStreetView(p.lat, p.lng, p.name);
      });
      markers.google.push(marker);
    } else {
      const position = { lat: group.lat, lng: group.lng };
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38">
        <circle cx="19" cy="19" r="16" fill="#E1392A" stroke="#fff" stroke-width="3"/>
        <text x="19" y="24" font-size="13" font-weight="900" fill="#fff" text-anchor="middle" font-family="Noto Sans KR, sans-serif">${group.count}</text>
      </svg>`;
      const marker = new google.maps.Marker({
        position,
        map: maps.google,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
          scaledSize: new google.maps.Size(38, 38),
        },
      });
      marker.addListener('click', () => {
        maps.google.panTo(position);
        maps.google.setZoom(Math.min(maps.google.getZoom() + 3, 18));
      });
      markers.google.push(marker);
    }
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
    btn.style.background = '#E1392A';
    btn.style.color = '#FFFFFF';
    document.getElementById('mapSearchInput').focus();
  } else {
    bar.style.display = 'none';
    bar.classList.add('search-hidden');
    btn.style.background = '#fff';
    btn.style.color = '#1C1917';
    hideSearchDropdown();
  }
};

// ---------- 지도 탭 전환 ----------
function setupMapTabs() {
  document.querySelectorAll('.map-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      const provider = tab.dataset.provider;
      if (provider === currentProvider) return;

      const tier = Number(tab.dataset.tier || 0);
      if (tier > mapUnlockLevel()) {
        const need = { 1: 15, 2: 30, 3: 60 }[tier] || 0;
        const remaining = Math.max(0, need - (currentUser?.registered_count || 0));
        showMapLockMsg(`${MAP_TIER_LABEL[provider]}은 맛집 ${remaining}개 더 등록하면 열려요`);
        return;
      }

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
    renderPlaceList(placesCache);
    renderAllMarkers(placesCache);

    // 홈(검색 결과)에서 특정 맛집을 콕 집어 넘어온 경우 해당 위치로 이동
    const focusId = new URLSearchParams(location.search).get('focus');
    if (focusId) {
      const target = placesCache.find((p) => p.id === focusId);
      if (target) panActiveMapTo(target.lat, target.lng);
    }
  } catch (err) {
    console.error('[loadPlaces] fetch 실패:', err);
    placesCache = [];
    renderAllMarkers([]);
    showEmptyState();
  }
}

function renderPlaceList(items) {
  const list = document.getElementById('placeList');
  if (!items.length) {
    showEmptyState();
    return;
  }
  list.innerHTML = items
    .map(
      (p) => `
    <li class="place-card" data-lat="${p.lat}" data-lng="${p.lng}">
      <div class="verified-badge">인증</div>
      <h3>${escapeHtml(p.name)}</h3>
      <div class="addr">${escapeHtml(p.address)}${p.category ? ' · ' + escapeHtml(p.category) : ''}</div>
      ${p.rating ? `<div class="rating">⭐ ${p.rating} (리뷰 ${p.review_count ?? 0}개)</div>` : ''}
      ${p.comment ? `<div class="comment">${escapeHtml(p.comment)}</div>` : ''}
      <button onclick="event.stopPropagation(); viewStreetView(${p.lat}, ${p.lng}, ${JSON.stringify(p.name)})"
        style="margin-top:8px;font-size:12px;font-weight:700;background:none;border:1.5px solid var(--line,#E7E4DF);
        border-radius:6px;padding:5px 10px;cursor:pointer;">🚶 거리뷰</button>
    </li>`
    )
    .join('');

  list.querySelectorAll('.place-card').forEach((card) => {
    card.addEventListener('click', () => {
      panActiveMapTo(parseFloat(card.dataset.lat), parseFloat(card.dataset.lng));
    });
  });
}

// 왼쪽 패널에서 등록된 맛집 이름/주소/카테고리로 검색 (지도에 등록을 위한 검색과는 별개)
function filterPlaceList(query) {
  const q = query.trim().toLowerCase();
  if (!q) { renderPlaceList(placesCache); return; }
  const filtered = placesCache.filter((p) =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.address || '').toLowerCase().includes(q) ||
    (p.category || '').toLowerCase().includes(q)
  );
  if (!filtered.length) {
    document.getElementById('placeList').innerHTML = '<li class="empty-state">검색 결과가 없어요.</li>';
  } else {
    renderPlaceList(filtered);
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

const LOGGED_OUT_AREA_HTML = `
  <a class="btn-ghost" href="/login.html" style="display:inline-block;text-decoration:none;">로그인</a>
  <a class="btn-primary" href="/signup.html" style="display:inline-block;text-decoration:none;margin-left:6px;">회원가입</a>
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
          ? `<img src="${avatarSrc}" alt="" style="width:26px;height:26px;border-radius:50%;object-fit:cover;border:1.5px solid #1C1917;" />`
          : `<span style="width:26px;height:26px;border-radius:50%;background:#D9A441;border:1.5px solid #1C1917;display:flex;align-items:center;justify-content:center;font-size:13px;">👤</span>`}
        <span style="font-size:13px;font-weight:700">${escapeHtml(displayName)}님</span>
      </a>
      ${isAdmin() ? '<button onclick="openDiagPanel()" style="margin-left:6px;background:none;border:1.5px solid #8A8580;border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer;" title="진단 패널">🛠️</button>' : ''}
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
  area.style.visibility = 'visible';
}

// ---------- 등록 모달 ----------
function setupRegisterModal() {
  const modal = document.getElementById('registerModal');
  const form = document.getElementById('registerForm');
  const overlay = document.getElementById('verifyOverlay');
  const addressInput = document.getElementById('addressInput');

  const photoInput = document.getElementById('placePhotoInput');
  const photoStatus = document.getElementById('photoUploadStatus');
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { photoStatus.textContent = '5MB 이하 이미지만 업로드할 수 있어요.'; photoInput.value = ''; return; }

    photoStatus.textContent = '업로드 중...';
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const res = await fetch('/api/places/photo-upload', { method: 'POST', credentials: 'include', body: fd });
      const data = await res.json();
      if (!res.ok) { photoStatus.textContent = data.error || '업로드 실패'; return; }
      document.getElementById('imageUrlInput').value = data.url;
      photoStatus.textContent = '사진 업로드 완료 ✓';
    } catch {
      photoStatus.textContent = '업로드 중 오류가 발생했어요.';
    }
  });

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
  document.getElementById('photoUploadStatus').textContent = '';
  document.getElementById('imageUrlInput').value = '';
  clearPreviewMarkers();
}

// ---------- 시작 ----------
window.addEventListener('DOMContentLoaded', async () => {
  setupMapTabs();
  updateMapTabLocks();
  initJjinMap(); // 찐지도 기본 로드
  setupRegisterModal();
  await restoreSession(); // 쿠키에 저장된 로그인 세션 복원
  loadPlaces();
});



// ---------- 장소 검색 (등록용) — 어느 지도 탭에 있든 동작 ----------
async function searchKakaoPlaces(keyword) {
  if (!keyword.trim()) return;
  hideSearchDropdown();
  showSearchMsg('검색 중...');

  await loadKakaoSDK(); // 지도 탭과 무관하게 검색만 가능하도록 SDK 로드 (지도 인스턴스는 불필요)

  const ps = new kakao.maps.services.Places();
  ps.keywordSearch(keyword, (data, status) => {
    if (status !== kakao.maps.services.Status.OK) {
      showSearchMsg('검색 결과가 없어요.');
      hideSearchDropdown();
      return;
    }
    showSearchMsg('');
    renderSearchDropdown(data.slice(0, 8));
  }, { sort: kakao.maps.services.SortBy.ACCURACY });
}

function renderSearchDropdown(results) {
  const wrap = document.getElementById('searchDropdown');
  if (!wrap) return;
  if (!results.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }

  wrap.style.display = 'block';
  wrap.innerHTML = results.map((place) => `
    <div class="search-result-item"
      onclick='registerFromSearch(${JSON.stringify(place.place_name)}, ${JSON.stringify(place.address_name)}, ${place.y}, ${place.x})'
      style="padding:10px 12px;border-bottom:1px solid var(--line,#E7E4DF);cursor:pointer;background:#fff;">
      <div style="font-weight:700;font-size:13px;">${escapeHtml(place.place_name)}</div>
      <div style="font-size:11px;color:#8A8580;">${escapeHtml(place.address_name)}</div>
    </div>
  `).join('');
}

function hideSearchDropdown() {
  const wrap = document.getElementById('searchDropdown');
  if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
}

window.registerFromSearch = function(name, address, lat, lng) {
  hideSearchDropdown();
  showSearchMsg('');
  document.getElementById('mapSearchInput').value = '';

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

  // 현재 활성화된 지도(어느 탭이든)에 미리보기 마커 표시
  showPreviewMarker(parseFloat(lat), parseFloat(lng));

  modal.showModal();
};

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
        if (!profile.onboarding_completed) { location.href = '/onboarding.html'; return; }
      } else {
        currentUser = { name: data.email.split('@')[0], email: data.email };
      }
      // 접속 기록 업데이트 (로그인 확인 후 비동기 호출)
      if (currentUser) fetch('/api/auth/visit', { method: 'POST', credentials: 'include' }).catch(() => {});
    }
  } catch (err) {
    // 세션 복원 실패는 조용히 무시 (비로그인 상태로 시작)
    console.log('[restoreSession] 로그인 세션 없음');
  } finally {
    // 로그인 여부와 상관없이 항상 인증 영역을 확정 렌더링 (깜빡임/무한 숨김 방지)
    renderAuthArea();
    updateMapTabLocks();
  }
}


// ---------- 관리자 체크 ----------
const ADMIN_EMAILS = [
  'jehoon100703@gmail.com',
];

function isAdmin() {
  return currentUser && ADMIN_EMAILS.includes(currentUser.email);
}

// ---------- 지도 등급 잠금 ----------
const MAP_TIER_LABEL = { naver: '네이버지도', kakao: '카카오맵', google: '구글맵' };

function mapUnlockLevel() {
  if (isAdmin()) return Infinity;
  return currentUser?.badge_level || 0;
}

function updateMapTabLocks() {
  const level = mapUnlockLevel();
  document.querySelectorAll('.map-tab').forEach((tab) => {
    const tier = Number(tab.dataset.tier || 0);
    const locked = tier > level;
    tab.classList.toggle('locked', locked);
    const label = MAP_TIER_LABEL[tab.dataset.provider] || tab.textContent.replace('🔒 ', '');
    tab.textContent = locked ? `🔒 ${label}` : label;
  });
}

function showMapLockMsg(text) {
  const el = document.getElementById('mapLockMsg');
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(showMapLockMsg._t);
  showMapLockMsg._t = setTimeout(() => { el.style.display = 'none'; }, 2600);
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
        <button onclick="document.getElementById('diagPanel').remove()" style="background:#E1392A;color:#fff;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:13px">✕ 닫기</button>
      </div>

      <div style="margin-bottom:12px">
        <div style="color:#ff0;margin-bottom:6px">📋 환경변수 (config.js)</div>
        <table>${cfg_rows}</table>
      </div>

      <div style="margin-bottom:12px">
        <div style="color:#ff0;margin-bottom:6px">🏅 내 뱃지</div>
        ${(() => {
          if (isAdmin()) return `<div style="color:#0f0">👑 관리자</div>`;
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