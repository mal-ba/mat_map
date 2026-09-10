let allPlaces = [];
let currentUser = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

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

const CATEGORY_BUCKETS = [
  { key: '한식', label: '한식', match: (c) => c.includes('한식') },
  { key: '카페', label: '카페·디저트', match: (c) => c.includes('카페') || c.includes('디저트') },
  { key: '고기', label: '고기·구이', match: (c) => c.includes('고기') || c.includes('구이') },
  { key: '분식', label: '분식·간식', match: (c) => c.includes('분식') || c.includes('간식') },
  { key: '일식', label: '일식', match: (c) => c.includes('일식') },
  { key: '양식', label: '양식', match: (c) => c.includes('양식') },
  { key: '중식', label: '중식', match: (c) => c.includes('중식') },
];

function placeCardHtml(p) {
  const emoji = getCategoryEmoji(p.category);
  const color = getCategoryColor(p.category);
  const boosted = p.boosted_until && new Date(p.boosted_until) > new Date();
  const photo = p.image_url
    ? `<img src="${escapeHtml(p.image_url)}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:8px 8px 0 0;" onerror="this.style.display='none'" />`
    : `<div style="width:100%;height:120px;background:${color}18;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;font-size:36px;">${emoji}</div>`;

  return `
    <div class="place-tile" data-id="${p.id}" onclick="goToMapWith('${p.id}')" style="position:relative;">
      ${boosted ? `<span style="position:absolute;top:6px;left:6px;background:#E1392A;color:#fff;font-size:10px;font-weight:900;padding:3px 7px;border-radius:6px;z-index:2;">🚀 추천</span>` : ''}
      ${photo}
      <div style="padding:10px 12px;">
        <div style="font-weight:700;font-size:14px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.name)}</div>
        <div style="font-size:11px;color:#8A8580;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.address || '')}</div>
        ${p.rating ? `<div style="font-size:11px;color:#D9A441;font-weight:700;margin-top:4px;">⭐ ${p.rating}</div>` : ''}
      </div>
    </div>`;
}

window.goToMapWith = function (id) {
  location.href = `/map.html?focus=${encodeURIComponent(id)}`;
};

function renderCategoryRows(places) {
  const wrap = document.getElementById('categoryRows');
  if (!places.length) {
    wrap.innerHTML = `<p style="text-align:center;color:#8A8580;padding:40px 0;">아직 등록된 맛집이 없어요.<br>가장 먼저 등록해보세요!</p>`;
    return;
  }

  const used = new Set();
  const rows = CATEGORY_BUCKETS.map((bucket) => {
    const items = places.filter((p) => p.category && bucket.match(p.category));
    items.forEach((p) => used.add(p.id));
    if (!items.length) return '';
    return categoryRowHtml(bucket.label, items);
  }).join('');

  const etc = places.filter((p) => !used.has(p.id));
  const etcRow = etc.length ? categoryRowHtml('기타', etc) : '';

  wrap.innerHTML = rows + etcRow;
}

function categoryRowHtml(label, items) {
  return `
    <section style="margin-bottom:32px;">
      <h2 style="font-family:'Black Han Sans',sans-serif;font-size:19px;margin:0 0 12px;">${escapeHtml(label)}</h2>
      <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;">
        ${items.map((p) => `<div style="flex:0 0 150px;">${placeCardHtml(p)}</div>`).join('')}
      </div>
    </section>`;
}

function runSearch(query) {
  const q = query.trim().toLowerCase();
  const resultsWrap = document.getElementById('searchResults');
  const browseWrap = document.getElementById('categoryRows');

  if (!q) {
    resultsWrap.style.display = 'none';
    browseWrap.style.display = 'block';
    return;
  }

  const matched = allPlaces.filter((p) =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.address || '').toLowerCase().includes(q) ||
    (p.category || '').toLowerCase().includes(q)
  );

  browseWrap.style.display = 'none';
  resultsWrap.style.display = 'block';
  resultsWrap.innerHTML = matched.length
    ? `<h2 style="font-family:'Black Han Sans',sans-serif;font-size:19px;margin:0 0 14px;">검색 결과 ${matched.length}개</h2>
       <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;">
         ${matched.map(placeCardHtml).join('')}
       </div>`
    : `<p style="text-align:center;color:#8A8580;padding:40px 0;">"${escapeHtml(query)}"에 대한 검색 결과가 없어요.</p>`;
}

async function loadPlaces() {
  try {
    const res = await fetch('/api/places');
    allPlaces = res.ok ? await res.json() : [];
  } catch {
    allPlaces = [];
  }
  renderCategoryRows(allPlaces);
}

async function initAuthArea() {
  const area = document.getElementById('authArea');
  try {
    const res = await fetch('/api/auth/profile', { credentials: 'include' });
    if (!res.ok) throw new Error('not logged in');
    const profile = await res.json();
    currentUser = profile;
    if (!profile.onboarding_completed) { location.href = '/onboarding.html'; return; }

    const displayName = profile.display_name || profile.name || '익명';
    const avatarSrc = profile.avatar_url || profile.picture;
    area.innerHTML = `
      <a href="/profile.html" style="display:flex;align-items:center;gap:6px;text-decoration:none;color:inherit;">
        ${avatarSrc
          ? `<img src="${avatarSrc}" alt="" style="width:26px;height:26px;border-radius:50%;object-fit:cover;border:1.5px solid #1C1917;" />`
          : `<span style="width:26px;height:26px;border-radius:50%;background:#D9A441;border:1.5px solid #1C1917;display:flex;align-items:center;justify-content:center;font-size:13px;">👤</span>`}
        <span style="font-size:13px;font-weight:700">${escapeHtml(displayName)}님</span>
      </a>
    `;
  } catch {
    area.innerHTML = `
      <a class="btn-ghost" href="/login.html" style="display:inline-block;text-decoration:none;">로그인</a>
      <a class="btn-primary" href="/signup.html" style="display:inline-block;text-decoration:none;margin-left:6px;">회원가입</a>
    `;
  }
  area.style.visibility = 'visible';
}

document.getElementById('homeSearchInput').addEventListener('input', (e) => runSearch(e.target.value));
document.getElementById('homeSearchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch(document.getElementById('homeSearchInput').value);
});

initAuthArea();
loadPlaces();
