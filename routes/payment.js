// server/payment.js
// 기존 Express 앱에 이 라우터를 붙여서 사용하세요:
//   const paymentRouter = require('./server/payment');
//   app.use('/payment', paymentRouter);
//
// 환경변수 TOSS_SECRET_KEY 에 발급받은 "테스트" 시크릿 키를 넣어두세요. (test_sk_로 시작)
// Render라면 대시보드 > Environment 에서 등록하면 됩니다.

const express = require("express");
const router = express.Router();

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY;

// checkout.html에서 결제 성공 시 토스가 이 경로로 리다이렉트합니다.
// 쿼리스트링으로 paymentKey, orderId, amount가 붙어서 옵니다.
router.get("/success", async (req, res) => {
  const { paymentKey, orderId, amount } = req.query;

  if (!paymentKey || !orderId || !amount) {
    return res.status(400).send("결제 정보가 올바르지 않습니다.");
  }

  try {
    const response = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount: Number(amount),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      // 토스가 거절한 경우 (금액 위변조, 이미 처리된 결제 등)
      return res.redirect(
        `/payment/fail?message=${encodeURIComponent(data.message)}&code=${data.code}`
      );
    }

    // TODO: 여기서 Supabase에 결제 내역을 저장하고
    // 해당 가게의 '끌어올리기' 상태를 활성화하는 로직을 추가하세요.
    // 예: await supabase.from('boosts').insert({ store_id, order_id: orderId, expires_at: ... })

    res.send(`
      <h2>결제 성공</h2>
      <p>주문번호: ${data.orderId}</p>
      <p>결제금액: ${data.totalAmount.toLocaleString()}원</p>
      <p>결제수단: ${data.method}</p>
    `);
  } catch (err) {
    console.error("결제 승인 오류:", err);
    res.redirect("/payment/fail?message=" + encodeURIComponent("서버 오류가 발생했습니다."));
  }
});

router.get("/fail", (req, res) => {
  const { message, code } = req.query;
  res.send(`
    <h2>결제 실패</h2>
    <p>${message || "알 수 없는 오류가 발생했습니다."}</p>
    ${code ? `<p>오류 코드: ${code}</p>` : ""}
    <a href="/payment/checkout.html">다시 시도하기</a>
  `);
});

module.exports = router;
