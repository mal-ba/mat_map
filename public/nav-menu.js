// 공통 햄버거 메뉴
// - 모든 페이지의 <header class="topbar">에 자동으로 햄버거 버튼과 드롭다운을 삽입합니다.
// - 이 파일 하나만 고치면 모든 페이지의 메뉴 항목이 한 번에 바뀝니다.
(function () {
  var MENU_ITEMS = [
    { icon: '🗺️', label: '지도 보러가기', href: '/map.html' },
    { icon: '📖', label: '소개', href: '/about.html' },
    { icon: '📋', label: '사용법', href: '/guide.html' },
    { icon: '🏪', label: '사장님 (인증·가게관리)', href: '/claim.html' },
    { icon: '🎯', label: '맞춤추천 구독 결제', href: '/subscribe.html' },
  ];

  function injectStyle() {
    if (document.getElementById('jjinHamburgerStyle')) return;
    var style = document.createElement('style');
    style.id = 'jjinHamburgerStyle';
    style.textContent = [
      '.jjin-hamburger-wrap{position:relative;display:inline-flex;align-items:center;}',
      '.jjin-hamburger-btn{',
      '  width:40px;height:40px;border-radius:10px;border:1.5px solid var(--line,#E7E4DF);',
      '  background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;',
      '  font-size:18px;color:var(--ink,#1C1917);line-height:1;flex-shrink:0;',
      '}',
      '.jjin-hamburger-btn:hover{background:var(--paper-deep,#F6F4F1);}',
      '.jjin-hamburger-menu{',
      '  position:absolute;top:calc(100% + 8px);right:0;min-width:230px;',
      '  background:#fff;border:1px solid var(--line,#E7E4DF);border-radius:12px;',
      '  box-shadow:0 12px 30px rgba(28,25,23,.15);padding:6px;z-index:1000;',
      '  display:none;flex-direction:column;gap:2px;',
      '}',
      '.jjin-hamburger-menu.open{display:flex;}',
      '.jjin-hamburger-menu a{',
      '  display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;',
      '  text-decoration:none;color:var(--ink,#1C1917);font-family:"Noto Sans KR",sans-serif;',
      '  font-size:14px;font-weight:700;white-space:nowrap;',
      '}',
      '.jjin-hamburger-menu a:hover{background:var(--paper-deep,#F6F4F1);}',
      '.jjin-hamburger-divider{height:1px;background:var(--line,#E7E4DF);margin:4px 6px;}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function buildMenuHtml() {
    var html = '';
    MENU_ITEMS.forEach(function (item, idx) {
      // 결제 항목(맞춤추천, 배열의 마지막 항목) 앞에 구분선 삽입
      if (idx === MENU_ITEMS.length - 1) html += '<div class="jjin-hamburger-divider"></div>';
      html += '<a href="' + item.href + '" data-jjin-idx="' + idx + '">' + item.icon + ' ' + item.label + '</a>';
    });
    return html;
  }

  // '사장님' 메뉴 항목: 홈 화면(index.html)처럼 페이지 안에 이미 사장님 메뉴 버튼/다이얼로그가
  // 있는 경우에는 페이지 이동 없이 바로 그 창을 열어줍니다. 없는 페이지에서는 claim.html로 이동합니다.
  function handleOwnerMenuClick(e) {
    var ownerBtn = document.getElementById('ownerMenuBtn');
    if (ownerBtn) {
      e.preventDefault();
      ownerBtn.click();
    }
    // ownerBtn이 없는 페이지(map, community 등)는 기본 동작대로 /claim.html로 이동합니다.
  }

  function findInsertTarget(topbar) {
    var last = topbar.lastElementChild;
    if (last && last.tagName === 'DIV') return last; // 오른쪽 버튼 묶음 div가 있으면 그 안에 삽입
    return topbar; // 없으면 topbar 바로 아래에 삽입
  }

  function init() {
    var topbar = document.querySelector('header.topbar, .topbar');
    if (!topbar) return;
    if (topbar.querySelector('.jjin-hamburger-wrap')) return; // 중복 삽입 방지

    injectStyle();

    var wrap = document.createElement('div');
    wrap.className = 'jjin-hamburger-wrap';
    wrap.innerHTML =
      '<button type="button" class="jjin-hamburger-btn" id="jjinHamburgerBtn" aria-label="메뉴 열기">☰</button>' +
      '<div class="jjin-hamburger-menu" id="jjinHamburgerMenu">' + buildMenuHtml() + '</div>';

    findInsertTarget(topbar).appendChild(wrap);

    var btn = wrap.querySelector('#jjinHamburgerBtn');
    var menu = wrap.querySelector('#jjinHamburgerMenu');

    var ownerLink = wrap.querySelector('a[data-jjin-idx="3"]'); // 🏪 사장님
    if (ownerLink) {
      ownerLink.addEventListener('click', function (e) {
        handleOwnerMenuClick(e);
        menu.classList.remove('open');
      });
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) menu.classList.remove('open');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') menu.classList.remove('open');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
