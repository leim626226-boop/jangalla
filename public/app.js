const $app = document.getElementById('app');
const $nav = document.getElementById('boardNav');
const $userArea = document.getElementById('userArea');

let me = null;
let boards = [];

// ---------- 유틸 ----------
function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function fmtDate(s) {
  return String(s || '').slice(2, 16); // 26-09-17 14:30
}
async function api(url, opts = {}) {
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || '오류가 발생했습니다.');
  return data;
}
function goto(hash) { location.hash = hash; }

// ---------- 내용 렌더 (URL → 링크/이미지/유튜브/영상) ----------
function renderContent(text) {
  const escaped = esc(text);
  const lines = escaped.split(/\r?\n/).map((line) => {
    // URL 찾기
    const parts = line.split(/(https?:\/\/[^\s<>"')\]]+)/g);
    return parts.map((p) => {
      if (!/^https?:\/\//.test(p)) return p;
      if (/^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{6,}/.test(p)) {
        const m = p.match(/(?:v=|youtu\.be\/)([\w-]{6,})/);
        return `\u0000YT${m[1]}\u0000`;
      }
      if (/\.(png|jpe?g|gif|webp|bmp)(\?[^\s]*)?$/i.test(p)) return `\u0000IMG${p}\u0000`;
      if (/\.(mp4|webm|mov|m4v)(\?[^\s]*)?$/i.test(p)) return `\u0000VID${p}\u0000`;
      return `<a href="${p}" target="_blank" rel="noopener">${p}</a>`;
    }).join('');
  }).join('<br>');
  return lines
    .replace(/\u0000YT([\w-]+)\u0000/g, '<iframe src="https://www.youtube.com/embed/$1" loading="lazy" allowfullscreen></iframe>')
    .replace(/\u0000IMG(.*?)\u0000/g, '<img src="$1" alt="이미지" loading="lazy" onerror="this.outerHTML=\'<a href=&quot;$1&quot; target=&quot;_blank&quot;>이미지 링크</a>\'">')
    .replace(/\u0000VID(.*?)\u0000/g, '<video src="$1" controls preload="metadata"></video>');
}

// ---------- 상단 바 ----------
async function loadBoards() {
  boards = await api('/api/boards');
  $nav.innerHTML =
    `<a href="#/" data-slug="">🏠 홈</a>` +
    boards.map((b) =>
      `<a href="#/b/${b.slug}" data-slug="${b.slug}">${esc(b.name)}</a>`
    ).join('');
  highlightNav();
}
function highlightNav() {
  const m = location.hash.match(/^#\/b\/([^?/]+)/);
  const slug = m ? m[1] : '';
  $nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.slug === slug));
}
async function loadMe() {
  const data = await api('/api/me');
  me = data.user;
  renderUserArea();
}
function renderUserArea() {
  if (me) {
    const isAdmin = me.role === 'admin';
    $userArea.innerHTML = `
      <span class="nick">${esc(me.nickname)}${isAdmin ? ' ⭐관리자' : ''}</span>
      ${isAdmin ? '<a class="btn sm" href="#/admin">인증·게시판 관리</a>' : ''}
      <button class="btn sm" id="logoutBtn">로그아웃</button>`;
    document.getElementById('logoutBtn').onclick = async () => {
      await api('/api/logout', { method: 'POST' });
      me = null;
      renderUserArea();
      goto('#/b/free');
      render();
    };
  } else {
    $userArea.innerHTML = `
      <a class="btn sm" href="#/login">로그인</a>
      <a class="btn sm primary" href="#/join">인증 신청</a>`;
  }
}

// ---------- 라우터 ----------
function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = raw.split('?');
  const query = new URLSearchParams(queryPart || '');
  const segs = pathPart.split('/').filter(Boolean);
  return { segs, query, path: pathPart };
}

async function render() {
  const { segs, query } = parseHash();
  highlightNav();
  try {
    const isAuthPage = ['login', 'join', 'reverify'].includes(segs[0]);
    if (!isAuthPage && (!me || (!me.verified && me.role !== 'admin'))) {
      pageAccess();
      return;
    }
    if (segs.length === 0) return await pageBoard('free', query);
    if (segs[0] === 'b' && segs[1]) return await pageBoard(segs[1], query);
    if (segs[0] === 'p' && segs[1]) return await pagePost(segs[1]);
    if (segs[0] === 'write' && segs[1]) return await pageWrite(segs[1]);
    if (segs[0] === 'edit' && segs[1]) return await pageEdit(segs[1]);
    if (segs[0] === 'login') return pageLogin();
    if (segs[0] === 'join') return pageJoin();
    if (segs[0] === 'reverify') return pageReverify();
    if (segs[0] === 'admin') return pageAdmin();
    return await pageBoard('free', query);
  } catch (e) {
    $app.innerHTML = `<div class="alert-error">${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', render);

// ---------- 게시판 목록 ----------
async function pageBoard(slug, query) {
  const page = parseInt(query.get('p')) || 1;
  const q = query.get('q') || '';
  const data = await api(`/api/boards/${encodeURIComponent(slug)}/posts?p=${page}&q=${encodeURIComponent(q)}`);
  const { board, posts, total, per } = data;
  const totalPages = Math.max(1, Math.ceil(total / per));

  let pager = '';
  if (totalPages > 1) {
    const mk = (p, label, current) =>
      `<a href="#/b/${board.slug}?p=${p}${q ? '&q=' + encodeURIComponent(q) : ''}" class="${current ? 'current' : ''}">${label}</a>`;
    const pages = [];
    const start = Math.max(1, page - 4), end = Math.min(totalPages, page + 4);
    if (start > 1) pages.push(mk(1, '«'));
    for (let i = start; i <= end; i++) pages.push(mk(i, i, i === page));
    if (end < totalPages) pages.push(mk(totalPages, '»'));
    pager = `<div class="pagination">${pages.join('')}</div>`;
  }

  const rows = posts.length
    ? posts.map((p, i) => `
      <tr>
        <td>${total - (page - 1) * per - i}</td>
        <td class="title"><a href="#/p/${p.id}">${esc(p.title)}</a>
          ${p.comment_count > 0 ? `<span class="cmt">[${p.comment_count}]</span>` : ''}</td>
        <td class="author">${esc(p.author_name)}</td>
        <td>${fmtDate(p.created_at)}</td>
        <td>${p.views}</td>
        <td>${p.score > 0 ? '+' + p.score : p.score}</td>
      </tr>`).join('')
    : `<tr><td colspan="6"><div class="empty">글이 없습니다. 첫 글의 주인공이 되어보세요!</div></td></tr>`;

  $app.innerHTML = `
    <div class="layout">
      <div class="main">
        <div class="card">
          <div class="card-head">
            <h1>${esc(board.name)} ${board.forced_anon ? '<span class="sub">익명 게시판 - 모든 글이 익명으로 표시됩니다</span>' : ''}</h1>
            <a class="btn primary" href="#/write/${board.slug}">✏️ 글쓰기</a>
          </div>
          <div class="list-tools">
            <span style="font-size:12px;color:#888;">전체 ${total}개 글</span>
            <form class="search-form" id="searchForm">
              <input type="text" name="q" value="${esc(q)}" placeholder="제목/내용 검색">
              <button class="btn" type="submit">검색</button>
            </form>
          </div>
          <table class="list">
            <thead><tr><th style="width:50px;">번호</th><th>제목</th><th style="width:110px;">작성자</th><th style="width:110px;">날짜</th><th style="width:60px;">조회</th><th style="width:60px;">추천</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          ${pager}
        </div>
      </div>
      <aside class="side">
        <div class="card">
          <div class="card-head"><h1 style="font-size:15px;">📌 게시판</h1></div>
          <div style="padding:10px 16px;">
            ${boards.map((b) => `<div style="padding:6px 0;border-bottom:1px dashed #eee;"><a href="#/b/${b.slug}">${esc(b.name)}</a></div>`).join('')}
          </div>
        </div>
        ${!me ? `
        <div class="card">
          <div class="card-head"><h1 style="font-size:15px;">💡 안내</h1></div>
          <div style="padding:12px 16px;font-size:13px;color:#666;line-height:1.7;">
            부산기계공고 학생·선생님만<br>인증 후 이용할 수 있습니다.
            <div style="margin-top:10px;display:flex;gap:6px;">
              <a class="btn sm primary" href="#/login">로그인</a>
              <a class="btn sm" href="#/join">인증 신청</a>
            </div>
          </div>
        </div>` : ''}
      </aside>
    </div>`;

  document.getElementById('searchForm').onsubmit = (e) => {
    e.preventDefault();
    const qv = e.target.q.value.trim();
    goto(`#/b/${board.slug}?p=1${qv ? '&q=' + encodeURIComponent(qv) : ''}`);
  };
}

// ---------- 글 보기 ----------
async function pagePost(id) {
  const data = await api(`/api/posts/${id}`);
  const { post, attachments, votes, myVote, mine } = data;
  const isAdmin = me && me.role === 'admin';
  const canManage = mine || isAdmin;

  const attHtml = attachments.length
    ? `<div class="attach-grid">${attachments.map((a) =>
        a.kind === 'image'
          ? `<a href="${esc(a.path)}" target="_blank"><img src="${esc(a.path)}" alt="${esc(a.name)}"></a>`
          : `<video src="${esc(a.path)}" controls preload="metadata" style="max-width:100%;"></video>`
      ).join('')}</div>`
    : '';

  const cmts = (await api(`/api/posts/${id}/comments`)).comments;
  const cmtHtml = cmts.length
    ? cmts.map((c) => `
      <div class="comment">
        <div class="c-meta">
          <span class="author">${esc(c.author_name)}</span>
          <span>${fmtDate(c.created_at)}</span>
          ${(c.mine || isAdmin || c.needsPassword) ? `<button class="c-del" data-id="${c.id}" data-anon="${c.needsPassword ? 1 : 0}">삭제</button>` : ''}
        </div>
        <div class="c-body">${esc(c.content)}</div>
      </div>`).join('')
    : `<div class="empty" style="padding:20px;">아직 댓글이 없습니다.</div>`;

  $app.innerHTML = `
    <div class="card">
      <div class="post-head">
        <h1>${esc(post.title)}</h1>
        <div class="post-meta">
          <span class="author">${esc(post.author_name)}</span>
          <span>${fmtDate(post.created_at)}</span>
          <span>조회 ${post.views}</span>
          <span class="post-actions">
            <a class="btn sm" href="#/b/${post.board_slug}">목록</a>
            ${canManage ? `<a class="btn sm" href="#/edit/${post.id}">수정</a>
            <button class="btn sm danger" id="delBtn">삭제</button>` : ''}
          </span>
        </div>
      </div>
      ${attHtml}
      <div class="post-body">${renderContent(post.content)}</div>
      <div class="vote-bar">
        <button class="vote-btn up ${myVote === 1 ? 'active' : ''}" id="upBtn">👍 개추 ${votes.up}</button>
        <button class="vote-btn down ${myVote === -1 ? 'active' : ''}" id="downBtn">👎 비추 ${votes.down}</button>
      </div>
    </div>

    <div class="card">
      <div class="comment-head">💬 댓글 ${cmts.length}개</div>
      ${cmtHtml}
      <form class="comment-form" id="cmtForm">
        ${!me ? `
        <div class="anon-row">
          <input type="text" name="nickname" placeholder="닉네임" required maxlength="15">
          <input type="password" name="password" placeholder="삭제용 비밀번호(선택)">
        </div>` : ''}
        <textarea name="content" placeholder="댓글을 입력하세요" required></textarea>
        <div class="submit-row" style="margin-top:8px;">
          <button class="btn primary" type="submit">댓글 달기</button>
        </div>
      </form>
    </div>`;

  document.getElementById('upBtn').onclick = () => doVote(id, 1);
  document.getElementById('downBtn').onclick = () => doVote(id, -1);

  document.getElementById('cmtForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/posts/${id}/comments`, {
        method: 'POST',
        body: { content: f.content.value, nickname: f.nickname?.value, password: f.password?.value },
      });
      render();
    } catch (err) { alert(err.message); }
  };

  $app.querySelectorAll('.c-del').forEach((btn) => {
    btn.onclick = async () => {
      const isAnon = btn.dataset.anon === '1';
      let body = {};
      if (isAnon && !(me && me.role === 'admin')) {
        const pw = prompt('댓글 삭제 비밀번호를 입력하세요 (설정 안 했으면 삭제 불가)');
        if (pw === null) return;
        body = { password: pw };
      }
      if (!confirm('댓글을 삭제할까요?')) return;
      try {
        await api(`/api/comments/${btn.dataset.id}`, { method: 'DELETE', body });
        render();
      } catch (err) { alert(err.message); }
    };
  });

  const delBtn = document.getElementById('delBtn');
  if (delBtn) {
    delBtn.onclick = async () => {
      let body = {};
      if (!mine && !isAdmin) {
        const pw = prompt('글 삭제 비밀번호를 입력하세요');
        if (pw === null) return;
        body = { password: pw };
      }
      if (!confirm('정말 글을 삭제할까요?')) return;
      try {
        await api(`/api/posts/${id}`, { method: 'DELETE', body });
        goto(`#/b/${post.board_slug}`);
      } catch (err) { alert(err.message); }
    };
  }
}

async function doVote(id, value) {
  try {
    await api(`/api/posts/${id}/vote`, { method: 'POST', body: { value } });
    render();
  } catch (err) { alert(err.message); }
}

// ---------- 글쓰기 ----------
async function pageWrite(slug) {
  const allBoards = boards.length ? boards : await api('/api/boards');
  const board = allBoards.find((b) => b.slug === slug) || allBoards[0];

  const needNick = !me && !board.forced_anon;
  $app.innerHTML = `
    <div class="card">
      <div class="card-head"><h1>✏️ 글쓰기</h1>
        <span class="sub">${esc(board.name)}${board.forced_anon ? ' · 익명으로 올라갑니다' : ''}</span>
      </div>
      <form class="form-card" id="writeForm">
        <div class="form-row">
          <label>게시판</label>
          <select name="board">
            ${allBoards.map((b) => `<option value="${b.slug}" ${b.slug === board.slug ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select>
        </div>
        ${needNick ? `
        <div class="form-row inline">
          <div><label>닉네임</label><input type="text" name="nickname" required maxlength="15" placeholder="닉네임"></div>
          <div><label>삭제용 비밀번호 (선택)</label><input type="password" name="password" placeholder="비밀번호"></div>
        </div>` : (!me ? `
        <div class="form-row">
          <label>삭제용 비밀번호 (선택)</label>
          <input type="password" name="password" placeholder="비밀번호">
          <div class="hint">익명게시판에서는 닉네임 없이 올라갑니다.</div>
        </div>` : '')}
        <div class="form-row">
          <label>제목</label>
          <input type="text" name="title" required maxlength="100" placeholder="제목을 입력하세요">
        </div>
        <div class="form-row">
          <label>내용</label>
          <textarea name="content" required placeholder="내용을 입력하세요.

• 이미지/짤/영상 파일을 첨부할 수 있습니다.
• 유튜브 링크를 붙여넣으면 영상이 재생됩니다.
• 이미지 주소(png/jpg/gif...)를 붙여넣으면 바로 보여집니다."></textarea>
        </div>
        <div class="form-row">
          <label>파일 첨부 (이미지·짤·영상, 개당 최대 25MB)</label>
          <input type="file" name="files" multiple accept="image/*,video/*">
        </div>
        <div class="form-actions">
          <a class="btn" href="#/b/${board.slug}">취소</a>
          <button class="btn primary" type="submit">작성하기</button>
        </div>
      </form>
    </div>`;

  document.getElementById('writeForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const fd = new FormData();
    fd.append('title', f.title.value);
    fd.append('content', f.content.value);
    if (f.nickname) fd.append('nickname', f.nickname.value);
    if (f.password) fd.append('password', f.password.value);
    for (const file of f.files.files) fd.append('files', file);
    try {
      const target = f.board.value;
      const res = await api(`/api/boards/${target}/posts`, { method: 'POST', body: fd });
      goto(`#/p/${res.id}`);
    } catch (err) { alert(err.message); }
  };
}

// ---------- 글 수정 ----------
async function pageEdit(id) {
  const { post, mine } = await api(`/api/posts/${id}`);
  const isAdmin = me && me.role === 'admin';
  if (!mine && !isAdmin && !post.isAnonymous) {
    $app.innerHTML = `<div class="alert-error">본인 글만 수정할 수 있습니다.</div>`;
    return;
  }
  $app.innerHTML = `
    <div class="card">
      <div class="card-head"><h1>📝 글 수정</h1></div>
      <form class="form-card" id="editForm">
        ${post.isAnonymous ? `
        <div class="form-row">
          <label>작성 시 비밀번호</label>
          <input type="password" name="password" placeholder="비밀번호">
        </div>` : ''}
        <div class="form-row">
          <label>제목</label>
          <input type="text" name="title" required maxlength="100" value="${esc(post.title)}">
        </div>
        <div class="form-row">
          <label>내용</label>
          <textarea name="content" required>${esc(post.content)}</textarea>
        </div>
        <div class="form-actions">
          <a class="btn" href="#/p/${post.id}">취소</a>
          <button class="btn primary" type="submit">저장</button>
        </div>
      </form>
    </div>`;

  document.getElementById('editForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/posts/${id}`, {
        method: 'PUT',
        body: { title: f.title.value, content: f.content.value, password: f.password?.value || '' },
      });
      goto(`#/p/${id}`);
    } catch (err) { alert(err.message); }
  };
}

// ---------- 로그인 / 회원가입 ----------
function pageLogin() {
  $app.innerHTML = `
    <div class="card auth-card">
      <h1>로그인</h1>
      <form class="form-card" id="loginForm" style="padding:0;">
        <div class="form-row">
          <label>아이디</label>
          <input type="text" name="login_id" required>
        </div>
        <div class="form-row">
          <label>비밀번호</label>
          <input type="password" name="password" required>
        </div>
        <div class="form-actions">
          <button class="btn primary" type="submit" style="width:100%;">로그인</button>
        </div>
        <div class="hint" style="margin-top:10px;text-align:center;">
          가입 신청이 필요하신가요? <a href="#/join">인증 신청</a><br>
          인증이 반려되었나요? <a href="#/reverify">다시 신청</a>
        </div>
      </form>
    </div>`;
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { login_id: e.target.login_id.value, password: e.target.password.value } });
      await loadMe();
      await loadBoards();
      goto('#/b/free');
    } catch (err) { alert(err.message); }
  };
}

function startAutoLoginCountdown(loginId, password) {
  $app.innerHTML = `
    <div class="card auth-card">
      <h1>인증 신청이 접수되었습니다</h1>
      <div class="form-card access-message">
        <p>잠시 후 자동 승인되어 로그인됩니다.</p>
        <div class="hint">제출한 사진의 진위 여부를 자동 대조하지는 않습니다.</div>
      </div>
    </div>`;

  const finishLogin = async () => {
    try {
      await api('/api/login', { method: 'POST', body: { login_id: loginId, password } });
      await loadMe();
      await loadBoards();
      goto('#/b/free');
    } catch (err) {
      if (err.message.includes('5초')) {
        setTimeout(finishLogin, 500);
        return;
      }
      $app.innerHTML = `
        <div class="card auth-card">
          <h1>자동 로그인에 실패했습니다</h1>
          <div class="form-card access-message"><p>${esc(err.message)}</p><div class="form-actions"><a class="btn primary" href="#/login">로그인 화면으로</a></div></div>
        </div>`;
    }
  };

  setTimeout(finishLogin, 5000);
}

function pageAccess() {
  $app.innerHTML = `
    <div class="card auth-card">
      <h1>부기공 구성원 전용</h1>
      <div class="form-card access-message">
        <p>부산기계공고 학생 또는 선생님 인증 후 이용할 수 있습니다.</p>
        <div class="form-actions">
          <a class="btn" href="#/login">로그인</a>
          <a class="btn primary" href="#/join">학생·교직원 인증 신청</a>
        </div>
      </div>
    </div>`;
}

function pageJoin() {
  $app.innerHTML = `
    <div class="card auth-card">
      <h1>부기공 구성원 인증 신청</h1>
      <form class="form-card" id="joinForm" style="padding:0;" enctype="multipart/form-data">
        <div class="form-row">
          <label>구성원 유형</label>
          <select name="member_type" required>
            <option value="student">학생</option>
            <option value="teacher">선생님</option>
          </select>
        </div>
        <div class="form-row">
          <label>아이디 (영문/숫자 3~20자)</label>
          <input type="text" name="login_id" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+">
        </div>
        <div class="form-row">
          <label>비밀번호 (8자 이상)</label>
          <input type="password" name="password" required minlength="8" autocomplete="new-password">
        </div>
        <div class="form-row">
          <label>닉네임 (2~15자)</label>
          <input type="text" name="nickname" required maxlength="15">
        </div>
        <div class="form-row">
          <label>학생증 또는 교직원증 사진 (최대 8MB)</label>
          <input type="file" name="school_id_photo" accept="image/jpeg,image/png,image/webp" capture="environment" required>
          <div class="hint">JPG, PNG, WEBP 사진만 제출할 수 있습니다. 주민등록번호 등 인증에 필요 없는 개인정보는 가려 주세요. 사진은 자동 승인 후 삭제됩니다.</div>
        </div>
        <div class="form-row member-attestation">
          <label><input type="checkbox" name="member_attestation" required> 나는 부산기계공고 학생 또는 선생님이며, 본인 신분증 사진을 제출합니다.</label>
        </div>
        <div class="verification-note">신청 5초 후 자동 승인·로그인됩니다. 사진이 실제 학교 신분증인지 자동 대조하지 않으니, 본인 확인 후 신청해 주세요.</div>
        <div class="form-actions">
          <button class="btn primary" type="submit" style="width:100%;">인증 신청하기</button>
        </div>
      </form>
    </div>`;
  document.getElementById('joinForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const formData = new FormData(e.target);
      const loginId = e.target.login_id.value;
      const password = e.target.password.value;
      await api('/api/join', { method: 'POST', body: formData });
      startAutoLoginCountdown(loginId, password);
    } catch (err) { alert(err.message); }
  };
}

function pageReverify() {
  $app.innerHTML = `
    <div class="card auth-card">
      <h1>인증 다시 신청하기</h1>
      <form class="form-card" id="reverifyForm" style="padding:0;">
        <div class="form-row"><label>아이디</label><input type="text" name="login_id" required></div>
        <div class="form-row"><label>비밀번호</label><input type="password" name="password" required autocomplete="current-password"></div>
        <div class="form-row">
          <label>구성원 유형</label>
          <select name="member_type" required><option value="student">학생</option><option value="teacher">선생님</option></select>
        </div>
        <div class="form-row">
          <label>학생증 또는 교직원증 사진 (최대 8MB)</label>
          <input type="file" name="school_id_photo" accept="image/jpeg,image/png,image/webp" capture="environment" required>
          <div class="hint">주민등록번호 등 인증에 필요 없는 개인정보는 가려 주세요. 사진은 자동 승인 후 삭제됩니다.</div>
        </div>
        <div class="form-row member-attestation"><label><input type="checkbox" name="member_attestation" required> 나는 부산기계공고 학생 또는 선생님이며, 본인 신분증 사진을 제출합니다.</label></div>
        <div class="form-actions"><button class="btn primary" type="submit" style="width:100%;">다시 신청하기</button></div>
      </form>
    </div>`;
  document.getElementById('reverifyForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const loginId = e.target.login_id.value;
      const password = e.target.password.value;
      await api('/api/verification/resubmit', { method: 'POST', body: new FormData(e.target) });
      startAutoLoginCountdown(loginId, password);
    } catch (err) { alert(err.message); }
  };
}

// ---------- 관리자 ----------
async function pageAdmin() {
  if (!me || me.role !== 'admin') {
    $app.innerHTML = `<div class="alert-error">관리자만 접근할 수 있습니다.</div>`;
    return;
  }
  const [list, verificationData] = await Promise.all([
    api('/api/boards'),
    api('/api/admin/verifications'),
  ]);
  const requests = verificationData.requests;
  const verificationHtml = requests.length ? requests.map((request) => `
    <div class="verification-row">
      <div class="verification-details">
        <strong>${esc(request.nickname)}</strong> <span>(${esc(request.login_id)})</span>
        <div>${request.member_type === 'student' ? '학생' : '선생님'} · ${fmtDate(request.created_at)} · <b class="verification-status ${request.status}">${request.status === 'pending' ? '검토 대기' : request.status === 'approved' ? '승인' : '반려'}</b></div>
        ${request.status === 'pending' ? `<img class="verification-photo" src="/api/admin/verifications/${request.id}/photo" alt="${esc(request.nickname)} 인증 사진">` : ''}
      </div>
      ${request.status === 'pending' ? `<div class="verification-actions"><button class="btn sm primary" data-review="approved" data-id="${request.id}">승인</button><button class="btn sm danger" data-review="rejected" data-id="${request.id}">반려</button></div>` : ''}
    </div>`).join('') : '<div class="empty">인증 신청이 없습니다.</div>';
  $app.innerHTML = `
    <div class="card">
      <div class="card-head"><h1>🪪 구성원 인증 신청</h1></div>
      <div class="verification-list">${verificationHtml}</div>
    </div>
    <div class="card">
      <div class="card-head"><h1>⚙️ 게시판 관리</h1><a class="btn sm" href="#/b/free">나가기</a></div>
      <div class="admin-tools">
        ${list.map((b) => `
          <div class="board-admin-row">
            <span>${esc(b.name)} <span style="color:#999;">(#/b/${esc(b.slug)})${b.forced_anon ? ' · 강제익명' : ''}</span></span>
            <button class="btn sm danger" data-del="${b.id}">삭제</button>
          </div>`).join('')}
        <hr style="border:0;border-top:1px solid #eee;margin:6px 0;">
        <form id="boardForm" class="row">
          <input type="text" name="name" placeholder="새 게시판 이름 (예: 선생님께 바란다)" required>
          <input type="text" name="slug" placeholder="주소 (영문, 선택)" style="max-width:140px;">
          <label style="display:flex;align-items:center;gap:4px;font-size:13px;white-space:nowrap;">
            <input type="checkbox" name="forced_anon"> 강제익명
          </label>
          <button class="btn primary sm" type="submit">추가</button>
        </form>
      </div>
    </div>`;

  $app.querySelectorAll('[data-review]').forEach((button) => {
    button.onclick = async () => {
      const decision = button.dataset.review;
      const prompt = decision === 'approved' ? '이 신청을 승인할까요?' : '이 신청을 반려할까요?';
      if (!confirm(prompt)) return;
      try {
        await api(`/api/admin/verifications/${button.dataset.id}/review`, { method: 'POST', body: { decision } });
        await pageAdmin();
      } catch (err) { alert(err.message); }
    };
  });

  $app.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('게시판과 그 안의 모든 글이 삭제됩니다. 계속할까요?')) return;
      try {
        await api(`/api/boards/${btn.dataset.del}`, { method: 'DELETE' });
        await loadBoards();
        render();
      } catch (err) { alert(err.message); }
    };
  });
  document.getElementById('boardForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/boards', {
        method: 'POST',
        body: { name: f.name.value, slug: f.slug.value, forced_anon: f.forced_anon.checked },
      });
      await loadBoards();
      render();
    } catch (err) { alert(err.message); }
  };
}

// ---------- 시작 ----------
(async function init() {
  try {
    await loadMe();
    if (me && (me.verified || me.role === 'admin')) await loadBoards();
    else $nav.innerHTML = '';
  } catch (e) {
    $app.innerHTML = `<div class="alert-error">서버에 연결할 수 없습니다: ${esc(e.message)}</div>`;
    return;
  }
  render();
})();
