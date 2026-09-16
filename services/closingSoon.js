// 구글 Place Details의 weekday_text (예: "월요일: 오전 9:00 ~ 오후 9:00")를 파싱해서
// "지금부터 N분 안에 문을 닫는지"를 판단하는 유틸.
// 하루에 영업시간이 여러 구간(브레이크타임 등)으로 나뉘어 있어도 각 구간을 다 검사함.

const DAY_NAMES = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

// "오전 9:00" / "오후 9:00" / "9:00" 형태를 모두 24시간 기준 { h, m }으로 변환
function parseTimeToken(token) {
  const t = (token || '').trim();
  const ampmMatch = t.match(/(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (ampmMatch) {
    const [, ampm, hStr, mStr] = ampmMatch;
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (ampm === '오후' && h !== 12) h += 12;
    if (ampm === '오전' && h === 12) h = 0;
    return { h, m };
  }
  const plainMatch = t.match(/(\d{1,2}):(\d{2})/);
  if (plainMatch) return { h: parseInt(plainMatch[1], 10), m: parseInt(plainMatch[2], 10) };
  return null;
}

// weekday_text 한 줄(예: "월요일: 오전 9:00 ~ 오후 9:00, 오후 5:00 ~ 오후 10:00")에서
// [{openMin, closeMin}] (자정 기준 분 단위) 형태의 영업 구간 배열을 뽑아냄
function parseRangesFromLine(line) {
  if (!line) return [];
  if (line.includes('24시간')) return [{ openMin: 0, closeMin: 24 * 60 }];
  if (line.includes('휴무')) return [];

  const afterColon = line.split(':').length > 1 ? line.split(/:(.+)/)[1] : line;
  const segments = (afterColon || '').split(',');
  const ranges = [];
  for (const seg of segments) {
    const parts = seg.split('~');
    if (parts.length !== 2) continue;
    const open = parseTimeToken(parts[0]);
    const close = parseTimeToken(parts[1]);
    if (!open || !close) continue;
    let openMin = open.h * 60 + open.m;
    let closeMin = close.h * 60 + close.m;
    if (closeMin <= openMin) closeMin += 24 * 60; // 자정 넘어 영업(예: 저녁~새벽 2시)
    ranges.push({ openMin, closeMin });
  }
  return ranges;
}

// opening_hours: string[] (weekday_text), now: Date
// windowMin분 안에 닫는 영업 구간이 있으면 그 구간을, 없으면 null을 반환
function findClosingSoonRange(openingHours, now, windowMin = 30) {
  if (!Array.isArray(openingHours) || openingHours.length === 0) return null;

  const dayName = DAY_NAMES[now.getDay()];
  const line = openingHours.find((l) => l.startsWith(dayName));
  const ranges = parseRangesFromLine(line);
  if (ranges.length === 0) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const r of ranges) {
    // 지금 영업 중이면서 닫는 시각까지 windowMin분 이하로 남은 경우만 알림 대상
    if (nowMin >= r.openMin && nowMin < r.closeMin && r.closeMin - nowMin <= windowMin) {
      return r;
    }
  }
  return null;
}

module.exports = { findClosingSoonRange, parseRangesFromLine, parseTimeToken, DAY_NAMES };
