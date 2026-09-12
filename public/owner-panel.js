// 사장님 메뉴 — '가게 인증 신청'과 '끌어올리기'를 하나의 버튼/창으로 통합
(function () {
  const ADMIN_EMAILS = ['jehoon100703@gmail.com'];

  let payConfig = null;
  let paymentWidget = null;
  let currentOrder = null;
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
    document.getElementById('ownerBoostPanel').style.display = tab === 'boost' ? 'block' : 'none';
    if (tab === 'boost') loadBoostList();
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

  // ── 끌어올리기 탭 ────────────────────────────────────────
  async function loadBoostList() {
    const wrap = document.getElementById('ownerBoostList');
    wrap.innerHTML = '<p class="empty-state">불러오는 중...</p>';

    if (!payConfig) {
      const cfgRes = await fetch('/api/payments/config');
      payConfig = await cfgRes.json();
    }

    const meRes = await fetch('/api/auth/profile', { credentials: 'include' });
    if (!meRes.ok) { wrap.innerHTML = '<p class="empty-state">로그인 후 이용할 수 있어요.</p>'; return; }
    const me = await meRes.json();
    if (me.role !== 'owner' && !ADMIN_EMAILS.includes(me.email)) {
      wrap.innerHTML = '<p class="empty-state">🏪 가게 끌어올리기는 <b>사장님 계정</b>만 이용할 수 있어요.</p>';
      return;
    }

    const res = await fetch('/api/places/mine', { credentials: 'include' });
    const places = await res.json();
    const verified = places.filter((p) => p.status === 'verified');
    if (!verified.length) { wrap.innerHTML = '<p class="empty-state">등록해서 검증된 가게가 없어요.</p>'; return; }

    wrap.innerHTML = '';
    for (const p of verified) {
      const el = document.createElement('div');
      el.className = 'owner-place-row';
      const boosted = p.boosted_until && new Date(p.boosted_until) > new Date();
      let badgeHtml = '';
      let btnHtml = '';
      if (boosted) {
        const d = new Date(p.boosted_until);
        badgeHtml = `<span class="owner-badge boosted">🚀 ${d.getMonth() + 1}/${d.getDate()}까지 노출중</span>`;
        btnHtml = '<button type="button" class="owner-boost-btn" disabled>진행중</button>';
      } else {
        btnHtml = `<button type="button" class="owner-boost-btn" onclick='ownerOpenBoostSub(${JSON.stringify(p.id)}, ${JSON.stringify(p.name)})'>7일 끌어올리기</button>`;
      }
      el.innerHTML = `
        <h3>${escapeHtml(p.name)} ${badgeHtml}</h3>
        <div class="owner-place-meta">${escapeHtml(p.address || '')} · 리뷰 ${p.review_count ?? 0}개</div>
        ${btnHtml}
        <div id="ownerEligMsg-${p.id}" style="font-size:12px;color:#b45309;margin-top:6px;"></div>`;
      wrap.appendChild(el);
    }
  }

  window.ownerOpenBoostSub = async function (placeId, name) {
    const msgEl = document.getElementById(`ownerEligMsg-${placeId}`);
    msgEl.textContent = '';

    const eligRes = await fetch(`/api/payments/boost/eligibility/${placeId}`, { credentials: 'include' });
    const elig = await eligRes.json();
    if (!elig.eligible) { msgEl.textContent = elig.reason || '지금은 끌어올릴 수 없어요'; return; }

    const orderRes = await fetch('/api/payments/boost/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ placeId }),
    });
    const order = await orderRes.json();
    if (!orderRes.ok) { msgEl.textContent = order.error || '주문 생성에 실패했어요'; return; }
    currentOrder = order;

    document.getElementById('ownerPaySubName').textContent = name;
    document.getElementById('ownerPaySubPrice').textContent = `${order.amount.toLocaleString()}원 · 7일`;
    document.getElementById('ownerPayMethod').innerHTML = '';
    document.getElementById('ownerPayAgreement').innerHTML = '';

    const customerKey = 'boost_' + Math.random().toString(36).slice(2);
    paymentWidget = PaymentWidget(payConfig.clientKey, customerKey);
    const methodWidget = paymentWidget.renderPaymentMethods('#ownerPayMethod', { value: order.amount }, { variantKey: 'DEFAULT' });
    paymentWidget.renderAgreement('#ownerPayAgreement', { variantKey: 'AGREEMENT' });
    methodWidget.on('ready', () => { document.getElementById('ownerPayBtn').disabled = false; });

    document.getElementById('ownerPaySubDialog').showModal();
  };

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

    document.getElementById('ownerPayBtn').addEventListener('click', () => {
      if (!paymentWidget || !currentOrder) return;
      paymentWidget.requestPayment({
        orderId: currentOrder.orderId,
        orderName: currentOrder.orderName,
        successUrl: `${location.origin}/pay-success.html?kind=boost`,
        failUrl: `${location.origin}/pay-fail.html?kind=boost`,
      }).catch((err) => {
        if (err.code !== 'USER_CANCEL') alert('결제 요청에 실패했어요: ' + err.message);
      });
    });
  });
})();
