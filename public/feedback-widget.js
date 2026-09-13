// ---------- 찐맛집 문의/제보 위젯 (챗봇 + 버그·건의 제보) ----------
// 아무 페이지에나 <script src="/feedback-widget.js"></script> 한 줄만 추가하면 동작합니다.
(function () {
  const STYLE = `
  #jjinFabBtn{
    position:fixed; right:18px; bottom:18px; z-index:9000;
    width:52px; height:52px; border-radius:50%;
    background:#B23A2E; color:#E7DCC3; border:none;
    box-shadow:0 4px 14px rgba(0,0,0,.28); font-size:22px; cursor:pointer;
    display:flex; align-items:center; justify-content:center;
  }
  #jjinFabPanel{
    position:fixed; right:18px; bottom:82px; z-index:9000;
    width:320px; max-width:calc(100vw - 36px); height:440px; max-height:70vh;
    background:#FFFFFF; border:1px solid #E7E4DF; border-radius:14px;
    box-shadow:0 8px 28px rgba(0,0,0,.25); display:none; flex-direction:column; overflow:hidden;
    font-family:'Noto Sans KR',sans-serif;
  }
  #jjinFabPanel.open{ display:flex; }
  #jjinFabTabs{ display:flex; border-bottom:1px solid #E7E4DF; }
  #jjinFabTabs button{
    flex:1; padding:10px 6px; border:none; background:#F6F4F1; color:#8A8580;
    font-size:13px; font-weight:700; cursor:pointer;
  }
  #jjinFabTabs button.active{ background:#fff; color:#1C1917; border-bottom:2px solid #B23A2E; }
  .jjinFabPane{ display:none; flex:1; min-height:0; flex-direction:column; }
  .jjinFabPane.active{ display:flex; }

  #jjinChatLog{ flex:1; overflow-y:auto; padding:10px 12px; font-size:13px; }
  .jjinMsg{ margin-bottom:10px; line-height:1.5; }
  .jjinMsg.user{ text-align:right; }
  .jjinMsg .bubble{ display:inline-block; padding:8px 11px; border-radius:10px; max-width:85%; white-space:pre-wrap; }
  .jjinMsg.user .bubble{ background:#B23A2E; color:#fff; }
  .jjinMsg.bot .bubble{ background:#F6F4F1; color:#1C1917; }
  #jjinChatInputRow{ display:flex; gap:6px; padding:10px; border-top:1px solid #E7E4DF; }
  #jjinChatInputRow input{
    flex:1; padding:8px 10px; border:1.5px solid #E7E4DF; border-radius:8px; font-size:13px;
  }
  #jjinChatInputRow button{
    background:#B23A2E; color:#fff; border:none; border-radius:8px; padding:0 14px; font-size:13px; cursor:pointer;
  }

  #jjinFeedbackForm{ padding:12px; display:flex; flex-direction:column; gap:8px; flex:1; }
  #jjinFeedbackForm select, #jjinFeedbackForm textarea, #jjinFeedbackForm input{
    border:1.5px solid #E7E4DF; border-radius:8px; padding:8px 10px; font-size:13px; font-family:inherit;
  }
  #jjinFeedbackForm textarea{ flex:1; min-height:100px; resize:vertical; }
  #jjinFeedbackForm button{
    background:#B23A2E; color:#fff; border:none; border-radius:8px; padding:10px; font-size:13px; font-weight:700; cursor:pointer;
  }
  #jjinFeedbackStatus{ font-size:12px; min-height:16px; }
  `;

  function el(html) {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.firstChild;
  }

  function injectStyle() {
    const s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function buildUI() {
    const fab = el(`<button id="jjinFabBtn" title="문의/제보">💬</button>`);
    const panel = el(`
      <div id="jjinFabPanel">
        <div id="jjinFabTabs">
          <button data-tab="chat" class="active">챗봇에게 물어보기</button>
          <button data-tab="feedback">버그/건의 제보</button>
        </div>
        <div class="jjinFabPane active" data-pane="chat">
          <div id="jjinChatLog"></div>
          <div id="jjinChatInputRow">
            <input id="jjinChatInput" type="text" placeholder="궁금한 걸 물어보세요" />
            <button id="jjinChatSend">전송</button>
          </div>
        </div>
        <div class="jjinFabPane" data-pane="feedback">
          <form id="jjinFeedbackForm">
            <select id="jjinFbType">
              <option value="bug">버그 신고</option>
              <option value="suggestion">건의 사항</option>
              <option value="other">기타</option>
            </select>
            <textarea id="jjinFbContent" placeholder="어떤 문제가 있었는지, 어떤 점이 개선되면 좋을지 알려주세요"></textarea>
            <input id="jjinFbEmail" type="email" placeholder="답변받을 이메일 (선택)" />
            <button type="submit">보내기</button>
            <div id="jjinFeedbackStatus"></div>
          </form>
        </div>
      </div>
    `);
    document.body.appendChild(fab);
    document.body.appendChild(panel);

    fab.addEventListener('click', () => panel.classList.toggle('open'));

    panel.querySelectorAll('#jjinFabTabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('#jjinFabTabs button').forEach((b) => b.classList.remove('active'));
        panel.querySelectorAll('.jjinFabPane').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        panel.querySelector(`.jjinFabPane[data-pane="${btn.dataset.tab}"]`).classList.add('active');
      });
    });

    setupChat(panel);
    setupFeedback(panel);
  }

  function appendChatBubble(log, role, text) {
    const wrap = el(`<div class="jjinMsg ${role}"><span class="bubble"></span></div>`);
    wrap.querySelector('.bubble').textContent = text;
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  function setupChat(panel) {
    const log = panel.querySelector('#jjinChatLog');
    const input = panel.querySelector('#jjinChatInput');
    const sendBtn = panel.querySelector('#jjinChatSend');
    const history = [];

    appendChatBubble(log, 'bot', '안녕하세요! 찐맛집 이용 중 궁금한 점을 물어보세요 🙂');

    async function send() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      appendChatBubble(log, 'user', text);
      history.push({ role: 'user', content: text });
      const loadingMsg = el(`<div class="jjinMsg bot"><span class="bubble">...</span></div>`);
      log.appendChild(loadingMsg);
      log.scrollTop = log.scrollHeight;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: history.slice(0, -1) }),
        });
        const data = await res.json();
        loadingMsg.remove();
        if (!res.ok) {
          appendChatBubble(log, 'bot', data.error || '오류가 발생했어요.');
          return;
        }
        appendChatBubble(log, 'bot', data.reply);
        history.push({ role: 'assistant', content: data.reply });
      } catch {
        loadingMsg.remove();
        appendChatBubble(log, 'bot', '네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
      }
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  }

  function setupFeedback(panel) {
    const form = panel.querySelector('#jjinFeedbackForm');
    const status = panel.querySelector('#jjinFeedbackStatus');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const type = panel.querySelector('#jjinFbType').value;
      const content = panel.querySelector('#jjinFbContent').value.trim();
      const contact_email = panel.querySelector('#jjinFbEmail').value.trim();
      if (!content) { status.textContent = '내용을 입력해주세요.'; status.style.color = '#B23A2E'; return; }

      status.textContent = '전송 중...'; status.style.color = '#8A8580';
      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ type, content, contact_email, page_url: location.href }),
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || '전송 실패'); }
        status.textContent = '✅ 제보가 접수되었어요. 감사합니다!'; status.style.color = '#2E7D32';
        form.reset();
      } catch (err) {
        status.textContent = '❌ ' + err.message; status.style.color = '#B23A2E';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectStyle();
    buildUI();
  });
})();
