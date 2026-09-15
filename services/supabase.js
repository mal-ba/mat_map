const { createClient } = require('@supabase/supabase-js');

// 운영 서버는 이 환경변수를 안 주면 그대로 'public' 스키마를 씁니다.
// 테스트 서버(Render staging)에서만 SUPABASE_SCHEMA=test 로 설정하면
// 완전히 분리된 test 스키마의 테이블을 사용하게 됩니다.
const schema = process.env.SUPABASE_SCHEMA || 'public';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    db: { schema },
  }
);

module.exports = supabase;
