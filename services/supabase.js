const { createClient } = require('@supabase/supabase-js');
const { AsyncLocalStorage } = require('async_hooks');

// 운영용(public)과 테스트용(test) 클라이언트를 둘 다 미리 만들어둠
const supabasePublic = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { db: { schema: 'public' } }
);

const supabaseTest = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { db: { schema: 'test' } }
);

// 지금 이 요청이 테스트 모드인지 담아두는 저장소.
// (server.js의 미들웨어가 요청마다 'public' 또는 'test'로 채워줌)
const schemaContext = new AsyncLocalStorage();

// 이 메서드들만 테스트 모드일 때 test 스키마로 감.
// select와 그 뒤에 체이닝되는 eq/order/single 등은 별도 처리가 필요 없음 —
// 이미 골라진 클라이언트(아래에서 만든 pub 또는 test 빌더)가 그대로 체이닝을 이어감.
const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

// from(table)을 가로채서, 읽기(select)는 항상 운영(public) 데이터를 보고
// 쓰기(insert/update/upsert/delete)만 테스트 모드일 때 test 스키마로 가도록 분기.
// → 관리자가 테스트 모드를 켜도 지도에는 실제 운영 가게가 그대로 보이고,
//   새로 등록/수정한 내용만 test 스키마에 쌓여서 운영 데이터에는 전혀 영향이 없음.
function hybridFrom(table) {
  const isTestMode = schemaContext.getStore() === 'test';
  const pub = supabasePublic.from(table);
  const test = isTestMode ? supabaseTest.from(table) : null;

  return new Proxy(pub, {
    get(target, prop) {
      const useTest = isTestMode && WRITE_METHODS.has(prop);
      const source = useTest ? test : target;
      const value = source[prop];
      return typeof value === 'function' ? value.bind(source) : value;
    },
  });
}

// server.js에서만 쓰는 특수 기능들 — 일반 route 파일들은 이 존재를 몰라도 됨
const internals = {
  runWithSchema: (schema, fn) => schemaContext.run(schema, fn),
};

// 기존 코드가 그대로 `const supabase = require('./services/supabase'); supabase.from(...)`
// 식으로 쓸 수 있도록, 겉으로는 평범한 supabase 클라이언트처럼 보이는 Proxy를 내보냄.
// from()만 위의 hybridFrom으로 가로채서 읽기/쓰기를 분리하고,
// 그 외(auth/rpc/storage 등)는 기존처럼 테스트 모드 여부에 따라 통째로 연결함.
const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop in internals) return internals[prop];
      if (prop === 'from') return hybridFrom;
      const client = schemaContext.getStore() === 'test' ? supabaseTest : supabasePublic;
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }
);

module.exports = supabase;
