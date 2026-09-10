const express = require('express');
const crypto = require('crypto');
const supabase = require('../services/supabase');
const requireAuth = require('./requireAuth');

const router = express.Router();

// ── 가격 (원) — 필요하면 이 값만 바꾸면 됩니다 ──
const BOOST_PRICE = 9900;      // 가게 끌어올리기 7일
const BOOST_DAYS = 7;
const SUBSCRIPTION_PRICE = 4900; // 소비자 맞춤 추천 월 구독

// '저매출' 판단 기준 — 리뷰 수가 이 값 미만이면 부스트 신청 가능 (없음/null도 허용)
const LOW_SALES_REVIEW_THRESHOLD = 10;

function tossAuthHeader() {
  const key = process.env.TOSS_SECRET_KEY || '';
  return 'Basic ' + Buffer.from(key + ':').toString('base64');
}

async function tossConfirmPayment({ paymentKey, orderId, amount }) {
  const res = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST',
    headers: { Authorization: tossAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '토스 결제 승인 실패');
  return data;
}

// 프론트엔드 결제위젯 초기화용 공개 키 전달
router.get('/config', (req, res) => {
  res.json({
    clientKey: process.env.TOSS_CLIENT_KEY,
    boostPrice: BOOST_PRICE,
    boostDays: BOOST_DAYS,
    subscriptionPrice: SUBSCRIPTION_PRICE,
  });
});

// ============================================================
// 가게 끌어올리기 (부스트) — 1회 결제
// ============================================================

// 특정 가게가 부스트 신청 가능한지 확인 (본인 등록 + 저매출 기준 충족)
router.get('/boost/eligibility/:placeId', requireAuth, async (req, res) => {
  const { data: place, error } = await supabase
    .from('places')
    .select('id, name, submitted_by, review_count, boosted_until, status')
    .eq('id', req.params.placeId)
    .single();
  if (error || !place) return res.status(404).json({ error: '가게를 찾을 수 없어요' });

  if (place.submitted_by !== req.user.userId) {
    return res.status(403).json({ error: '본인이 등록한 가게만 끌어올릴 수 있어요', eligible: false });
  }
  if (place.status !== 'verified') {
    return res.json({ eligible: false, reason: '검증된 가게만 끌어올릴 수 있어요' });
  }
  const alreadyBoosted = place.boosted_until && new Date(place.boosted_until) > new Date();
  if (alreadyBoosted) {
    return res.json({ eligible: false, reason: '이미 끌어올리기 진행 중이에요', boosted_until: place.boosted_until });
  }
  const lowSales = place.review_count == null || place.review_count < LOW_SALES_REVIEW_THRESHOLD;
  if (!lowSales) {
    return res.json({ eligible: false, reason: '리뷰가 많은(저매출이 아닌) 가게는 끌어올리기를 이용할 수 없어요' });
  }
  res.json({ eligible: true, price: BOOST_PRICE, days: BOOST_DAYS });
});

// 결제 주문 생성 (결제창 열기 전 서버에 금액/주문번호를 먼저 기록)
router.post('/boost/order', requireAuth, async (req, res) => {
  const { placeId } = req.body;
  const { data: place, error } = await supabase
    .from('places')
    .select('id, name, submitted_by, review_count, boosted_until, status')
    .eq('id', placeId)
    .single();
  if (error || !place) return res.status(404).json({ error: '가게를 찾을 수 없어요' });
  if (place.submitted_by !== req.user.userId) return res.status(403).json({ error: '본인이 등록한 가게만 끌어올릴 수 있어요' });
  const alreadyBoosted = place.boosted_until && new Date(place.boosted_until) > new Date();
  if (alreadyBoosted) return res.status(400).json({ error: '이미 끌어올리기 진행 중이에요' });
  const lowSales = place.review_count == null || place.review_count < LOW_SALES_REVIEW_THRESHOLD;
  if (!lowSales) return res.status(400).json({ error: '저매출 가게만 끌어올리기를 이용할 수 있어요' });

  const orderId = 'boost_' + crypto.randomUUID();
  const { error: insertError } = await supabase.from('payments').insert({
    user_id: req.user.userId,
    kind: 'boost',
    place_id: place.id,
    order_id: orderId,
    amount: BOOST_PRICE,
    status: 'pending',
  });
  if (insertError) return res.status(500).json({ error: insertError.message });

  res.json({ orderId, amount: BOOST_PRICE, orderName: `${place.name} 7일 끌어올리기` });
});

// 결제창에서 돌아온 후 최종 승인 + 부스트 적용
router.post('/boost/confirm', requireAuth, async (req, res) => {
  const { paymentKey, orderId, amount } = req.body;
  try {
    const { data: payment, error: findErr } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .eq('user_id', req.user.userId)
      .single();
    if (findErr || !payment) return res.status(404).json({ error: '주문을 찾을 수 없어요' });
    if (payment.status === 'paid') return res.json({ ok: true }); // 이미 처리됨 (중복 콜백 방지)
    if (Number(amount) !== payment.amount) return res.status(400).json({ error: '결제 금액이 일치하지 않아요' });

    const confirmed = await tossConfirmPayment({ paymentKey, orderId, amount });

    await supabase.from('payments').update({
      status: 'paid',
      payment_key: confirmed.paymentKey,
    }).eq('order_id', orderId);

    const boostedUntil = new Date(Date.now() + BOOST_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('places').update({ boosted_until: boostedUntil }).eq('id', payment.place_id);

    res.json({ ok: true, boosted_until: boostedUntil });
  } catch (err) {
    console.error('[boost/confirm]', err.message);
    await supabase.from('payments').update({ status: 'failed' }).eq('order_id', orderId);
    res.status(500).json({ error: err.message || '결제 승인에 실패했어요' });
  }
});

// ============================================================
// 소비자 맞춤 추천 — 월 구독 (토스 빌링/자동결제)
// ※ 실제 서비스로 쓰려면 토스페이먼츠에 '빌링(정기결제)' 서비스를
//   별도로 신청/승인받아야 해요 (사업자등록 필요). 그 전까지는
//   테스트 키로만 동작을 확인할 수 있어요.
// ============================================================

// 카드 등록(빌링키 발급) 완료 후 authKey를 받아 실제 빌링키로 교환 + 첫 달 결제
router.post('/subscribe/confirm', requireAuth, async (req, res) => {
  const { authKey, customerKey } = req.body;
  try {
    const issueRes = await fetch('https://api.tosspayments.com/v1/billing/authorizations/issue', {
      method: 'POST',
      headers: { Authorization: tossAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ authKey, customerKey }),
    });
    const issued = await issueRes.json();
    if (!issueRes.ok) throw new Error(issued.message || '빌링키 발급 실패');

    const orderId = 'sub_' + crypto.randomUUID();
    const chargeRes = await fetch(`https://api.tosspayments.com/v1/billing/${issued.billingKey}`, {
      method: 'POST',
      headers: { Authorization: tossAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerKey,
        amount: SUBSCRIPTION_PRICE,
        orderId,
        orderName: '찐맛집 맞춤 추천 구독 (1개월)',
      }),
    });
    const charged = await chargeRes.json();
    if (!chargeRes.ok) throw new Error(charged.message || '첫 결제 실패');

    await supabase.from('payments').insert({
      user_id: req.user.userId,
      kind: 'subscription',
      order_id: orderId,
      payment_key: charged.paymentKey,
      amount: SUBSCRIPTION_PRICE,
      status: 'paid',
    });

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await supabase.from('subscriptions').upsert({
      user_id: req.user.userId,
      status: 'active',
      billing_key: issued.billingKey,
      customer_key: customerKey,
      current_period_end: periodEnd.toISOString(),
    }, { onConflict: 'user_id' });

    res.json({ ok: true, current_period_end: periodEnd.toISOString() });
  } catch (err) {
    console.error('[subscribe/confirm]', err.message);
    res.status(500).json({ error: err.message || '구독 등록에 실패했어요' });
  }
});

// 내 구독 상태 조회
router.get('/subscribe/status', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', req.user.userId)
    .maybeSingle();
  res.json(data || { status: 'none' });
});

// 구독 취소 (다음 결제부터 청구 안 함)
router.post('/subscribe/cancel', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'canceled' })
    .eq('user_id', req.user.userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// 매월 정기결제 청구 — 외부 크론(예: Render Cron Job)이 하루 한 번 호출해야 함
router.post('/subscribe/run-billing', async (req, res) => {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: '권한 없음' });
  }

  const { data: due } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('status', 'active')
    .lte('current_period_end', new Date().toISOString());

  const results = [];
  for (const sub of due || []) {
    try {
      const orderId = 'sub_' + crypto.randomUUID();
      const chargeRes = await fetch(`https://api.tosspayments.com/v1/billing/${sub.billing_key}`, {
        method: 'POST',
        headers: { Authorization: tossAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerKey: sub.customer_key,
          amount: SUBSCRIPTION_PRICE,
          orderId,
          orderName: '찐맛집 맞춤 추천 구독 (1개월)',
        }),
      });
      const charged = await chargeRes.json();
      if (!chargeRes.ok) throw new Error(charged.message);

      await supabase.from('payments').insert({
        user_id: sub.user_id, kind: 'subscription', order_id: orderId,
        payment_key: charged.paymentKey, amount: SUBSCRIPTION_PRICE, status: 'paid',
      });

      const nextEnd = new Date(sub.current_period_end);
      nextEnd.setMonth(nextEnd.getMonth() + 1);
      await supabase.from('subscriptions').update({ current_period_end: nextEnd.toISOString() }).eq('id', sub.id);
      results.push({ user_id: sub.user_id, ok: true });
    } catch (err) {
      await supabase.from('subscriptions').update({ status: 'past_due' }).eq('id', sub.id);
      results.push({ user_id: sub.user_id, ok: false, error: err.message });
    }
  }
  res.json({ processed: results.length, results });
});

// ============================================================
// 맞춤 추천 (구독자 전용) — 취향 입력 + AI 추천
// ============================================================

router.put('/preferences', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: '취향을 입력해주세요' });
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: req.user.userId, content: content.trim(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.get('/preferences', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('user_preferences')
    .select('content')
    .eq('user_id', req.user.userId)
    .maybeSingle();
  res.json({ content: data?.content || '' });
});

router.post('/recommend', requireAuth, async (req, res) => {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', req.user.userId)
    .maybeSingle();
  const active = sub && sub.status === 'active' && new Date(sub.current_period_end) > new Date();
  if (!active) return res.status(403).json({ error: '맞춤 추천은 구독자만 이용할 수 있어요' });

  const { data: pref } = await supabase
    .from('user_preferences')
    .select('content')
    .eq('user_id', req.user.userId)
    .maybeSingle();
  if (!pref?.content) return res.status(400).json({ error: '먼저 취향을 입력해주세요' });

  const { data: places } = await supabase
    .from('places')
    .select('id, name, category, address, comment, rating')
    .eq('status', 'verified')
    .limit(150);

  if (!places?.length) return res.json({ recommendations: [] });

  try {
    const placeList = places.map(p => `- id:${p.id} | ${p.name} | ${p.category || '분류없음'} | ${p.comment || ''}`).join('\n');
    const prompt = `사용자 취향: "${pref.content}"\n\n아래 가게 목록 중 사용자 취향에 가장 잘 맞는 가게를 최대 5개 골라주세요.\n각 가게마다 왜 추천하는지 한 줄 이유도 같이 적어주세요.\n\n가게 목록:\n${placeList}\n\n반드시 아래 JSON 배열 형식으로만 답하세요. 다른 텍스트는 포함하지 마세요.\n[{"id": "가게id", "reason": "추천 이유 한 줄"}]`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiData.error?.message || 'AI 추천 실패');

    const text = aiData.content?.[0]?.text || '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const picks = JSON.parse(jsonMatch ? jsonMatch[0] : '[]');

    const byId = Object.fromEntries(places.map(p => [p.id, p]));
    const recommendations = picks
      .filter(p => byId[p.id])
      .map(p => ({ ...byId[p.id], reason: p.reason }));

    res.json({ recommendations });
  } catch (err) {
    console.error('[recommend]', err.message);
    res.status(500).json({ error: '추천을 생성하지 못했어요' });
  }
});

module.exports = router;
