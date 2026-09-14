// 사장님 메뉴 — '가게 인증 신청'과 '가게 관리(메뉴·사진)'를 하나의 버튼/창으로 통합
(function () {
  let claimingPlaceId = null;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function claimBadge(p) {
    if (p.owner_claim_status === 'approved') return '<span class="owner-badge approved">✅ 인증 완료</span>';
    if (p.owner_claim_status === 'pending') return '<span class="owner-badge pending">⏳ 검토 중</span>';
    return '';
  }

  // ── 탭 전환 ──────────────────────────────────────────────
  window.switchOwnerTab = function (tab) {
    document.querySelectorAll('#ownerDialog .owner-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.getElementById('ownerClaimPanel').style.display = tab === 'claim' ? 'block' : 'none';
    document.getElementById('ownerManagePanel').style.display = tab === 'manage' ? 'block' : 'none';
    if (tab === 'manage') loadManageList();
    else loadMyClaims();
  };

  // ── 가게 인증 신청 탭 ────────────────────────────────────
  window.ownerClaimSearch = async function () {
    const q = document.getElementById('ownerClaimQ').value.trim();
    const results = document.getElementById('ownerClaimResults');
    if (!q) { results.innerHTML = ''; return; }

    results.innerHTML = '<p class="empty-state">검색 중...</p>';
    const res = await fetch(`/api/places/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
    if (!res.ok) {
      results.innerHTML = res.status === 401
        ? '<p class="empty-state">로그인 후 이용할 수 있어요.</p>'
        : '<p class="empty-state">검색에 실패했어요.</p>';
      return;
    }
    const places = await res.json();
    if (!places.length) { results.innerHTML = '<p class="empty-state">검색 결과가 없어요. 가게가 아직 등록되지 않았다면 직접 등록해보세요.</p>'; return; }

    results.innerHTML = places.map((p) => `
      <div class="owner-place-row">
        <h3>${escapeHtml(p.name)} ${claimBadge(p)}</h3>
        <div class="owner-place-meta">${escapeHtml(p.address)}${p.category ? ' · ' + escapeHtml(p.category) : ''}</div>
        <button type="button" class="owner-claim-btn" ${p.owner_claim_status === 'approved' || p.owner_claim_status === 'pending' ? 'disabled' : ''}
          onclick='ownerOpenClaimSub(${JSON.stringify(p.id)}, ${JSON.stringify(p.name)})'>
          ${p.owner_claim_status === 'approved' ? '인증 완료' : p.owner_claim_status === 'pending' ? '검토 중' : '내 가게 인증 신청'}
        </button>
      </div>`).join('');
  };

  window.ownerOpenClaimSub = function (placeId, name) {
    claimingPlaceId = placeId;
    document.getElementById('ownerSubClaimName').textContent = name;
    document.getElementById('ownerClaimPhone').value = '';
    document.getElementById('ownerClaimBiz').value = '';
    document.getElementById('ownerClaimNote').value = '';
    document.getElementById('ownerClaimError').textContent = '';
    document.getElementById('ownerClaimSubDialog').showModal();
  };

  async function loadMyClaims() {
    const res = await fetch('/api/places/my-claims', { credentials: 'include' });
    if (!res.ok) return;
    const claims = await res.json();
    const section = document.getElementById('ownerMyClaimsSection');
    const list = document.getElementById('ownerMyClaimsList');
    if (!claims.length) { section.style.display = 'none'; return; }

    section.style.display = 'block';
    list.innerHTML = claims.map((p) => `
      <div class="owner-place-row">
        <h3>${escapeHtml(p.name)} ${claimBadge(p)}</h3>
        <div class="owner-place-meta">${escapeHtml(p.address)}</div>
      </div>`).join('');
  }

  // ── 가게 관리 탭 (메뉴·사진 등록은 owner-dashboard.html에서 처리) ──
  async function loadManageList() {
    const wrap = document.getElementById('ownerManageList');
    wrap.innerHTML = '<p class="empty-state">불러오는 중...</p>';

    const res = await fetch('/api/places/mine', { credentials: 'include' });
    if (!res.ok) { wrap.innerHTML = '<p class="empty-state">로그인 후 이용할 수 있어요.</p>'; return; }
    const places = await res.json();
    const approved = places.filter((p) => p.owner_claim_status === 'approved');
    if (!approved.length) {
      wrap.innerHTML = '<p class="empty-state">사업자 인증이 승인된 가게가 없어요.<br>먼저 "가게 인증 신청" 탭에서 신청해주세요.</p>';
      return;
    }

    wrap.innerHTML = '';
    for (const p of approved) {
      const el = document.createElement('div');
      el.className = 'owner-place-row';
      const active = p.owner_edit_until && new Date(p.owner_edit_until) > new Date();
      const badgeHtml = active
        ? `<span class="owner-badge approved">✅ 이용중</span>`
        : `<span class="owner-badge pending">🔒 이용권 필요</span>`;
      el.innerHTML = `
        <h3>${escapeHtml(p.name)} ${badgeHtml}</h3>
        <div class="owner-place-meta">${escapeHtml(p.address || '')}</div>
        <a href="/owner-dashboard.html?place=${p.id}" class="owner-manage-btn" style="display:inline-block;text-decoration:none;">
          ${active ? '메뉴·사진 관리하기' : '이용권 구매하고 관리 시작'}
        </a>`;
      wrap.appendChild(el);
    }
  }

  // ── 초기화 / 이벤트 바인딩 ───────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const openBtn = document.getElementById('ownerMenuBtn');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        document.getElementById('ownerClaimQ').value = '';
        document.getElementById('ownerClaimResults').innerHTML = '';
        document.getElementById('ownerDialog').showModal();
        window.switchOwnerTab('claim');
      });
    }

    document.getElementById('ownerSubmitClaimBtn').addEventListener('click', async () => {
      const phone = document.getElementById('ownerClaimPhone').value.trim();
      const biz_number = document.getElementById('ownerClaimBiz').value.trim();
      const note = document.getElementById('ownerClaimNote').value.trim();
      const errEl = document.getElementById('ownerClaimError');
      if (!phone || !biz_number) { errEl.textContent = '연락처와 사업자등록번호를 입력해주세요.'; return; }

      errEl.textContent = '';
      const res = await fetch(`/api/places/${claimingPlaceId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone, biz_number, note }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || '신청에 실패했어요.'; return; }

      document.getElementById('ownerClaimSubDialog').close();
      window.ownerClaimSearch();
      loadMyClaims();
    });
  });
})();
