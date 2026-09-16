const nodemailer = require('nodemailer');
const supabase = require('./supabase');
const { findClosingSoonRange } = require('./closingSoon');

// 인증코드 발송(routes/auth.js)과 동일한 SMTP 설정을 그대로 재사용
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const WINDOW_MIN = 30; // 닫기 30분 전부터 알림

// 찜한 가게 중 오늘 곧 문을 닫는 곳이 있으면, 유저마다 하루 1번만
// 인앱 알림(notifications 테이블)과 이메일을 함께 보낸다.
// server.js의 setInterval에서 20분마다 호출됨.
async function sendClosingSoonNotifications() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const { data: likedRows, error } = await supabase
    .from('likes')
    .select('user_id, place_id, places(id, name, opening_hours, status), users(email, name)');
  if (error) {
    console.error('[notifyClosingSoon] likes 조회 실패:', error.message);
    return;
  }

  for (const row of likedRows || []) {
    const place = row.places;
    const user = row.users;
    if (!place || place.status !== 'verified' || !user?.email) continue;

    const closingRange = findClosingSoonRange(place.opening_hours, now, WINDOW_MIN);
    if (!closingRange) continue;

    // 오늘 이미 이 가게에 대해 알림을 보냈으면 중복 발송 방지
    const { data: existing, error: existingErr } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', row.user_id)
      .eq('place_id', place.id)
      .eq('type', 'closing_soon')
      .gte('created_at', todayStart.toISOString())
      .limit(1);
    if (existingErr) {
      console.error('[notifyClosingSoon] 중복확인 실패:', existingErr.message);
      continue;
    }
    if (existing && existing.length > 0) continue;

    const message = `찜하신 '${place.name}'이(가) 곧 문을 닫아요.`;
    const { error: insertErr } = await supabase.from('notifications').insert({
      user_id: row.user_id,
      place_id: place.id,
      type: 'closing_soon',
      message,
    });
    if (insertErr) {
      console.error('[notifyClosingSoon] 알림 저장 실패:', insertErr.message);
      continue;
    }

    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM,
        to: user.email,
        subject: `[찐맛집] ${place.name} 곧 영업 종료`,
        text: `${message}\n\n찐맛집에서 확인하기: ${process.env.APP_BASE_URL}`,
      });
      await supabase
        .from('notifications')
        .update({ email_sent_at: new Date().toISOString() })
        .eq('user_id', row.user_id)
        .eq('place_id', place.id)
        .eq('type', 'closing_soon')
        .gte('created_at', todayStart.toISOString());
    } catch (mailErr) {
      // 메일 발송 실패해도 인앱 알림은 이미 저장돼 있으니 그대로 둠
      console.error('[notifyClosingSoon] 메일 발송 실패:', mailErr.message);
    }
  }
}

module.exports = { sendClosingSoonNotifications };
