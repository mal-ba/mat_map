# 찐맛집 (mat-map)

사람들이 발견한 맛집을 등록하면, 실존 여부를 확인하고
애매한 경우 AI가 한 번 더 검증한 뒤 지도에 공개하는 서비스.

## 준비물 (키 발급)

1. **Supabase** (supabase.com) — 프로젝트 생성 후
   - SQL Editor에서 `schema.sql` 내용 실행
   - Project Settings > API 에서 `URL`, `service_role key` 복사
2. **Google Cloud Console** (console.cloud.google.com)
   - OAuth 동의화면 설정 → 사용자 인증 정보 → OAuth 클라이언트 ID (웹 애플리케이션)
   - 승인된 자바스크립트 원본에 `http://localhost:3000` 등록 (배포 시 도메인 추가)
3. **카카오 개발자센터** (developers.kakao.com)
   - 애플리케이션 생성 → JS 키(지도 표시용), REST API 키(장소 검색용) 복사
   - 플랫폼 > Web에 사이트 도메인 등록
4. (선택) **Anthropic API 키** — 애매한 케이스에서 AI가 이중 판단하게 하려면 필요.
   없어도 카카오 존재확인만으로 동작함.

## 실행

```bash
cp .env.example .env
# .env 파일을 열어서 위에서 발급받은 키들을 채워넣기

npm install
npm start
```

`http://localhost:3000` 접속.

## 다음 단계 (제안)

- 이미지 업로드: Supabase Storage 버킷 만들어서 `image_url`에 연결
- 좋아요/북마크: `likes` 테이블 이미 스키마에 있음, API만 추가하면 됨
- 관리자 페이지: `status=pending`/`rejected` 목록을 사람이 최종 검수하는 화면
- 앱 전환: 이 구조 그대로 PWA(manifest + service worker) 붙이면 APK 패키징 가능
  (UNEXPOSED 프로젝트에서 썼던 PWABuilder 방식 그대로 적용 가능)

## 폴더 구조

```
mat-map/
  server.js            # Express 진입점
  schema.sql            # Supabase DB 스키마
  routes/
    auth.js             # 구글 로그인
    places.js           # 맛집 CRUD
    requireAuth.js       # 로그인 확인 미들웨어
  services/
    supabase.js
    verifyPlace.js       # 카카오 검증 + AI 이중 검증
  public/
    index.html
    style.css
    app.js
```
