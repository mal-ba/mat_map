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

// server.js에서만 쓰는 특수 기능들 — 일반 route 파일들은 이 존재를 몰라도 됨
const internals = {
  runWithSchema: (schema, fn) => schemaContext.run(schema, fn),
};

// 기존 코드가 그대로 `const supabase = require('./services/supabase'); supabase.from(...)`
// 식으로 쓸 수 있도록, 겉으로는 평범한 supabase 클라이언트처럼 보이는 Proxy를 내보냄.
// 내부적으로는 매 호출마다 지금 요청이 테스트 모드인지 확인해서
// supabasePublic / supabaseTest 중 알맞은 쪽으로 자동 전달함.
const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop in internals) return internals[prop];
      const client = schemaContext.getStore() === 'test' ? supabaseTest : supabasePublic;
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }
);

module.exports = supabase;
