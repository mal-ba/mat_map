// beta-notice.js — 베타 테스트 안내 배너
// 이 스크립트를 넣은 페이지 맨 위에 "현재 베타 테스트 중" 안내 배너를 자동으로 띄웁니다.
// 사용자가 한 번 닫으면 localStorage에 기억해서 다시 보여주지 않습니다.
// (문구를 바꿨는데 다시 보여주고 싶다면 STORAGE_KEY 뒤의 버전 숫자를 올리세요. 예: v1 -> v2)
(function () {
  var STORAGE_KEY = 'jjinBetaNoticeDismissed_v1';

  function createBanner() {
    var banner = document.createElement('div');
    banner.id = 'betaNotice';
    banner.className = 'beta-notice';
    banner.innerHTML =
      '<div class="beta-notice-inner">' +
        '<span class="beta-notice-icon">⚠️</span>' +
        '<div class="beta-notice-text">' +
          '<strong>현재 베타 테스트 중인 서비스입니다.</strong>' +
          '<span>사업자등록번호, 카드·계좌 정보 등 민감한 정보는 입력하지 마세요.</span>' +
        '</div>' +
        '<button type="button" class="beta-notice-close" aria-label="닫기">✕</button>' +
      '</div>';

    banner.querySelector('.beta-notice-close').addEventListener('click', function () {
      banner.remove();
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) { /* 무시 */ }
    });

    return banner;
  }

  function init() {
    var dismissed = false;
    try { dismissed = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { /* 무시 */ }
    if (dismissed) return;

    var banner = createBanner();
    document.body.insertBefore(banner, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
