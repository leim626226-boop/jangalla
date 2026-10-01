const $app = document.getElementById('app');
const $nav = document.getElementById('boardNav');

const BOARDS = [
  { slug: 'free', name: '자유게시판' },
  { slug: 'anon', name: '익명게시판' },
  { slug: 'jjal', name: '짤방·유머' },
  { slug: 'info', name: '질문·정보' },
  { slug: 'club', name: '동아리·홍보' },
  { slug: 'meal', name: '급식·건의' },
];
const STORAGE_KEY = 'bmhs-community-mvp-v1';
let storageAvailable = true;
let viewedPostId = null;
let state = loadState();

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.posts)) return parsed;
    }
  } catch {
    storageAvailable = false;
  }
  return { posts: [] };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    storageAvailable = false;
  }
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function fmtDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function storageNotice() {
  return `<div class="storage-note">${storageAvailable
    ? '이 MVP의 글·댓글·투표는 현재 브라우저에 저장되며 다른 기기와 공유되지 않습니다.'
    : '브라우저 저장소를 사용할 수 없습니다. 이 화면을 닫으면 작성한 내용이 사라질 수 있습니다.'}</div>`;
}

function parseRoute() {
  const raw = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = raw.split('?');
  return { segments: pathPart.split('/').filter(Boolean), query: new URLSearchParams(queryPart || '') };
}

function goto(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function renderNav() {
  const current = location.hash.match(/^#\/b\/([^?/]+)/)?.[1] || '';
  $nav.innerHTML = `<a href="#/" data-slug="">🏠 홈</a>` + BOARDS.map((board) =>
    `<a href="#/b/${board.slug}" data-slug="${board.slug}">${esc(board.name)}</a>`
  ).join('');
  $nav.querySelectorAll('a').forEach((link) => link.classList.toggle('active', link.dataset.slug === current));
}

function render() {
  renderNav();
  const { segments, query } = parseRoute();
  const [route, parameter] = segments;

  if (route === 'p' && parameter) {
    renderPost(parameter);
    return;
  }
  viewedPostId = null;
  if (route === 'write') {
    renderWrite(parameter || BOARDS[0].slug);
    return;
  }
  if (route === 'b' && parameter) {
    renderBoard(parameter, query);
    return;
  }
  renderBoard(BOARDS[0].slug, query);
}

function renderBoard(slug, query) {
  const board = BOARDS.find((item) => item.slug === slug) || BOARDS[0];
  const search = query.get('q') || '';
  const posts = state.posts
    .filter((post) => post.board_slug === board.slug)
    .filter((post) => !search || `${post.title} ${post.content}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const rows = posts.length ? posts.map((post, index) => `
    <tr>
      <td>${posts.length - index}</td>
      <td class="title"><a href="#/p/${encodeURIComponent(post.id)}">${esc(post.title)}</a>${post.comments.length ? `<span class="cmt">[${post.comments.length}]</span>` : ''}</td>
      <td class="author">익명</td>
      <td>${fmtDate(post.created_at)}</td>
      <td>${post.views}</td>
      <td>${post.upvotes - post.downvotes > 0 ? '+' : ''}${post.upvotes - post.downvotes}</td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty">글이 없습니다. 첫 글을 작성해 보세요!</div></td></tr>';

  $app.innerHTML = `
    ${storageNotice()}
    <div class="layout">
      <div class="main">
        <div class="card">
          <div class="card-head">
            <h1>${esc(board.name)}</h1>
            <a class="btn primary" href="#/write/${board.slug}">✏️ 글쓰기</a>
          </div>
          <div class="list-tools">
            <span style="font-size:12px;color:#888;">현재 브라우저 글 ${posts.length}개</span>
            <form class="search-form" id="searchForm">
              <input type="text" name="q" value="${esc(search)}" placeholder="제목/내용 검색">
              <button class="btn" type="submit">검색</button>
            </form>
          </div>
          <table class="list">
            <thead><tr><th style="width:50px;">번호</th><th>제목</th><th style="width:90px;">작성자</th><th style="width:135px;">날짜</th><th style="width:60px;">조회</th><th style="width:60px;">추천</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      <aside class="side card">
        <div class="card-head"><h1 style="font-size:15px;">📌 게시판</h1></div>
        <div style="padding:10px 16px;">
          ${BOARDS.map((item) => `<div style="padding:6px 0;border-bottom:1px dashed #eee;"><a href="#/b/${item.slug}">${esc(item.name)}</a></div>`).join('')}
        </div>
      </aside>
    </div>`;

  document.getElementById('searchForm').onsubmit = (event) => {
    event.preventDefault();
    const value = event.target.q.value.trim();
    goto(`#/b/${board.slug}${value ? `?q=${encodeURIComponent(value)}` : ''}`);
  };
}

function renderWrite(slug) {
  const selectedBoard = BOARDS.find((item) => item.slug === slug) || BOARDS[0];
  $app.innerHTML = `
    ${storageNotice()}
    <div class="card">
      <div class="card-head"><h1>✏️ 익명 글쓰기</h1><span class="sub">작성자는 익명으로 표시됩니다.</span></div>
      <form class="form-card" id="writeForm">
        <div class="form-row">
          <label>게시판</label>
          <select name="board">${BOARDS.map((board) => `<option value="${board.slug}" ${board.slug === selectedBoard.slug ? 'selected' : ''}>${esc(board.name)}</option>`).join('')}</select>
        </div>
        <div class="form-row"><label>제목</label><input type="text" name="title" required maxlength="100" placeholder="제목을 입력하세요"></div>
        <div class="form-row"><label>내용</label><textarea name="content" required placeholder="내용을 입력하세요."></textarea></div>
        <div class="form-actions"><a class="btn" href="#/b/${selectedBoard.slug}">취소</a><button class="btn primary" type="submit">작성하기</button></div>
      </form>
    </div>`;

  document.getElementById('writeForm').onsubmit = (event) => {
    event.preventDefault();
    const form = event.target;
    const post = {
      id: newId(),
      board_slug: form.board.value,
      title: form.title.value.trim(),
      content: form.content.value.trim(),
      author_name: '익명',
      created_at: new Date().toISOString(),
      views: 0,
      upvotes: 0,
      downvotes: 0,
      myVote: 0,
      comments: [],
    };
    state.posts.push(post);
    saveState();
    goto(`#/p/${encodeURIComponent(post.id)}`);
  };
}

function renderPost(id) {
  const post = state.posts.find((item) => item.id === id);
  if (!post) {
    $app.innerHTML = '<div class="alert-error">이 브라우저에 저장된 글을 찾을 수 없습니다.</div><a class="btn" href="#/">게시판으로</a>';
    return;
  }
  if (viewedPostId !== id) {
    post.views += 1;
    viewedPostId = id;
    saveState();
  }
  const board = BOARDS.find((item) => item.slug === post.board_slug) || BOARDS[0];
  const comments = post.comments.length ? post.comments.map((comment) => `
    <div class="comment">
      <div class="c-meta"><span class="author">익명</span><span>${fmtDate(comment.created_at)}</span></div>
      <div class="c-body">${esc(comment.content)}</div>
    </div>`).join('') : '<div class="empty" style="padding:20px;">아직 댓글이 없습니다.</div>';

  $app.innerHTML = `
    ${storageNotice()}
    <div class="card">
      <div class="post-head">
        <h1>${esc(post.title)}</h1>
        <div class="post-meta">
          <span class="author">익명</span><span>${fmtDate(post.created_at)}</span><span>조회 ${post.views}</span>
          <span class="post-actions"><a class="btn sm" href="#/b/${board.slug}">목록</a></span>
        </div>
      </div>
      <div class="post-body">${esc(post.content).replace(/\r?\n/g, '<br>')}</div>
      <div class="vote-bar">
        <button class="vote-btn up ${post.myVote === 1 ? 'active' : ''}" id="upBtn">👍 개추 ${post.upvotes}</button>
        <button class="vote-btn down ${post.myVote === -1 ? 'active' : ''}" id="downBtn">👎 비추 ${post.downvotes}</button>
      </div>
    </div>
    <div class="card">
      <div class="comment-head">💬 댓글 ${post.comments.length}개</div>
      ${comments}
      <form class="comment-form" id="commentForm">
        <textarea name="content" placeholder="익명 댓글을 입력하세요" required maxlength="2000"></textarea>
        <div class="submit-row" style="margin-top:8px;"><button class="btn primary" type="submit">댓글 달기</button></div>
      </form>
    </div>`;

  document.getElementById('upBtn').onclick = () => changeVote(post, 1);
  document.getElementById('downBtn').onclick = () => changeVote(post, -1);
  document.getElementById('commentForm').onsubmit = (event) => {
    event.preventDefault();
    const content = event.target.content.value.trim();
    if (!content) return;
    post.comments.push({ id: newId(), author_name: '익명', content, created_at: new Date().toISOString() });
    saveState();
    render();
  };
}

function changeVote(post, nextVote) {
  if (post.myVote === nextVote) {
    if (nextVote === 1) post.upvotes -= 1;
    else post.downvotes -= 1;
    post.myVote = 0;
  } else {
    if (post.myVote === 1) post.upvotes -= 1;
    if (post.myVote === -1) post.downvotes -= 1;
    if (nextVote === 1) post.upvotes += 1;
    else post.downvotes += 1;
    post.myVote = nextVote;
  }
  saveState();
  render();
}

window.addEventListener('hashchange', render);
renderNav();
render();
