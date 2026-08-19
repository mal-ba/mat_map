-- Supabase SQL Editor에서 그대로 실행하세요.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_sub text unique not null,
  email text not null,
  name text,
  picture text,
  created_at timestamptz default now()
);

create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  name text not null,          -- 가게 이름
  address text not null,       -- 지번/도로명 주소
  lat double precision not null,
  lng double precision not null,
  category text,               -- 한식/카페/분식 등
  comment text,                -- 등록자 한줄평
  image_url text,
  submitted_by uuid references users(id),
  status text not null default 'pending', -- pending | verified | rejected
  verify_reason text,          -- AI/API가 남긴 판단 근거
  kakao_place_id text,         -- 카카오 로컬 검색으로 매칭된 실제 장소 id
  rating numeric,              -- 카카오에서 가져온 평점(있으면)
  review_count int,            -- 카카오에서 가져온 리뷰수(있으면)
  created_at timestamptz default now()
);

create table if not exists likes (
  user_id uuid references users(id),
  place_id uuid references places(id),
  created_at timestamptz default now(),
  primary key (user_id, place_id)
);

-- 지도에는 verified 상태만 노출
create index if not exists idx_places_status on places(status);
