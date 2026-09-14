// 주소 문자열에서 (시/도, 시·군·구) 두 단계를 뽑아 "지역" 단위를 판별한다.
// public/app.js의 classifyRegion과 동일한 규칙을 서버에서도 그대로 써서,
// "추천을 가장 많이 받은 가게가 그 지역에서 상위로 올라가는" 랭킹을 계산하는 데 사용한다.

const SIDO_LIST = [
  { key: '서울', aliases: ['서울특별시', '서울'] },
  { key: '부산', aliases: ['부산광역시', '부산'] },
  { key: '대구', aliases: ['대구광역시', '대구'] },
  { key: '인천', aliases: ['인천광역시', '인천'] },
  { key: '광주', aliases: ['광주광역시', '광주'] },
  { key: '대전', aliases: ['대전광역시', '대전'] },
  { key: '울산', aliases: ['울산광역시', '울산'] },
  { key: '세종', aliases: ['세종특별자치시', '세종시', '세종'] },
  { key: '경기', aliases: ['경기도', '경기'] },
  { key: '강원', aliases: ['강원특별자치도', '강원도', '강원'] },
  { key: '충북', aliases: ['충청북도', '충북'] },
  { key: '충남', aliases: ['충청남도', '충남'] },
  { key: '전북', aliases: ['전북특별자치도', '전라북도', '전북'] },
  { key: '전남', aliases: ['전라남도', '전남'] },
  { key: '경북', aliases: ['경상북도', '경북'] },
  { key: '경남', aliases: ['경상남도', '경남'] },
  { key: '제주', aliases: ['제주특별자치도', '제주도', '제주'] },
];

// 주소 하나에서 (시/도, 시·군·구)를 뽑아낸다. 시/도 뒤에 나오는 첫 "○○시/○○군/○○구" 토큰을 2단계로 사용
function classifyRegion(address) {
  const addr = (address || '').trim();
  const sido = SIDO_LIST.find((s) => s.aliases.some((a) => addr.includes(a)));
  if (!sido) return { l1: '기타', l2: '기타' };

  const matchedAlias = sido.aliases.find((a) => addr.includes(a));
  const rest = addr.slice(addr.indexOf(matchedAlias) + matchedAlias.length);
  const tokens = rest.trim().split(/\s+/).filter(Boolean);

  let l2 = '기타';
  for (const t of tokens) {
    if (t.length >= 2 && /[시군구]$/.test(t)) { l2 = t; break; }
  }
  return { l1: sido.key, l2 };
}

// 랭킹을 묶을 그룹 키 (예: "경기|화성시")
function regionKey(address) {
  const { l1, l2 } = classifyRegion(address);
  return `${l1}|${l2}`;
}

// 화면에 보여줄 라벨 (예: "경기 화성시")
function regionLabel(address) {
  const { l1, l2 } = classifyRegion(address);
  return l2 === '기타' ? l1 : `${l1} ${l2}`;
}

module.exports = { classifyRegion, regionKey, regionLabel, SIDO_LIST };
